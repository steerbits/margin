import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  prepareRelease,
  finalizeRelease,
  validateReleaseNotes,
} from "../scripts/release.ts";
import {
  releaseSuites,
  releaseTestEnvironment,
} from "../scripts/release-suites.ts";
const parent = resolve(".margin-data/temporary/release-unit-tests");
mkdirSync(parent, { recursive: true });
function git(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
function fixture(t: any) {
  const root = mkdtempSync(join(parent, "case-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Release test");
  git(root, "config", "user.email", "test@invalid");
  writeFileSync(join(root, ".gitignore"), ".margin-data/\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.1.0" }),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      version: "0.1.0",
      packages: { "": { version: "0.1.0" } },
    }),
  );
  writeFileSync(join(root, "source.txt"), "Application behavior\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Initial");
  return root;
}
function notes(root: string, version: string) {
  const folder = join(root, "releases", version);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "README.md"),
    `# Margin ${version}\n\nThis release improves the update workflow. Rebuild and restart to activate it.\n`,
  );
  git(root, "add", ".");
  git(root, "commit", "-qm", "Reviewed release notes");
}

test("release preparation, reviewed notes, local pin/tag and independent highlighted carry-forward", (t) => {
  const root = fixture(t);
  const source = git(root, "rev-parse", "HEAD");
  const prompt = prepareRelease(root, "0.2.0");
  assert.ok(prompt.includes(source));
  assert.ok(prompt.includes("no previous release"));
  notes(root, "0.2.0");
  let tested = false;
  const first = finalizeRelease(root, "0.2.0", {
    highlighted: true,
    runTests: () => {
      tested = true;
      assert.equal(
        JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
        "0.2.0",
      );
    },
  });
  assert.ok(tested);
  assert.equal(first.latest?.tests.status, "passed");
  assert.equal(first.lastHighlightedVersion, "0.2.0");
  assert.equal(git(root, "rev-parse", "v0.2.0^{commit}"), first.latest?.commit);
  assert.notEqual(git(root, "rev-parse", "HEAD"), first.latest?.commit);
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.equal(
    JSON.parse(git(root, "show", `${first.latest!.commit}:package.json`))
      .version,
    "0.2.0",
  );
  assert.ok(prepareRelease(root, "0.2.1").includes(first.latest!.commit));
  notes(root, "0.2.1");
  const patch = finalizeRelease(root, "0.2.1", {
    highlighted: false,
    skipTestsReason: "Disposable skip fixture",
  });
  assert.equal(patch.latest?.highlighted, false);
  assert.equal(patch.lastHighlightedVersion, "0.2.0");
  assert.equal(patch.latest?.tests.status, "skipped");
  assert.equal(patch.latest?.tests.reason, "Disposable skip fixture");
  assert.equal(git(root, "remote"), ""); // No publishing was possible or attempted.
});

test("dirty checkout, wrong branch, version errors, changed code and stale preparation are rejected", (t) => {
  const root = fixture(t);
  for (const version of ["0.1.0", "0.0.1", "1.0.0-beta", "../escape"])
    assert.throws(() => prepareRelease(root, version));
  writeFileSync(join(root, "source.txt"), "Uncommitted change");
  assert.throws(() => prepareRelease(root, "0.2.0"), /working changes/);
  git(root, "add", ".");
  git(root, "commit", "-qm", "Code change");
  git(root, "switch", "-qc", "other");
  assert.throws(() => prepareRelease(root, "0.2.0"), /main/);
  git(root, "switch", "-q", "main");
  prepareRelease(root, "0.2.0");
  notes(root, "0.2.0");
  writeFileSync(join(root, "source.txt"), "More code changed");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Late code change");
  assert.throws(
    () =>
      finalizeRelease(root, "0.2.0", {
        highlighted: false,
        skipTestsReason: "test",
      }),
    /stale/,
  );
  assert.equal(git(root, "tag", "--list"), "");
});

test("failed checks and files modified by a check cannot create release tags or advertise success", (t) => {
  for (const mutate of [false, true]) {
    const root = fixture(t);
    prepareRelease(root, "0.2.0");
    notes(root, "0.2.0");
    assert.throws(
      () =>
        finalizeRelease(root, "0.2.0", {
          highlighted: true,
          runTests: () => {
            if (mutate)
              writeFileSync(
                join(root, "source.txt"),
                "unexpected test mutation",
              );
            else throw new Error("Deliberate test failure");
          },
        }),
      mutate ? /changed during testing/ : /Deliberate test failure/,
    );
    assert.equal(git(root, "tag", "--list"), "");
    assert.match(git(root, "status", "--porcelain"), /package.json/);
  }
});

