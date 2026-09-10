import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { realpath, stat, mkdir } from "node:fs/promises";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./store.ts";
import { LiveSession, errorText } from "./sessions.ts";
import { createModels, listModels } from "./models.ts";
import { loadPlugins } from "./plugins.ts";
import type { Project, SessionInfo } from "../shared/types.ts";
import { executionInfo, withinPath } from "./execution.ts";
import {
  backendRegistry,
  type AgentBackend,
  type BackendHost,
} from "./backend-api.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execution = executionInfo();
const projectView = (project: Project): Project => ({
  ...project,
  launchWritable:
    execution.mode === "cco"
      ? execution.writablePaths.some((path) => withinPath(project.path, path))
      : undefined,
});
const dataDir = resolve(
  process.env.MARGIN_DATA_DIR ?? join(appRoot, ".margin-data"),
);
await mkdir(dataDir, { recursive: true });
const store = new Store(join(dataDir, "margin.sqlite"));
const plugins = [
  ...(await loadPlugins(join(appRoot, "plugins"))),
  ...(process.env.MARGIN_TEST_MODE === "1"
    ? await loadPlugins(join(appRoot, "tests", "plugins"))
    : []),
];
const live = new Map<string, AgentBackend>();
const host: BackendHost = { store, dataDir, appRoot, plugins };
const backends = backendRegistry([
  {
    id: "pi",
    label: "Pi",
    models: async () => listModels(await createModels(dataDir)),
    create: (info, project, h) =>
      new LiveSession(info, project, h.store, h.dataDir, h.appRoot, h.plugins),
  },
  ...plugins.flatMap((p) => p.backends ?? []),
]);
const port = Number(process.env.PORT ?? 4317);
const app = express(),
  secret = randomBytes(32).toString("hex");
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!hosts.has(req.headers.host ?? ""))
    return res
      .status(403)
      .json({ error: "Margin only accepts requests to its local address." });
  if (req.headers.origin && !hosts.has(new URL(req.headers.origin).host))
    return res
      .status(403)
      .json({ error: "Cross-origin requests are not allowed." });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`,
  );
  if (req.path === "/")
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
    if (cookie !== secret)
      return res
        .status(401)
        .json({ error: "Open Margin in your browser to connect." });
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ error: "Expected JSON." });
  }
  next();
});
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

if (!store.projects().length) {
  const p: Project = {
    id: randomUUID(),
    name: basename(appRoot),
    path: appRoot,
  };
  store.put("project", p.id, p);
}
function getLive(id: string) {
  let l = live.get(id);
  if (l) return l;
  const info = store.get<SessionInfo>("session", id);
  if (!info) throw new Error("Conversation not found.");
  const project = store.get<Project>("project", info.projectId);
  if (!project) throw new Error("Project not found.");
  const backend = backends.get(info.backend ?? "pi");
  if (!backend)
    throw new Error(
      "This conversation requires a backend that is not installed.",
    );
  l = backend.create(info, project, host);
  live.set(id, l);
  return l;
}
async function availableModels() {
  const results = await Promise.all(
    [...backends.values()].map(async (b) =>
      (await b.models(host)).map((m) => ({ ...m, backend: b.id })),
    ),
  );
  return results.flat();
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
    res.json({
      projects: store.projects().map(projectView),
      sessions: store.sessions(),
      models,
      modelError,
      piVersion: "0.85.1",
      readOnlyAuth: process.env.MARGIN_AUTH_READ_ONLY === "1",
      plugins: plugins.map((p) => p.id),
      execution,
    });
  }),
);
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
    const path = await realpath(
      input.path.replace(/^~(?=\/)/, process.env.HOME ?? ""),
    );
    if (!(await stat(path)).isDirectory()) throw new Error("Choose a folder.");
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
    const input = z
      .object({
        projectId: z.string(),
        model: z
          .object({
            id: z.string(),
            provider: z.string(),
            name: z.string(),
            subscription: z.boolean(),
            backend: z.string().optional(),
          })
          .optional(),
      })
      .parse(req.body);
    if (!store.get("project", input.projectId))
      throw new Error("Project not found.");
    const info: SessionInfo = {
      id: randomUUID(),
      projectId: input.projectId,
      title: "New conversation",
      model: input.model,
      backend: input.model?.backend ?? "pi",
      backendLabel: backends.get(input.model?.backend ?? "pi")?.label,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.put("session", info.id, info);
    const l = getLive(info.id);
    res.json(l.snapshot());
  }),
);
app.get(
  "/api/sessions/:id",
  asyncRoute((req, res) => res.json(getLive(String(req.params.id)).snapshot())),
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
    const send = (snapshot: unknown) =>
      res.write(`data: ${JSON.stringify({ type: "snapshot", snapshot })}\n\n`);
    send(l.snapshot());
    const unsubscribe = l.onSnapshot(send);
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 20000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }),
);
const batchSchema = z.object({
  id: z.string().uuid(),
  note: z.string().max(100000),
  commentIds: z.array(z.string().uuid()).max(200),
  skill: z.string().max(200).optional(),
});
app.post(
  "/api/sessions/:id/send",
  asyncRoute(async (req, res) =>
    res.json(
      await getLive(String(req.params.id)).send(batchSchema.parse(req.body)),
    ),
  ),
);
app.post(
  "/api/sessions/:id/stop",
  asyncRoute(async (req, res) => {
    await getLive(String(req.params.id)).stop();
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
    res.json({ ok: true });
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
if (process.env.NODE_ENV === "production")
  app.use(express.static(join(appRoot, "dist")));
else {
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
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Margin is running at http://127.0.0.1:${port}`),
);
async function shutdown() {
  server.close();
  for (const l of live.values()) await l.dispose();
  for (const p of plugins) await p.dispose?.();
  store.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
