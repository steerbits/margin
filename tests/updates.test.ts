import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import express from "express";
import {
  compareVersions,
  highlightedUpdate,
  marginReleaseFeed,
  marginUpdatePrompt,
  parseReleaseManifest,
  releaseNotesUrl,
  updateAvailable,
  validVersion,
  type ReleaseManifest,
  type UpdateStatus,
} from "../shared/updates.ts";
import {
  UpdateChecker,
  installUpdateRoutes,
  runningIdentity,
} from "../server/updates.ts";
const parent = resolve(".margin-data/temporary/update-unit-tests");
mkdirSync(parent, { recursive: true });
function fixture(t: any) {
  const root = mkdtempSync(join(parent, "case-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function manifest(
  version = "0.2.0",
  highlighted = true,
  lastHighlightedVersion: string | null = highlighted ? version : null,
): ReleaseManifest {
  return {
    schemaVersion: 1,
    latest: {
      version,
      commit: "a".repeat(40),
      tag: `v${version}`,
      highlighted,
      security: false,
      publishedAt: "2026-09-18T00:00:00Z",
      tests: { status: "passed" },
    },
    lastHighlightedVersion,
  };
}
const identity = { runningVersion: "0.1.0", runningCommit: null };
function status(
  m: ReleaseManifest,
  runningVersion: string | null = "0.1.0",
): UpdateStatus {
  return { ...identity, runningVersion, manifest: m, checkedAt: 1 };
}

test("stable numeric ordering, notification importance, quiet follow-ups, skipped versions and unknown baselines", () => {
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
  assert.equal(compareVersions("2.0.0", "10.0.0"), -1);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  for (const v of [
    "01.0.0",
    "1.0",
    "v1.0.0",
    "1.0.0-beta",
    "9007199254740992.0.0",
    null,
  ])
    assert.equal(validVersion(v), false);
  assert.throws(() => compareVersions("1.0", "1.0.0"));
  const quiet = status(manifest("0.2.0", false));
  assert.equal(updateAvailable(quiet), true);
  assert.equal(highlightedUpdate(quiet), false);
  const patch = manifest("0.2.1", false, "0.2.0");
  assert.equal(highlightedUpdate(status(patch)), true);
  assert.equal(highlightedUpdate(status(patch, "0.2.0")), false);
  assert.equal(updateAvailable(status(patch, "0.2.0")), true);
  assert.equal(updateAvailable(status(patch, "0.2.1")), false);
  assert.equal(updateAvailable(status(patch, "1.0.0")), false);
  assert.equal(highlightedUpdate(status(patch, null)), false);
});

test("manifest validation rejects unsafe identities and malformed notification/test metadata", () => {
  assert.deepEqual(parseReleaseManifest(manifest()), manifest());
  for (const mutate of [
    (m: any) => (m.schemaVersion = 2),
    (m: any) => (m.latest.commit = "main; echo bad"),
    (m: any) => (m.latest.tag = "main"),
    (m: any) => (m.latest.version = "01.2.0"),
    (m: any) => (m.lastHighlightedVersion = "9.0.0"),
    (m: any) => (m.lastHighlightedVersion = null),
    (m: any) => (m.latest.publishedAt = "tomorrow"),
    (m: any) => (m.latest.tests = { status: "skipped" }),
    (m: any) => (m.latest = null),
  ]) {
    const m = manifest();
    mutate(m);
    assert.throws(() => parseReleaseManifest(m));
  }
  assert.deepEqual(
    parseReleaseManifest({
      schemaVersion: 1,
      latest: null,
      lastHighlightedVersion: null,
    }),
    { schemaVersion: 1, latest: null, lastHighlightedVersion: null },
  );
  const m: any = manifest();
  m.latest.releaseNotesUrl = "https://evil.invalid";
  assert.match(
    releaseNotesUrl(parseReleaseManifest(m).latest!),
    /^https:\/\/github.com\/steerbits\/margin\/blob\/a{40}\/releases\/0\.2\.0\/README.md$/,
  );
});

test("update review pins the official target, asks before mutation, and identifies preservation/restart boundaries", () => {
  const m = manifest();
  const prompt = marginUpdatePrompt(status(m), m.latest!);
  for (const text of [
    "0.1.0",
    "0.2.0",
    "a".repeat(40),
    "Do not modify source",
    "explicitly confirm",
    "ignored/private plugins",
    "exact release commit",
    "not a moving branch",
    "data migrations",
    "running upgrade",
  ])
    assert.ok(prompt.includes(text), text);
});

test("one conditional shared request, manual cooldown, persisted cache, 304, and bounded normal refresh", async (t) => {
  const root = fixture(t);
  let now = 1_800_000_000_000,
    calls = 0;
  const checker = new UpdateChecker({
    dataDir: root,
    identity,
    now: () => now,
    fetch: (async (url, options) => {
      assert.equal(url, marginReleaseFeed);
      assert.equal(options?.redirect, "error");
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      if (calls > 1) {
        assert.equal((options?.headers as any)["If-None-Match"], '"test"');
        return new Response(null, { status: 304 });
      }
      return Response.json(manifest(), { headers: { etag: '"test"' } });
    }) as typeof fetch,
  });
  await Promise.all([checker.check(), checker.check(), checker.check(true)]);
  assert.equal(calls, 1);
  await checker.check(true);
  assert.equal(calls, 1);
  now += 60_001;
  await checker.check();
  assert.equal(calls, 1);
  await checker.check(true);
  assert.equal(calls, 2);
  assert.equal(checker.status().checkedAt, now);
  const next = new UpdateChecker({
    dataDir: root,
    identity,
    now: () => now,
    fetch: (async () => {
      throw new Error("must use cache");
    }) as typeof fetch,
  });
  await next.check();
  assert.deepEqual(next.status().manifest, manifest());
  assert.equal(next.status().error, undefined);
  assert.equal(
    JSON.parse(readFileSync(join(root, "updates/cache.json"), "utf8")).manifest
      .latest.version,
    "0.2.0",
  );
});

test("upstream Retry-After survives restart and manual refresh cannot bypass it", async (t) => {
  const root = fixture(t);
  let now = 1_800_000_000_000,
    calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(null, {
      status: 429,
      headers: { "retry-after": "3600" },
    });
  }) as typeof fetch;
  const checker = new UpdateChecker({
    dataDir: root,
    identity,
    now: () => now,
    fetch: fetcher,
  });
  await checker.check();
  assert.equal(calls, 1);
  now += 600_000;
  await checker.check(true);
  assert.equal(calls, 1);
  const restarted = new UpdateChecker({
    dataDir: root,
    identity,
    now: () => now,
    fetch: fetcher,
  });
  await restarted.check(true);
  assert.equal(calls, 1);
  assert.ok(restarted.status().error);
  now += 3_000_001;
  await restarted.check(true);
  assert.equal(calls, 2);
});

