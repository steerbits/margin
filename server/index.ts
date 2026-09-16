import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./store.ts";
import { ArtifactPreviews } from "./artifact-preview.ts";
import { ArtifactStore } from "./artifacts.ts";
import { installArtifactRoutes } from "./artifact-routes.ts";
import { installAttachmentRoutes } from "./attachment-routes.ts";
import { attachmentUploadRoute, ATTACHMENT_JSON_LIMIT, MAX_DRAFT_ATTACHMENTS } from "../shared/attachments.ts";
import { readSessionPreview } from "./session-preview.ts";
import { SessionActivityTracker } from "./session-activity.ts";
import { snapshotStream } from "./snapshot-stream.ts";
import { RuntimeOwner } from "./runtime-owner.ts";
import { runtimeLog } from "./runtime-log.ts";
import { deleteSavedSession } from "./delete-session.ts";
import { LiveSession, errorText } from "./sessions.ts";
import { createModels, listModels } from "./models.ts";
import { ProviderAccounts, installProviderAccountRoutes } from "./provider-accounts.ts";
import { installCustomConnectionRoutes } from "./custom-connections.ts";
import {
  installSettingsRoutes,
  modelReferenceSchema,
  newConversationSettings,
  readSettings,
  settingsSchema,
} from "./settings.ts";
import { loadPlugins } from "./plugins.ts";
import type { Project, SessionInfo } from "../shared/types.ts";
import { executionInfo } from "./execution.ts";
import { CheckpointHistory } from "./checkpoints.ts";
import {
  pluginCatalog,
  pluginPreferences,
  setPluginEnabled,
} from "./plugin-management.ts";
import { WorkspaceAccess } from "./workspace-access.ts";
import { NativeDirectoryPicker } from "./native-directory-picker.ts";
import { pluginStorage } from "./plugin-storage.ts";
import {
  backendRegistry,
  type AgentBackend,
  type BackendHost,
} from "./backend-api.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execution = executionInfo();
const workerToken = process.env.MARGIN_WORKER_TOKEN;
const boundProjectId = process.env.MARGIN_WORKSPACE_ID;
if (workerToken) {
  process.chdir(process.env.MARGIN_WORKSPACE_PATH!);
  delete process.env.GIT_CEILING_DIRECTORIES;
}
if (workerToken && (!boundProjectId || execution.mode !== "cco"))
  throw new Error("Invalid workspace worker configuration.");
function requireWorkspace(id: string) {
  if (boundProjectId && id !== boundProjectId)
    throw new Error("This worker belongs to a different workspace.");
}

const projectView = (project: Project): Project => ({
  ...project,
  name:
    resolve(project.path) === appRoot && !project.renamed
      ? "Margin"
      : project.name,
  kind: resolve(project.path) === appRoot ? "margin" : "project",
  launchWritable:
    execution.mode === "cco"
      ? workspaceAccess.canOpen(project.path)
      : undefined,
});
const dataDir = resolve(
  process.env.MARGIN_DATA_DIR ?? join(appRoot, ".margin-data"),
);
await mkdir(dataDir, { recursive: true });
// Claim exclusive runtime ownership before loading plugins or creating agents.
const runtimeOwner = new RuntimeOwner(dataDir);
const reservation = workerToken
  ? (process.env.MARGIN_RUNTIME_GENERATION ?? "")
  : runtimeOwner.reserve().generation;
const runtimeIdentity = runtimeOwner.claim(reservation);
const assertOwnership = () => runtimeOwner.assert(runtimeIdentity.generation);
process.on("uncaughtExceptionMonitor", () => {
  runtimeLog(dataDir, {
    event: "uncaught-error",
    generation: runtimeIdentity.generation,
    pid: process.pid,
    reason: "uncaught runtime error",
  });
});
const memoryTimer = setInterval(() => {
  const memory = process.memoryUsage();
  runtimeLog(dataDir, {
    event: "memory",
    generation: runtimeIdentity.generation,
    pid: process.pid,
    heapBytes: memory.heapUsed,
    rssBytes: memory.rss,
  });
}, 30000);
memoryTimer.unref();
const workspaceAccess = new WorkspaceAccess(execution, appRoot, dataDir);
const store = new Store(join(dataDir, "margin.sqlite"));
const history = new CheckpointHistory(appRoot, dataDir);
let loadedSourceTree: string | undefined;
try {
  if (
    !boundProjectId ||
    resolve(process.env.MARGIN_WORKSPACE_PATH ?? "") === appRoot
  )
    history.acknowledgeStartup();
  if (
    (!boundProjectId ||
      resolve(process.env.MARGIN_WORKSPACE_PATH ?? "") === appRoot) &&
    history.state().available
  )
    loadedSourceTree = history.currentTree();
} catch (error) {
  console.error(`History status: ${errorText(error)}`);
}
const initialCatalog = pluginCatalog(appRoot),
  loadedFolders = new Set<string>(),
  pluginErrors = new Map<string, string>();
