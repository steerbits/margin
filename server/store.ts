import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Comment, Project, SessionInfo } from "../shared/types.ts";

export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout=5000");
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS batches (session_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(session_id,id));`);
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  put(kind: string, id: string, value: unknown) {
    if (kind === "composer") {
      if (this.get(kind, id) === value) return;
      // A single statement keeps text and revision atomic for preview readers.
      this.db
        .prepare(
          `INSERT INTO records (kind,id,value) VALUES
        ('composer',?,?),
        ('composer-revision',?,CAST(COALESCE((SELECT value FROM records WHERE kind='composer-revision' AND id=?),'0') AS INTEGER)+1)
        ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value`,
        )
        .run(id, JSON.stringify(value), id, id);
      return;
    }
    this.db
      .prepare(
        "INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",
      )
      .run(kind, id, JSON.stringify(value));
  }
  list<T>(kind: string): T[] {
    return (
      this.db.prepare("SELECT value FROM records WHERE kind=?").all(kind) as {
        value: string;
      }[]
    ).map((x) => JSON.parse(x.value));
  }
  projects() {
    return this.list<Project>("project");
  }
  sessions() {
    return this.list<SessionInfo>("session")
      .map((session) => ({
        ...session,
        activity: this.get<SessionInfo["activity"]>("activity", session.id),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  deleteSession(id: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const kind of [
        "session",
        "session-owner",
        "activity",
        "transcript",
        "composer",
        "composer-revision",
        "comments",
        "interrupted",
        "pi-backup",
        "pending-input",
      ])
        this.db
          .prepare("DELETE FROM records WHERE kind=? AND id=?")
          .run(kind, id);
      this.db.prepare("DELETE FROM batches WHERE session_id=?").run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  comments(id: string) {
    return this.get<Comment[]>("comments", id) ?? [];
  }
  batch(id: string, batchId: string) {
    return this.db
      .prepare("SELECT status FROM batches WHERE session_id=? AND id=?")
      .get(id, batchId) as { status: string } | undefined;
  }
  markBatch(id: string, batchId: string, status: string) {
    this.db
      .prepare(
        "INSERT INTO batches VALUES (?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET status=excluded.status",
      )
      .run(id, batchId, status);
  }
  close() {
    this.db.close();
  }
}
