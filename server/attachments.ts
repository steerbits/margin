import { createHash } from "node:crypto";
import {
  constants,
  existsSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Store } from "./store.ts";
import type { Attachment, FeedbackBatch, Snapshot } from "../shared/types.ts";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  MAX_DRAFT_ATTACHMENT_BYTES,
  type AttachmentReference,
  attachmentMessage,
} from "../shared/attachments.ts";

export interface SavedAttachment extends AttachmentReference {
  sha256: string;
  batchId?: string;
}
export const uploadSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(255)
    .refine((name) => !/[\x00-\x1f\x7f]/.test(name), "Invalid filename."),
  mimeType: z.string().max(200).optional(),
  data: z.string().max(4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3)),
});
export function attachmentState(store: Store, sessionId: string) {
  const saved = store.get<SavedAttachment[]>("attachments", sessionId) ?? [];
  return {
    composerAttachments: saved
      .filter((file) => !file.batchId)
      .map(publicAttachment),
    attachmentRevision:
      store.get<number>("attachment-revision", sessionId) ?? 0,
  };
}
export function publicAttachment(file: Attachment): Attachment {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
  };
}
export function decorateAttachments(
  snapshot: Snapshot,
  saved: SavedAttachment[],
): Snapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      attachmentMessage(message, saved),
    ),
  };
}

export class AttachmentStore {
  constructor(
    private store: Store,
    private dataDir: string,
    private sessionId: string,
  ) {}
  list() {
    return (
      this.store.get<SavedAttachment[]>("attachments", this.sessionId) ?? []
    );
  }
  private save(files: SavedAttachment[]) {
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.put("attachments", this.sessionId, files);
      this.store.put(
        "attachment-revision",
        this.sessionId,
        (this.store.get<number>("attachment-revision", this.sessionId) ?? 0) +
          1,
      );
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
  }
  private directory(create = false) {
    z.string().uuid().parse(this.sessionId);
    const root = realpathSync(this.dataDir);
    let path = root;
    for (const part of ["attachments", this.sessionId]) {
      path = join(path, part);
      if (create && !existsSync(path)) mkdirSync(path, { mode: 0o700 });
      if (
        existsSync(path) &&
        (lstatSync(path).isSymbolicLink() ||
          realpathSync(path) !== path ||
          !lstatSync(path).isDirectory())
      )
        throw new Error("Attachment storage moved or became a symbolic link.");
    }
    return path;
  }
  upload(input: unknown) {
    const body = uploadSchema.parse(input);
    // Buffer.from is permissive: reject malformed/noncanonical base64 explicitly.
    if (body.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(body.data))
      throw new Error("Invalid attachment encoding.");
    const bytes = Buffer.from(body.data, "base64");
    if (bytes.length > MAX_ATTACHMENT_BYTES)
      throw new Error("Files must be 20 MB or smaller.");
    if (bytes.toString("base64") !== body.data)
      throw new Error("Invalid attachment encoding.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const files = this.list();
    const existing = files.find((file) => file.id === body.id);
    if (existing) {
      if (existing.sha256 !== sha256 || existing.name !== body.name)
        throw new Error("Upload ID is already in use.");
      this.read(existing.id);
      return publicAttachment(existing);
    }
    const drafts = files.filter((file) => !file.batchId);
    if (drafts.length >= MAX_DRAFT_ATTACHMENTS)
      throw new Error("Attach at most 10 files per message.");
    if (
      drafts.reduce((sum, file) => sum + file.size, bytes.length) >
      MAX_DRAFT_ATTACHMENT_BYTES
    )
      throw new Error("Draft attachments must total 50 MB or less.");
    if (
      files.reduce((sum, file) => sum + file.size, bytes.length) >
        500 * 1024 * 1024 ||
      files.length >= 1000
    )
      throw new Error(
        "This conversation has reached its attachment storage limit (500 MB or 1,000 files).",
      );
    // User filenames are metadata, never paths. Preserve a safe extension for readers.
    const extension = body.name.match(/\.[a-zA-Z0-9]{1,12}$/)?.[0] ?? "";
    const path = join(this.directory(true), `${body.id}${extension}`);
    const file: SavedAttachment = {
      id: body.id,
      name: body.name,
      size: bytes.length,
      mimeType: body.mimeType || "application/octet-stream",
      path,
      sha256,
    };
    try {
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A crash after the file write but before SQLite publication is retryable.
      // Never overwrite a different file or follow a replacement symlink.
      this.readOriginal(file);
    }
    try {
      this.save([...files, file]);
    } catch (error) {
      rmSync(path, { force: true });
      throw error;
    }
    return publicAttachment(file);
  }
  read(id: string) {
    const file = this.list().find((file) => file.id === id);
    if (!file) throw new Error("Attachment not found in this conversation.");
    return this.readOriginal(file);
  }
  private filePath(file: SavedAttachment) {
    z.string().uuid().parse(file.id);
    const directory = this.directory();
    const expected = join(
      directory,
      `${file.id}${file.name.match(/\.[a-zA-Z0-9]{1,12}$/)?.[0] ?? ""}`,
    );
    if (resolve(file.path) !== expected)
      throw new Error("Attachment is outside this conversation's storage.");
    return expected;
  }
  private readOriginal(file: SavedAttachment) {
    const fd = openSync(
      this.filePath(file),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size !== file.size ||
        stat.size > MAX_ATTACHMENT_BYTES
      )
        throw new Error(
          "Attachment changed on disk. Upload the original again.",
        );
      const bytes = readFileSync(fd);
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new Error(
          "Attachment changed on disk. Upload the original again.",
        );
      return { file, bytes };
    } finally {
      closeSync(fd);
    }
  }
  select(batch: FeedbackBatch): AttachmentReference[] {
    const ids = batch.attachmentIds ?? [];
    if (ids.length > MAX_DRAFT_ATTACHMENTS || new Set(ids).size !== ids.length)
      throw new Error("Invalid attachment selection.");
    return ids.map((id) => {
      const { file } = this.read(id);
      if (file.batchId)
        throw new Error("An attachment in this message is no longer a draft.");
      return { ...publicAttachment(file), path: file.path };
    });
  }
  accept(batch: FeedbackBatch) {
    if (!batch.attachmentIds?.length) return;
    this.save(
      this.list().map((file) =>
        batch.attachmentIds!.includes(file.id)
          ? { ...file, batchId: batch.id }
          : file,
      ),
    );
  }
  recover(batchId: string) {
    const files = this.list();
    if (files.some((file) => file.batchId === batchId))
      this.save(
        files.map((file) =>
          file.batchId === batchId ? { ...file, batchId: undefined } : file,
        ),
      );
  }
  remove(id: string) {
    const files = this.list();
    const file = files.find((file) => file.id === id);
    if (!file) return; // Removing an upload whose response was lost is idempotent.
    const pending = this.store.get<{
      batchId: string;
      attachmentIds?: string[];
    }>("pending-input", this.sessionId);
    if (
      file.batchId ||
      (pending?.attachmentIds?.includes(id) &&
        this.store.batch(this.sessionId, pending.batchId)?.status ===
          "submitting")
    )
      throw new Error(
        "This attachment is being sent or has already been sent.",
      );
    // Removal must also work for a missing/modified draft, without reading or
    // following the file. This lets the person recover by uploading it again.
    rmSync(this.filePath(file), { force: true });
    this.save(files.filter((file) => file.id !== id));
  }
  deleteAll() {
    if (!existsSync(join(this.dataDir, "attachments"))) return;
    const path = this.directory();
    rmSync(path, { recursive: true, force: true });
  }
}
