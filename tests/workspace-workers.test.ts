import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.ts";
import {
  prepareWorkspaceData,
  workspaceDataDir,
} from "../server/workspace-data.ts";
import { workspaceWorkerPlan } from "../server/workspace-workers.ts";
import { launcherAuth } from "../server/launcher-auth.ts";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "margin-worker-unit-")));
  const app = join(root, "app"),
    data = join(app, "data"),
    project = {
      id: randomUUID(),
      name: "Project",
      path: join(root, "project"),
    };
  mkdirSync(data, { recursive: true });
  mkdirSync(project.path);
  const store = new Store(join(data, "margin.sqlite"));
  store.put("project", project.id, project);
  return {
    root,
    app,
    data,
    project,
    store,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("workspace migration preserves notes, session IDs, drafts, batches and native files; originals remain intact", () => {
  const f = fixture();
  try {
    const id = randomUUID(),
      original = join(f.data, "old-session.jsonl");
    writeFileSync(original, "native session contents");
    f.store.put("session", id, {
      id,
      projectId: f.project.id,
      sessionFile: original,
    });
    f.store.put("composer", id, "draft");
    f.store.put("comments", id, [{ text: "comment" }]);
    f.store.put(`plugin:project-notes:${f.project.id}`, "note", {
      text: "saved",
      revision: 3,
    });
    f.store.markBatch(id, "batch", "accepted");
    const directory = prepareWorkspaceData(f.data, f.app, f.project);
    assert.notEqual(directory, f.data);
    const migrated = new Store(join(directory, "margin.sqlite"));
    try {
      const info = migrated.get<{ sessionFile: string }>("session", id)!;
      assert.equal(
        readFileSync(info.sessionFile, "utf8"),
        "native session contents",
      );
      assert.equal(migrated.get("composer", id), "draft");
      assert.equal(migrated.batch(id, "batch")?.status, "accepted");
      assert.deepEqual(
        migrated.get(`plugin:project-notes:${f.project.id}`, "note"),
        { text: "saved", revision: 3 },
      );
      migrated.put(`plugin:project-notes:${f.project.id}`, "note", {
        text: "newer",
        revision: 4,
      });
      migrated.db.prepare("DELETE FROM records WHERE kind='migration'").run();
    } finally {
      migrated.close();
    }
    prepareWorkspaceData(f.data, f.app, f.project);
    const reloaded = new Store(join(directory, "margin.sqlite"));
    assert.deepEqual(
      reloaded.get(`plugin:project-notes:${f.project.id}`, "note"),
      { text: "newer", revision: 4 },
    );
    reloaded.close();
    assert.equal(readFileSync(original, "utf8"), "native session contents");
    assert.deepEqual(
      f.store.get(`plugin:project-notes:${f.project.id}`, "note"),
      { text: "saved", revision: 3 },
    );
  } finally {
    f.close();
  }
});
test("a worker cannot trick migration into replacing newer data or following a symlink", () => {
  const f = fixture();
  try {
    const directory = prepareWorkspaceData(f.data, f.app, f.project);
    const db = join(directory, "margin.sqlite"),
      sentinel = join(f.root, "protected");
    writeFileSync(sentinel, "unchanged");
    rmSync(db);
    symlinkSync(sentinel, db);
    assert.throws(
      () => prepareWorkspaceData(f.data, f.app, f.project),
      /symbolic link/,
    );
    assert.equal(readFileSync(sentinel, "utf8"), "unchanged");
    rmSync(db);
    assert.throws(() => prepareWorkspaceData(f.data, f.app, f.project));
    assert.equal(existsSync(db), false);
  } finally {
    f.close();
  }
});
test("worker launch uses a fresh neutral cwd, ordinary cco grants, pinned runtime fields and Git worktree metadata", () => {
  const f = fixture();
  try {
    const git = join(f.root, "repo.git"),
      worktree = join(git, "worktrees", "topic");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(join(git, "objects"));
    mkdirSync(join(git, "refs"));
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/main");
    writeFileSync(join(worktree, "HEAD"), "ref: refs/heads/topic");
    writeFileSync(join(worktree, "commondir"), "../..");
    writeFileSync(join(f.project.path, ".git"), `gitdir: ${worktree}\n`);
    const launch = join(f.data, "launcher-runs", "fresh");
    const plan = workspaceWorkerPlan(
      f.app,
      workspaceDataDir(f.data, f.app, f.project),
      join(f.root, "pi"),
      f.project.path,
      launch,
      "worker-token",
      f.project.id,
      "Project",
    );
    assert.equal(plan.cwd, launch);
    assert.ok(plan.args.includes(`--add-dir=${f.project.path}`));
    assert.ok(plan.args.includes(`--add-dir=${git}`));
    assert.ok(plan.args.includes(`--allow-readonly=${f.app}`));
    assert.equal(
      plan.args[plan.args.indexOf("--command") + 1],
      process.execPath,
    );
    assert.equal(plan.env.BASH_ENV, "");
    assert.equal(plan.env.NODE_OPTIONS, "");
    assert.equal(
      JSON.parse(plan.env.MARGIN_CCO_INFO).projectRoot,
      f.project.path,
    );
    assert.ok(!plan.args.includes("--safe"));
    writeFileSync(join(f.project.path, ".git"), `gitdir: ${f.data}\n`);
    const invalid = workspaceWorkerPlan(
      f.app,
      workspaceDataDir(f.data, f.app, f.project),
      join(f.root, "pi"),
      f.project.path,
      launch,
      "worker-token",
      f.project.id,
      "Project",
    );
    assert.ok(!invalid.args.includes(`--add-dir=${f.data}`));
  } finally {
    f.close();
  }
});
test("launcher authentication persists hashes only and keeps existing browser access across restarts", () => {
  const f = fixture();
  try {
    const first = launcherAuth(f.data),
      second = launcherAuth(f.data);
    assert.equal(second.accepts(first.token), true);
    assert.equal(second.accepts("unknown"), false);
    const saved = readFileSync(join(f.data, "launcher-auth.json"), "utf8");
    assert.ok(!saved.includes(first.token));
    assert.ok(!saved.includes(second.token));
    assert.equal(second.accepts(JSON.parse(saved)[0]), false);
  } finally {
    f.close();
  }
});
