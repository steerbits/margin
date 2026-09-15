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
import { Store } from "../server/store.ts";
import type { RecoverableRun } from "../server/run-recovery.ts";

// Actual Pi prompt/retry/tool/event lifecycle, with only the model stream
// replaced. No live inference, real credentials, extensions or network probes.
test("real SDK exhausts retries, recovers through Margin, and preserves one completed tool effect", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "margin-network-sdk-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir);
  const oldAgent = process.env.PI_CODING_AGENT_DIR;
  const oldAuth = process.env.MARGIN_AUTH_READ_ONLY;
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
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    }),
  );
  const store = new Store(join(dir, "margin.sqlite"));
  const project = { id: randomUUID(), name: "Fixture", path: dir };
  const session = new LiveSession(
    {
      id: randomUUID(),
      projectId: project.id,
      title: "Network fixture",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: {
        id: "gpt-4.1",
        provider: "openai",
        name: "Fixture",
        subscription: false,
      },
    },
    project,
    store,
    dir,
    dir,
    [],
  );
  try {
    await session.ready;
    let effects = 0;
    const contexts: unknown[] = [];
    session.agent.agent.state.tools = [
      {
        name: "count_effect",
        label: "Effect counter",
        description: "Fixture only",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => {
          effects++;
          return {
            content: [{ type: "text", text: "Effect completed once" }],
            details: {},
          };
        },
      },
    ];
    let calls = 0;
    session.agent.agent.streamFunction = (
      _model: unknown,
      context: unknown,
    ) => {
      contexts.push(
        structuredClone((context as { messages: unknown[] }).messages),
      );
      calls++;
      const error = calls >= 2 && calls <= 5;
      const message: AssistantMessage = {
        role: "assistant",
        content:
          calls === 1
            ? [
                {
                  type: "toolCall",
                  id: "one-effect",
                  name: "count_effect",
                  arguments: {},
                },
              ]
            : error
              ? []
              : [
                  {
                    type: "text",
                    text: "Recovered after the saved tool result",
                  },
                ],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-4.1",
        stopReason: calls === 1 ? "toolUse" : error ? "error" : "stop",
        errorMessage: error
          ? calls === 2
            ? "WebSocket idle timeout after 300000ms"
            : "fetch failed"
          : undefined,
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
      const stream = createAssistantMessageEventStream();
      if (error)
        stream.push({ type: "error", reason: "error", error: message });
      else
        stream.push({
          type: "done",
          reason: message.stopReason as "stop" | "toolUse",
          message,
        });
      stream.end(message);
      return stream;
    };
    // Drain the initialization snapshot's real timer before installing a virtual clock.
    await new Promise((resolve) => setTimeout(resolve, 50));
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await session.send({
      id: randomUUID(),
      note: "Perform the fixture task",
      commentIds: [],
    });
    session.setComposer("Private draft; do not submit");
    // Flush actual async SDK/auth work between virtual retry timer advances.
    for (let i = 0; i < 300 && !session.ui.statuses.network; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      t.mock.timers.tick(10);
    }
    assert.equal(
      calls,
      5,
      `one tool turn, one failure and three Pi retries; notices: ${JSON.stringify(session.ui.notices)}; errors: ${JSON.stringify(session.messages.map((m) => m.error).filter(Boolean))}`,
    );
    assert.equal(effects, 1);
    assert.equal(session.busy, true);
    assert.match(session.ui.statuses.network, /Retrying in 15s/);
    assert.deepEqual(
      store.get<RecoverableRun>("run-recovery", session.info.id)?.tools,
      [],
    );
    t.mock.timers.tick(15_000);
    for (let i = 0; i < 300 && session.busy; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      t.mock.timers.tick(10);
    }
    assert.equal(session.busy, false);
    assert.equal(calls, 6);
    assert.equal(effects, 1, "saved tool work was not replayed by recovery");
    assert.equal(
      session.messages.at(-1)?.text,
      "Recovered after the saved tool result",
    );
    assert.equal(session.ui.editorText, "Private draft; do not submit");
    assert.doesNotMatch(JSON.stringify(contexts), /Private draft/);
    assert.match(JSON.stringify(contexts.at(-1)), /Effect completed once/);
    assert.match(JSON.stringify(contexts.at(-1)), /automatic network recovery/);
    assert.equal(
      store.get<RecoverableRun>("run-recovery", session.info.id)
        ?.networkAttempts,
      1,
    );
  } finally {
    await session.dispose();
    store.close();
    t.mock.timers.reset();
    if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgent;
    if (oldAuth === undefined) delete process.env.MARGIN_AUTH_READ_ONLY;
    else process.env.MARGIN_AUTH_READ_ONLY = oldAuth;
    rmSync(dir, { recursive: true, force: true });
  }
});
