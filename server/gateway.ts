import express from "express";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { z } from "zod";
import { Store } from "./store.ts";
import { readSessionPreview } from "./session-preview.ts";
import { deleteSavedSession } from "./delete-session.ts";
import { WorkspaceAccess } from "./workspace-access.ts";
import { createWorkspace } from "./workspaces.ts";
import { workspaceDataDir, assertDataPath } from "./workspace-data.ts";
import { attachmentUploadRoute, attachmentDownloadRoute, ATTACHMENT_JSON_LIMIT } from "../shared/attachments.ts";
import { WorkspaceWorkers } from "./workspace-workers.ts";
import { launcherAuth } from "./launcher-auth.ts";
import { NativeDirectoryPicker } from "./native-directory-picker.ts";
import type { ModelInfo, Project, SessionInfo } from "../shared/types.ts";
import { installSettingsRoutes, readSettings } from "./settings.ts";
import { createModels } from "./models.ts";
import { ProviderAccounts, installProviderAccountRoutes } from "./provider-accounts.ts";
import { installCustomConnectionRoutes } from "./custom-connections.ts";
import { withinPath } from "./execution.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { installInstructionsRoute } from "./instructions.ts";

// This process handles browser requests and worker lifecycle. It deliberately
// imports neither Pi sessions nor executable server plugins.
const appRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const requestedDataDir = resolve(
  process.env.MARGIN_DATA_DIR ?? join(appRoot, ".margin-data"),
);
mkdirSync(requestedDataDir, { recursive: true });
const dataDir = realpathSync(requestedDataDir);
const registry = new Store(join(dataDir, "margin.sqlite"));
const access = new WorkspaceAccess({ mode: "native" }, appRoot, dataDir);
const workspaceParent = resolve(
  process.env.MARGIN_WORKSPACE_PARENT ?? join(homedir(), "Projects"),
);
const workers = new WorkspaceWorkers(appRoot, dataDir);
const auth = launcherAuth(dataDir);
const directoryPicker = new NativeDirectoryPicker(appRoot);
function projectView(project: Project): Project {
  return {
    ...project,
    name:
      project.path === appRoot && !project.renamed ? "Margin" : project.name,
    kind: project.path === appRoot ? "margin" : "project",
    launchWritable: access.canOpen(project.path),
  };
}
function register(path: string): Project {
  const canonical = access.requireDirectory(path);
  const existing = registry.projects().find((p) => p.path === canonical);
  if (existing) return projectView(existing);
  if (canonical !== appRoot && withinPath(canonical, appRoot))
    throw new Error("Choose a workspace folder outside Margin's source folder, such as ~/Projects. Use Customize Margin to edit the app itself.");
  const project = {
    id: randomUUID(),
    name: basename(canonical),
    path: canonical,
  };
  registry.put("project", project.id, project);
  return projectView(project);
}
const margin = register(appRoot);
const initialPaths = JSON.parse(
  process.env.MARGIN_INITIAL_PROJECTS ?? "[]",
) as string[];
for (const path of initialPaths) register(path);
const initial = initialPaths[0] ? register(initialPaths[0]) : margin;
for (const session of registry.sessions()) {
  if (!registry.get("session-owner", session.id))
    registry.put("session-owner", session.id, session.projectId);
}
function projects() {
  return registry
    .projects()
    .filter((p) => access.canOpen(p.path))
    .map(projectView);
}
function projectById(id: string) {
  const project = registry.get<Project>("project", id);
  if (!project) throw new Error("Workspace not found.");
  if (access.requireDirectory(project.path) !== project.path)
    throw new Error(
      "This workspace moved. Reopen its folder to use the new location.",
    );
  return projectView(project);
}
function sessionsFor(project: Project): SessionInfo[] {
  const path = join(
    workspaceDataDir(dataDir, appRoot, project),
    "margin.sqlite",
  );
  if (
    !existsSync(path) &&
    registry.get<{ ready: boolean }>("workspace-storage", project.id)?.ready
  )
    throw new Error(
      "Workspace data is missing; it has not been replaced with older data.",
    );
  if (path === join(dataDir, "margin.sqlite") || !existsSync(path))
    return registry.sessions().filter((s) => s.projectId === project.id);
  assertDataPath(workspaceDataDir(dataDir, appRoot, project), path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000");
    return (
      db.prepare("SELECT value FROM records WHERE kind='session'").all() as {
        value: string;
      }[]
    )
      .map((row) => {
        const session = JSON.parse(row.value) as SessionInfo;
        const activity = db
          .prepare("SELECT value FROM records WHERE kind='activity' AND id=?")
          .get(session.id) as { value: string } | undefined;
        return {
          ...session,
          activity: activity ? JSON.parse(activity.value) : undefined,
        } as SessionInfo;
      })
      .filter(
        (s) =>
          s.projectId === project.id &&
          registry.get("session-owner", s.id) === project.id,
      );
  } finally {
    db.close();
  }
}
function sessionProject(id: string) {
  const projectId = registry.get<string>("session-owner", id);
  if (!projectId) throw new Error("Conversation not found.");
  return projectById(projectId);
}

