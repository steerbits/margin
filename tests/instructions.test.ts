import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  symlinkSync,
  linkSync,
  statSync,
  realpathSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readInstructions,
  saveInstructions,
  InstructionsError,
} from "../server/instructions.ts";
import { MAX_INSTRUCTION_BYTES } from "../shared/instructions.ts";
import { LeaveGuard, sameInstructionsSurface } from "../src/leave-guard.ts";

function fixture(t: import("node:test").TestContext) {
  const root = mkdtempSync(join(tmpdir(), "margin-instructions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test("missing, Unicode/BOM/CRLF, empty, and global permissions round-trip without autosave", (t) => {
  const dir = fixture(t);
  const path = join(dir, "AGENTS.md");
  const initial = readInstructions(dir);
  assert.equal(initial.exists, false);
  assert.equal(existsSync(path), false);
  saveInstructions(dir, { revision: initial.revision, content: "" });
  assert.equal(
    existsSync(path),
    false,
    "unchanged empty editor does not create a file",
  );
  const content = "\uFEFF# 指示 🐈\r\n\r\nUse pnpm.  \r\n";
  const saved = saveInstructions(
    dir,
    { revision: initial.revision, content },
    true,
  );
  assert.equal(saved.content, content);
  assert.equal(readFileSync(path, "utf8"), content);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const empty = saveInstructions(dir, {
    revision: saved.revision,
    content: "",
  });
  assert.equal(empty.content, "");
  assert.equal(empty.exists, true);
  assert.deepEqual(readdirSync(dir), ["AGENTS.md"]);
});
test("stale browser/external revisions cannot overwrite saved content", (t) => {
  const dir = fixture(t);
  const a = readInstructions(dir),
    b = readInstructions(dir);
  const saved = saveInstructions(dir, {
    revision: a.revision,
    content: "First writer",
  });
  assert.throws(
    () =>
      saveInstructions(dir, { revision: b.revision, content: "Second writer" }),
    (e) => e instanceof InstructionsError && e.status === 409,
  );
  writeFileSync(saved.path, "External writer");
  assert.throws(
    () =>
      saveInstructions(dir, {
        revision: saved.revision,
        content: "Stale draft",
      }),
    /changed since/,
  );
  assert.equal(readFileSync(saved.path, "utf8"), "External writer");
  assert.deepEqual(readdirSync(dir), ["AGENTS.md"]);
});
test("alternate context filenames are visible and never silently replaced", (t) => {
  for (const name of [
    "AGENTS.override.md",
    "CLAUDE.md",
    "CLAUDE.MD",
    "AGENTS.MD",
  ]) {
    const dir = join(fixture(t), name.replaceAll(".", "-"));
    mkdirSync(dir);
    writeFileSync(join(dir, name), "Keep this existing instruction");
    const view = readInstructions(dir);
    assert.equal(view.effectivePath, join(realpathSync(dir), name));
    assert.ok(view.blockedReason);
    assert.throws(
      () =>
        saveInstructions(dir, {
          content: "Don't replace",
          revision: view.revision,
        }),
      /Pi uses/,
    );
    assert.equal(
      readFileSync(join(dir, name), "utf8"),
      "Keep this existing instruction",
    );
    assert.deepEqual(readdirSync(dir), [name]);
  }
});
test("a newly introduced override, symlink, hardlink or non-file blocks saving", (t) => {
  const dir = fixture(t);
  const first = readInstructions(dir);
  writeFileSync(join(dir, "AGENTS.override.md"), "Override");
  assert.throws(
    () => saveInstructions(dir, { content: "draft", revision: first.revision }),
    /ignored/,
  );
  rmSync(join(dir, "AGENTS.override.md"));
  const other = join(dir, "other.md");
  writeFileSync(other, "Keep");
  symlinkSync(other, join(dir, "AGENTS.md"));
  assert.match(readInstructions(dir).blockedReason!, /link/);
  assert.throws(
    () => saveInstructions(dir, { content: "draft", revision: first.revision }),
    /link/,
  );
  rmSync(join(dir, "AGENTS.md"));
  linkSync(other, join(dir, "AGENTS.md"));
  assert.match(readInstructions(dir).blockedReason!, /link/);
  rmSync(join(dir, "AGENTS.md"));
  mkdirSync(join(dir, "AGENTS.md"));
  assert.match(readInstructions(dir).blockedReason!, /regular file/);
  assert.equal(readFileSync(other, "utf8"), "Keep");
});
test("invalid UTF-8 and oversized drafts are rejected without destructive writes", (t) => {
  const dir = fixture(t);
  const before = readInstructions(dir);
  assert.throws(
    () =>
      saveInstructions(dir, { revision: before.revision, content: "\ud800" }),
    /valid Unicode/,
  );
  assert.throws(
    () =>
      saveInstructions(dir, {
        revision: before.revision,
        content: "猫".repeat(MAX_INSTRUCTION_BYTES),
      }),
    /256 KB/,
  );
  assert.equal(existsSync(before.path), false);
  writeFileSync(before.path, Buffer.from([0xff, 0xfe]));
  assert.throws(() => readInstructions(dir));
  assert.deepEqual(readFileSync(before.path), Buffer.from([0xff, 0xfe]));
});
test("read-only instructions are not replaced through directory write permission", (t) => {
  if (process.getuid?.() === 0)
    return t.skip("root bypasses permission checks");
  const dir = fixture(t),
    path = join(dir, "AGENTS.md");
  writeFileSync(path, "Read only instructions");
  chmodSync(path, 0o444);
  const view = readInstructions(dir);
  assert.match(view.blockedReason!, /read-only/);
  assert.throws(
    () =>
      saveInstructions(dir, { content: "overwrite", revision: view.revision }),
    /read-only/,
  );
  assert.equal(readFileSync(path, "utf8"), "Read only instructions");
});
test("only panel changes within the same instruction surface bypass the guard", () => {
  const home = { kind: "workspace" as const, projectId: "A" };
  assert.equal(
    sameInstructionsSurface(home, { ...home, panel: "notes:editor" }),
    true,
  );
  assert.equal(
    sameInstructionsSurface(home, { ...home, projectId: "B" }),
    false,
  );
  assert.equal(sameInstructionsSurface(home, { ...home, view: "new" }), false);
  assert.equal(
    sameInstructionsSurface(home, { kind: "customize", tab: "instructions" }),
    false,
  );
  assert.equal(
    sameInstructionsSurface(
      { kind: "customize", tab: "instructions" },
      { kind: "customize", tab: "examples" },
    ),
    false,
  );
});
test("leave guard delegates only to the mounted owner and releases cleanly", async () => {
  const guard = new LeaveGuard(),
    first = Symbol(),
    second = Symbol();
  assert.equal(await guard.confirmLeave(), true);
  const dispose = guard.register(first, async () => false);
  assert.equal(guard.blocking, true);
  assert.equal(await guard.confirmLeave(), false);
  guard.register(second, async () => true);
  dispose();
  assert.equal(
    guard.blocking,
    true,
    "stale unmount cannot remove the current owner",
  );
  assert.equal(await guard.confirmLeave(), true);
  guard.release(second);
  assert.equal(guard.blocking, false);
});
