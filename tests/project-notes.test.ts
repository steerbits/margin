import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../plugins/project-notes/server.ts";
import {
  NotesDraft,
  ProjectDrafts,
  isDirty,
} from "../plugins/project-notes/drafts.ts";
import {
  MAX_NOTE_LENGTH,
  type Note,
  type SaveResult,
} from "../plugins/project-notes/model.ts";
import type { PluginContext } from "../server/plugin-api.ts";
import { Store } from "../server/store.ts";
import { loadPlugins } from "../server/plugins.ts";
import { pluginStorage } from "../server/plugin-storage.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "project-notes-unit-"));
  const file = join(directory, "notes.sqlite");
  let store = new Store(file);
  const published = new Map<string, unknown>();
  const context = (
    projectId: string,
    sessionId = "session-a",
  ): PluginContext => ({
    project: { id: projectId, name: projectId, path: directory },
    sessionId,
    storage: {
      get: <T>(key: string) =>
        pluginStorage(store, "project-notes", projectId).get<T>(key),
      set: (key, value) =>
        pluginStorage(store, "project-notes", projectId).set(key, value),
    },
    publish: (state) => {
      published.set(sessionId, structuredClone(state));
    },
    notify: () => {},
    getMessages: () => [],
    createAgent: async () => {
      throw new Error("Notes must not create an agent");
    },
  });
  return {
    context,
    published,
    reopen() {
      store.close();
      store = new Store(file);
    },
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const run = (ctx: PluginContext, action: string, input: unknown = {}) =>
  plugin.action!(action, input, ctx);
const response = (text: string, revision: number, saved?: boolean) => ({
  result: {
    note: { text, revision },
    ...(saved === undefined ? {} : { saved }),
  },
});
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

test("project-notes is discovered by the existing server loader", async () => {
  const plugins = await loadPlugins(join(process.cwd(), "plugins"));
  assert.ok(
    plugins.some((p) => p.id === "project-notes" && p.apiVersion === 1),
  );
  assert.equal(plugin.tools, undefined);
});

test("notes preserve exact text across sessions and storage reopen, isolate projects, and support clearing", async () => {
  const f = fixture();
  try {
    const a = f.context("a"),
      b = f.context("b", "session-b");
    assert.deepEqual(await run(a, "load"), { note: { text: "", revision: 0 } });
    const text = "  # Decisions\n日本語 📝 <script>alert(1)</script>\n\n";
    assert.deepEqual(await run(a, "save", { text, revision: 0 }), {
      saved: true,
      note: { text, revision: 1 },
    });
    assert.deepEqual(await run(b, "load"), { note: { text: "", revision: 0 } });
    await run(b, "save", { text: "Other project", revision: 0 });
    f.reopen();
    assert.deepEqual(await run(f.context("a", "session-c"), "load"), {
      note: { text, revision: 1 },
    });
    assert.deepEqual(f.published.get("session-c"), {
      note: { text, revision: 1 },
    });
    assert.deepEqual(await run(b, "load"), {
      note: { text: "Other project", revision: 1 },
    });
    await run(a, "save", { text: "", revision: 1 });
    f.reopen();
    assert.deepEqual(await run(a, "load"), { note: { text: "", revision: 2 } });
  } finally {
    f.close();
  }
});

test("workspace actions need no agent session and share the existing notes with legacy session actions", async () => {
  const f = fixture();
  try {
    const session = f.context("workspace", "chat-a");
    const workspace = { project: session.project, storage: session.storage };
    assert.deepEqual(
      await plugin.workspaceAction!(
        "save",
        { text: "Before any chat", revision: 0 },
        workspace,
      ),
      {
        saved: true,
        note: { text: "Before any chat", revision: 1 },
      },
    );
    assert.deepEqual(await run(f.context("workspace", "chat-b"), "load"), {
      note: { text: "Before any chat", revision: 1 },
    });
    await run(session, "save", { text: "From another chat", revision: 1 });
    f.reopen();
    const fresh = f.context("workspace");
    assert.deepEqual(
      await plugin.workspaceAction!(
        "load",
        {},
        { project: fresh.project, storage: fresh.storage },
      ),
      {
        note: { text: "From another chat", revision: 2 },
      },
    );
  } finally {
    f.close();
  }
});

test("stale revisions cannot overwrite another session, and session-ready publishes durable state", async () => {
  const f = fixture();
  try {
    const a = f.context("a"),
      other = f.context("a", "other");
    await run(a, "save", { text: "first", revision: 0 });
    const results = (await Promise.all([
      run(a, "save", { text: "winner", revision: 1 }),
      run(other, "save", { text: "stale", revision: 1 }),
    ])) as SaveResult[];
    assert.deepEqual(
      results.map((r) => r.saved),
      [true, false],
    );
    assert.deepEqual(results[1].note, { text: "winner", revision: 2 });
    await plugin.onEvent!(
      { type: "session.ready", projectId: "a", sessionId: "other" },
      other,
    );
    assert.deepEqual(f.published.get("other"), {
      note: { text: "winner", revision: 2 },
    });
  } finally {
    f.close();
  }
});

test("input validation accepts the boundary but rejects malformed, oversized, and cross-project fields without writing", async () => {
  const f = fixture();
  try {
    const ctx = f.context("a");
    const note = { text: "a".repeat(MAX_NOTE_LENGTH), revision: 0 };
    await run(ctx, "save", note);
    for (const input of [
      null,
      {},
      { text: 3, revision: 1 },
      { text: "x" },
      { text: "x", revision: -1 },
      { text: "x", revision: 1.5 },
      { text: "x", revision: Number.MAX_SAFE_INTEGER },
      { text: "x".repeat(MAX_NOTE_LENGTH + 1), revision: 1 },
      { text: "x", revision: 1, projectId: "b" },
    ]) {
      await assert.rejects(async () => run(ctx, "save", input));
    }
    await assert.rejects(async () => run(ctx, "delete"), /Unknown/);
    assert.deepEqual(await run(ctx, "load"), {
      note: { text: note.text, revision: 1 },
    });
    ctx.storage.set("note", { text: 1, revision: 2 });
    await assert.rejects(async () => run(ctx, "load"), /invalid/);
    await assert.rejects(
      async () => run(ctx, "save", { text: "replace", revision: 2 }),
      /invalid/,
    );
    assert.deepEqual(ctx.storage.get("note"), { text: 1, revision: 2 });
  } finally {
    f.close();
  }
});

test("storage failure is not published or reported as a successful save", async () => {
  const f = fixture();
  try {
    const ctx = f.context("a");
    ctx.storage.set = () => {
      throw new Error("disk full");
    };
    await assert.rejects(
      async () => run(ctx, "save", { text: "draft", revision: 0 }),
      /disk full/,
    );
    assert.equal(f.published.size, 0);
    assert.deepEqual(await run(ctx, "load"), {
      note: { text: "", revision: 0 },
    });
  } finally {
    f.close();
  }
});

test("drafts survive panel/session lifetimes, remain project-scoped, and track hidden unsaved changes", async () => {
  const registry = new ProjectDrafts();
  const a = registry.get("a"),
    b = registry.get("b");
  await a.refresh(async () => response("saved", 1));
  await b.refresh(async () => response("other", 1));
  a.edit("unsaved");
  assert.equal(registry.get("a"), a);
  assert.equal(registry.get("a").getSnapshot().text, "unsaved");
  assert.equal(b.getSnapshot().text, "other");
  assert.equal(registry.hasUnsaved(), true);
  await a.save(async () => response("unsaved", 2, true));
  assert.equal(registry.hasUnsaved(), false);
});

test("delayed saves preserve newer edits and block duplicate saves and refresh races", async () => {
  const draft = new NotesDraft();
  await draft.refresh(async () => response("", 0));
  draft.edit("submitted");
  const pending = deferred();
  const saving = draft.save(async (name, input) => {
    assert.equal(name, "save");
    assert.deepEqual(input, { text: "submitted", revision: 0 });
    return pending.promise;
  });
  draft.edit("newer draft");
  const forbidden = async () => {
    assert.fail("must not start a competing operation");
  };
  await draft.save(forbidden);
  await draft.refresh(forbidden);
  pending.resolve(response("submitted", 1, true));
  await saving;
  assert.equal(draft.getSnapshot().text, "newer draft");
  assert.equal(draft.getSnapshot().base?.text, "submitted");
  assert.equal(isDirty(draft.getSnapshot()), true);
});

test("failed loads and saves are visible and retryable without losing the draft; bad responses are rejected", async () => {
  const draft = new NotesDraft();
  await draft.refresh(async () => {
    throw new Error("offline");
  });
  assert.match(draft.getSnapshot().error!, /offline/);
  assert.equal(draft.getSnapshot().base, undefined);
  await draft.refresh(async () => response("saved", 1));
  draft.edit("keep me");
  await draft.save(async () => {
    throw new Error("disk full");
  });
  assert.match(draft.getSnapshot().error!, /disk full/);
  assert.equal(draft.getSnapshot().text, "keep me");
  for (const value of [
    {},
    null,
    { result: { note: { text: 9, revision: 2 } } },
    response("bad", 2),
  ]) {
    await draft.save(async () => value);
    assert.match(draft.getSnapshot().error!, /Invalid/);
    assert.equal(draft.getSnapshot().base?.revision, 1);
  }
  await draft.save(async () => response("keep me", 2, true));
  assert.equal(draft.getSnapshot().error, undefined);
  assert.equal(isDirty(draft.getSnapshot()), false);
});

test("refresh never clobbers dirty edits; conflicts require an explicit keep/replace choice", async () => {
  const draft = new NotesDraft();
  await draft.refresh(async () => response("old", 1));
  draft.edit("my version");
  await draft.refresh(async () => response("old", 1));
  assert.equal(draft.getSnapshot().text, "my version");
  assert.equal(draft.getSnapshot().conflict, undefined);
  await draft.refresh(async () => response("their version", 2));
  assert.equal(draft.getSnapshot().text, "my version");
  assert.equal(draft.getSnapshot().conflict?.text, "their version");
  await draft.save(async () => {
    assert.fail("must resolve the conflict first");
  });
  draft.resolveConflict(true);
  assert.equal(draft.getSnapshot().text, "my version");
  assert.equal(draft.getSnapshot().base?.revision, 2);
  await draft.save(async (_name, input) => {
    assert.deepEqual(input, { text: "my version", revision: 2 });
    return response("changed again", 3, false);
  });
  assert.equal(draft.getSnapshot().conflict?.revision, 3);
  draft.resolveConflict(false);
  assert.equal(draft.getSnapshot().text, "changed again");
  assert.equal(isDirty(draft.getSnapshot()), false);
});

test("a clean mounted editor refreshes to another session's latest saved note", async () => {
  const draft = new NotesDraft();
  await draft.refresh(async () => response("old", 1));
  await draft.refresh(async () => response("latest", 2));
  assert.deepEqual(draft.getSnapshot().base, {
    text: "latest",
    revision: 2,
  } satisfies Note);
  assert.equal(draft.getSnapshot().text, "latest");
});
