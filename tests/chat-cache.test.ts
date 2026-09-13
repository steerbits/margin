import test from "node:test";
import assert from "node:assert/strict";
import { ChatCache, ChatDrafts } from "../src/chat-cache.ts";
import { sessionPreview } from "../server/session-preview.ts";
import { Store } from "../server/store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Snapshot } from "../shared/types.ts";

test("a slow save in one chat does not delay another and cannot discard its newer draft", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const written: [string, string][] = [];
  const drafts = new ChatDrafts(async (id, text) => {
    if (id === "slow" && text === "first") await gate;
    written.push([id, text]);
  });
  drafts.set("slow", "first");
  const first = drafts.flush("slow");
  drafts.set("slow", "newer");
  const newer = drafts.flush("slow");
  drafts.set("fast", "other chat");
  await drafts.flush("fast");
  assert.deepEqual(written, [["fast", "other chat"]]);
  assert.equal(drafts.get("slow")?.text, "newer");
  release();
  await Promise.all([first, newer]);
  assert.deepEqual(written.slice(1), [
    ["slow", "first"],
    ["slow", "newer"],
  ]);
  assert.equal(drafts.unsaved, false);
});

test("failed saves keep their text and can be retried without losing edits", async () => {
  let fail = true;
  const written: string[] = [];
  const drafts = new ChatDrafts(async (_id, text) => {
    if (fail) throw new Error("offline");
    written.push(text);
  });
  drafts.set("chat", "keep this");
  await assert.rejects(drafts.flush("chat"));
  assert.equal(drafts.get("chat")?.text, "keep this");
  assert.equal(drafts.unsaved, true);
  fail = false;
  drafts.set("chat", "keep this and more");
  await drafts.flush("chat");
  assert.deepEqual(written, ["keep this and more"]);
  assert.equal(drafts.unsaved, false);
});

test("saved previews include history and drafts without loading any agent", () => {
  const directory = mkdtempSync(join(tmpdir(), "margin-preview-test-"));
  const store = new Store(join(directory, "margin.sqlite"));
  try {
    const session = {
      id: "chat",
      projectId: "workspace",
      title: "Saved",
      createdAt: 1,
      updatedAt: 2,
    };
    store.put("session", "chat", session);
    store.put("transcript", "chat", [
      { id: "reply", role: "assistant", text: "Saved answer" },
    ]);
    store.put("composer", "chat", "Saved draft");
    const snapshot = sessionPreview(store.get.bind(store), "chat");
    assert.equal(snapshot.messages[0].text, "Saved answer");
    assert.equal(snapshot.composer, "Saved draft");
    assert.equal(snapshot.session.id, "chat");
    assert.throws(() => sessionPreview(store.get.bind(store), "missing"));
    const cache = new ChatCache(2);
    cache.put(snapshot);
    cache.put({ ...snapshot, session: { ...session, id: "second" } });
    cache.put({ ...snapshot, session: { ...session, id: "third" } });
    assert.equal(cache.get("chat"), undefined);
    assert.equal(cache.get("third")?.messages[0].text, "Saved answer");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an acknowledged draft survives older stream messages until its revision is reached", async () => {
  const drafts = new ChatDrafts(async () => ({ composerRevision: 8 }));
  drafts.set("chat", "Latest saved draft");
  await drafts.flush("chat");
  assert.equal(drafts.unsaved, false);
  assert.equal(
    drafts.text("chat", "old stream value", 7),
    "Latest saved draft",
  );
  assert.equal(
    drafts.text("chat", "Latest saved draft", 8),
    "Latest saved draft",
  );
  assert.equal(drafts.text("chat", "", 9), "");
});
