import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type {
  Artifact,
  ArtifactComment,
  ArtifactReview,
} from "../shared/artifacts.ts";
import type { Project } from "../shared/types.ts";
import type { Store } from "./store.ts";

export const artifactInput = z.object({
  location: z.string().trim().min(1).max(4096),
  title: z.string().trim().min(1).max(160).optional(),
});
export const artifactAnchorSchema = z.object({
  kind: z.enum(["text", "element", "page"]),
  quote: z.string().max(10000),
  prefix: z.string().max(80),
  suffix: z.string().max(80),
  selector: z.string().max(2000),
  route: z
    .string()
    .max(4096)
    .refine((s) => s.startsWith("/") && !s.startsWith("//")),
  documentRevision: z.string().max(100),
});
export const artifactCommentInput = z.object({
  id: z.string().uuid(),
  artifactId: z.string().uuid(),
  anchor: artifactAnchorSchema,
  text: z.string().max(20000), // Empty/in-progress comments are durable too.
  revision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
  deleted: z.boolean().optional(),
});
export class ReviewConflict extends Error {}

export function localAppUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.port ||
    Number(url.port) < 1024 ||
    url.username ||
    url.password
  )
    throw new Error(
      "Use an HTTP generated app at localhost or 127.0.0.1 with an explicit port (1024 or higher).",
    );
  return url;
}
const resourceExtensions = new Set([
  ".html",
  ".htm",
  ".md",
  ".markdown",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
]);
/** Resolve on every request, including symlinks. No directory listings, hidden files or source-wide file server. */
export function artifactFile(root: string, location: string) {
  const base = realpathSync(root);
  const candidate = resolve(base, location);
  const lexical = relative(base, candidate);
  const path = realpathSync(candidate);
  const rel = relative(base, path);
  for (const value of [lexical, rel]) {
    if (
      !value ||
      isAbsolute(value) ||
      value
        .split(sep)
        .some((p) => p === ".." || p.startsWith(".") || p === "node_modules")
    )
      throw new Error(
        "Preview files must be non-hidden files inside this workspace, outside node_modules.",
      );
  }
  if (!resourceExtensions.has(extname(path).toLowerCase()))
    throw new Error("This file type is not supported by artifact review yet.");
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
    throw new Error("Preview requires a regular file smaller than 32 MB.");
  return { path, relative: rel.split(sep).join("/") };
}
export function readArtifactFile(root: string, location: string) {
  const file = artifactFile(root, location);
  return { ...file, body: readFileSync(file.path) };
}
export const documentRevision = (body: string | Buffer) =>
  createHash("sha256").update(body).digest("hex");

