import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { LiveSession } from "../server/sessions.ts";
import { Store } from "../server/store.ts";
import { RuntimeOwner } from "../server/runtime-owner.ts";
import { RunRecovery, type RecoverableRun } from "../server/run-recovery.ts";
import { UiBridge } from "../server/ui-bridge.ts";

// Exercise the actual adapter methods with real persistence and a stub model
// boundary, without discovering global extensions or making provider requests.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "margin-session-recovery-"));
  const store = new Store(join(dir, "db.sqlite"));
  const owner = new RuntimeOwner(dir);
  const identity = owner.reserve();
  owner.claim(identity.generation);
  const runtime = {
    generation: identity.generation,
    previous: { generation: "old", unexpected: true, reason: "out of memory" },
  };
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  const userId = manager.appendMessage({
    role: "user",
    content: "Original task",
    timestamp: Date.now(),
  });
  const pending = {
    batchId: "run",
    prompt: "Original task",
    note: "Original task",
    accepted: true,
    persistedUserId: userId,
  };
  store.put("pending-input", "session", pending);
  store.put("composer", "session", "Do not send this new draft");
  const oldRun = new RunRecovery(store, "session", { generation: "old" });
  oldRun.begin("run");
  const recoveryRun = new RunRecovery(store, "session", runtime);
  assert.equal(
    recoveryRun.prepare(pending, (id) => !!manager.getEntry(id), new Set())
      .resume,
    true,
  );
  let prompts = 0;
  const l = Object.assign(Object.create(LiveSession.prototype), {
    info: {
      id: "session",
      projectId: "project",
      title: "Task",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    project: { id: "project", path: dir },
    store,
    dataDir: dir,
    appRoot: dir,
    plugins: [],
    runtime: { storage: owner, recovery: runtime },
    recoveryRun,
    autoResume: true,
    disposing: false,
    busy: true,
    messages: [],
    liveTools: new Map(),
    childOperations: 0,
    pluginOperations: 0,
    changed() {},
    agent: {
      sessionManager: manager,
      async prompt(text: string, options: unknown) {
        prompts++;
        assert.ok(text.includes("previously requested task"));
        assert.deepEqual(options, { expandPromptTemplates: false });
        await new Promise((r) => setTimeout(r, 10));
      },
      abortCompaction() {},
      abortBranchSummary() {},
      async abort() {},
    },
  }) as any;
  l.ui = new UiBridge(() => l.trackWaiting());
  return {
    l,
    store,
    recoveryRun,
    manager,
    prompts: () => prompts,
    close() {
      store.close();
      owner.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("adapter automatically prompts exactly once, keeps a new draft private and returns idle", async () => {
  const f = fixture();
  try {
    await Promise.all([f.l.resumeInterruptedRun(), f.l.resumeInterruptedRun()]);
    assert.equal(f.prompts(), 1);
    assert.equal(f.l.busy, false);
    assert.equal(
      f.store.get("composer", "session"),
      "Do not send this new draft",
    );
    assert.equal(f.store.get("interrupted", "session"), false);
    assert.equal(
      f.store.get<RecoverableRun>("run-recovery", "session")?.active,
      false,
    );
  } finally {
    f.close();
  }
});
test("Stop is persisted before awaiting SDK cancellation and prevents a queued recovery prompt", async () => {
  const f = fixture();
  try {
    let release!: () => void;
    f.l.agent.abort = () => new Promise<void>((r) => (release = r));
    const stopping = f.l.stop();
    assert.equal(f.store.get("interrupted", "session"), false);
    assert.equal(
      f.store.get<RecoverableRun>("run-recovery", "session")?.active,
      false,
    );
    await f.l.resumeInterruptedRun();
    assert.equal(f.prompts(), 0);
    release();
    await stopping;
  } finally {
    f.close();
  }
});
test("tool_execution_end cannot make an uncertain command automatically replayable", async () => {
  const f = fixture();
  try {
    f.l.onEvent({
      type: "tool_execution_start",
      toolCallId: "call",
      toolName: "bash",
      args: { command: "build" },
    });
    f.l.onEvent({
      type: "tool_execution_end",
      toolCallId: "call",
      toolName: "bash",
      result: { content: [] },
      isError: false,
    });
    assert.deepEqual(
      f.store.get<RecoverableRun>("run-recovery", "session")?.tools,
      ["call"],
    );
    const message = {
      role: "toolResult" as const,
      toolCallId: "call",
      toolName: "bash",
      content: [{ type: "text" as const, text: "done" }],
      isError: false,
      timestamp: Date.now(),
    };
    // Match the SDK's listener-before-native-append ordering.
    f.l.onEvent({ type: "message_end", message });
    f.manager.appendMessage(message);
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    assert.deepEqual(
      f.store.get<RecoverableRun>("run-recovery", "session")?.tools,
      [],
    );
  } finally {
    f.close();
  }
});
test("new startup questions pause automatic continuation without fabricating an answer", async () => {
  const f = fixture();
  try {
    const question = f.l.ui.request("confirm", "Proceed?");
    await f.l.resumeInterruptedRun();
    assert.equal(f.prompts(), 0);
    assert.equal(f.l.ui.dialogs.size, 1);
    assert.ok(f.l.ui.notices.some((n: any) => n.text.includes("paused")));
    f.l.ui.cancelAll();
    await question;
  } finally {
    f.close();
  }
});
