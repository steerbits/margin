import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatOutbox } from "../src/chat-outbox.ts";
import type { FeedbackBatch, Snapshot } from "../shared/types.ts";

const snapshot = (): Snapshot => ({
  session: {
    id: "chat",
    projectId: "project",
    title: "Task",
    createdAt: 1,
    updatedAt: 1,
  },
  messages: [{ id: "old", role: "user", text: "Same words" }],
  composer: "Same words",
  comments: [],
  busy: false,
  dialogs: [],
  notices: [],
  statuses: {},
  widgets: {},
  skills: [],
  pluginState: {},
});
const batch: FeedbackBatch = {
  id: "batch",
  note: "Same words",
  commentIds: [],
};

function setup() {
  const outbox = new ChatOutbox();
  const s = snapshot();
  outbox.begin(s, batch, []);
  return { outbox, s };
}

test("pending sends clear only the displayed draft; old snapshots cannot resurrect it", () => {
  const { outbox, s } = setup();
  assert.equal(outbox.text("chat", s.composer), "");
  assert.equal(s.composer, "Same words");
  assert.equal(outbox.get("chat")?.message.text, "Same words");
  assert.equal(outbox.observe(s), undefined);
  assert.equal(outbox.get("chat")?.status, "sending");
  assert.equal(outbox.text("another", "Other draft"), "Other draft");
});

test("acceptance keeps the bubble until a new durable user message replaces it", () => {
  const { outbox, s } = setup();
  outbox.accept("chat", "wrong-id");
  assert.equal(outbox.get("chat")?.status, "sending");
  outbox.accept("chat", "batch");
  assert.equal(outbox.get("chat")?.status, "accepted");
  assert.equal(outbox.observe(s), undefined);
  const result = outbox.observe({
    ...s,
    composer: "",
    submission: { id: "batch", status: "accepted" },
    messages: [...s.messages, { id: "new", role: "user", text: "Same words" }],
  });
  assert.deepEqual(result, { draft: "", rejected: false });
  assert.equal(outbox.get("chat"), undefined);
  // A late HTTP error cannot restore a message already confirmed by the stream.
  assert.equal(outbox.reject("chat", "batch"), undefined);
});

test("new typing survives stale echoes and the server's acceptance-time clear", () => {
  const { outbox, s } = setup();
  outbox.edit("chat", "Follow-up draft");
  assert.equal(outbox.text("chat", "Same words"), "Follow-up draft");
  assert.equal(outbox.text("chat", ""), "Follow-up draft");
  assert.deepEqual(
    outbox.observe({
      ...s,
      composer: "",
      messages: [
        ...s.messages,
        { id: "new", role: "user", text: "Same words" },
      ],
    }),
    { draft: "Follow-up draft", rejected: false },
  );
});

test("typing the same text again is a new draft, not an echo to discard", () => {
  const { outbox, s } = setup();
  outbox.edit("chat", "Same words");
  assert.deepEqual(
    outbox.observe({
      ...s,
      composer: "",
      messages: [
        ...s.messages,
        { id: "new", role: "user", text: "Same words" },
      ],
    }),
    { draft: "Same words", rejected: false },
  );
});

test("failure restores the original and preserves newer typing; another batch cannot reject it", () => {
  const { outbox } = setup();
  outbox.edit("chat", "Follow-up draft");
  assert.equal(outbox.reject("chat", "other"), undefined);
  assert.equal(outbox.reject("chat", "batch"), "Same words\n\nFollow-up draft");
  assert.equal(outbox.get("chat"), undefined);
});

test("async preflight rejection restores the draft even after HTTP reports submitting", () => {
  const { outbox, s } = setup();
  assert.deepEqual(
    outbox.observe({ ...s, submission: { id: "batch", status: "rejected" } }),
    {
      draft: "Same words",
      rejected: true,
    },
  );
  assert.equal(outbox.get("chat"), undefined);
});

test("an accepted command can settle without adding a transcript message", () => {
  const { outbox, s } = setup();
  assert.deepEqual(
    outbox.observe({
      ...s,
      composer: "",
      submission: { id: "batch", status: "accepted" },
    }),
    {
      draft: "",
      rejected: false,
    },
  );
  assert.equal(outbox.get("chat"), undefined);
});

test("another browser's submission cannot acknowledge this optimistic message", () => {
  const { outbox, s } = setup();
  assert.equal(
    outbox.observe({
      ...s,
      submission: { id: "other", status: "accepted" },
      messages: [
        ...s.messages,
        { id: "other", role: "user", text: "Same words" },
      ],
    }),
    undefined,
  );
  assert.equal(outbox.get("chat")?.status, "sending");
});

test("comments, skills and attachment-only messages have optimistic content too", () => {
  const { outbox, s } = setup();
  const files = [
    { id: "file", name: "report.csv", size: 10, mimeType: "text/csv" },
  ];
  outbox.begin(s, { ...batch, note: "", attachmentIds: ["file"] }, files);
  assert.equal(outbox.get("chat")?.message.text, "");
  assert.deepEqual(outbox.get("chat")?.message.attachments, files);
  s.messages.push({ id: "reply", role: "assistant", text: "A proposal" });
  s.comments.push({
    id: "comment",
    text: "Please simplify",
    status: "draft",
    createdAt: 1,
    anchor: {
      messageId: "reply",
      start: 0,
      end: 1,
      quote: "A",
      prefix: "",
      suffix: "",
    },
  });
  outbox.begin(
    s,
    { ...batch, note: "", commentIds: ["comment"], skill: "shape-with-me" },
    [],
  );
  assert.match(outbox.get("chat")!.message.text, /Please simplify/);
  assert.equal(outbox.get("chat")?.message.skill, "shape-with-me");
});
