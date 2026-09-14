import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import type { Socket } from "node:net";
import { extname } from "node:path";
import type { Artifact, PreviewConnection } from "../shared/artifacts.ts";
import {
  documentRevision,
  localAppUrl,
  readArtifactFile,
} from "./artifacts.ts";
import { markdownPage } from "./artifact-markdown.tsx";

const prefix = "/_margin_preview/";
const bridgeSource = readFileSync(
  new URL("./artifact-bridge.js", import.meta.url),
  "utf8",
);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".markdown": "text/plain; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
export function injectBridge(html: string, revision: string) {
  const script = `<script src="${prefix}bridge.js?revision=${encodeURIComponent(revision)}"></script>`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + script)
    : script + html;
}
function failure(res: ServerResponse, error: unknown, code = 400) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(
    `Margin preview: ${error instanceof Error ? error.message : String(error)}`,
  );
}
interface RunningPreview {
  sessionId: string;
  server: Server;
  port: number;
  connection: PreviewConnection;
  touch: () => void;
  close: () => void;
}
/** A separate origin per preview, no listener on the LAN, no arbitrary-target proxy endpoint. */
export class ArtifactPreviews {
  private previews = new Map<string, RunningPreview>();
  private opening = new Map<string, Promise<PreviewConnection>>();
  constructor(private blockedPorts: () => number[] = () => []) {}
  async open(
    sessionId: string,
    artifact: Artifact,
    root: string,
    parentOrigin: string,
    original = false,
  ): Promise<PreviewConnection> {
    const parent = localAppUrl(parentOrigin);
    if (parent.origin !== parentOrigin)
      throw new Error("Invalid Margin origin.");
    const target =
      artifact.kind === "app" ? localAppUrl(artifact.location) : undefined;
    const forbidden = new Set([
      ...this.blockedPorts(),
      Number(parent.port),
      ...[...this.previews.values()].map((p) => p.port),
    ]);
    if (target && forbidden.has(Number(target.port)))
      throw new Error(
        "Margin and its preview servers cannot themselves be used as generated apps.",
      );
    const key = `${sessionId}:${artifact.id}:${parentOrigin}:${original}`;
    const existing = this.previews.get(key);
    if (existing) {
      existing.touch();
      return existing.connection;
    }
    const pending = this.opening.get(key);
    if (pending) return pending;
    if (this.previews.size + this.opening.size >= 24)
      throw new Error(
        "Too many active previews. Close unused preview windows and try again after they expire.",
      );
    const promise = this.start(
      key,
      sessionId,
      artifact,
      root,
      parentOrigin,
      original,
    );
    this.opening.set(key, promise);
    try {
      return await promise;
    } finally {
      this.opening.delete(key);
    }
  }
  private async start(
    key: string,
    sessionId: string,
    artifact: Artifact,
    root: string,
    parentOrigin: string,
    original: boolean,
  ) {
    const token = randomBytes(24).toString("hex"),
      channel = randomBytes(24).toString("hex");
    const cookieName = `margin_preview_${token.slice(0, 12)}`;
    const target =
      artifact.kind === "app" ? localAppUrl(artifact.location) : undefined;
    let origin = "",
      port = 0,
      lastRequest = Date.now();
    const sockets = new Set<Socket>();
    const touch = () => {
      lastRequest = Date.now();
    };
    const authorized = (req: IncomingMessage) =>
      req.headers.host === new URL(origin).host &&
      (!req.headers.origin ||
        req.headers.origin === origin ||
        req.headers.origin === parentOrigin) &&
      req.headers.cookie
        ?.split(";")
        .some((c) => c.trim() === `${cookieName}=${token}`);
    const entry = target
      ? target.pathname + target.search + target.hash
      : "/" + artifact.location.split("/").map(encodeURIComponent).join("/");
    const server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", origin);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Cache-Control", "no-store");
        // This is not a Margin API origin, and must never be accepted as an upstream app.
        res.setHeader("X-Margin-Host", "preview");
        if (req.headers.host !== new URL(origin).host)
          return failure(res, "Use the registered preview address.", 403);
        if (url.pathname === prefix + "start") {
          if (req.method !== "GET" || url.searchParams.get("token") !== token)
            return failure(
              res,
              "Preview link expired. Reopen it in Margin.",
              403,
            );
          touch();
          res.setHeader(
            "Set-Cookie",
            `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
          );
          res.writeHead(302, { Location: entry });
          res.end();
          return;
        }
        if (!authorized(req))
          return failure(
            res,
            "Open this preview through Margin to connect.",
            403,
          );
        touch();
        if (url.pathname === prefix + "ping") {
          res.end("ok");
          return;
        }
        if (url.pathname === prefix + "bridge.js" && !original) {
          const revision = (url.searchParams.get("revision") ?? "").slice(
            0,
            100,
          );
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          res.end(
            bridgeSource.replace(
              "__MARGIN_CONFIG__",
              JSON.stringify({ parentOrigin, channel, revision }).replaceAll(
                "<",
                "\\u003c",
              ),
            ),
          );
          return;
        }
        if (url.pathname.startsWith(prefix))
          return failure(res, "Unknown preview operation.", 404);
        if (target) {
          this.proxy(req, res, target, origin, original);
          return;
        }
        if (!["GET", "HEAD"].includes(req.method ?? "GET"))
          return failure(res, "Static previews are read-only.", 405);
        const location = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        const { body, path } = readArtifactFile(root, location);
        const ext = extname(path).toLowerCase();
        let result: string | Buffer = body;
        let type = mime[ext] ?? "application/octet-stream";
        if (!original && [".md", ".markdown"].includes(ext)) {
          result = markdownPage(body.toString("utf8"), location);
          type = "text/html; charset=utf-8";
        }
        if (!original && type.startsWith("text/html"))
          result = injectBridge(result.toString(), documentRevision(body));
        res.setHeader("Content-Type", type);
        res.end(req.method === "HEAD" ? undefined : result);
      })().catch((error) => failure(res, error));
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("upgrade", (req, socket, head) => {
      if (!target || !authorized(req) || req.headers.origin !== origin) {
        socket.destroy();
        return;
      }
      touch();
      const headers: Record<string, string> = {
        host: target.host,
        origin: target.origin,
        connection: "Upgrade",
        upgrade: "websocket",
      };
      for (const name of [
        "sec-websocket-key",
        "sec-websocket-version",
        "sec-websocket-protocol",
        "sec-websocket-extensions",
      ])
        if (typeof req.headers[name] === "string")
          headers[name] = req.headers[name];
      const upstream = request({
        hostname: "127.0.0.1",
        port: target.port,
        path: req.url,
        headers,
      });
      upstream.on("upgrade", (response, remote, remoteHead) => {
        if (response.headers["x-margin-host"]) {
          remote.destroy();
          socket.destroy();
          return;
        }
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(
            response.headers,
          )
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n")}\r\n\r\n`,
        );
        if (head.length) remote.write(head);
        if (remoteHead.length) socket.write(remoteHead);
        socket.pipe(remote).pipe(socket);
        remote.on("error", () => socket.destroy());
        socket.on("error", () => remote.destroy());
        socket.on("close", () => remote.destroy());
      });
      upstream.on("response", () => socket.destroy());
      upstream.on("error", () => socket.destroy());
      upstream.setTimeout(15000, () => upstream.destroy());
      upstream.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    port = (server.address() as import("node:net").AddressInfo).port;
    origin = `http://${new URL(parentOrigin).hostname}:${port}`;
    const connection = {
      url: `${origin}${prefix}start?token=${token}`,
      origin,
      channel,
    };
    const close = () => {
      clearInterval(timer);
      for (const socket of sockets) socket.destroy();
      server.close();
      this.previews.delete(key);
    };
    const timer = setInterval(() => {
      if (Date.now() - lastRequest > 10 * 60000) close();
    }, 30000);
    timer.unref();
    this.previews.set(key, {
      sessionId,
      server,
      port,
      connection,
      touch,
      close,
    });
    return connection;
  }
  private proxy(
    req: IncomingMessage,
    res: ServerResponse,
    target: URL,
    origin: string,
    original: boolean,
  ) {
    // Never forward Margin cookies, browser credentials, or arbitrary proxy headers.
    const headers: Record<string, string> = {
      host: target.host,
      "accept-encoding": "identity",
    };
    for (const name of [
      "accept",
      "accept-language",
      "content-type",
      "content-length",
      "range",
    ])
      if (typeof req.headers[name] === "string")
        headers[name] = req.headers[name];
    if (req.headers.origin) headers.origin = target.origin;
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        method: req.method,
        path: req.url,
        headers,
      },
      (response) => {
        if (response.headers["x-margin-host"]) {
          response.resume();
          failure(
            res,
            "Margin services cannot be previewed as generated apps.",
            403,
          );
          return;
        }
        const location = response.headers.location;
        if (location) {
          const destination = new URL(
            location,
            target.origin + (req.url ?? "/"),
          );
          if (destination.origin !== target.origin) {
            response.resume();
            failure(
              res,
              "This app redirects outside its registered origin. Use Open original.",
              409,
            );
            return;
          }
          res.setHeader(
            "Location",
            origin +
              destination.pathname +
              destination.search +
              destination.hash,
          );
        }
        const skip = new Set([
          "connection",
          "transfer-encoding",
          "content-length",
          "set-cookie",
          "location",
          "cache-control",
          "etag",
          "last-modified",
          "x-margin-host",
          "referrer-policy",
        ]);
        for (const [name, value] of Object.entries(response.headers))
          if (!skip.has(name) && value !== undefined)
            res.setHeader(name, value);
        // Preserve the app's CSP and framing policies. Incompatible apps get an explicit bridge timeout in Margin.
        const html =
          !original &&
          String(response.headers["content-type"]).includes("text/html") &&
          req.method !== "HEAD";
        if (!html) {
          res.writeHead(response.statusCode ?? 502);
          response.on("error", () => res.destroy());
          response.pipe(res);
          return;
        }
        if (
          response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity"
        ) {
          response.resume();
          failure(
            res,
            "This app forces compressed HTML. Runtime annotation is not supported for it yet.",
            409,
          );
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 5 * 1024 * 1024) {
            failure(res, "HTML response exceeds the 5 MB preview limit.", 413);
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on("error", (error) => failure(res, error, 502));
        response.on("end", () => {
          if (res.writableEnded) return;
          const body = Buffer.concat(chunks);
          res.writeHead(response.statusCode ?? 200);
          res.end(injectBridge(body.toString("utf8"), documentRevision(body)));
        });
      },
    );
    upstream.setTimeout(30000, () =>
      upstream.destroy(new Error("The generated app did not respond in time.")),
    );
    upstream.on("error", (error) => failure(res, error, 502));
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  }
  closeSession(sessionId: string) {
    for (const preview of this.previews.values())
      if (preview.sessionId === sessionId) preview.close();
  }
  close() {
    for (const preview of this.previews.values()) preview.close();
  }
}
