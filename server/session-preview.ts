import type {
  Message,
  SessionInfo,
  Snapshot,
  Comment,
} from "../shared/types.ts";
import type { DatabaseSync } from "node:sqlite";

export function readSessionPreview(db: DatabaseSync, id: string): Snapshot {
  // One SQLite read snapshot: never pair old composer text with a newer revision.
  const rows = db
    .prepare(
      "SELECT kind,value FROM records WHERE id=? AND kind IN ('session','activity','transcript','comments','composer','composer-revision')",
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
  return {
    session: { ...session, activity },
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
  };
}
