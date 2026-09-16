import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveSession } from "../server/sessions.ts";
import { Store } from "../server/store.ts";
import type { SessionInfo } from "../shared/types.ts";

test("opening, observing and idle disposal preserve recency; real message activity advances it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-recency-"));
  const agentDir = join(dir, "agent");
  const data = join(dir, "data");
  mkdirSync(agentDir);
  mkdirSync(data);
  const oldAgent = process.env.PI_CODING_AGENT_DIR;
  const oldAuth = process.env.MARGIN_AUTH_READ_ONLY;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.MARGIN_AUTH_READ_ONLY = "1";
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      openai: { type: "api_key", key: "unused-fixture-key" },
    }),
  );
  const store = new Store(join(data, "margin.sqlite"));
  const project = { id: "project", name: "Fixture", path: dir };
  const sessions: LiveSession[] = [];
  const open = async (info: SessionInfo) => {
    const session = new LiveSession(info, project, store, data, dir, []);
    sessions.push(session);
    await session.ready;
    return session;
  };
  try {
    const first = await open({
      id: "chat",
      projectId: project.id,
      title: "Older conversation",
      createdAt: 1,
      updatedAt: 2,
    });
    assert.equal(first.info.updatedAt, 2);
    first.snapshot();
    first.changed();
    await first.dispose();
    assert.equal(store.get<SessionInfo>("session", "chat")!.updatedAt, 2);
    const reopened = await open(store.get<SessionInfo>("session", "chat")!);
    assert.equal(reopened.snapshot().session.updatedAt, 2);
    // Exercise the real send/persistence path with a scripted model boundary.
    reopened.agent.prompt = async (text, options) => {
      options?.preflightResult?.(true);
      reopened.agent.sessionManager.appendMessage({
        role: "user",
        content: text,
        timestamp: Date.now(),
      });
    };
    await reopened.send({
      id: "batch",
      note: "Actual new activity",
      commentIds: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(reopened.busy, false);
    assert.ok(reopened.info.updatedAt > 2);
    const activeAt = reopened.info.updatedAt;
    await reopened.dispose();
    const again = await open(store.get<SessionInfo>("session", "chat")!);
    assert.equal(again.info.updatedAt, activeAt);
    assert.ok(
      again.snapshot().messages.some((m) => m.text === "Actual new activity"),
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