test("offline, malformed, oversized, identity rewrites and rollbacks keep last valid release with error", async (t) => {
  const root = fixture(t);
  let now = 1_800_000_000_000;
  let response: () => Response = () => Response.json(manifest());
  const checker = new UpdateChecker({
    dataDir: root,
    identity,
    now: () => now,
    fetch: (async () => response()) as typeof fetch,
  });
  await checker.check();
  const cases = [
    () => {
      throw new Error("offline/private error");
    },
    () => new Response("not JSON"),
    () => new Response("x".repeat(33000)),
    () => {
      const m = manifest();
      m.latest!.commit = "b".repeat(40);
      return Response.json(m);
    },
    () => Response.json(manifest("0.1.0")),
    () => Response.json(manifest("0.2.1", false)),
    () => new Response(null, { status: 404 }),
  ];
  for (const failure of cases) {
    now += 60_001;
    response = failure;
    await checker.check(true);
    assert.deepEqual(checker.status().manifest, manifest());
    assert.ok(checker.status().error);
    assert.ok(!checker.status().error!.includes("private error"));
  }
  now += 60_001;
  response = () => Response.json(manifest("0.2.1", false, "0.2.0"));
  await checker.check(true);
  assert.equal(checker.status().manifest?.latest?.version, "0.2.1");
  assert.equal(checker.status().error, undefined);
});

test("first-check failure never reports current; malformed cache is ignored; production identity is a startup snapshot", async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "updates"));
  writeFileSync(join(root, "updates/cache.json"), "broken");
  const checker = new UpdateChecker({
    dataDir: root,
    identity,
    fetch: (async () => new Response(null, { status: 404 })) as typeof fetch,
  });
  await checker.check();
  assert.equal(checker.status().manifest, null);
  assert.equal(checker.status().checkedAt, null);
  assert.ok(checker.status().error);
  writeFileSync(join(root, "package.json"), '{"version":"0.1.0"}');
  mkdirSync(join(root, "dist"));
  writeFileSync(
    join(root, "dist/margin-build.json"),
    JSON.stringify({ version: "0.1.0", commit: "a".repeat(40) }),
  );
  const before = runningIdentity(root, true);
  assert.equal(before.runningVersion, "0.1.0");
  writeFileSync(join(root, "package.json"), '{"version":"0.2.0"}');
  assert.equal(before.runningVersion, "0.1.0");
  assert.equal(runningIdentity(root, true).runningVersion, null);
  writeFileSync(join(root, "dist/margin-build.json"), '{"version":"0.2.0"}');
  assert.equal(runningIdentity(root, true).runningVersion, "0.2.0");
});

test("older and newer disposable hosts expose their own running identity without reading live-edited versions", async (t) => {
  const saved = process.env.MARGIN_TEST_MODE;
  process.env.MARGIN_TEST_MODE = "1";
  t.after(() => {
    if (saved === undefined) delete process.env.MARGIN_TEST_MODE;
    else process.env.MARGIN_TEST_MODE = saved;
  });
  for (const version of ["0.1.0", "0.2.0"]) {
    const root = fixture(t);
    writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
    mkdirSync(join(root, "dist"));
    writeFileSync(
      join(root, "dist/margin-build.json"),
      JSON.stringify({ version }),
    );
    const app = express();
    app.use(express.json());
    installUpdateRoutes(app, root, join(root, "data"));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    t.after(() => server.close());
    const address = server.address() as import("node:net").AddressInfo;
    const url = `http://127.0.0.1:${address.port}/api/updates`;
    const initial = await (await fetch(url)).json();
    assert.equal(initial.runningVersion, version);
    writeFileSync(join(root, "package.json"), '{"version":"9.0.0"}');
    assert.equal((await (await fetch(url)).json()).runningVersion, version);
  }
});
