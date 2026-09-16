import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveSession } from "../server/sessions.ts";
import { Store } from "../server/store.ts";
import { replyActionInstructions } from "../shared/reply-actions.ts";

test("real Pi sessions receive Margin reply instructions without modifying skills", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-reply-prompt-"));
  const agentDir = join(dir, "agent"),
    dataDir = join(dir, "data");
  mkdirSync(agentDir);
  mkdirSync(dataDir);
  // Authentication-shaped fixture; no provider prompt or credential mutation.
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      openai: { type: "api_key", key: "unused-fixture-key" },
    }),
  );
  const names = ["PI_CODING_AGENT_DIR", "MARGIN_AUTH_READ_ONLY", "PI_OFFLINE"];
  const previous = names.map((key) => process.env[key]);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.MARGIN_AUTH_READ_ONLY = "1";
  process.env.PI_OFFLINE = "1";
  const store = new Store(join(dataDir, "margin.sqlite"));
  const project = { id: randomUUID(), name: "Reply prompt test", path: dir };
  const session = new LiveSession(
    {
      id: randomUUID(),
      projectId: project.id,
      title: "Reply prompt test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    project,
    store,
    dataDir,
    dir,
    [],
  );
  try {
    await session.ready;
    assert.ok(
      session.agent.agent.state.systemPrompt.includes(replyActionInstructions),
    );
    assert.ok(
      session.agent.agent.state.systemPrompt.includes(
        "Follow the selected skill",
      ),
    );
  } finally {
    await session.dispose();
    store.close();
    names.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
    rmSync(dir, { recursive: true, force: true });
  }
});
