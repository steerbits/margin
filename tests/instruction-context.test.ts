import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { LiveSession } from "../server/sessions.ts";
import { InstructionResourceLoader } from "../server/instruction-context.ts";
import {
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Store } from "../server/store.ts";
import { readInstructions, saveInstructions } from "../server/instructions.ts";

async function idle(session: LiveSession) {
  for (let i = 0; i < 200 && session.busy; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(session.busy, false, JSON.stringify(session.ui.notices));
}
test("a failed prompt rebuild does not mark changed instructions as activated", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "margin-context-rebuild-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  writeFileSync(join(root, "AGENTS.md"), "Before rebuild");
  const loader = new InstructionResourceLoader({
    cwd: root,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
  });
  await loader.reload();
  const before = loader.getAgentsFiles().agentsFiles;
  writeFileSync(join(root, "AGENTS.md"), "After rebuild");
  let calls = 0;
  const session = {
    isStreaming: false,
    isCompacting: false,
    getActiveToolNames: () => [],
    setActiveToolsByName: () => {
      calls++;
      if (calls === 1) throw new Error("Rebuild failed");
    },
  } as unknown as AgentSession;
  assert.throws(() => loader.refreshInstructions(session), /Rebuild failed/);
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, before);
  loader.refreshInstructions(session);
  assert.equal(calls, 2);
  assert.match(JSON.stringify(loader.getAgentsFiles()), /After rebuild/);
});

const batch = () => ({
  id: randomUUID(),
  note: "Continue the fixture",
  commentIds: [],
});
function reply(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "Fixture reply" }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4.1",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

