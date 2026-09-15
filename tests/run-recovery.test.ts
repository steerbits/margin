import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { RunRecovery, type RecoverableRun } from "../server/run-recovery.ts";
const pending = {
  batchId: "run",
  prompt: "task",
  note: "task",
  accepted: true,
  persistedUserId: "user",
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "margin-run-recovery-"));
  const store = new Store(join(dir, "db.sqlite"));
  const run = new RunRecovery(store, "session", { generation: "old" });
  run.begin("run");
  const reopen = (previous = "old", unexpected = true) =>
    new RunRecovery(store, "session", {
      generation: "new",
      previous: { generation: previous, unexpected, reason: "out of memory" },
    });
  return {
    store,
    run,
    reopen,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("network retries have a durable cap, survive worker replacement, and only human sends reset it", () => {
  const f = fixture();
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      assert.equal(f.run.networkDecision(pending, () => true).attempt, attempt);
      assert.equal(
        f.run.networkDecision(pending, () => true, true).resume,
        true,
      );
    }
    assert.match(
      f.run.networkDecision(pending, () => true).reason,
      /exhausted/,
    );
    const next = f.reopen();
    assert.equal(next.prepare(pending, () => true, new Set()).resume, true);
    assert.match(next.networkDecision(pending, () => true).reason, /exhausted/);
    next.begin("new-human-send");
    assert.equal(
      next.networkDecision(
        { ...pending, batchId: "new-human-send" },
        () => true,
      ).attempt,
      1,
    );
  } finally {
    f.close();
  }
});
for (const condition of [
  "stop",
  "tool",
  "question",
  "background",
  "missing-input",
  "unaccepted",
  "wrong-batch",
] as const) {
  test(`network recovery refuses ${condition} before reserving or prompting`, () => {
    const f = fixture();
    try {
      if (condition === "stop") f.run.cancel();
      if (condition === "tool") f.run.toolStarted("uncertain");
      if (condition === "question") f.run.waiting(true, false);
      if (condition === "background") f.run.waiting(false, true);
      const input = {
        ...pending,
        accepted: condition !== "unaccepted",
        batchId: condition === "wrong-batch" ? "other" : "run",
      };
      assert.equal(
        f.run.networkDecision(input, () => condition !== "missing-input", true)
          .resume,
        false,
      );
      assert.equal(
        f.store.get<RecoverableRun>("run-recovery", "session")?.networkAttempts,
        0,
      );
    } finally {
      f.close();
    }
  });
}
test("safe interrupted work consumes a durable single recovery attempt before prompting", () => {
  const f = fixture();
  try {
    const resumed = f.reopen();
    assert.deepEqual(
      resumed.prepare(pending, () => true, new Set()),
      { resume: true, reason: "out of memory" },
    );
    assert.equal(resumed.active, true);
    assert.equal(
      f.store.get<RecoverableRun>("run-recovery", "session")?.attempts,
      1,
    );
    // A fresh browser/session object does not receive another prompt.
    assert.equal(
      f.reopen().prepare(pending, () => true, new Set()).resume,
      false,
    );
    // Even another actual crash does not reset the original run's budget.
    assert.match(
      f.reopen("new").prepare(pending, () => true, new Set()).reason,
      /already ran once/,
    );
  } finally {
    f.close();
  }
});
test("only a new human send resets the recovery budget", () => {
  const f = fixture();
  try {
    const resumed = f.reopen();
    resumed.prepare(pending, () => true, new Set());
    resumed.finish();
    resumed.begin("follow-up");
    assert.equal(
      f.store.get<RecoverableRun>("run-recovery", "session")?.attempts,
      0,
    );
    assert.equal(
      f
        .reopen("new")
        .prepare({ ...pending, batchId: "follow-up" }, () => true, new Set())
        .resume,
      true,
    );
  } finally {
    f.close();
  }
});
for (const condition of [
  "stop",
  "finished",
  "dialog",
  "background",
  "tool",
  "missing-user",
  "wrong-batch",
  "requested-restart",
  "wrong-owner",
  "legacy",
] as const) {
  test(`recovery refuses ${condition} without consuming an attempt or changing the draft`, () => {
    const f = fixture();
    try {
      f.store.put("composer", "session", "newer unsent draft");
      if (condition === "stop") f.run.cancel();
      if (condition === "finished") f.run.finish();
      if (condition === "dialog") f.run.waiting(true, false);
      if (condition === "background") f.run.waiting(false, true);
      if (condition === "tool") f.run.toolStarted("tool-1");
      if (condition === "legacy")
        f.store.db
          .prepare("DELETE FROM records WHERE kind='run-recovery'")
          .run();
      const recovered = f.reopen(
        condition === "wrong-owner" ? "unrelated" : "old",
        condition !== "requested-restart",
      );
      const result = recovered.prepare(
        condition === "wrong-batch"
          ? { ...pending, batchId: "old-batch" }
          : pending,
        () => condition !== "missing-user",
        new Set(),
      );
      assert.equal(result.resume, false);
      assert.equal(f.store.get("composer", "session"), "newer unsent draft");
      assert.notEqual(
        f.store.get<RecoverableRun>("run-recovery", "session")?.attempts,
        1,
      );
    } finally {
      f.close();
    }
  });
}
test("only durable tool results close the uncertainty window, including crash between native and app persistence", () => {
  const f = fixture();
  try {
    f.run.toolStarted("one");
    f.run.toolStarted("two");
    assert.equal(
      f.reopen().prepare(pending, () => true, new Set(["one"])).resume,
      false,
    );
    assert.equal(
      f.reopen().prepare(pending, () => true, new Set(["one", "two"])).resume,
      true,
    );
  } finally {
    f.close();
  }
});
test("explicit Stop during replacement initialization cancels the prior generation before preparation", () => {
  const f = fixture();
  try {
    const loading = f.reopen();
    loading.cancel();
    assert.equal(loading.prepare(pending, () => true, new Set()).resume, false);
    assert.equal(
      f.reopen().prepare(pending, () => true, new Set()).resume,
      false,
    );
  } finally {
    f.close();
  }
});
test("initialization callbacks cannot erase a prior runtime's pending dialog", () => {
  const f = fixture();
  try {
    f.run.waiting(true, true);
    const recovered = f.reopen();
    recovered.waiting(false, false);
    recovered.finish();
    assert.match(
      recovered.prepare(pending, () => true, new Set()).reason,
      /question/,
    );
  } finally {
    f.close();
  }
});
