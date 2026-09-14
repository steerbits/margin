import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveSession } from "../server/sessions.ts";
import { createModels, listModels } from "../server/models.ts";
import { newConversationSettings, readSettings } from "../server/settings.ts";
import { Store } from "../server/store.ts";
import type { SessionInfo } from "../shared/types.ts";

test("real Pi adapter applies defaults only to new sessions, restores per-chat effort, and never writes global defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-session-defaults-"));
  const agentDir = join(dir, "agent");
  const data = join(dir, "data");
  mkdirSync(agentDir);
  mkdirSync(data);
  const oldAgent = process.env.PI_CODING_AGENT_DIR;
  const oldAuth = process.env.MARGIN_AUTH_READ_ONLY;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.MARGIN_AUTH_READ_ONLY = "1";
  // Authentication-shaped fixture only; this test never calls a provider.
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      openai: { type: "api_key", key: "unused-fixture-key" },
    }),
  );
  const piSettings = '{"defaultThinkingLevel":"low"}\n';
  writeFileSync(join(agentDir, "settings.json"), piSettings);
  const store = new Store(join(data, "margin.sqlite"));
  const project = { id: randomUUID(), name: "Test", path: dir };
  const sessions: LiveSession[] = [];
  const open = async (info: SessionInfo) => {
    const session = new LiveSession(info, project, store, data, dir, []);
    sessions.push(session);
    await session.ready;
    return session;
  };
  try {
    const models = await listModels(await createModels(data));
    const model = models.find(
      (m) =>
        m.provider === "openai" &&
        m.thinkingLevels?.includes("high") &&
        m.thinkingLevels.includes("medium"),
    );
    assert.ok(model);
    const reference = {
      id: model.id,
      provider: model.provider,
      backend: model.backend,
    };
    store.put("preference", "app-settings", {
      defaultModel: reference,
      defaultThinkingLevel: "high",
    });
    const makeInfo = (): SessionInfo => ({
      id: randomUUID(),
      projectId: project.id,
      title: "New conversation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...newConversationSettings(readSettings(store), models),
    });
    const first = await open(makeInfo());
    assert.equal(first.snapshot().thinking?.level, "high");
    const other = model.thinkingLevels!.find((level) => level !== "high")!;
    await first.setThinking(other);
    store.put("preference", "app-settings", {
      defaultModel: reference,
      defaultThinkingLevel: "medium",
    });
    const second = await open(makeInfo());
    assert.equal(second.snapshot().thinking?.level, "medium");
    assert.equal(first.snapshot().thinking?.level, other);
    await first.dispose();
    const resumed = await open(
      store.get<SessionInfo>("session", first.info.id)!,
    );
    assert.equal(resumed.snapshot().thinking?.level, other);
    assert.equal(resumed.snapshot().session.model?.id, model.id);
    assert.equal(
      readFileSync(join(agentDir, "settings.json"), "utf8"),
      piSettings,
    );
  } finally {
    for (const session of sessions) await session.dispose();
    store.close();
    if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgent;
    if (oldAuth === undefined) delete process.env.MARGIN_AUTH_READ_ONLY;
    else process.env.MARGIN_AUTH_READ_ONLY = oldAuth;
    rmSync(dir, { recursive: true, force: true });
  }
});
