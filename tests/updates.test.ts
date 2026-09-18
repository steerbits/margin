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
  marginReleaseFeedFallback,
  marginUpdatePrompt,
  parseReleaseManifest,
  releaseNotesUrl,
  updateAvailable,
  updateSummary,
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

test("compact version summaries distinguish available, latest, ahead, unknown and failed checks", () => {
  assert.equal(updateSummary(null), "Checking version…");
  assert.equal(updateSummary(status(manifest())), "v0.1.0 → v0.2.0 available");
  assert.equal(
    updateSummary(status(manifest(), "0.2.0")),
    "v0.2.0 · already latest",
  );
  assert.equal(
    updateSummary(status(manifest(), "0.3.0")),
    "v0.3.0 · ahead of published",
  );
  assert.equal(
    updateSummary(status(manifest(), null)),
    "Version not identified · latest v0.2.0",
  );
  assert.equal(
    updateSummary({ ...status(manifest(), null), error: "Offline" }),
    "Version not identified · latest v0.2.0 (cached)",
  );
  assert.equal(
    updateSummary({ ...status(manifest(), null), manifest: null }),
    "Version not identified · latest unknown",
  );
  assert.equal(
    updateSummary({
      ...status(manifest(), null),
      manifest: null,
      error: "Offline",
    }),
    "Version not identified · check unavailable",
  );
  assert.equal(
    updateSummary({ ...status(manifest()), manifest: null }),
    "v0.1.0 · latest unknown",
  );
  assert.equal(
    updateSummary({ ...status(manifest(), "0.2.0"), checkedAt: null }),
    "v0.2.0 · latest unknown",
  );
  assert.equal(
    updateSummary(
      status({ schemaVersion: 1, latest: null, lastHighlightedVersion: null }),
    ),
    "v0.1.0 · no published release",
  );
  assert.equal(
    updateSummary({ ...status(manifest()), error: "Offline" }),
    "v0.1.0 → v0.2.0 available (cached)",
  );
  assert.equal(
    updateSummary({ ...status(manifest(), "0.2.0"), error: "Offline" }),
    "v0.2.0 · check unavailable",
  );
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

test("a raw TLS timeout falls back once to the official API with a fresh timeout and shared result", async (t) => {
  const calls: string[] = [];
  let primarySignal: AbortSignal | null | undefined;
  const checker = new UpdateChecker({
    dataDir: fixture(t),
    identity,
    fetch: (async (url, options) => {
      calls.push(String(url));
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal);
      if (url === marginReleaseFeed) {
        primarySignal = options.signal;
        assert.equal(
          new Headers(options.headers).get("Accept"),
          "application/json",
        );
        throw new DOMException("SSL connection timeout", "TimeoutError");
      }
      assert.equal(url, marginReleaseFeedFallback);
      assert.notEqual(options.signal, primarySignal);
      assert.equal(options.signal.aborted, false);
      assert.deepEqual(options.headers, {
        Accept: "application/vnd.github.raw+json",
      });
      return Response.json(manifest());
    }) as typeof fetch,
  });
  await Promise.all([checker.check(), checker.check(true), checker.check()]);
  assert.deepEqual(calls, [marginReleaseFeed, marginReleaseFeedFallback]);
  assert.deepEqual(checker.status().manifest, manifest());
  assert.ok(checker.status().checkedAt);
  assert.equal(checker.status().error, undefined);
});

test("fallback ETags stay scoped to their endpoint across legacy caches, restart and raw recovery", async (t) => {
  const root = fixture(t);
  let now = 1_800_000_000_000;
  let stage = "raw";
  const calls: string[] = [];
  const fetcher = (async (url, options) => {
    calls.push(String(url));
    const etag = new Headers(options?.headers).get("If-None-Match");
    if (url === marginReleaseFeed) {
      assert.equal(
        etag,
        stage === "fallback" || stage === "raw-304" ? '"raw"' : null,
      );
      if (stage === "fallback" || stage === "api-304")
        throw new TypeError("fetch failed");
      return stage === "raw-304"
        ? new Response(null, { status: 304 })
        : Response.json(manifest(), { headers: { etag: '"raw"' } });
    }
    assert.equal(url, marginReleaseFeedFallback);
    assert.equal(etag, stage === "api-304" ? '"api"' : null);
    return stage === "api-304"
      ? new Response(null, { status: 304 })
      : Response.json(manifest(), { headers: { etag: '"api"' } });
  }) as typeof fetch;
  const create = () =>
    new UpdateChecker({
      dataDir: root,
      identity,
      now: () => now,
      fetch: fetcher,
    });
  await create().check();
  const file = join(root, "updates/cache.json");
  const legacy = JSON.parse(readFileSync(file, "utf8"));
  delete legacy.etagSource;
  writeFileSync(file, JSON.stringify(legacy));
  for (const nextStage of ["fallback", "api-304", "raw-recovered", "raw-304"]) {
    stage = nextStage;
    now += 60_001;
    const checker = create();
    await checker.check(true);
    assert.equal(checker.status().error, undefined);
    assert.equal(checker.status().checkedAt, now);
    assert.deepEqual(checker.status().manifest, manifest());
  }
  assert.deepEqual(calls, [
    marginReleaseFeed,
    marginReleaseFeed,
    marginReleaseFeedFallback,
    marginReleaseFeed,
    marginReleaseFeedFallback,
    marginReleaseFeed,
    marginReleaseFeed,
  ]);
});

test("HTTP failures and invalid primary feeds do not trigger the connection fallback", async (t) => {
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(null, { status: 429 }),
    new Response(null, { status: 503 }),
    new Response("invalid JSON"),
    new Response("x".repeat(33000)),
  ]) {
    const calls: string[] = [];
    const checker = new UpdateChecker({
      dataDir: fixture(t),
      identity,
      fetch: (async (url) => {
        calls.push(String(url));
        return response;
      }) as typeof fetch,
    });
    await checker.check();
    assert.deepEqual(calls, [marginReleaseFeed]);
    assert.equal(checker.status().manifest, null);
    assert.equal(checker.status().checkedAt, null);
    assert.ok(checker.status().error);
  }
});

