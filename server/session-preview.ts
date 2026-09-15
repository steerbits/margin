import type {
  Message,
  SessionInfo,
  Snapshot,
  Comment,
} from "../shared/types.ts";
import type { DatabaseSync } from "node:sqlite";
import {
  decorateAttachments,
  publicAttachment,
  type SavedAttachment,
} from "./attachments.ts";

export function readSessionPreview(db: DatabaseSync, id: string): Snapshot {
  // One SQLite read snapshot: never pair old composer text with a newer revision.
  const rows = db
    .prepare(
      "SELECT kind,value FROM records WHERE id=? AND kind IN ('session','activity','transcript','comments','composer','composer-revision','attachments','attachment-revision')",
    )
    .all(id) as { kind: string; value: string }[];
  const values = new Map(rows.map((row) => [row.kind, JSON.parse(row.value)]));
  return sessionPreview(
    <T>(kind: string) => values.get(kind) as T | undefined,
    id,
  );
}

/** Saved history only: reading it never creates a backend or invokes a plugin. */
export function sessionPreview(
  get: <T>(kind: string, id: string) => T | undefined,
  id: string,
): Snapshot {
  const session = get<SessionInfo>("session", id);
  if (!session) throw new Error("Conversation not found.");
  const activity = get<SessionInfo["activity"]>("activity", id);
  const attachments = get<SavedAttachment[]>("attachments", id) ?? [];
  return decorateAttachments(
    {
      session: { ...session, activity },
      attachmentSupport: !session.backend || session.backend === "pi",
      composerAttachments: attachments
        .filter((file) => !file.batchId)
        .map(publicAttachment),
      attachmentRevision: get<number>("attachment-revision", id) ?? 0,
      messages: get<Message[]>("transcript", id) ?? [],
      comments: get<Comment[]>("comments", id) ?? [],
      composer: get<string>("composer", id) ?? "",
      composerRevision: get<number>("composer-revision", id) ?? 0,
      busy: activity?.status === "running" || activity?.status === "waiting",
      dialogs: [],
      notices: [],
      statuses: {},
      widgets: {},
      skills: [],
      pluginState: {},
    },
    attachments,
  );
}