const port = Number(process.env.PORT ?? 4317);
// The disposable installation can coexist with another Margin on the same host.
// Cookies are shared across ports, so the trial launcher supplies a distinct name.
const launcherCookie = process.env.MARGIN_LAUNCHER_COOKIE ?? "margin_launcher";
const app = express();
app.set("case sensitive routing", true);
app.disable("x-powered-by");
app.use((req, res, next) => {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(req.headers.host ?? ""))
    return res.status(403).json({ error: "Use Margin's local address." });
  try {
    if (req.headers.origin && !hosts.has(new URL(req.headers.origin).host))
      return res
        .status(403)
        .json({ error: "Cross-origin requests are not allowed." });
  } catch {
    return res.status(403).end();
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Margin-Host", "gateway");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`,
  );
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "sandbox; default-src 'none'; frame-ancestors 'none'",
    );
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ error: "Expected JSON." });
    const cookie =
      req.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(`${launcherCookie}=`))
        ?.slice(launcherCookie.length + 1) ?? "";
    if (req.path !== "/api/connect" && !auth.accepts(cookie))
      return res.status(401).json({
        error:
          "Open the connection link printed by Margin in Terminal to connect this browser.",
      });
  }
  next();
});
app.post(attachmentUploadRoute, express.json({ limit: ATTACHMENT_JSON_LIMIT }));
app.use(express.json({ limit: "2mb" }));
app.post("/api/connect", (req, res) => {
  if (typeof req.body.token !== "string" || !auth.accepts(req.body.token))
    return res.status(403).json({
      error:
        "This connection link is invalid. Use the link printed in Terminal.",
    });
  res.cookie(launcherCookie, req.body.token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 365 * 86400000,
  });
  res.json({ ok: true });
});
async function workerFetch(
  project: Project,
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  const worker = await workers.get(project);
  return fetch(`http://127.0.0.1:${worker.port}${path}`, {
    method,
    signal,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${worker.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function proxy(
  project: Project,
  req: express.Request,
  res: express.Response,
) {
  const abort = new AbortController();
  res.once("close", () => abort.abort());
  const response = await workerFetch(
    project,
    req.originalUrl,
    req.method,
    ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
    abort.signal,
  );
  const type = response.headers.get("content-type")?.split(";")[0];
  const download = attachmentDownloadRoute.test(req.originalUrl.split("?")[0]);
  const expected = req.path.endsWith("/events")
    ? "text/event-stream"
    : download ? "application/octet-stream" : "application/json";
  if (
    type !== expected &&
    !(response.status >= 400 && type === "application/json")
  ) {
    await response.body?.cancel();
    throw new Error("Worker returned an unsupported response type.");
  }
  res.status(response.status);
  for (const name of ["content-type", "cache-control", "x-accel-buffering", ...(download ? ["content-disposition"] : [])])
    if (response.headers.has(name))
      res.setHeader(name, response.headers.get(name)!);
  res.flushHeaders();
  if (!response.body) return res.end();
  Readable.fromWeb(response.body as never)
    .on("error", () => res.destroy())
    .pipe(res);
}
app.get("/api/bootstrap", async (req, res) => {
  const available = projects();
  const selected =
    available.find(
      (p) =>
        p.id ===
        (typeof req.query.sessionId === "string"
          ? registry.get("session-owner", req.query.sessionId)
          : req.query.projectId),
    ) ?? projectById(initial.id);
  let metadata: Record<string, unknown> = {},
    modelError: string | undefined;
  try {
    const response = await workerFetch(
      selected,
      "/api/bootstrap",
      "GET",
      undefined,
      AbortSignal.timeout(35000),
    );
    if (!response.ok)
      throw new Error(((await response.json()) as { error: string }).error);
    metadata = (await response.json()) as Record<string, unknown>;
  } catch (e) {
    modelError = String(e instanceof Error ? e.message : e);
  }
  const workspaceErrors: string[] = [];
  const sessions = available.flatMap((project) => {
    try {
      return sessionsFor(project);
    } catch (e) {
      workspaceErrors.push(
        `${project.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  });
  res.json({
    ...metadata,
    projects: available,
    workspaceErrors,
    sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt),
    models: metadata.models ?? [],
    modelError: modelError ?? metadata.modelError,
    readOnlyAuth: process.env.MARGIN_AUTH_READ_ONLY === "1",
    marginProjectId: margin.id,
    workspaceParent,
    execution: { mode: "cco-workspaces" },
    capabilities: { customization: true, workspacePicker: true },
  });
});
app.get("/api/sessions", (_req, res) => {
  const workspaceErrors: string[] = [];
  const available = projects();
  const sessions = available.flatMap((project) => {
    try {
      return sessionsFor(project).map((session) => ({
        ...session,
        activity:
          session.activity &&
          !workers.isStarted(project.id) &&
          ["running", "waiting"].includes(session.activity.status)
            ? { ...session.activity, status: "stopped" as const }
            : session.activity,
      }));
    } catch (error) {
      workspaceErrors.push(`${project.name}: ${String(error)}`);
      return [];
    }
  });
  res.json({
    sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt),
    projects: available,
    workspaceErrors,
  });
});
app.patch("/api/projects/:id", async (req, res) => {
  const project = projectById(String(req.params.id));
  const { name } = z
    .object({ name: z.string().trim().min(1).max(100) })
    .strict()
    .parse(req.body);
  const renamed = { ...project, name, renamed: true };
  await workers.rename(renamed);
  registry.put("project", project.id, renamed);
  res.json(projectView(renamed));
});
app.post("/api/workspaces/choose", async (req, res) => {
  z.object({}).strict().parse(req.body);
  const abort = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const last = registry.get<string>("preference", "workspace-directory");
  const initialDirectory = [last, workspaceParent, homedir()].find(
    (path): path is string => !!path && access.canOpen(path) &&
      !withinPath(access.requireDirectory(path), appRoot),
  ) ?? homedir();
  const path = await directoryPicker.choose(initialDirectory, abort.signal);
  if (res.destroyed) return;
  if (path === null) return res.json({ project: null });
  const project = register(path);
  registry.put("preference", "workspace-directory", dirname(project.path));
  res.json({ project });
});
app.post("/api/projects", (req, res) => {
  res.json(
    register(z.object({ path: z.string().min(1) }).parse(req.body).path),
  );
});
app.post("/api/workspaces", async (req, res) => {
  const { name } = z
    .object({ name: z.string().trim().min(1).max(100) })
    .strict()
    .parse(req.body);
  if (withinPath(workspaceParent, appRoot))
    throw new Error("Set MARGIN_WORKSPACE_PARENT to a folder outside Margin's source folder.");
  mkdirSync(workspaceParent, { recursive: true });
  const parent = access.requireDirectory(workspaceParent);
  if (withinPath(parent, appRoot))
    throw new Error("The workspace parent resolves inside Margin. Choose an external folder.");
  const created = await createWorkspace(
    parent,
    name,
  );
  registry.put("project", created.id, created);
  res.json(projectView(created));
});
// Account setup belongs to the authenticated gateway, not a project worker.
// Loading ModelRuntime does not load project extensions or start an agent.
const providerAccounts = new ProviderAccounts(() =>
  createModels(dataDir, AbortSignal.timeout(15_000)),
);
installProviderAccountRoutes(app, providerAccounts);
installCustomConnectionRoutes(app);
installSettingsRoutes(app, registry, async () => {
  const response = await workerFetch(
    projectById(initial.id),
    "/api/models/refresh",
    "POST",
    {},
  );
  const body = (await response.json()) as {
    models: ModelInfo[];
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Unable to load models.");
  return body.models;
});
app.post("/api/sessions", async (req, res) => {
  const { projectId } = z
    .object({ projectId: z.string().uuid() })
    .parse(req.body);
  const project = projectById(projectId);
  const id = randomUUID();
  registry.put("session-owner", id, projectId);
  req.body.gatewaySessionId = id;
  // The gateway owns app-wide defaults; workers receive a creation-time copy.
  req.body.defaults = readSettings(registry);
  await proxy(project, req, res);
});
app.delete("/api/sessions/:id", async (req, res) => {
  const id = String(req.params.id);
  const project = sessionProject(id);
  const original = registry.get<SessionInfo>("session", id);
  const response = await workerFetch(
    project,
    `/api/sessions/${id}`,
    "DELETE",
    {},
  );
  const result = await response.json();
  if (response.ok) {
    if (original) deleteSavedSession(registry, original, dataDir);
    else registry.deleteSession(id);
  }
  res.status(response.status).json(result);
});
app.get("/api/sessions/:id/preview", (req, res) => {
  const id = String(req.params.id);
  const project = sessionProject(id);
  const directory = workspaceDataDir(dataDir, appRoot, project);
  const path = join(directory, "margin.sqlite");
  if (
    !existsSync(path) &&
    registry.get<{ ready?: boolean }>("workspace-storage", project.id)?.ready
  )
    throw new Error("Workspace data is missing.");
  if (directory === dataDir || !existsSync(path)) {
    const preview = readSessionPreview(registry.db, id);
    if (preview.session.projectId !== project.id)
      throw new Error("Conversation not found.");
    return res.json(preview);
  }
  assertDataPath(directory, path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000");
    const preview = readSessionPreview(db, id);
    if (preview.session.projectId !== project.id)
      throw new Error("Conversation not found.");
    res.json(preview);
  } finally {
    db.close();
  }
});
app.use("/api/sessions/:id", async (req, res) => {
  await proxy(sessionProject(String(req.params.id)), req, res);
});
app.post("/api/projects/:id/plugins/:pluginId/:action", async (req, res) => {
  await proxy(projectById(String(req.params.id)), req, res);
});
app.post("/api/models/refresh", async (req, res) => {
  await proxy(projectById(initial.id), req, res);
});
// Global instructions belong to the gateway, not the source worker's idle
// gate. Saves never interrupt running work; workers read them before new input.
installInstructionsRoute(app, "/api/instructions/global", () => getAgentDir(), true);
app.use("/api/projects/:id/instructions", async (req, res) => {
  await proxy(projectById(String(req.params.id)), req, res);
});
app.use("/api/customize", async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) await workers.requireIdle();
  await proxy(projectById(margin.id), req, res);
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Unknown API route." }),
);
if (process.env.NODE_ENV === "production") {
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
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(400).json({
      error:
        err instanceof z.ZodError
          ? err.issues.map((i) => i.message).join("; ")
          : err instanceof Error
            ? err.message
            : String(err),
    });
  },
);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Margin: http://127.0.0.1:${port}`);
  console.log(
    `Connect this browser: http://127.0.0.1:${port}/#connect=${auth.token}`,
  );
  console.log(
    "Pi and server plugins start inside a separate cco worker for each workspace.",
  );
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  directoryPicker.close();
  providerAccounts.close();
  await workers.close();
  registry.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