test("release note validation rejects placeholders, missing or escaped images and accepts bundled images", (t) => {
  const root = fixture(t);
  prepareRelease(root, "0.2.0");
  assert.throws(() => validateReleaseNotes(root, "0.2.0"));
  notes(root, "0.2.0");
  const path = join(root, "releases/0.2.0/README.md"),
    original = readFileSync(path, "utf8");
  for (const tail of [
    "TODO",
    "![Screenshot](missing.png)",
    '<img src="https://other.invalid/private.png">',
    '<img src = "https://other.invalid/private.png">',
    "<img src=unquoted.png>",
    "![Screenshot][absent]",
    "![Missing shortcut reference]",
  ]) {
    writeFileSync(path, original + tail);
    assert.throws(() => validateReleaseNotes(root, "0.2.0"));
  }
  writeFileSync(join(root, "outside.png"), "fixture image");
  symlinkSync(
    join(root, "outside.png"),
    join(root, "releases/0.2.0/escaped.png"),
  );
  writeFileSync(path, original + "![Screenshot](escaped.png)");
  assert.throws(() => validateReleaseNotes(root, "0.2.0"));
  writeFileSync(join(root, "releases/0.2.0/screenshot.png"), "fixture image");
  writeFileSync(path, original + "![Screenshot](screenshot.png)");
  assert.throws(() => validateReleaseNotes(root, "0.2.0")); // Existing but untracked is not publishable.
  git(root, "add", "releases/0.2.0/screenshot.png");
  assert.ok(validateReleaseNotes(root, "0.2.0"));
  writeFileSync(
    path,
    original + "![Screenshot]\n\n[Screenshot]: screenshot.png\n",
  );
  assert.ok(validateReleaseNotes(root, "0.2.0"));
});

test("release directories cannot redirect writes; test-time mode changes and commit-hook changes cannot receive a release tag", (t) => {
  for (const name of ["releases", "package.json", "package-lock.json"]) {
    const root = fixture(t);
    mkdirSync(join(root, ".margin-data/private"), { recursive: true });
    rmSync(join(root, name), { force: true });
    symlinkSync(join(root, ".margin-data/private"), join(root, name));
    git(root, "add", name);
    git(root, "commit", "-qm", "Link fixture");
    assert.throws(() => prepareRelease(root, "0.2.0"), /symbolic links/);
  }
  for (const hook of [false, true]) {
    const candidate = fixture(t);
    prepareRelease(candidate, "0.2.0");
    notes(candidate, "0.2.0");
    if (hook) {
      const path = join(candidate, ".git/hooks/pre-commit");
      writeFileSync(
        path,
        '#!/bin/sh\necho "hook change" >> source.txt\ngit add source.txt\n',
      );
      chmodSync(path, 0o755);
    }
    assert.throws(
      () =>
        finalizeRelease(candidate, "0.2.0", {
          highlighted: false,
          runTests: () => {
            if (!hook) chmodSync(join(candidate, "source.txt"), 0o755);
          },
        }),
      hook ? /commit hook changed/ : /changed during testing/,
    );
    assert.equal(git(candidate, "tag", "--list"), "");
  }
});

test("release test environments do not inherit provider secrets, runtime identity or Node preload hooks", () => {
  assert.deepEqual(
    releaseTestEnvironment({
      PATH: "/fixture/bin",
      HOME: "/fixture/home",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "fixture-secret",
      AWS_PROFILE: "production",
      GITHUB_TOKEN: "fixture-secret",
      MARGIN_WORKER_TOKEN: "fixture-token",
      PI_CODING_AGENT_DIR: "/live/pi",
      PORT: "4317",
      NODE_OPTIONS: "--import private-loader.mjs",
    }),
    { PATH: "/fixture/bin", HOME: "/fixture/home", LANG: "en_US.UTF-8" },
  );
});

test("release registry includes every browser configuration plus unit and build checks", () => {
  const configs = readdirSync(resolve("tests")).filter((f) =>
    f.endsWith(".playwright.config.ts"),
  );
  for (const config of configs)
    assert.ok(
      releaseSuites.some((s) => s.args.includes(`tests/${config}`)),
      config,
    );
  assert.ok(releaseSuites.some((s) => s.args.join(" ") === "test"));
  assert.ok(releaseSuites.some((s) => s.args.join(" ") === "run build"));
});
