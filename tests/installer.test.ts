import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { cloneInstallationSource } = await import(
  pathToFileURL(resolve("scripts/clone-installation-source.mjs")).href
);

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "margin-install-")));
  const source = join(root, "source");
  mkdirSync(source);
  execFileSync("git", ["init", "-q", source]);
  writeFileSync(join(source, "source.txt"), "keep source");
  execFileSync("git", ["-C", source, "add", "source.txt"]);
  execFileSync("git", ["-C", source, "-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture", "-c", "user.email=fixture@local", "-c", "commit.gpgSign=false", "commit", "-qm", "fixture"]);
  execFileSync("git", ["-C", source, "update-ref", "refs/margin/checkpoints/fixture", "HEAD"]);
  return { root, source, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("fresh source copy retains independent Git/checkpoint history and excludes private data and environment files", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.source, ".margin-data"));
    writeFileSync(join(f.source, ".margin-data", "notes.json"), '{"private":"keep"}');
    writeFileSync(join(f.source, ".env"), "FIXTURE_SECRET=private");
    writeFileSync(join(f.source, ".env.example"), "EXAMPLE=value");
    mkdirSync(join(f.source, "workspaces/example"), { recursive: true });
    writeFileSync(join(f.source, "workspaces/example/source.txt"), "tracked example");
    writeFileSync(join(f.source, "workspaces/example/private.txt"), "private workspace file");
    const target = cloneInstallationSource(f.source, join(f.root, "new folder with spaces"));
    assert.equal(readFileSync(join(target, "source.txt"), "utf8"), "keep source");
    assert.equal(existsSync(join(target, ".margin-data")), false);
    assert.equal(existsSync(join(target, ".env")), false);
    assert.equal(existsSync(join(target, ".env.example")), true);
    assert.equal(existsSync(join(target, "workspaces")), false);
    assert.equal(existsSync(join(target, "workspaces/example/private.txt")), false);
    assert.equal(readFileSync(join(f.source, ".margin-data", "notes.json"), "utf8"), '{"private":"keep"}');
    const ref = ["rev-parse", "refs/margin/checkpoints/fixture"];
    assert.equal(execFileSync("git", ["-C", target, ...ref], { encoding: "utf8" }),
      execFileSync("git", ["-C", f.source, ...ref], { encoding: "utf8" }));
    assert.equal(existsSync(join(target, ".git/objects/info/alternates")), false);
  } finally { f.close(); }
});

test("a source repo that still tracks workspace files is refused without changing them", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.source, "workspaces/example"), { recursive: true });
    const file = join(f.source, "workspaces/example/source.txt");
    writeFileSync(file, "preserve this project");
    execFileSync("git", ["-C", f.source, "add", "workspaces/example/source.txt"]);
    const target = join(f.root, "new copy");
    assert.throws(() => cloneInstallationSource(f.source, target), /Workspace files are tracked/);
    assert.equal(existsSync(target), false);
    assert.equal(readFileSync(file, "utf8"), "preserve this project");
  } finally { f.close(); }
});

test("an existing destination or symlink is refused without changing its contents", () => {
  const f = fixture();
  try {
    const target = join(f.root, "existing");
    mkdirSync(target); writeFileSync(join(target, "precious.txt"), "unchanged");
    assert.throws(() => cloneInstallationSource(f.source, target), /already exists/);
    const link = join(f.root, "link");
    symlinkSync(target, link);
    assert.throws(() => cloneInstallationSource(f.source, link), /already exists/);
    assert.equal(readFileSync(join(target, "precious.txt"), "utf8"), "unchanged");
  } finally { f.close(); }
});

test("copying into the source or through a symlink back into it is refused", () => {
  const f = fixture();
  try {
    assert.throws(() => cloneInstallationSource(f.source, join(f.source, "child")), /outside the source/);
    const alias = join(f.root, "alias");
    symlinkSync(f.source, alias);
    assert.throws(() => cloneInstallationSource(f.source, join(alias, "child")), /inside the source/);
    assert.throws(() => cloneInstallationSource(f.source, join(alias, "new parent", "child")), /inside the source/);
    assert.equal(existsSync(join(f.source, "child")), false);
    assert.equal(existsSync(join(f.source, "new parent")), false);
  } finally { f.close(); }
});

test("installer help is available and existing dependencies are never replaced", () => {
  const help = spawnSync("bash", [resolve("install.sh"), "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /never|refuses|untouched/);
  const pkg = readFileSync(resolve("node_modules/tsx/package.json"), "utf8");
  const result = spawnSync("bash", [resolve("install.sh"), "--prepare-only"], {
    encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, process.platform === "darwin" ? /Nothing was replaced/ : /supports native macOS/);
  assert.equal(readFileSync(resolve("node_modules/tsx/package.json"), "utf8"), pkg);
});
