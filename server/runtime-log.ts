import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export interface RuntimeLogEvent {
  event:
    | "launch"
    | "ready"
    | "launcher-exit"
    | "runtime-exit"
    | "startup-failed"
    | "shutdown"
    | "memory"
    | "stream-stalled"
    | "uncaught-error";
  generation?: string;
  pid?: number;
  launcherPid?: number;
  code?: number | null;
  signal?: string | null;
  reason?: string;
  expected?: boolean;
  heapBytes?: number;
  rssBytes?: number;
  queuedBytes?: number;
}
/** Only structured lifecycle metadata goes to disk, never raw tool/stdout,
 * prompts, environment, bearer tokens, or arbitrary exception messages.
 */
export function runtimeLog(
  dataDir: string,
  event: RuntimeLogEvent,
  maxBytes = 256 * 1024,
) {
  try {
    const directory = join(realpathSync(dataDir), "runtime");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "events.jsonl");
    if (
      realpathSync(directory) !== directory ||
      (existsSync(file) && realpathSync(file) !== file)
    )
      return;
    const line =
      JSON.stringify({ time: new Date().toISOString(), ...event }) + "\n";
    if (
      existsSync(file) &&
      statSync(file).size + Buffer.byteLength(line) > maxBytes
    ) {
      rmSync(`${file}.1`, { force: true });
      renameSync(file, `${file}.1`);
    }
    appendFileSync(file, line, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch {
    // Diagnostics must not crash a healthy agent (e.g. full disk). Ownership
    // and run-recovery persistence deliberately do NOT swallow write failures.
  }
}
export function exitReason(
  stderr: string,
  code: number | null,
  signal: string | null,
): string {
  if (
    /heap out of memory|allocation failed|FatalProcessOutOfMemory|OOMErrorHandler/i.test(
      stderr,
    )
  )
    return "out of memory";
  if (signal) return `terminated by ${signal}`;
  return `runtime exited (code ${code ?? "unknown"})`;
}
/** readline can itself retain an unbounded, newline-free plugin log. */
export function boundedLines(onLine: (line: string) => void, limit = 8192) {
  let buffer = "",
    dropping = false;
  return (chunk: string) => {
    for (const [index, part] of chunk.split("\n").entries()) {
      if (index > 0) {
        if (!dropping) onLine(buffer);
        buffer = "";
        dropping = false;
      }
      if (!dropping) {
        if (buffer.length + part.length > limit) {
          buffer = "";
          dropping = true;
        } else buffer += part;
      }
    }
  };
}
