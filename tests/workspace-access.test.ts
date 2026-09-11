import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceAccess } from "../server/workspace-access.ts";

function fixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "margin-folder-access-")),
  );
  const project = join(root, "project");
  const outside = join(root, "project-outside");
  const extra = join(root, "extra");
  const data = join(root, "data");
  const pi = join(root, "pi");
  for (const path of [
    project,
    outside,
    extra,
    data,
    pi,
    join(project, "child"),
    join(project, ".hidden"),
  ])
    mkdirSync(path);
  return {
    root,
    project,
    outside,
    extra,
    data,
    pi,
    access: new WorkspaceAccess(
      {
        mode: "cco",
        projectRoot: project,
        writablePaths: [project, extra, data, pi],
      },
      project,
      data,
      pi,
    ),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
test("folder picker stays within cco grants, handles aliases, and leaves read access unchanged", async () => {
  const f = fixture();
  try {
    symlinkSync(f.outside, join(f.project, "escape"));
    symlinkSync(join(f.project, "child"), join(f.project, "alias"));
    const result = await f.access.browse();
    assert.deepEqual(
      result.folders.map((p) => p.name),
      ["alias", "child"],
    );
    assert.equal(result.parent, null);
    assert.deepEqual(
      result.roots.map((p) => p.path),
      [f.project, f.extra],
    );
    assert.equal(
      (await f.access.browse(join(f.project, "alias"))).current.path,
      join(f.project, "child"),
    );
    assert.equal(
      (await f.access.browse(join(f.project, "child"))).parent,
      f.project,
    );
    await assert.rejects(f.access.browse(f.outside), /not writable/);
    assert.throws(
      () => f.access.requireDirectory(join(f.project, "escape")),
      /not writable/,
    );
    assert.throws(
      () => f.access.requireDirectory(join(f.project, "..", "project-outside")),
      /not writable/,
    );
    assert.equal(f.access.canOpen(f.extra), true);
    // The UI restriction does not change OS permissions or hide files from Pi read tools.
    assert.equal(existsSync(f.outside), true);
    assert.equal(
      (await f.access.browse(undefined, true)).folders.some(
        (p) => p.name === ".hidden",
      ),
      true,
    );
    const locked = join(f.project, "locked");
    mkdirSync(locked, { mode: 0o500 });
    if (process.getuid?.() !== 0) assert.equal(f.access.canOpen(locked), false);
    chmodSync(locked, 0o700);
  } finally {
    f.dispose();
  }
});
test("name-only creation uses the launch project and never reuses an existing folder", async () => {
  const f = fixture();
  try {
    const workspace = await f.access.create("My new idea");
    assert.equal(workspace.path, join(f.project, "workspaces", "My new idea"));
    await assert.rejects(f.access.create("My new idea"));
    await assert.rejects(f.access.create("../outside"));
    assert.equal(existsSync(join(f.project, "outside")), false);
  } finally {
    f.dispose();
  }
});
test("creation cannot follow a workspace-parent symlink outside the write grants", async () => {
  const f = fixture();
  try {
    symlinkSync(f.outside, join(f.project, "workspaces"));
    await assert.rejects(f.access.create("Escape"), /not writable/);
    assert.equal(existsSync(join(f.outside, "Escape")), false);
  } finally {
    f.dispose();
  }
});
test("native launch can open writable folders outside the source tree", async () => {
  const f = fixture();
  try {
    const native = new WorkspaceAccess(
      { mode: "native" },
      f.project,
      f.data,
      f.pi,
    );
    assert.equal(native.requireDirectory(f.outside), f.outside);
    assert.equal((await native.browse()).parent, f.root);
  } finally {
    f.dispose();
  }
});
