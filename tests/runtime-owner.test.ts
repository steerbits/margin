import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RuntimeOwner,
  processState,
  type ProcessState,
} from "../server/runtime-owner.ts";
import {
  boundedLines,
  WorkerDiagnostics,
  exitReason,
  runtimeLog,
} from "../server/runtime-log.ts";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "margin-runtime-owner-"));
  const states = new Map<number, ProcessState>();
  const probe = (pid: number) => states.get(pid) ?? "dead";
  const a = new RuntimeOwner(dir, probe),
    b = new RuntimeOwner(dir, probe);
  return {
    dir,
    states,
    a,
    b,
    close() {
      a.close();
      b.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("competing gateways, sleep, unknown liveness and PID reuse cannot start a second runtime", () => {
  const f = fixture();
  try {
    f.states.set(10, "alive");
    const first = f.a.reserve(10);
    assert.throws(() => f.b.reserve(20), /second agent/);
    f.a.claim(first.generation, 11);
    f.states.set(11, "alive");
    f.states.set(10, "dead"); // Gateway/wrapper died; SDK remains alive.
    assert.throws(() => f.b.reserve(20), /second agent/);
    f.states.set(11, "unknown");
    assert.throws(() => f.b.reserve(20), /cannot be verified/);
    f.states.set(11, "alive"); // Also the safe behavior if the PID was reused.
    assert.throws(() => f.b.reserve(20));
    f.states.set(11, "dead");
    const second = f.b.reserve(20);
    assert.equal(second.previous?.generation, first.generation);
    assert.equal(second.previous?.unexpected, true);
    assert.throws(() => f.a.claim(first.generation, 11), /ownership changed/);
    f.b.claim(second.generation, 21);
    assert.throws(() => f.a.assert(first.generation, 11), /no longer owns/);
    assert.throws(() => f.b.claim(second.generation, 22), /ownership changed/);
  } finally {
    f.close();
  }
});
test("a dead SDK host does not permit takeover while managed command guardians are alive", () => {
  const f = fixture();
  try {
    const first = f.a.reserve(10);
    f.a.claim(first.generation, 11);
    f.a.guardian(first.generation, 12, true);
    f.states.set(12, "alive");
    assert.throws(() => f.b.reserve(20), /managed commands/);
    f.states.set(12, "unknown");
    assert.throws(() => f.b.reserve(20));
    f.states.set(12, "dead");
    assert.ok(f.b.reserve(20));
  } finally {
    f.close();
  }
});
test("requested stops are not automatic recovery; failed reservations preserve provenance", () => {
  const f = fixture();
  try {
    const first = f.a.reserve(10);
    f.a.claim(first.generation, 11);
    f.a.update(first.generation, { expectedStop: true, reason: "shutdown" });
    const next = f.b.reserve(20);
    assert.equal(next.previous?.unexpected, false);
    f.states.set(20, "alive");
    f.b.update(next.generation, { reservationFailed: true });
    const retried = f.a.reserve(30);
    assert.deepEqual(retried.previous, next.previous);
    assert.throws(() => f.b.claim(next.generation, 21), /ownership changed/);
  } finally {
    f.close();
  }
});
test("liveness is conservative for invalid identifiers and recognizes this process", () => {
  assert.equal(processState(process.pid), "alive");
  for (const pid of [-1, 0, NaN, 1.2])
    assert.equal(processState(pid), "unknown");
});
test("structured lifecycle logs are private, bounded and distinguish OOM from signals", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 100; i++)
      runtimeLog(f.dir, { event: "memory", pid: 1, heapBytes: i }, 1024);
    const file = join(f.dir, "runtime/events.jsonl");
    for (const path of [file, file + ".1"]) {
      assert.ok(statSync(path).size <= 1024);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      for (const line of readFileSync(path, "utf8").trim().split("\n"))
        assert.equal(JSON.parse(line).event, "memory");
    }
    assert.equal(
      exitReason(
        "FATAL ERROR: Allocation failed - JavaScript heap out of memory secret-token",
        1,
        null,
      ),
      "out of memory",
    );
    assert.equal(
      exitReason("private transcript", null, "SIGTERM"),
      "terminated by SIGTERM",
    );
  } finally {
    f.close();
  }
});
test("OOM classification survives split stderr chunks and a stack longer than the retained tail", () => {
  const diagnostics = new WorkerDiagnostics();
  diagnostics.append("FATAL ERROR: JavaScript heap out of", true);
  diagnostics.append(" memory\n", true);
  diagnostics.append("more stack frames\n".repeat(5000), true);
  assert.equal(diagnostics.reason(134, null), "out of memory");
  assert.ok(diagnostics.tail.length <= 4000);
  assert.ok(!diagnostics.tail.includes("FATAL ERROR"));
  const ordinary = new WorkerDiagnostics();
  ordinary.append("plugin started\n", true);
  assert.equal(ordinary.reason(1, null), "runtime exited (code 1)");
});
test("newline-free stdout is discarded at a fixed bound and the next ready line survives", () => {
  const lines: string[] = [];
  const consume = boundedLines((line) => lines.push(line), 64);
  for (let i = 0; i < 10000; i++) consume("x".repeat(64));
  consume("\nMARGIN_WORKER_");
  consume("READY {}\n");
  assert.deepEqual(lines, ["MARGIN_WORKER_READY {}"]);
});
