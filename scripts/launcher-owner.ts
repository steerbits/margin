import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { processState } from "../server/runtime-owner.ts";

interface LauncherRecord {
  generation: string;
  pid: number;
  port?: number;
}

/** One host launcher per physical checkout, even with a different PORT or
 * MARGIN_DATA_DIR. Keep the database in place: unlinking stale lock files can
 * let competing claimants lock different inodes. SQLite serializes claims;
 * only a verified dead PID permits recovery, never a timeout or lost socket.
 */
export function claimLauncher(appRoot: string) {
  const directory = join(realpathSync(appRoot), ".margin-data", "launcher");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "owner.sqlite");
  if (
    realpathSync(directory) !== directory ||
    (existsSync(file) && realpathSync(file) !== file)
  )
    throw new Error("Launcher ownership storage must not be a symbolic link.");
  const db = new DatabaseSync(file);
  const generation = randomUUID();
  let closed = false;
  try {
    chmodSync(file, 0o600);
    db.exec("PRAGMA busy_timeout=5000");
    // Serialize schema creation too. Concurrent journal_mode=WAL changes can
    // return SQLITE_BUSY during the very first launch, before any row exists.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        "CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
      );
      const row = db.prepare("SELECT value FROM owner WHERE id=1").get() as
        | { value: string }
        | undefined;
      const old: LauncherRecord | undefined = row && JSON.parse(row.value);
      if (old && processState(old.pid) !== "dead") {
        const location = old.port
          ? ` at http://127.0.0.1:${old.port}`
          : " (startup in progress)";
        throw new Error(
          `Margin is already running from this folder${location} (PID ${old.pid}), or its exit cannot be verified. Stop that launcher before retrying; --port does not allow a second instance.`,
        );
      }
      db.prepare(
        "INSERT INTO owner VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      ).run(
        JSON.stringify({
          generation,
          pid: process.pid,
        } satisfies LauncherRecord),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    db.close();
    throw error;
  }
  function release() {
    if (closed) return;
    closed = true;
    process.off("exit", release);
    try {
      db.prepare(
        "DELETE FROM owner WHERE id=1 AND json_extract(value,'$.generation')=?",
      ).run(generation);
    } finally {
      db.close();
    }
  }
  process.once("exit", release);
  return {
    // Publish the URL only after the listener actually binds.
    listening(port: number) {
      db.prepare(
        "UPDATE owner SET value=? WHERE id=1 AND json_extract(value,'$.generation')=?",
      ).run(
        JSON.stringify({
          generation,
          pid: process.pid,
          port,
        } satisfies LauncherRecord),
        generation,
      );
    },
    release,
  };
}