test("fallback failures, invalid bodies and release rollbacks preserve the last valid cache", async (t) => {
  let now = 1_800_000_000_000;
  const checkedAt = now;
  let fallback: (() => Response) | undefined;
  let calls = 0;
  const checker = new UpdateChecker({
    dataDir: fixture(t),
    identity,
    now: () => now,
    fetch: (async (url) => {
      calls++;
      if (!fallback)
        return Response.json(manifest(), { headers: { etag: '"raw"' } });
      if (url === marginReleaseFeed) throw new TypeError("raw offline");
      return fallback();
    }) as typeof fetch,
  });
  await checker.check();
  for (const failure of [
    () => {
      throw new TypeError("API offline/private error");
    },
    () => new Response("invalid JSON"),
    () => new Response("x".repeat(33000)),
    () => new Response("{}", { headers: { "content-length": "33000" } }),
    () => Response.json({ schemaVersion: 2 }),
    () => Response.json(manifest("0.1.0")),
    () => {
      const changed = manifest();
      changed.latest!.commit = "b".repeat(40);
      return Response.json(changed);
    },
    () => Response.json(manifest("0.2.1", false)),
    // A raw-feed ETag cannot validate an API 304.
    () => new Response(null, { status: 304 }),
  ]) {
    fallback = failure;
    now += 60_001;
    calls = 0;
    await checker.check(true);
    assert.equal(calls, 2);
    assert.deepEqual(checker.status().manifest, manifest());
    assert.equal(checker.status().checkedAt, checkedAt);
    assert.ok(checker.status().error);
    assert.ok(!checker.status().error!.includes("private error"));
    await checker.check(true);
    assert.equal(
      calls,
      2,
      "manual cooldown still applies after fallback failure",
    );
  }
  fallback = () => Response.json(manifest("0.2.1", false, "0.2.0"));
  now += 60_001;
  await checker.check(true);
  assert.equal(checker.status().manifest?.latest?.version, "0.2.1");
  assert.equal(checker.status().error, undefined);
});

test("upstream Retry-After from either endpoint survives restart and manual refresh cannot bypass it", async (t) => {
  for (const useFallback of [false, true]) {
    const root = fixture(t);
    let now = 1_800_000_000_000,
      calls = 0;
    const fetcher = (async (url) => {
      if (useFallback && url === marginReleaseFeed)
        throw new TypeError("raw offline");
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
  }
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
  const stale = runningIdentity(root, true);
  assert.equal(stale.runningVersion, "0.1.0");
  assert.equal(stale.runningCommit, "a".repeat(40));
  assert.match(
    stale.identityWarning!,
    /Source is v0\.2\.0; the built app is v0\.1\.0/,
  );
  writeFileSync(join(root, "dist/margin-build.json"), '{"version":"0.2.0"}');
  assert.equal(runningIdentity(root, true).runningVersion, "0.2.0");
});

test("stale or missing builds do not prevent manual discovery or release review", async (t) => {
  for (const buildVersion of ["0.1.0", null]) {
    const root = fixture(t);
    writeFileSync(join(root, "package.json"), '{"version":"0.2.0"}');
    if (buildVersion) {
      mkdirSync(join(root, "dist"));
      writeFileSync(
        join(root, "dist/margin-build.json"),
        JSON.stringify({ version: buildVersion }),
      );
    }
    const capturedIdentity = runningIdentity(root, true);
    let calls = 0;
    const checker = new UpdateChecker({
      dataDir: join(root, "data"),
      identity: capturedIdentity,
      fetch: (async () => {
        calls++;
        return Response.json(manifest());
      }) as typeof fetch,
    });
    await checker.check(true);
    const result = checker.status();
    assert.equal(calls, 1);
    assert.equal(result.runningVersion, buildVersion);
    assert.deepEqual(result.manifest, manifest());
    assert.ok(result.checkedAt);
    assert.equal(result.error, undefined);
    assert.ok(result.identityWarning);
    assert.match(updateSummary(result), /v0\.2\.0/);
    assert.match(
      marginUpdatePrompt(result, result.manifest!.latest!),
      /to 0\.2\.0/,
    );
    assert.equal(updateAvailable(result), buildVersion !== null);
  }
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
