import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type ProcessState = "alive" | "dead" | "unknown";
export function processState(pid: number): ProcessState {
  if (!Number.isSafeInteger(pid) || pid <= 0) return "unknown";
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "dead"
      : "unknown";
  }
}
export interface RuntimeRecovery {
  generation: string;
  previous?: { generation: string; unexpected: boolean; reason: string };
}
export interface RuntimeRecord extends RuntimeRecovery {
  controllerPid: number;
  runtimePid?: number;
  guardians: number[];
  expectedStop?: boolean;
  reason?: string;
  reservationFailed?: boolean;
}

/** No expiry/heartbeat takeover: sleep and a lost socket are not proof of death.
 * SQLite serializes competing gateways and runtime claims without stale-file
 * unlink races. The gateway checks OS liveness outside the workspace sandbox.
 */
export class RuntimeOwner {
  private db: DatabaseSync;
  constructor(
    dataDir: string,
    private probe = processState,
  ) {
    const directory = join(realpathSync(dataDir), "runtime");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "owner.sqlite");
    if (
      realpathSync(directory) !== directory ||
      (existsSync(file) && realpathSync(file) !== file)
    )
      throw new Error("Runtime ownership storage must not be a symbolic link.");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
    );
  }
  current(): RuntimeRecord | undefined {
    const row = this.db.prepare("SELECT value FROM owner WHERE id=1").get() as
      | { value: string }
      | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  private change<T>(
    fn: (current: RuntimeRecord | undefined) => {
      record: RuntimeRecord;
      result: T;
    },
  ): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const { record, result } = fn(this.current());
      this.db
        .prepare(
          "INSERT INTO owner VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(record));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  reserve(controllerPid = process.pid): RuntimeRecord {
    return this.change((old) => {
      const pid =
        old?.runtimePid ??
        (!old?.reservationFailed ? old?.controllerPid : undefined);
      if (pid !== undefined && this.probe(pid) !== "dead")
        throw new Error(
          `The previous workspace runtime (PID ${pid}) is still alive or its exit cannot be verified. Margin will not start a second agent. Stop that runtime before retrying.`,
        );
      if (old?.guardians.some((pid) => this.probe(pid) !== "dead"))
        throw new Error(
          "Waiting for the previous runtime's managed commands to stop. Margin will not start overlapping work.",
        );
      const record: RuntimeRecord = {
        generation: randomUUID(),
        controllerPid,
        guardians: [],
        // Preserve provenance across failed startup attempts, but never skip a
        // runtime that actually claimed ownership (including a failed recovery).
        previous: old?.runtimePid
          ? {
              generation: old.generation,
              unexpected: !old.expectedStop,
              reason: old.reason ?? "unexpected runtime exit",
            }
          : old?.previous,
      };
      return { record, result: record };
    });
  }
  claim(generation: string, runtimePid = process.pid): RuntimeRecord {
    return this.change((record) => {
      if (
        !record ||
        record.generation !== generation ||
        record.runtimePid ||
        record.reservationFailed
      )
        throw new Error(
          "Workspace runtime ownership changed. This runtime will not start an agent.",
        );
      record.runtimePid = runtimePid;
      return { record, result: record };
    });
  }
  assert(generation: string, runtimePid = process.pid) {
    const owner = this.current();
    if (owner?.generation !== generation || owner.runtimePid !== runtimePid)
      throw new Error(
        "This runtime no longer owns the workspace. Agent work is blocked.",
      );
  }
  update(
    generation: string,
    patch: Partial<
      Pick<RuntimeRecord, "expectedStop" | "reason" | "reservationFailed">
    >,
  ) {
    this.change((record) => {
      if (!record || record.generation !== generation)
        throw new Error("Workspace runtime ownership changed.");
      Object.assign(record, patch);
      return { record, result: undefined };
    });
  }
  guardian(generation: string, pid: number, active: boolean) {
    this.change((record) => {
      if (!record || record.generation !== generation)
        throw new Error("Workspace runtime ownership changed.");
      record.guardians = active
        ? [...new Set([...record.guardians, pid])]
        : record.guardians.filter((p) => p !== pid);
      return { record, result: undefined };
    });
  }
  close() {
    this.db.close();
  }
}