const plugins = [
  ...(await loadPlugins(join(appRoot, "plugins"), {
    disabled: new Set(pluginPreferences(appRoot).disabled),
    onLoaded: (folder) => loadedFolders.add(folder),
    onError: (folder, error) => pluginErrors.set(folder, errorText(error)),
  })),
  ...(process.env.MARGIN_TEST_MODE === "1"
    ? await loadPlugins(join(appRoot, "tests", "plugins"))
    : []),
];
const live = new Map<string, AgentBackend>();
const trackers = new Map<string, SessionActivityTracker>();
const deleting = new Set<string>();
for (const session of store.sessions()) {
  new ArtifactStore(store, session.id).recoverUnstartedBatches();
  if (
    session.activity &&
    ["running", "waiting"].includes(session.activity.status)
  )
    store.put("activity", session.id, {
      ...session.activity,
      status: "stopped",
    });
}
function observe(snapshot: import("../shared/types.ts").Snapshot) {
  const id = snapshot.session.id;
  const tracker = trackers.get(id);
  if (tracker && !deleting.has(id)) {
    const previous = JSON.stringify(tracker.activity);
    const activity = tracker.update(snapshot);
    if (previous !== JSON.stringify(activity))
      store.put("activity", id, activity);
  }
  return {
    ...snapshot,
    session: { ...snapshot.session, activity: tracker?.activity },
  };
}
for (const p of initialCatalog)
  if (p.enabled && !p.server) loadedFolders.add(p.id);
const activePluginFolders = [
  ...loadedFolders,
  ...(process.env.MARGIN_TEST_MODE === "1" ? ["lab"] : []),
];
const host: BackendHost = { store, dataDir, appRoot, plugins };
const backends = backendRegistry([
  {
    id: "pi",
    label: "Pi",
    models: async () => listModels(await createModels(dataDir)),
    create: (info, project, h) =>
      new LiveSession(info, project, h.store, h.dataDir, h.appRoot, h.plugins, {
        storage: runtimeOwner,
        recovery: runtimeIdentity,
      }),
  },
  ...plugins.flatMap((p) => p.backends ?? []),
]);
const port = Number(process.env.PORT ?? 4317);
const app = express(),
  secret = randomBytes(32).toString("hex");
let listeningPort = port;
const artifactPreviews = new ArtifactPreviews(() => [listeningPort]);
app.set("case sensitive routing", true);
app.disable("x-powered-by");
app.use((req, res, next) => {
  const hosts = new Set([
    `127.0.0.1:${listeningPort}`,
    `localhost:${listeningPort}`,
  ]);
  if (!hosts.has(req.headers.host ?? ""))
    return res
      .status(403)
      .json({ error: "Margin only accepts requests to its local address." });
  if (req.headers.origin && !hosts.has(new URL(req.headers.origin).host))
    return res
      .status(403)
      .json({ error: "Cross-origin requests are not allowed." });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Margin-Host", "worker");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`,
  );
  if (!req.path.startsWith("/api/") && req.accepts("html") && !workerToken)
    res.cookie("margin_session", secret, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
  if (req.path.startsWith("/api/")) {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("margin_session="))
      ?.slice("margin_session=".length);
    if (
      workerToken
        ? req.headers.authorization !== `Bearer ${workerToken}`
        : cookie !== secret
    )
      return res
        .status(401)
        .json({ error: "Open Margin in your browser to connect." });
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ error: "Expected JSON." });
  }
  next();
});
app.post(attachmentUploadRoute, express.json({ limit: ATTACHMENT_JSON_LIMIT }));
app.use(express.json({ limit: "2mb" }));
const asyncRoute =
  (
    fn: (
      req: express.Request,
      res: express.Response,
    ) => Promise<unknown> | unknown,
  ): express.RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

