import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, SessionActivity, SessionInfo } from "../shared/types.ts";
import {
  isActiveConversation,
  orderConversations,
  searchConversations,
  visibleConversations,
} from "../src/sidebar-conversations.ts";

function chat(
  id: string,
  updatedAt: number,
  status: SessionActivity["status"] = "idle",
  projectId = "a",
): SessionInfo {
  return {
    id,
    projectId,
    title: id,
    createdAt: 1,
    updatedAt,
    activity: { status },
  };
}
const ids = (sessions: SessionInfo[]) => sessions.map((s) => s.id);

test("activity is running or waiting, not unread or a settled outcome", () => {
  for (const status of [
    "idle",
    "running",
    "waiting",
    "finished",
    "failed",
    "stopped",
  ] as const)
    assert.equal(
      isActiveConversation(chat(status, 1, status)),
      ["running", "waiting"].includes(status),
    );
  assert.equal(
    isActiveConversation({ ...chat("legacy", 1), activity: undefined }),
    false,
  );
});

test("ordering is active-first, recency within groups, deterministic and deduplicated", () => {
  const input = [
    chat("new", 100),
    chat("run", 2, "running"),
    chat("wait", 4, "waiting"),
    chat("old", 1),
    chat("new", 100),
  ];
  const before = JSON.stringify(input);
  assert.deepEqual(ids(orderConversations(input)), [
    "wait",
    "run",
    "new",
    "old",
  ]);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(ids(orderConversations([chat("b", 1), chat("a", 1)])), [
    "a",
    "b",
  ]);
});

test("normal caps, expanded lists, and an old selected chat", () => {
  const ordered = orderConversations(
    Array.from({ length: 20 }, (_, i) => chat(String(i), 20 - i)),
  );
  assert.deepEqual(ids(visibleConversations(ordered, 5, false, "19")), [
    "0",
    "1",
    "2",
    "3",
    "19",
  ]);
  assert.equal(visibleConversations(ordered, 10, false).length, 10);
  assert.equal(visibleConversations(ordered, 5, true).length, 20);
  assert.deepEqual(visibleConversations([], 5, false), []);
});

test("soft caps include every active chat without duplicating recent entries", () => {
  for (const limit of [5, 10]) {
    const active = Array.from({ length: limit + 3 }, (_, i) =>
      chat(`active-${i}`, i, i % 2 ? "waiting" : "running"),
    );
    const ordered = orderConversations([
      ...active,
      chat("new-inactive", 100),
      chat("selected", 0),
    ]);
    const visible = visibleConversations(ordered, limit, false);
    assert.equal(visible.length, active.length);
    assert.ok(visible.every(isActiveConversation));
    assert.equal(new Set(ids(visible)).size, visible.length);
    assert.equal(
      visibleConversations(ordered, limit, false, "selected").length,
      active.length + 1,
    );
  }
});

test("a completed chat rejoins recents and the next recent fills the cap", () => {
  const ordered = orderConversations([
    chat("old-run", 1, "running"),
    ...Array.from({ length: 5 }, (_, i) => chat(`recent-${i}`, 20 - i)),
  ]);
  assert.equal(visibleConversations(ordered, 5, false)[0].id, "old-run");
  const completed = orderConversations(
    ordered.map((s) =>
      s.id === "old-run"
        ? { ...s, activity: { status: "finished" as const } }
        : s,
    ),
  );
  assert.deepEqual(ids(visibleConversations(completed, 5, false)), [
    "recent-0",
    "recent-1",
    "recent-2",
    "recent-3",
    "recent-4",
  ]);
});

test("metadata search spans all workspaces, including chats below both caps", () => {
  const projects: Project[] = [
    { id: "a", name: "Margin", path: "/a" },
    { id: "b", name: "Website", path: "/b" },
  ];
  const ordered = orderConversations([
    chat("Pricing experiment", 1, "idle", "b"),
    chat("Fix exports", 5),
    chat("Pricing experiment", 1, "idle", "b"),
    chat("legacy", 0, "idle", "missing"),
  ]);
  assert.deepEqual(
    ids(searchConversations(ordered, projects, "  WEBSITE   pricing ")),
    ["Pricing experiment"],
  );
  assert.deepEqual(ids(searchConversations(ordered, projects, "margin")), [
    "Fix exports",
  ]);
  assert.deepEqual(searchConversations(ordered, projects, "meeting notes"), []);
  assert.deepEqual(searchConversations(ordered, projects, "   "), ordered);
  assert.deepEqual(ids(searchConversations(ordered, projects, "legacy")), [
    "legacy",
  ]);
});
