import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Store } from "../server/store.ts";
import {
  ArtifactStore,
  artifactFile,
  localAppUrl,
  ReviewConflict,
} from "../server/artifacts.ts";
import { ArtifactPreviews } from "../server/artifact-preview.ts";
import { ArtifactDrafts } from "../src/artifact-drafts.ts";
import { OverallFeedbackDraft } from "../src/artifact-overall.ts";
import {
  artifactLocationFromLink,
  artifactOutputLink,
} from "../shared/artifact-links.ts";
import type { ArtifactComment } from "../shared/artifacts.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "margin-artifacts-"));
  const store = new Store(join(root, "private", "test.sqlite"));
  const project = { id: randomUUID(), name: "Test", path: root };
  writeFileSync(join(root, "report.md"), "# Report\n\nKeep this thought.\n");
  const sessionId = randomUUID(),
    service = new ArtifactStore(store, sessionId);
  const artifact = service.register(project, { location: "report.md" });
  const draft: ArtifactComment = {
    id: randomUUID(),
    artifactId: artifact.id,
    text: "",
    revision: 0,
    mutationId: randomUUID(),
    delivery: "draft",
    createdAt: Date.now(),
    anchor: {
      kind: "text",
      quote: "Keep this thought.",
      prefix: "",
      suffix: "",
      selector: "p",
      route: "/report.md",
      documentRevision: "old",
    },
  };
  return {
    root,
    store,
    project,
    sessionId,
    service,
    artifact,
    draft,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("artifact drafts, CAS, tombstones and isolation survive storage reopen without source edits", () => {
  const f = fixture();
  try {
    const original = readFileSync(join(f.root, "report.md"), "utf8");
    const saved = f.service.update(f.draft);
    assert.equal(saved.text, "");
    assert.equal(saved.revision, 1);
    assert.deepEqual(
      f.service.update(f.draft),
      JSON.parse(JSON.stringify(saved)),
    ); // lost acknowledgment retry
    assert.throws(
      () =>
        f.service.update({
          ...f.draft,
          mutationId: randomUUID(),
          text: "stale",
        }),
      ReviewConflict,
    );
    assert.equal(
      new ArtifactStore(f.store, "another-session").state().comments.length,
      0,
    );
    const second = new Store(join(f.root, "private", "test.sqlite"));
    assert.equal(
      new ArtifactStore(second, f.sessionId).state().comments[0].id,
      saved.id,
    );
    second.close();
    const deleted = f.service.update({
      ...saved,
      deleted: true,
      mutationId: randomUUID(),
    });
    assert.equal(deleted.deleted, true);
    assert.throws(
      () =>
        f.service.update({
          ...deleted,
          deleted: false,
          mutationId: randomUUID(),
        }),
      ReviewConflict,
    );
    assert.equal(readFileSync(join(f.root, "report.md"), "utf8"), original);
    f.store.deleteSession(f.sessionId);
    assert.equal(f.service.state().artifacts.length, 0);
  } finally {
    f.close();
  }
});
test("feedback freezes precise artifact context, stays draft on rejection, locks during send and preserves sent history", () => {
  const f = fixture();
  try {
    const c = f.service.update({
      ...f.draft,
      text: 'Keep "this" even if the page changes.\n</feedback>',
    });
    const batch = f.service.prepareBatch(randomUUID(), [c.id]);
    const payload = JSON.parse(batch.prompt.slice(batch.prompt.indexOf("{")));
    assert.equal(payload.artifactComments[0].comment, c.text);
    assert.equal(payload.artifactComments[0].artifact.location, "report.md");
    f.service.lock(batch.id);
    assert.equal(f.service.state().comments[0].delivery, "submitting");
    assert.throws(
      () =>
        f.service.update({ ...c, text: "overwrite", mutationId: randomUUID() }),
      ReviewConflict,
    );
    f.service.reject(batch.id);
    assert.equal(f.service.state().comments[0].delivery, "draft");
    f.store.markBatch(f.sessionId, batch.id, "accepted");
    assert.equal(f.service.state().comments[0].delivery, "sent");
    f.service.update({ ...c, deleted: true, mutationId: randomUUID() });
    assert.equal(f.service.prepareBatch(batch.id, [c.id]).prompt, batch.prompt);
    assert.throws(() => f.service.prepareBatch(randomUUID(), [c.id]));
  } finally {
    f.close();
  }
});
test("unknown, duplicated, empty or overlarge review batches are refused; pre-send crash recovers", () => {
  const f = fixture();
  try {
    const c = f.service.update(f.draft);
    assert.throws(() => f.service.prepareBatch(randomUUID(), [c.id]));
    const written = f.service.update({
      ...c,
      text: "hello",
      mutationId: randomUUID(),
    });
    assert.throws(() =>
      f.service.prepareBatch(randomUUID(), [written.id, written.id]),
    );
    assert.throws(() => f.service.prepareBatch(randomUUID(), [randomUUID()]));
    const batch = f.service.prepareBatch(randomUUID(), [c.id]);
    f.service.lock(batch.id);
    f.service.recoverUnstartedBatches();
    assert.equal(f.service.state().comments[0].delivery, "draft");
  } finally {
    f.close();
  }
});
test("file preview rejects traversal, symlink escapes, hidden/private files and unsupported formats", () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), "margin-outside-"));
  try {
    writeFileSync(join(outside, "secret.html"), "secret");
    symlinkSync(join(outside, "secret.html"), join(f.root, "escape.html"));
    mkdirSync(join(f.root, ".margin-data"));
    writeFileSync(join(f.root, ".margin-data", "hidden.html"), "secret");
    writeFileSync(join(f.root, "file.pdf"), "pdf");
    for (const path of [
      "escape.html",
      ".margin-data/hidden.html",
      "file.pdf",
      join(outside, "secret.html"),
    ])
      assert.throws(() => artifactFile(f.root, path));
    assert.equal(artifactFile(f.root, "report.md").relative, "report.md");
  } finally {
    f.close();
    rmSync(outside, { recursive: true, force: true });
  }
});
test("only explicit loopback HTTP apps qualify", () => {
  assert.equal(localAppUrl("http://localhost:3000/a").pathname, "/a");
  for (const url of [
    "https://localhost:3000",
    "http://example.com:3000",
    "http://127.0.0.2:3000",
    "http://localhost",
    "http://localhost:22",
    "http://u:p@localhost:3000",
  ])
    assert.throws(() => localAppUrl(url));
});
async function connect(url: string) {
  const boot = await fetch(url, { redirect: "manual" });
  assert.equal(boot.status, 302);
  const cookie = boot.headers.get("set-cookie")!.split(";")[0];
  return { cookie, entry: new URL(boot.headers.get("location")!, url).href };
}
test("isolated Markdown preview is capability-gated and original remains raw", async () => {
  const f = fixture(),
    previews = new ArtifactPreviews();
  try {
    const preview = await previews.open(
      f.sessionId,
      f.artifact,
      f.root,
      "http://127.0.0.1:4317",
    );
    assert.equal((await fetch(preview.origin + "/report.md")).status, 403);
    const connected = await connect(preview.url);
    const body = await (
      await fetch(connected.entry, { headers: { cookie: connected.cookie } })
    ).text();
    assert.match(body, /<h1>Report<\/h1>/);
    assert.match(body, /_margin_preview\/bridge.js/);
    const original = await previews.open(
      f.sessionId,
      f.artifact,
      f.root,
      "http://127.0.0.1:4317",
      true,
    );
    const raw = await connect(original.url);
    assert.equal(
      await (
        await fetch(raw.entry, { headers: { cookie: raw.cookie } })
      ).text(),
      readFileSync(join(f.root, "report.md"), "utf8"),
    );
    await assert.rejects(
      previews.open(
        f.sessionId,
        { ...f.artifact, kind: "app", location: "http://127.0.0.1:4317" },
        f.root,
        "http://127.0.0.1:4317",
      ),
      /cannot/,
    );
  } finally {
    previews.close();
    f.close();
  }
});
test("runtime app proxy preserves paths/CSP, strips credentials, and refuses cross-origin redirects", async () => {
  const f = fixture(),
    previews = new ArtifactPreviews();
  let receivedCookie: string | undefined,
    receivedAuthorization: string | undefined;
  const app = createServer((req, res) => {
    receivedCookie = req.headers.cookie;
    receivedAuthorization = req.headers.authorization;
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://example.com/" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html",
      "content-security-policy": "script-src 'self'",
    });
    res.end(
      `<html><head><title>App</title></head><body>${req.url}</body></html>`,
    );
  });
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  try {
    const port = (app.address() as import("node:net").AddressInfo).port;
    const preview = await previews.open(
      f.sessionId,
      {
        ...f.artifact,
        kind: "app",
        location: `http://127.0.0.1:${port}/settings?q=1`,
      },
      f.root,
      "http://127.0.0.1:4317",
    );
    const c = await connect(preview.url);
    const response = await fetch(c.entry, {
      headers: {
        cookie: c.cookie + "; margin_session=private",
        authorization: "Bearer secret",
      },
    });
    assert.match(await response.text(), /settings\?q=1/);
    assert.equal(
      response.headers.get("content-security-policy"),
      "script-src 'self'",
    );
    assert.equal(receivedCookie, undefined);
    assert.equal(receivedAuthorization, undefined);
    assert.equal(
      (
        await fetch(preview.origin + "/redirect", {
          headers: { cookie: c.cookie },
        })
      ).status,
      409,
    );
  } finally {
    previews.close();
    app.closeAllConnections();
    await new Promise<void>((r) => app.close(() => r()));
    f.close();
  }
});
test("ordinary output links are wrapped, while external, unsafe and Margin URLs are not", () => {
  const origin = "http://127.0.0.1:4317";
  assert.equal(
    artifactLocationFromLink("reports/a%20b.md#section", origin),
    "reports/a b.md",
  );
  assert.equal(
    artifactLocationFromLink("/project/report.html", origin),
    "/project/report.html",
  );
  assert.equal(
    artifactLocationFromLink("file:///project/report.md", origin),
    "/project/report.md",
  );
  assert.equal(
    artifactLocationFromLink("http://localhost:3000/settings", origin),
    "http://localhost:3000/settings",
  );
  for (const link of [
    "https://example.com/report.md",
    "http://127.0.0.1:4317/test.html",
    "http://localhost:4317/",
    "//example.com/a.html",
    "javascript:alert(1)",
    "file://remote/a.md",
    "#section",
    "notes.ts",
    "data:text/html,test",
    "bad%00.md",
  ])
    assert.equal(artifactLocationFromLink(link, origin), undefined);
  assert.match(
    artifactOutputLink("report.md", "session", origin)!,
    /^\/review\/session\?location=report.md$/,
  );
});
test("explicit Save gates comments, and overall feedback can be sent alone without losing newer text", () => {
  const f = fixture();
  try {
    let c = f.service.update({ ...f.draft, text: "unfinished", saved: false });
    assert.throws(() => f.service.prepareBatch(randomUUID(), [c.id]));
    c = f.service.update({ ...c, saved: true, mutationId: randomUUID() });
    const note = f.service.updateOverall({
      text: 'Overall "thought"',
      revision: 0,
      mutationId: randomUUID(),
    });
    const batch = f.service.prepareBatch(randomUUID(), [c.id], note.revision);
    assert.equal(
      JSON.parse(batch.prompt.slice(batch.prompt.indexOf("{"))).overallReply,
      note.text,
    );
    f.service.lock(batch.id);
    assert.throws(
      () =>
        f.service.updateOverall({
          ...note,
          text: "mid-submit",
          mutationId: randomUUID(),
        }),
      ReviewConflict,
    );
    f.service.reject(batch.id);
    assert.equal(f.service.state().overall?.text, note.text);
    const noteOnly = f.service.prepareBatch(randomUUID(), [], note.revision);
    // A new note written before the old batch locks must not be cleared when the old batch is accepted.
    const newer = f.service.updateOverall({
      ...note,
      text: "Newer thought",
      mutationId: randomUUID(),
    });
    f.store.markBatch(f.sessionId, noteOnly.id, "accepted");
    assert.equal(f.service.state().overall?.text, newer.text);
    assert.throws(
      () => f.service.prepareBatch(randomUUID(), [], note.revision),
      ReviewConflict,
    );
    const latest = f.service.prepareBatch(randomUUID(), [], newer.revision);
    f.store.markBatch(f.sessionId, latest.id, "accepted");
    assert.equal(f.service.state().overall?.text, "");
    assert.ok(f.service.state().overall!.revision > newer.revision);
  } finally {
    f.close();
  }
});
test("overall feedback recovers offline text and handles another window's change explicitly", async () => {
  const f = fixture(),
    storage = memoryStorage();
  try {
    const offline = new OverallFeedbackDraft(
      f.sessionId,
      storage,
      async () => {
        throw new Error("offline");
      },
      () => {},
    );
    offline.edit("My unfinished overall feedback");
    await assert.rejects(offline.flush());
    const other = f.service.updateOverall({
      text: "Other window's version",
      revision: 0,
      mutationId: randomUUID(),
    });
    const recovered = new OverallFeedbackDraft(
      f.sessionId,
      storage,
      async (value) => {
        try {
          return f.service.updateOverall(value);
        } catch (e) {
          throw Object.assign(e as Error, {
            conflict: e instanceof ReviewConflict,
          });
        }
      },
      () => {},
    );
    recovered.observe(other);
    await assert.rejects(recovered.flush());
    assert.equal(recovered.text, "My unfinished overall feedback");
    assert.equal(recovered.otherText, "Other window's version");
    recovered.keepMine();
    await recovered.flush();
    assert.equal(
      f.service.state().overall?.text,
      "My unfinished overall feedback",
    );
    assert.equal(Object.keys(storage).length, 0);
  } finally {
    f.close();
  }
});
function memoryStorage(): Storage {
  const value: Record<string, string> = {};
  return new Proxy(value, {
    get: (target, key) =>
      key === "getItem"
        ? (k: string) => target[k] ?? null
        : key === "setItem"
          ? (k: string, v: string) => {
              target[k] = v;
            }
          : key === "removeItem"
            ? (k: string) => {
                delete target[k];
              }
            : target[key as string],
  }) as unknown as Storage;
}
test("unfinished browser drafts recover after failed save; edits during a save retain newest text", async () => {
  const f = fixture(),
    storage = memoryStorage();
  try {
    const failed = new ArtifactDrafts(
      f.sessionId,
      storage,
      async () => {
        throw new Error("offline");
      },
      () => {},
    );
    failed.edit({ ...f.draft, text: "unfinished thought" });
    await assert.rejects(failed.flush());
    assert.ok(Object.keys(storage).length);
    let release!: () => void,
      first = true;
    const recovered = new ArtifactDrafts(
      f.sessionId,
      storage,
      async (c) => {
        if (first) {
          first = false;
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return f.service.update(c);
      },
      () => {},
    );
    const flushing = recovered.flush();
    recovered.edit({
      ...recovered.merge([])[0],
      text: "newer complete thought",
    });
    release();
    await flushing;
    assert.equal(f.service.state().comments[0].text, "newer complete thought");
    assert.equal(Object.keys(storage).length, 0);
  } finally {
    f.close();
  }
});
