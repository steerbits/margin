import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionActivityTracker } from "../server/session-activity.ts";
import { deleteSavedSession } from "../server/delete-session.ts";
import { Store } from "../server/store.ts";
import {
  destinationUrl,
  parseRoute,
  type Destination,
} from "../shared/navigation.ts";
import { defaultSkill } from "../shared/skills.ts";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { Snapshot, Message } from "../shared/types.ts";
const info = {
  id: "chat",
  projectId: "workspace",
  title: "Test",
  createdAt: 1,
  updatedAt: 1,
};
const reply = (id: string): Message => ({
  id,
  role: "assistant",
  text: "A reply",
});
const snapshot = (messages: Message[] = [], busy = false): Snapshot => ({
  session: info,
  messages,
  busy,
  comments: [],
  composer: "",
  dialogs: [],
  notices: [],
  statuses: {},
  widgets: {},
  skills: [],
  pluginState: {},
});

test("destinations round-trip stable IDs and qualified panel IDs without encoding them as path segments", () => {
  const destinations: Destination[] = [
    { kind: "home" },
    { kind: "chat", sessionId: "7f03c9e8-6260-47ca-9d65-7430a05235d2" },
    { kind: "workspace", projectId: "id with/slashes", panel: "notes:editor" },
    { kind: "chat", sessionId: "id", panel: "comments" },
    { kind: "customize", tab: "history" },
  ];
  for (const target of destinations) {
    const url = new URL(destinationUrl(target), "http://localhost");
    assert.deepEqual(
      JSON.parse(JSON.stringify(parseRoute(url.pathname, url.search))),
      target,
    );
  }
  assert.deepEqual(parseRoute("/chats/%broken"), { kind: "not-found" });
  assert.deepEqual(parseRoute("/customize/unknown"), { kind: "not-found" });
});

test("a background run creates exactly one completion and reopening it retains that completion", () => {
  const tracker = new SessionActivityTracker();
  tracker.update(snapshot([reply("old")], true));
  assert.equal(
    tracker.update(snapshot([reply("old")])).completionId,
    undefined,
  );
  assert.equal(
    tracker.update(snapshot([reply("old")], true)).status,
    "running",
  );
  const waiting = snapshot([reply("old")], true);
  waiting.dialogs = [{ id: "question", title: "Choose", kind: "input" }];
  assert.equal(tracker.update(waiting).status, "waiting");
  tracker.update(snapshot([reply("old"), reply("new")], true));
  const finished = tracker.update(snapshot([reply("old"), reply("new")]));
  assert.equal(finished.status, "finished");
  assert.ok(finished.completionId);
  assert.equal(finished.replyId, "new");
  assert.deepEqual(
    tracker.update(snapshot([reply("old"), reply("new")])),
    finished,
  );
  const reopened = new SessionActivityTracker(finished);
  reopened.update(snapshot([reply("old"), reply("new")], true));
  assert.deepEqual(
    reopened.update(snapshot([reply("old"), reply("new")])),
    finished,
  );
});

test("errors during running persist until settled; a later successful run clears failed", () => {
  const tracker = new SessionActivityTracker();
  tracker.update(snapshot([reply("old")]));
  const running = snapshot([reply("old")], true);
  tracker.update(running);
  running.notices = [{ id: "error", text: "Request failed", level: "error" }];
  assert.equal(tracker.update(running).status, "running");
  running.busy = false;
  assert.equal(tracker.update(running).status, "failed");
  assert.equal(tracker.activity.completionId, undefined);
  const restart = new SessionActivityTracker(tracker.activity);
  restart.update(snapshot([reply("old")], true));
  assert.equal(restart.update(snapshot([reply("old")])).status, "failed");
  running.busy = true;
  tracker.update(running);
  running.messages.push(reply("recovered"));
  running.busy = false;
  assert.equal(tracker.update(running).status, "finished");
});

test("Stop suppresses unread completion for a partial reply", () => {
  const tracker = new SessionActivityTracker();
  tracker.update(snapshot());
  tracker.update(snapshot([], true));
  tracker.stop();
  const stopped = tracker.update(snapshot([reply("partial")]));
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.completionId, undefined);
});

test("deletion removes all owned chat state and native transcript, retaining workspace files and shared notes", () => {
  const root = mkdtempSync(join(tmpdir(), "margin-delete-test-"));
  const store = new Store(join(root, "margin.sqlite"));
  try {
    mkdirSync(join(root, "pi-sessions", "workspace"), { recursive: true });
    const file = join(root, "pi-sessions", "workspace", "chat.jsonl");
    writeFileSync(file, "private transcript");
    const other = join(root, "workspace-file.txt");
    writeFileSync(other, "keep");
    const session = { ...info, sessionFile: file };
    for (const kind of [
      "session",
      "activity",
      "session-owner",
      "transcript",
      "composer",
      "comments",
      "interrupted",
      "pi-backup",
      "pending-input",
    ])
      store.put(kind, info.id, kind === "session" ? session : "data");
    store.markBatch(info.id, "batch", "accepted");
    store.put("project", "workspace", {
      id: "workspace",
      name: "Name",
      path: root,
    });
    store.put("plugin:notes:workspace", "note", "shared notes");
    store.put("session", "other-chat", { ...info, id: "other-chat" });
    deleteSavedSession(store, session, root);
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(other), true);
    assert.equal(store.get("pi-backup", info.id), undefined);
    assert.equal(store.get("session-owner", info.id), undefined);
    assert.equal(store.batch(info.id, "batch"), undefined);
    assert.equal(store.sessions().length, 1);
    assert.equal(store.get("plugin:notes:workspace", "note"), "shared notes");
    assert.equal(store.projects().length, 1);
    assert.throws(() =>
      deleteSavedSession(store, { ...session, sessionFile: other }, root),
    );
    assert.equal(existsSync(other), true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("renamed skill is discoverable and the default remains independent of other skills", () => {
  const result = loadSkillsFromDir({ dir: resolve("skills"), source: "path" });
  assert.ok(result.skills.some((s) => s.name === "shape-with-me"));
  assert.equal(
    result.skills.some((s) => s.name === "grill-frame-explore"),
    false,
  );
  assert.equal(defaultSkill(result.skills), "shape-with-me");
  const additional = {
    name: "new-skill",
    filePath: "/example/SKILL.md",
    description: "Another skill",
  };
  assert.equal(defaultSkill([additional, ...result.skills]), "shape-with-me");
  assert.equal(defaultSkill([additional]), "");
  assert.equal(defaultSkill([]), "");
});

test("disposing the UI cancels pending and later startup questions without leaving hidden waits", async () => {
  const { UiBridge } = await import("../server/ui-bridge.ts");
  const ui = new UiBridge(() => {});
  const first = ui.request("input", "Startup question");
  const followup = first.then(() => ui.request("confirm", "Delayed follow-up"));
  ui.dispose();
  assert.equal(await first, undefined);
  assert.equal(await followup, false);
  assert.equal(ui.dialogs.size, 0);
  await assert.rejects(ui.request("unsupported", "Unavailable after disposal"));
});
