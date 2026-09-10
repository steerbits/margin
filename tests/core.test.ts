import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UiBridge } from "../server/ui-bridge.ts";
import { Store } from "../server/store.ts";
import { formatFeedback } from "../server/feedback.ts";
import { resolveAnchor } from "../src/anchors.ts";
import { transcript, diffFrom } from "../server/transcript.ts";
import type { Comment, Message } from "../shared/types.ts";
import { recoverInput } from "../server/recovery.ts";

const anchor = {
  messageId: "original",
  start: 0,
  end: 11,
  quote: "Use SQLite.",
  prefix: "",
  suffix: "",
};
const comment: Comment = {
  id: "c1",
  anchor,
  text: 'Use a local file.\nPreserve "quotes" and </feedback>.',
  status: "draft",
  createdAt: 1,
};
const message: Message = {
  id: "original",
  role: "assistant",
  text: "Use **SQLite**.",
};
test("feedback preserves exact quotes and comments, rejects already-sent/missing/duplicate references", () => {
  const text = formatFeedback(
    { id: "b1", note: "Keep it small.", commentIds: ["c1"] },
    [comment],
    [message],
  );
  const payload = JSON.parse(text.slice(text.indexOf("{")));
  assert.equal(payload.inlineComments[0].comment, comment.text);
  assert.equal(payload.inlineComments[0].quotedPassage, anchor.quote);
  assert.equal(payload.overallReply, "Keep it small.");
  assert.throws(() =>
    formatFeedback(
      { id: "b", note: "", commentIds: ["c1"] },
      [{ ...comment, status: "sent" }],
      [message],
    ),
  );
  assert.throws(() =>
    formatFeedback({ id: "b", note: "", commentIds: ["c1"] }, [comment], []),
  );
  assert.throws(() =>
    formatFeedback(
      { id: "b", note: "", commentIds: ["c1", "c1"] },
      [comment],
      [message],
    ),
  );
  assert.throws(() =>
    formatFeedback(
      { id: "b", note: "", commentIds: ["c1"] },
      [comment],
      [{ ...message, streaming: true }],
    ),
  );
});
test("anchor resolution refuses ambiguous or changed quotes and accepts context-preserving renderer shifts", () => {
  assert.deepEqual(resolveAnchor("Use SQLite.", anchor), { start: 0, end: 11 });
  assert.equal(resolveAnchor("Use hosted storage.", anchor), null);
  assert.equal(
    resolveAnchor("x Use SQLite. x Use SQLite.", {
      ...anchor,
      start: 99,
      end: 110,
    }),
    null,
  );
  const a = { ...anchor, start: 99, end: 110, prefix: "A: ", suffix: " Done" };
  assert.deepEqual(resolveAnchor("A: Use SQLite. Done", a), {
    start: 3,
    end: 14,
  });
});
test("UI promises wait for typed answers; cancellation, timeout, abort, and duplicate answers are distinct", async () => {
  const ui = new UiBridge(() => {});
  const context = { ...ui.context() };
  let settled = false;
  const p = context.select("Choose", ["A", "B"]).then((x) => {
    settled = true;
    return x;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  const id = [...ui.dialogs.keys()][0];
  assert.throws(() => ui.answer(id, "not-an-option"));
  assert.equal(settled, false);
  ui.answer(id, "B");
  assert.equal(await p, "B");
  assert.throws(() => ui.answer(id, "A"));
  const confirm = context.confirm("Proceed", "Do it?");
  ui.answer([...ui.dialogs.keys()][0], undefined, true);
  assert.equal(await confirm, false);
  const timed = context.input("Name", "", { timeout: 5 });
  assert.equal(await timed, undefined);
  const controller = new AbortController();
  const aborted = context.input("Name", "", { signal: controller.signal });
  controller.abort();
  assert.equal(await aborted, undefined);
  assert.equal(ui.dialogs.size, 0);
  context.setStatus("test", "Still available after spread");
  assert.equal(ui.statuses.test, "Still available after spread");
  context.setEditorText("draft");
  context.pasteToEditor(" plus");
  assert.equal(context.getEditorText(), "draft plus");
});
test("unsupported interactive UI stays explicit, never fabricates a cancellation result", async () => {
  const ui = new UiBridge(() => {});
  const p = ui.context().custom(() => {
    throw new Error("The terminal factory must not execute.");
  });
  assert.equal([...ui.dialogs.values()][0].kind, "unsupported");
  ui.cancelAll();
  await assert.rejects(p, /requires a terminal UI/);
  assert.equal(ui.dialogs.size, 0);
});
test("comments and project plugin data survive reopening storage and remain isolated", () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-store-"));
  const file = join(dir, "test.sqlite");
  try {
    let db = new Store(file);
    db.put("comments", "session-a", [comment]);
    db.put("plugin:notes:project-a", "data", { text: "a" });
    db.put("plugin:notes:project-b", "data", { text: "b" });
    db.markBatch("session-a", "batch", "accepted");
    db.close();
    db = new Store(file);
    assert.deepEqual(db.comments("session-a"), [comment]);
    assert.deepEqual(db.comments("session-b"), []);
    assert.deepEqual(db.get("plugin:notes:project-a", "data"), { text: "a" });
    assert.equal(db.batch("session-a", "batch")?.status, "accepted");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("transcript uses durable entry IDs, keeps pre-compaction history, and correlates tool results", () => {
  const entries = [
    {
      id: "a",
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Review me." },
          {
            type: "toolCall",
            id: "t",
            name: "future_tool",
            arguments: { x: 1 },
          },
        ],
      },
    },
    {
      id: "b",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "t",
        toolName: "future_tool",
        content: [{ type: "text", text: "result" }],
        details: { patch: "-old\n+new" },
        isError: false,
      },
    },
    { id: "c", type: "compaction", summary: "summary" },
    {
      id: "hidden",
      type: "custom_message",
      display: false,
      content: "do not show",
    },
  ];
  const result = transcript(entries as never);
  assert.equal(result[0].id, "a");
  assert.equal(result[1].tool?.name, "future_tool");
  assert.equal(result[1].tool?.status, "success");
  assert.equal(result[1].tool?.diff, "-old\n+new");
  assert.equal(
    result.some((m) => m.id === "hidden"),
    false,
  );
  assert.equal(result.length, 3);
  assert.equal(diffFrom({ details: { diff: "fallback" } }), "fallback");
});
test("interrupted follow-up recovers only its missing submission and preserves a newer draft", () => {
  const pending = {
    prompt: "follow-up",
    note: "Original note",
    batchId: "b",
    accepted: true,
    persistedUserId: "new-user",
  };
  const result = recoverInput(
    pending,
    (id) => id === "old-user",
    "Newer note",
    [{ ...comment, status: "sent", batchId: "b" }],
  );
  assert.equal(result.recovered, true);
  assert.match(result.composer, /Original note/);
  assert.match(result.composer, /Newer note/);
  assert.equal(result.comments[0].status, "draft");
  assert.equal(result.comments[0].batchId, undefined);
  const persisted = recoverInput(
    pending,
    (id) => id === "new-user",
    "Newer note",
    [{ ...comment, status: "sent", batchId: "b" }],
  );
  assert.equal(persisted.recovered, false);
  assert.equal(persisted.composer, "Newer note");
  assert.equal(persisted.comments[0].status, "sent");
});