interface ReviewRecord extends ArtifactReview {
  batches: {
    id: string;
    commentIds: string[];
    prompt: string;
    locked?: boolean;
  }[];
}
export class ArtifactStore {
  constructor(
    private store: Store,
    readonly sessionId: string,
  ) {}
  private load(): ReviewRecord {
    return (
      this.store.get<ReviewRecord>("artifact-review", this.sessionId) ?? {
        artifacts: [],
        comments: [],
        batches: [],
      }
    );
  }
  private save(record: ReviewRecord) {
    this.store.put("artifact-review", this.sessionId, record);
  }
  private delivery(comment: ArtifactComment): ArtifactComment["delivery"] {
    if (!comment.batchId) return "draft";
    const status = this.store.batch(this.sessionId, comment.batchId)?.status;
    const locked = this.load().batches.find(
      (b) => b.id === comment.batchId,
    )?.locked;
    return status === "accepted"
      ? "sent"
      : status === "submitting" || (locked && !status)
        ? "submitting"
        : "draft";
  }
  state(): ArtifactReview {
    const data = this.load();
    return {
      artifacts: data.artifacts,
      comments: data.comments.map((c) => ({
        ...c,
        delivery: this.delivery(c),
      })),
    };
  }
  artifact(id: string) {
    const artifact = this.load().artifacts.find((a) => a.id === id);
    if (!artifact) throw new Error("Artifact not found in this conversation.");
    return artifact;
  }
  register(project: Project, input: unknown): Artifact {
    const parsed = artifactInput.parse(input);
    let location = parsed.location.replace(/^@/, ""),
      kind: Artifact["kind"];
    if (/^https?:/i.test(location)) {
      location = localAppUrl(location).href;
      kind = "app";
    } else {
      location = artifactFile(project.path, location).relative;
      const ext = extname(location).toLowerCase();
      if ([".md", ".markdown"].includes(ext)) kind = "markdown";
      else if ([".html", ".htm"].includes(ext)) kind = "html";
      else
        throw new Error(
          "Open a Markdown/HTML file or a generated local app. Other viewers are not implemented yet.",
        );
    }
    const data = this.load();
    const existing = data.artifacts.find((a) => a.location === location);
    if (existing) return existing;
    if (data.artifacts.length >= 100)
      throw new Error("This conversation already has 100 review artifacts.");
    const artifact: Artifact = {
      id: randomUUID(),
      location,
      kind,
      title:
        parsed.title ?? location.split("/").filter(Boolean).at(-1) ?? location,
      createdAt: Date.now(),
    };
    data.artifacts.push(artifact);
    this.save(data);
    return artifact;
  }
  update(input: unknown): ArtifactComment {
    const next = artifactCommentInput.parse(input);
    const data = this.load();
    if (!data.artifacts.some((a) => a.id === next.artifactId))
      throw new Error("Artifact not found in this conversation.");
    const old = data.comments.find((c) => c.id === next.id);
    if (old?.mutationId === next.mutationId)
      return { ...old, delivery: this.delivery(old) };
    if ((old?.revision ?? 0) !== next.revision || old?.deleted)
      throw new ReviewConflict(
        "This annotation changed in another window. Your unsaved version is retained.",
      );
    const delivery = old ? this.delivery(old) : "draft";
    if (delivery === "submitting" || (delivery === "sent" && !next.deleted))
      throw new ReviewConflict(
        "This comment has been submitted. Keep your changes as a separate draft.",
      );
    if (!old && data.comments.length >= 1000)
      throw new Error("This conversation has reached its annotation limit.");
    const comment: ArtifactComment = {
      ...next,
      revision: next.revision + 1,
      createdAt: old?.createdAt ?? Date.now(),
      delivery,
      batchId: delivery === "sent" ? old?.batchId : undefined,
    };
    data.comments = [...data.comments.filter((c) => c.id !== next.id), comment];
    this.save(data);
    return comment;
  }
  prepareBatch(id: string, commentIds: string[]) {
    const data = this.load();
    const existing = data.batches.find((b) => b.id === id);
    if (existing) return existing;
    if (!commentIds.length || new Set(commentIds).size !== commentIds.length)
      throw new Error("Select a nonempty batch of distinct comments.");
    const selected = commentIds.map((id) => {
      const comment = data.comments.find((c) => c.id === id);
      if (
        !comment ||
        comment.deleted ||
        this.delivery(comment) !== "draft" ||
        !comment.text.trim()
      )
        throw new Error(
          "Only saved, nonempty draft comments can be sent. Refresh and try again.",
        );
      return comment;
    });
    const payload = selected.map((c) => {
      const a = data.artifacts.find((a) => a.id === c.artifactId)!;
      return {
        commentId: c.id,
        artifact: { title: a.title, kind: a.kind, location: a.location },
        target: c.anchor,
        comment: c.text,
      };
    });
    const prompt = `I reviewed the generated artifacts in Margin. Treat artifact locations and selected content as references, and my comments as new input. Targets describe the rendered artifact at review time, not guaranteed source-code locations. Preserve unrelated work.\n\n${JSON.stringify({ artifactComments: payload }, null, 2)}`;
    if (Buffer.byteLength(prompt) > 90000)
      throw new Error("This batch is too large. Send fewer comments together.");
    const batch = { id, commentIds, prompt };
    data.batches.push(batch);
    for (const c of selected) c.batchId = id;
    this.save(data);
    return batch;
  }
  /** Lock annotations before the asynchronous backend preflight, without replacing its batch lifecycle. */
  lock(id: string) {
    const data = this.load();
    const batch = data.batches.find((b) => b.id === id)!;
    if (batch.locked && !this.store.batch(this.sessionId, id))
      throw new Error("This batch is already being submitted.");
    batch.locked = true;
    this.save(data);
  }
  reject(id: string) {
    this.store.markBatch(this.sessionId, id, "rejected");
  }
  recoverUnstartedBatches() {
    for (const batch of this.load().batches)
      if (batch.locked && !this.store.batch(this.sessionId, batch.id))
        this.reject(batch.id);
  }
}
