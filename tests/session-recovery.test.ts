import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { loadCustomModelSupport, setCustomThinkingSelection, getCustomThinkingSelection } from "../server/custom-model-runtime.ts";
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
      autoRetryEnabled: true,
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
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("capability changes reset an invalid chat choice to Server default and persist the recovery", async () => {
  const f = fixture();
  try {
    const path = join(f.l.dataDir, "models.json");
    const provider = "margin-custom-recovery";
    const config: any = {
      providers: {
        [provider]: {
          api: "openai-completions", baseUrl: "http://localhost:1/v1", apiKey: "fixture",
          models: [{ id: "local", reasoning: true }],
          margin: { thinkingControl: { mode: "effort", source: "manual", levels: ["low", "high"] } },
        },
      },
    };
    writeFileSync(path, JSON.stringify(config));
    const models = await loadCustomModelSupport(await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: path, modelsStorePath: join(f.l.dataDir, "catalog.json") }), path);
    setCustomThinkingSelection(models, "low");
    f.l.models = models;
    f.l.agent.model = models.getModel(provider, "local");
    f.l.agent.setModel = async (model: unknown) => { f.l.agent.model = model; };
    config.providers[provider].margin.thinkingControl = { mode: "server", source: "unknown" };
    config.providers[provider].models[0].reasoning = false;
    writeFileSync(path, JSON.stringify(config));
    await f.l.runPrompt(async () => { assert.equal(getCustomThinkingSelection(models), null); });
    assert.equal(f.store.get<any>("custom-thinking", "session")?.level, null);
    assert.ok(f.l.ui.notices.some((notice: any) => notice.text.includes("Server default")));
  } finally { f.close(); }
});

test("Stop during custom-connection refresh cannot start a model request after refresh resolves", async () => {
  const f = fixture();
  try {
    let release!: () => void;
    let refreshing!: () => void;
    const started = new Promise<void>(resolve => { refreshing = resolve; });
    const current = { provider: "margin-custom-fixture", id: "local", contextWindow: 4096 };
    f.l.agent.model = current;
    f.l.models = {
      async refresh() {
        refreshing();
        await new Promise<void>(resolve => { release = resolve; });
      },
      async getAvailable() { return [current]; },
    };
    let prompts = 0;
    const run = f.l.runPrompt(async () => { prompts++; });
    const rejected = assert.rejects(run, /abort/i);
    await started;
    await f.l.stop();
    release();
    await rejected;
    assert.equal(prompts, 0);
    assert.equal(f.l.busy, false);
  } finally { f.close(); }
});
function modelResult(f: ReturnType<typeof fixture>, error?: string) {
  f.manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: error ? "" : "Recovered result" }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "fixture",
    usage,
    stopReason: error ? "error" : "stop",
    errorMessage: error,
    timestamp: Date.now(),
  });
  f.l.onEvent({ type: "agent_settled" });
}
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

test("network wait stays active after SDK settlement, resumes once, and never sends newer drafts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const prompts: string[] = [];
    f.l.agent.prompt = async (text: string) => {
      prompts.push(text);
      modelResult(f);
    };
    const run = f.l.runPrompt(async () =>
      modelResult(f, "WebSocket idle timeout after 300000ms"),
    );
    await flush();
    assert.equal(f.l.busy, true);
    assert.equal(f.store.get("interrupted", "session"), true);
    assert.match(f.l.ui.statuses.network, /Retrying in 15s/);
    t.mock.timers.tick(15_000);
    await run;
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /previously requested task/);
    assert.doesNotMatch(prompts[0], /Do not send this new draft/);
    assert.equal(
      f.store.get("composer", "session"),
      "Do not send this new draft",
    );
    assert.equal(f.l.busy, false);
    assert.equal(f.l.ui.statuses.network, undefined);
    assert.equal(f.l.messages.at(-1).text, "Recovered result");
  } finally {
    f.close();
  }
});

test("Stop during network backoff cancels continuation and remains stopped after time advances", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const run = f.l.runPrompt(async () => modelResult(f, "fetch failed"));
    await flush();
    await f.l.stop();
    await run;
    t.mock.timers.tick(100_000);
    assert.equal(f.prompts(), 0);
    assert.equal(f.l.busy, false);
    assert.equal(
      f.store.get<RecoverableRun>("run-recovery", "session")?.active,
      false,
    );
  } finally {
    f.close();
  }
});

for (const condition of [
  "uncertain-tool",
  "new-question",
  "background",
  "retry-disabled",
  "non-network",
] as const) {
  test(`adapter refuses network continuation for ${condition}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture();
    let question: Promise<unknown> | undefined;
    try {
      if (condition === "uncertain-tool") f.recoveryRun.toolStarted("call");
      if (condition === "retry-disabled") f.l.agent.autoRetryEnabled = false;
      const run = f.l.runPrompt(async () =>
        modelResult(
          f,
          condition === "non-network" ? "401 unauthorized" : "fetch failed",
        ),
      );
      await flush();
      // Arrives after backoff started: the post-wait guard must catch it.
      if (condition === "new-question")
        question = f.l.ui.request("confirm", "A new question");
      if (condition === "background") f.l.childOperations++;
      t.mock.timers.tick(15_000);
      await run;
      assert.equal(f.prompts(), 0);
      if (condition === "new-question") assert.equal(f.l.ui.dialogs.size, 1);
    } finally {
      f.l.ui.cancelAll();
      await question;
      f.close();
    }
  });
}

test("persistent network failure exhausts exactly three extra rounds with an actionable notice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    let attempts = 0;
    f.l.agent.prompt = async () => {
      attempts++;
      modelResult(f, "fetch failed");
    };
    const run = f.l.runPrompt(async () => modelResult(f, "fetch failed"));
    await flush();
    for (const ms of [15_000, 30_000, 60_000]) {
      t.mock.timers.tick(ms);
      await flush();
    }
    await run;
    assert.equal(attempts, 3);
    assert.equal(f.l.busy, false);
    assert.ok(
      f.l.ui.notices.some((n: any) => n.text.includes("retries are exhausted")),
    );
    t.mock.timers.tick(600_000);
    assert.equal(attempts, 3);
  } finally {
    f.close();
  }
});

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