if (boundProjectId) {
  const project = {
    id: boundProjectId,
    name: process.env.MARGIN_WORKSPACE_NAME ?? "Workspace",
    path: process.env.MARGIN_WORKSPACE_PATH!,
    renamed: process.env.MARGIN_WORKSPACE_RENAMED === "1",
  };
  if (
    !project.path ||
    execution.mode !== "cco" ||
    project.path !== execution.projectRoot
  )
    throw new Error("Workspace path does not match cco launch.");
  store.put("project", project.id, project);
}
if (
  !boundProjectId &&
  !store.projects().some((p) => resolve(p.path) === appRoot)
) {
  const p: Project = {
    id: randomUUID(),
    name: "Margin",
    path: appRoot,
  };
  store.put("project", p.id, p);
}
function getLive(id: string) {
  assertOwnership();
  if (deleting.has(id)) throw new Error("Conversation is being deleted.");
  let l = live.get(id);
  const info = store.get<SessionInfo>("session", id);
  if (!info) throw new Error("Conversation not found.");
  const project = store.get<Project>("project", info.projectId);
  if (!project) throw new Error("Project not found.");
  requireWorkspace(project.id);
  workspaceAccess.requireDirectory(project.path);
  if (l) return l;
  const backend = backends.get(info.backend ?? "pi");
  if (!backend)
    throw new Error(
      "This conversation requires a backend that is not installed.",
    );
  l = backend.create(info, project, host);
  live.set(id, l);
  trackers.set(id, new SessionActivityTracker(store.get("activity", id)));
  observe(l.snapshot());
  l.onSnapshot(observe);
  return l;
}
const marginProject = () =>
  projectView(
    store.projects().find((p) => resolve(p.path) === appRoot) ?? {
      id: "unavailable",
      name: "Margin",
      path: appRoot,
    },
  );
let maintenance = false,
  sourceNeedsRestart = false,
  workspacePluginOperations = 0;
function requireIdle() {
  if (
    maintenance ||
    workspacePluginOperations > 0 ||
    [...live.values()].some((s) => s.hasActiveWork?.() ?? s.snapshot().busy)
  )
    throw new Error(
      "Finish or stop active agent work before changing code history or plugin settings.",
    );
}
const catalogView = () =>
  pluginCatalog(appRoot).map((p) => ({
    ...p,
    active: loadedFolders.has(p.id),
    error: pluginErrors.get(p.id),
  }));