test("actual Pi context refresh spans existing workspaces, preserves a running request and blocks unreadable updates before acceptance", async () => {
  const root = mkdtempSync(join(tmpdir(), "margin-context-sdk-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  const old = {
    dir: process.env.PI_CODING_AGENT_DIR,
    auth: process.env.MARGIN_AUTH_READ_ONLY,
  };
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.MARGIN_AUTH_READ_ONLY = "1";
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({ openai: { type: "api_key", key: "unused-fixture-key" } }),
  );
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  );
  writeFileSync(join(agentDir, "AGENTS.md"), "GLOBAL_OLD_783");
  writeFileSync(join(root, "AGENTS.md"), "ANCESTOR_783");
  const store = new Store(join(root, "margin.sqlite"));
  const sessions: LiveSession[] = [];
  let release: (() => void) | undefined;
  try {
    for (const name of ["A", "B"]) {
      const path = join(root, name);
      mkdirSync(path);
      writeFileSync(join(path, "AGENTS.md"), `${name}_OLD_783`);
      const project = { id: randomUUID(), name, path };
      const session = new LiveSession(
        {
          id: randomUUID(),
          projectId: project.id,
          title: name,
          createdAt: 1,
          updatedAt: 1,
          model: {
            id: "gpt-4.1",
            provider: "openai",
            name: "Fixture",
            subscription: false,
          },
        },
        project,
        store,
        root,
        root,
        [],
      );
      sessions.push(session);
      await session.ready;
      await idle(session);
    }
    const [a, b] = sessions;
    const prompts: string[][] = [[], []];
    sessions.forEach((session, i) => {
      session.agent.agent.streamFunction = (_model, context) => {
        prompts[i].push(context.systemPrompt ?? "");
        const stream = createAssistantMessageEventStream();
        const finish = () => {
          const message = reply();
          stream.push({ type: "done", reason: "stop", message });
          stream.end(message);
        };
        if (i === 0 && prompts[i].length === 1) release = finish;
        else finish();
        return stream;
      };
    });
    const tools = a.agent.getActiveToolNames();
    const toolDefinitions = a.agent.agent.state.tools;
    const extensions = a.agent.resourceLoader.getExtensions();
    const skills = a.agent.resourceLoader.getSkills();
    const settings = a.agent.settingsManager;
    await a.send(batch());
    for (let i = 0; !release && i < 100; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.ok(release, "first request is paused inside the real SDK");
    assert.equal(a.busy, true);
    await b.send(batch());
    await idle(b);
    assert.match(prompts[0][0], /GLOBAL_OLD_783/);
    assert.match(prompts[0][0], /ANCESTOR_783/);
    assert.match(prompts[0][0], /A_OLD_783/);
    assert.doesNotMatch(prompts[1][0], /A_OLD_783/);
    saveInstructions(
      agentDir,
      {
        revision: readInstructions(agentDir).revision,
        content: "GLOBAL_NEW_783",
      },
      true,
    );
    saveInstructions(a.project.path, {
      revision: readInstructions(a.project.path).revision,
      content: "A_NEW_783",
    });
    assert.match(a.agent.agent.state.systemPrompt, /GLOBAL_OLD_783/);
    assert.doesNotMatch(a.agent.agent.state.systemPrompt, /GLOBAL_NEW_783/);
    await assert.rejects(
      () => a.send(batch()),
      /Wait for the current response/,
    );
    await b.send(batch());
    await idle(b);
    assert.match(prompts[1][1], /GLOBAL_NEW_783/);
    assert.match(prompts[1][1], /B_OLD_783/);
    assert.doesNotMatch(prompts[1][1], /A_NEW_783|GLOBAL_OLD_783/);
    release();
    await idle(a);
    await a.send(batch());
    await idle(a);
    assert.match(prompts[0][1], /GLOBAL_NEW_783/);
    assert.match(prompts[0][1], /A_NEW_783/);
    assert.doesNotMatch(prompts[0][1], /GLOBAL_OLD_783|A_OLD_783/);
    assert.equal(prompts[0][1].match(/GLOBAL_NEW_783/g)?.length, 1);
    assert.equal(prompts[0][1].match(/A_NEW_783/g)?.length, 1);
    assert.deepEqual(a.agent.getActiveToolNames(), tools);
    assert.deepEqual(a.agent.agent.state.tools, toolDefinitions);
    assert.equal(a.agent.resourceLoader.getExtensions(), extensions);
    assert.equal(a.agent.resourceLoader.getSkills().skills, skills.skills);
    assert.equal(a.agent.settingsManager, settings);
    assert.equal(a.messages.filter((m) => m.role === "user").length, 2);

    a.setComposer("Retain this unsent draft");
    const failed = batch();
    const messageCount = a.messages.length;
    writeFileSync(join(agentDir, "AGENTS.md"), Buffer.from([0xff]));
    await assert.rejects(
      () => a.send(failed),
      /Couldn't load updated instructions/,
    );
    assert.equal(store.batch(a.info.id, failed.id), undefined);
    assert.equal(a.messages.length, messageCount);
    assert.equal(a.ui.editorText, "Retain this unsent draft");
    assert.equal(a.busy, false);
    writeFileSync(join(agentDir, "AGENTS.md"), "GLOBAL_REPAIRED_783");
    await a.send(failed);
    await idle(a);
    assert.match(prompts[0][2], /GLOBAL_REPAIRED_783/);
    assert.equal(a.messages.filter((m) => m.role === "user").length, 3);

    // Inherited sources, override preference and removal follow Pi discovery.
    writeFileSync(join(root, "AGENTS.md"), "ANCESTOR_UPDATED_783");
    writeFileSync(join(a.project.path, "AGENTS.override.md"), "A_OVERRIDE_783");
    await a.send(batch());
    await idle(a);
    assert.match(prompts[0][3], /ANCESTOR_UPDATED_783/);
    assert.match(prompts[0][3], /A_OVERRIDE_783/);
    assert.doesNotMatch(prompts[0][3], /A_NEW_783|ANCESTOR_783/);
    rmSync(join(a.project.path, "AGENTS.override.md"));
    rmSync(join(a.project.path, "AGENTS.md"));
    await a.send(batch());
    await idle(a);
    assert.doesNotMatch(prompts[0][4], /A_OVERRIDE_783|A_NEW_783/);
  } finally {
    release?.();
    for (const session of sessions) await session.dispose();
    store.close();
    if (old.dir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old.dir;
    if (old.auth === undefined) delete process.env.MARGIN_AUTH_READ_ONLY;
    else process.env.MARGIN_AUTH_READ_ONLY = old.auth;
    rmSync(root, { recursive: true, force: true });
  }
});