async function availableModels() {
  const results = await Promise.all(
    [...backends.values()].map(async (b) =>
      (await b.models(host)).map((m) => ({ ...m, backend: b.id })),
    ),
  );
  return results.flat();
}
if (workerToken) {
  app.post("/api/worker/shutdown", (_req, res) => {
    runtimeOwner.update(runtimeIdentity.generation, { expectedStop: true });
    res.json({ ok: true });
    setImmediate(() => void shutdown());
  });
  app.get("/api/worker/status", (_req, res) =>
    res.json({
      busy:
        maintenance ||
        workspacePluginOperations > 0 ||
        [...live.values()].some(
          (s) => s.hasActiveWork?.() ?? s.snapshot().busy,
        ),
    }),
  );
  app.use((req, res, next) => {
    if (
      ["/api/projects", "/api/workspaces", "/api/workspace-folders"].includes(
        req.path,
      )
    )
      return res
        .status(403)
        .json({ error: "Open workspaces through the Margin launcher." });
    if (
      req.path.startsWith("/api/customize") &&
      boundProjectId !== marginProject().id
    )
      return res.status(403).json({
        error: "Customize Margin belongs to Margin's source workspace.",
      });
    next();
  });
}
app.get(
  "/api/bootstrap",
  asyncRoute(async (_req, res) => {
    let models: Awaited<ReturnType<typeof listModels>> = [];
    let modelError: string | undefined;
    try {
      models = await availableModels();
    } catch (e) {
      modelError = errorText(e);
    }
    const projects = store
      .projects()
      .filter(
        (p) =>
          (!boundProjectId || p.id === boundProjectId) &&
          workspaceAccess.canOpen(p.path),
      )
      .map(projectView);
    const projectIds = new Set(projects.map((p) => p.id));
    res.json({
      projects,
      sessions: store.sessions().filter((s) => projectIds.has(s.projectId)),
      models,
      modelError,
      piVersion: "0.85.1",
      readOnlyAuth: process.env.MARGIN_AUTH_READ_ONLY === "1",
      plugins: plugins.map((p) => p.id),
      activePluginFolders,
      marginProjectId: marginProject().id,
      workspaceParent: workspaceAccess.workspaceParent,
      capabilities: { customization: true, workspacePicker: true },
      execution,
    });
  }),
);
app.get(
  "/api/sessions",
  asyncRoute((_req, res) => {
    const projects = store
      .projects()
      .filter(
        (p) =>
          (!boundProjectId || p.id === boundProjectId) &&
          workspaceAccess.canOpen(p.path),
      );
    const projectIds = new Set(projects.map((p) => p.id));
    res.json({
      sessions: store.sessions().filter((s) => projectIds.has(s.projectId)),
      projects,
    });
  }),
);
app.patch(
  "/api/projects/:id",
  asyncRoute((req, res) => {
    const id = String(req.params.id);
    requireWorkspace(id);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .strict()
      .parse(req.body);
    const project = store.get<Project>("project", id);
    if (!project) throw new Error("Workspace not found.");
    project.name = name;
    project.renamed = true;
    store.put("project", id, project);
    for (const session of live.values())
      if (session instanceof LiveSession && session.project.id === id)
        Object.assign(session.project, project);
    res.json(projectView(project));
  }),
);
app.get(
  "/api/customize",
  asyncRoute((_req, res) =>
    res.json({
      project: marginProject(),
      plugins: catalogView(),
      history: history.state(),
    }),
  ),
);
app.post(
  "/api/customize/checkpoints",
  asyncRoute((req, res) => {
    requireIdle();
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(req.body);
    res.json(history.save(name));
  }),
);
app.get(
  "/api/customize/checkpoints/:id/preview",
  asyncRoute((req, res) => res.json(history.preview(String(req.params.id)))),
);
app.post(
  "/api/customize/checkpoints/:id/restore",
  asyncRoute((req, res) => {
    requireIdle();
    const { token } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.body);
    maintenance = true;
    try {
      const result = history.restore(String(req.params.id), token);
      if (result.restored) {
        sourceNeedsRestart = result.checkpoint.tree !== loadedSourceTree;
        history.setActivationPending(sourceNeedsRestart);
      }
      res.json(result);
    } finally {
      maintenance = false;
    }
  }),
);
app.post(
  "/api/customize/plugins/:id",
  asyncRoute((req, res) => {
    requireIdle();
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    history.withSavedState("Before changing plugin settings", () =>
      setPluginEnabled(appRoot, String(req.params.id), enabled),
    );
    res.json({ plugins: catalogView() });
  }),
);
const nativeDirectoryPicker = new NativeDirectoryPicker(appRoot);
if (!workerToken)
  app.post(
    "/api/workspaces/choose",
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.body);
      if (execution.mode !== "native")
        throw new Error(
          "Restart with npm start to use the native workspace dialog through Margin's launcher.",
        );
      const abort = new AbortController();
      res.once("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const last = store.get<string>("preference", "workspace-directory");
      const home = process.env.HOME ?? appRoot;
      const path = await nativeDirectoryPicker.choose(
        last && workspaceAccess.canOpen(last) ? last : home,
        abort.signal,
      );
      if (res.destroyed) return;
      if (path === null) return res.json({ project: null });
      const canonical = workspaceAccess.requireDirectory(path);
      const project = store.projects().find((p) => p.path === canonical) ?? {
        id: randomUUID(),
        name: basename(canonical),
        path: canonical,
      };
      store.put("project", project.id, project);
      store.put("preference", "workspace-directory", dirname(canonical));
      res.json({ project: projectView(project) });
    }),
  );
app.get(
  "/api/workspace-folders",
  asyncRoute(async (req, res) => {
    const { path, hidden } = z
      .object({
        path: z.string().min(1).optional(),
        hidden: z.enum(["true", "false"]).optional(),
      })
      .parse(req.query);
    res.json(await workspaceAccess.browse(path, hidden === "true"));
  }),
);
app.post(
  "/api/workspaces",
  asyncRoute(async (req, res) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .strict()
      .parse(req.body);
    const project = await workspaceAccess.create(name);
    store.put("project", project.id, project);
    res.json(projectView(project));
  }),
);
const providerAccounts = new ProviderAccounts(() =>
  createModels(dataDir, AbortSignal.timeout(15_000)),
);
if (!workerToken) {
  installSettingsRoutes(app, store, availableModels);
  installProviderAccountRoutes(app, providerAccounts);
  installCustomConnectionRoutes(app);
}
app.post(
  "/api/models/refresh",
  asyncRoute(async (_req, res) =>
    res.json({ models: await availableModels() }),
  ),
);
app.post(
  "/api/projects",
  asyncRoute(async (req, res) => {
    const input = z.object({ path: z.string().min(1) }).parse(req.body);
    const path = workspaceAccess.requireDirectory(
      input.path.replace(/^~(?=\/)/, process.env.HOME ?? ""),
    );
    const existing = store.projects().find((p) => p.path === path);
    if (existing) return res.json(projectView(existing));
    const project = { id: randomUUID(), name: basename(path), path };
    store.put("project", project.id, project);
    res.json(projectView(project));
  }),
);
app.post(
  "/api/sessions",
  asyncRoute(async (req, res) => {
    if (maintenance || sourceNeedsRestart)
      throw new Error(
        "Source files were restored. Rebuild and restart Margin before starting agent work. History controls remain available.",
      );
    const input = z
      .object({
        projectId: z.string(),
        gatewaySessionId: z.string().uuid().optional(),
        model: modelReferenceSchema.optional(),
        defaults: settingsSchema.optional(),
      })
      .parse(req.body);
    const project = store.get<Project>("project", input.projectId);
    if (!project) throw new Error("Project not found.");
    requireWorkspace(project.id);
    workspaceAccess.requireDirectory(project.path);
    const defaults = workerToken
      ? settingsSchema.parse(input.defaults)
      : readSettings(store);
    const selection = newConversationSettings(
      defaults,
      await availableModels(),
      input.model,
    );
    const info: SessionInfo = {
      id: workerToken
        ? (input.gatewaySessionId ??
          (() => {
            throw new Error("A launcher session ID is required.");
          })())
        : randomUUID(),
      projectId: input.projectId,
      title: "New conversation",
      ...selection,
      backend: selection.model.backend ?? "pi",
      backendLabel: backends.get(selection.model.backend ?? "pi")?.label,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (store.get("session", info.id))
      throw new Error("Conversation already exists.");
    store.put("session", info.id, info);
    const l = getLive(info.id);
    res.json(observe(l.snapshot()));
  }),
);
app.get(
  "/api/sessions/:id",
  asyncRoute((req, res) =>
    res.json(observe(getLive(String(req.params.id)).snapshot())),
  ),
);
app.get(
  "/api/sessions/:id/preview",
  asyncRoute((req, res) => {
    const id = String(req.params.id);
    const preview = readSessionPreview(store.db, id);
    requireWorkspace(preview.session.projectId);
    const project = store.get<Project>("project", preview.session.projectId);
    if (!project) throw new Error("Workspace not found.");
    workspaceAccess.requireDirectory(project.path);
    res.json(live.get(id)?.snapshot() ?? preview);
  }),
);
app.get(
  "/api/sessions/:id/events",
  asyncRoute((req, res) => {
    const l = getLive(String(req.params.id));
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const stream = snapshotStream<import("../shared/types.ts").Snapshot>(res, {
      serialize: (snapshot) =>
        `data: ${JSON.stringify({ type: "snapshot", snapshot: observe(snapshot) })}\n\n`,
      onStall: (queuedBytes) =>
        runtimeLog(dataDir, {
          event: "stream-stalled",
          generation: runtimeIdentity.generation,
          pid: process.pid,
          queuedBytes,
        }),
      onClose: () => {
        clearInterval(heartbeat);
        unsubscribe();
      },
    });
    const unsubscribe = l.onSnapshot(stream.send);
    const heartbeat = setInterval(stream.heartbeat, 20000);
    stream.send(l.snapshot());
  }),
);
installAttachmentRoutes(app, {
  store,
  dataDir,
  getLive,
  authorize(id) {
    assertOwnership();
    if (deleting.has(id)) throw new Error("Conversation is being deleted.");
    const session = store.get<SessionInfo>("session", id);
    if (!session) throw new Error("Conversation not found.");
    requireWorkspace(session.projectId);
    const project = store.get<Project>("project", session.projectId);
    if (!project) throw new Error("Workspace not found.");
    workspaceAccess.requireDirectory(project.path);
  },
});
const batchSchema = z.object({
  id: z.string().uuid(),
  note: z.string().max(100000),
  commentIds: z.array(z.string().uuid()).max(200),
  attachmentIds: z.array(z.string().uuid()).max(MAX_DRAFT_ATTACHMENTS).optional(),
  skill: z.string().max(200).optional(),
});
app.delete(
  "/api/sessions/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const info = store.get<SessionInfo>("session", id);
    if (!info) throw new Error("Conversation not found.");
    requireWorkspace(info.projectId);
    const session = live.get(id);
    if (deleting.has(id)) throw new Error("Conversation is being deleted.");
    if (
      session &&
      ((session.hasActiveWork?.() ?? session.snapshot().busy) ||
        session.snapshot().dialogs.length)
    )
      return res
        .status(409)
        .json({ error: "Stop this conversation before deleting it." });
    deleting.add(id);
    try {
      await session?.dispose();
      artifactPreviews.closeSession(id);
      deleteSavedSession(
        store,
        session?.info ?? store.get<SessionInfo>("session", id) ?? info,
        dataDir,
      );
      live.delete(id);
      trackers.delete(id);
      res.json({ ok: true });
    } finally {
      deleting.delete(id);
    }
  }),
);
async function sendBatch(
  id: string,
  batch: import("../shared/types.ts").FeedbackBatch,
) {
  if (maintenance || sourceNeedsRestart)
    throw new Error(
      "Rebuild and restart Margin to activate the restored source before sending more work.",
    );
  const l = getLive(id);
  await l.ready;
  if (
    l.info.projectId === marginProject().id &&
    process.env.MARGIN_TEST_MODE !== "1"
  ) {
    requireIdle();
    history.save("Before customization", "automatic", true);
  }
  if (batch.attachmentIds?.length && !l.attachmentsChanged)
    throw new Error("This runtime does not support attachments.");
  const result = await l.send(batch);
  observe(l.snapshot());
  return result;
}
app.post(
  "/api/sessions/:id/send",
  asyncRoute(async (req, res) => {
    res.json(
      await sendBatch(String(req.params.id), batchSchema.parse(req.body)),
    );
  }),
);
installArtifactRoutes(app, {
  store,
  previews: artifactPreviews,
  send: sendBatch,
  snapshot: (id) => getLive(id).snapshot(),
  project: (id) => {
    const session = store.get<SessionInfo>("session", id);
    const project = session && store.get<Project>("project", session.projectId);
    if (!project) throw new Error("Conversation not found.");
    requireWorkspace(project.id);
    workspaceAccess.requireDirectory(project.path);
    return project;
  },
});
app.post(
  "/api/sessions/:id/stop",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const session = getLive(id);
    await session.stop();
    trackers.get(id)?.stop();
    observe(session.snapshot());
    res.json({ ok: true });
  }),
);
app.post(
  "/api/sessions/:id/reload",
  asyncRoute(async (req, res) => {
    const l = getLive(String(req.params.id));
    void l.reload().catch((e) => l.notifyError(e));
    res.json({ ok: true });
  }),
);
app.post(
  "/api/sessions/:id/model",
  asyncRoute(async (req, res) => {
    const b = z
      .object({ provider: z.string(), id: z.string() })
      .parse(req.body);
    await getLive(String(req.params.id)).setModel(b.provider, b.id);
    res.json({ ok: true });
  }),
);
app.post(
  "/api/sessions/:id/thinking",
  asyncRoute(async (req, res) => {
    const { level } = z.object({ level: z.string().max(30) }).parse(req.body);
    const session = getLive(String(req.params.id));
    if (!session.setThinking)
      throw new Error("This runtime does not expose thinking effort.");
    await session.setThinking(level);
    res.json({ ok: true });
  }),
);
app.post(
  "/api/sessions/:id/dialogs/:dialogId",
  asyncRoute((req, res) => {
    const b = z
      .object({
        value: z.unknown().optional(),
        cancelled: z.boolean().optional(),
      })
      .parse(req.body);
    getLive(String(req.params.id)).answerDialog(
      String(req.params.dialogId),
      b.value,
      b.cancelled,
    );
    res.json({ ok: true });
  }),
);
app.put(
  "/api/sessions/:id/composer",
  asyncRoute((req, res) => {
    const b = z.object({ text: z.string().max(100000) }).parse(req.body);
    getLive(String(req.params.id)).setComposer(b.text);
    res.json({
      ok: true,
      composerRevision:
        store.get<number>("composer-revision", String(req.params.id)) ?? 0,
    });
  }),
);
const commentSchema = z.object({
  id: z.string().uuid(),
  anchor: z
    .object({
      messageId: z.string(),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      quote: z.string().min(1).max(50000),
      prefix: z.string().max(80),
      suffix: z.string().max(80),
    })
    .refine(
      (a) => a.end > a.start && a.end - a.start === a.quote.length,
      "Invalid selection range",
    ),
  text: z.string().trim().min(1).max(20000),
  status: z.enum(["draft", "sent", "resolved"]),
  batchId: z.string().uuid().optional(),
  createdAt: z.number(),
});
app.put(
  "/api/sessions/:id/comments",
  asyncRoute((req, res) => {
    const comments = z.array(commentSchema).max(500).parse(req.body);
    getLive(String(req.params.id)).saveComments(comments);
    res.json({ ok: true });
  }),
);
app.post(
  "/api/sessions/:id/notices/:noticeId/dismiss",
  asyncRoute((req, res) => {
    getLive(String(req.params.id)).dismissNotice(String(req.params.noticeId));
    res.json({ ok: true });
  }),
);
app.post(
  "/api/projects/:projectId/plugins/:pluginId/:action",
  asyncRoute(async (req, res) => {
    const project = store.get<Project>("project", String(req.params.projectId));
    if (!project) throw new Error("Workspace not found.");
    requireWorkspace(project.id);
    workspaceAccess.requireDirectory(project.path);
    const plugin = plugins.find((p) => p.id === req.params.pluginId);
    if (!plugin?.workspaceAction)
      throw new Error("Workspace plugin action not found.");
    workspacePluginOperations++;
    try {
      res.json({
        result: await plugin.workspaceAction(
          String(req.params.action),
          req.body,
          {
            project: projectView(project),
            storage: pluginStorage(store, plugin.id, project.id),
          },
        ),
      });
    } finally {
      workspacePluginOperations--;
    }
  }),
);
app.post(
  "/api/sessions/:id/plugins/:pluginId/:action",
  asyncRoute(async (req, res) => {
    res.json({
      result: await getLive(String(req.params.id)).pluginAction(
        String(req.params.pluginId),
        String(req.params.action),
        req.body,
      ),
    });
  }),
);

// Test fixture routes are absent in ordinary launches and never make model requests.
if (process.env.MARGIN_TEST_MODE === "1") {
  const { installFixtures } = await import("./test-fixtures.ts");
  installFixtures(app, {
    store,
    getLive: (id) => {
      const l = getLive(id);
      if (!(l instanceof LiveSession))
        throw new Error("Pi fixtures require the Pi backend.");
      return l;
    },
  });
}
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Unknown API route." }),
);
if (workerToken) {
  /* Worker APIs are only reached through the local launcher. */
} else if (process.env.NODE_ENV === "production") {
  app.use(express.static(join(appRoot, "dist")));
  app.get(
    [
      "/",
      "/chats/:id",
      "/review/:id",
      "/workspaces/:id",
      "/customize",
      "/customize/:tab",
    ],
    (_req, res) => res.sendFile(join(appRoot, "dist", "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: join(appRoot, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({
      error:
        err instanceof z.ZodError
          ? err.issues.map((i) => i.message).join("; ")
          : errorText(err),
    });
  },
);
const server = app.listen(port, "127.0.0.1", () => {
  listeningPort = (server.address() as import("node:net").AddressInfo).port;
  console.log(
    workerToken
      ? `MARGIN_WORKER_READY ${JSON.stringify({ port: listeningPort, projectId: boundProjectId, pid: process.pid, generation: runtimeIdentity.generation })}`
      : `Margin is running at http://127.0.0.1:${listeningPort}`,
  );
});
let shuttingDown = false;
async function shutdown() {
  providerAccounts.close();
  if (shuttingDown) return;
  shuttingDown = true;
  runtimeOwner.update(runtimeIdentity.generation, { expectedStop: true });
  runtimeLog(dataDir, {
    event: "shutdown",
    generation: runtimeIdentity.generation,
    pid: process.pid,
    expected: true,
  });
  clearInterval(memoryTimer);
  server.close();
  artifactPreviews.close();
  nativeDirectoryPicker.close();
  for (const l of live.values()) await l.dispose();
  for (const p of plugins) await p.dispose?.();
  store.close();
  runtimeOwner.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
