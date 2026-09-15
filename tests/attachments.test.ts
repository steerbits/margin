import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.ts";
import {
  AttachmentStore,
  attachmentState,
  decorateAttachments,
} from "../server/attachments.ts";
import {
  attachmentMessage,
  attachmentPrompt,
  MAX_ATTACHMENT_BYTES,
} from "../shared/attachments.ts";
import { readSessionPreview } from "../server/session-preview.ts";
import { deleteSavedSession } from "../server/delete-session.ts";
import { prepareWorkspaceData } from "../server/workspace-data.ts";
import { LiveSession } from "../server/sessions.ts";
import { RunRecovery } from "../server/run-recovery.ts";
import { UiBridge } from "../server/ui-bridge.ts";
import {
  SessionManager,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { transcript } from "../server/transcript.ts";

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "margin-attachments-")));
  const store = new Store(join(dir, "margin.sqlite"));
  const id = randomUUID();
  const project = { id: randomUUID(), path: dir, name: "Project" };
  const info = {
    id,
    projectId: project.id,
    title: "New conversation",
    createdAt: 1,
    updatedAt: 1,
  };
  store.put("session", id, info);
  store.put("project", project.id, project);
  const files = new AttachmentStore(store, dir, id);
  return {
    dir,
    store,
    id,
    info,
    project,
    files,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const upload = (name = "notes.md", bytes = Buffer.from("# A real file\n")) => ({
  id: randomUUID(),
  name,
  data: bytes.toString("base64"),
  mimeType: "application/octet-stream",
});
const batch = (ids: string[], note = "Inspect these files") => ({
  id: randomUUID(),
  note,
  commentIds: [],
  attachmentIds: ids,
});

test("any bytes, empty files, Unicode/path-like names and duplicate names are preserved without using the name as a path", () => {
  const f = fixture();
  try {
    for (const name of [
      "report.pdf",
      "notes.md",
      "notes.md",
      "../../../outside.bin",
      '資料 "quoted".xlsx',
      "<script>.html",
      "empty",
    ]) {
      const bytes =
        name === "empty" ? Buffer.alloc(0) : Buffer.from([0, 255, 1, 17]);
      const input = upload(name, bytes);
      const saved = f.files.upload(input);
      assert.deepEqual(f.files.read(saved.id).bytes, bytes);
      assert.equal(f.files.read(saved.id).file.name, name);
      assert.equal(
        f.files
          .read(saved.id)
          .file.path.startsWith(join(f.dir, "attachments", f.id)),
        true,
      );
      assert.equal(f.files.upload(input).id, saved.id);
      assert.throws(
        () => f.files.upload({ ...input, data: "eA==" }),
        /already in use/,
      );
    }
    assert.equal(f.files.list().length, 7);
    assert.equal(attachmentState(f.store, f.id).attachmentRevision, 7);
    assert.equal(existsSync(join(f.dir, "outside.bin")), false);
  } finally {
    f.close();
  }
});

test("orphaned upload writes are retryable and damaged drafts can be removed without following symlinks", () => {
  const f = fixture();
  try {
    const input = upload();
    f.files.upload(input);
    const path = f.files.read(input.id).file.path;
    f.store.put("attachments", f.id, []); // crash before metadata publication
    assert.equal(f.files.upload(input).id, input.id);
    f.store.put("attachments", f.id, []);
    assert.throws(() => f.files.upload({ ...input, data: "eA==" }), /changed/);
    f.files.upload(input);
    rmSync(path);
    symlinkSync(join(f.dir, "margin.sqlite"), path);
    f.files.remove(input.id);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(join(f.dir, "margin.sqlite")), true);
    const missing = f.files.upload(upload());
    rmSync(f.files.read(missing.id).file.path);
    f.files.remove(missing.id);
    assert.equal(f.files.list().length, 0);
  } finally {
    f.close();
  }
});

test("invalid base64, oversized files, duplicate IDs, and draft count/byte limits are rejected", () => {
  const f = fixture();
  try {
    for (const data of [
      "a",
      "====",
      "AB==",
      "AA=A",
      "!!!!",
      "aA==\n",
      "YWJj=",
      "éééé",
    ])
      assert.throws(() => f.files.upload({ ...upload(), data }));
    assert.throws(() =>
      f.files.upload(upload("huge", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))),
    );
    assert.throws(() => f.files.upload({ ...upload(), name: "bad\nname" }));
    for (let i = 0; i < 10; i++) f.files.upload(upload());
    assert.throws(() => f.files.upload(upload()), /at most 10/);
    const id = f.files.list()[0].id;
    assert.throws(
      () => f.files.select(batch([id, id])),
      /Invalid attachment selection/,
    );
    for (const file of f.files.list()) f.files.remove(file.id);
    f.files.upload(upload("a", Buffer.alloc(MAX_ATTACHMENT_BYTES)));
    f.files.upload(upload("b", Buffer.alloc(MAX_ATTACHMENT_BYTES)));
    assert.throws(
      () => f.files.upload(upload("c", Buffer.alloc(MAX_ATTACHMENT_BYTES))),
      /50 MB/,
    );
  } finally {
    f.close();
  }
});

test("cross-conversation IDs, symlinks and modified originals cannot be sent or downloaded", () => {
  const f = fixture();
  try {
    const a = f.files.upload(upload());
    const other = new AttachmentStore(f.store, f.dir, randomUUID());
    assert.throws(() => other.read(a.id), /not found/);
    assert.throws(() => other.select(batch([a.id])), /not found/);
    const { file } = f.files.read(a.id);
    writeFileSync(file.path, "xxxxxxxxxxxxxx");
    assert.throws(() => f.files.read(a.id), /changed/);
    rmSync(file.path);
    symlinkSync(join(f.dir, "margin.sqlite"), file.path);
    assert.throws(() => f.files.read(a.id));
    rmSync(join(f.dir, "attachments", f.id), { recursive: true });
    symlinkSync(f.dir, join(f.dir, "attachments", f.id));
    assert.throws(() => f.files.upload(upload()), /symbolic link/);
    assert.throws(() => f.files.deleteAll(), /symbolic link/);
  } finally {
    f.close();
  }
});

test("drafts survive reopening, pending removals are locked, accepted manifests render safely, and recovery restores only its batch", () => {
  const f = fixture();
  try {
    const file = f.files.upload(upload());
    const b = batch([file.id], "");
    const refs = f.files.select(b);
    const raw = {
      id: "user",
      role: "user" as const,
      text: attachmentPrompt("", b.id, refs),
    };
    assert.equal(
      attachmentMessage(raw, f.files.list()),
      raw,
      "unaccepted manifests are not projected",
    );
    f.store.put("pending-input", f.id, { ...b, batchId: b.id });
    f.store.markBatch(f.id, b.id, "submitting");
    assert.throws(() => f.files.remove(file.id), /being sent/);
    f.files.accept(b);
    f.store.markBatch(f.id, b.id, "accepted");
    const newer = f.files.upload(upload("newer.csv"));
    assert.deepEqual(
      attachmentState(f.store, f.id).composerAttachments.map((file) => file.id),
      [newer.id],
    );
    assert.throws(() => f.files.select(batch([file.id])), /no longer a draft/);
    const decorated = attachmentMessage(raw, f.files.list());
    assert.equal(decorated.text, "");
    assert.deepEqual(decorated.attachments, [file]);
    assert.equal(
      attachmentMessage(
        { ...raw, text: raw.text.replace(refs[0].path, "/secret") },
        f.files.list(),
      ).attachments,
      undefined,
    );
    f.store.put("transcript", f.id, [raw]);
    let reopened = new Store(join(f.dir, "margin.sqlite"));
    try {
      const preview = readSessionPreview(reopened.db, f.id);
      assert.deepEqual(preview.messages[0].attachments, [file]);
      assert.deepEqual(preview.composerAttachments, [newer]);
    } finally {
      reopened.close();
    }
    f.files.recover(b.id);
    assert.equal(attachmentState(f.store, f.id).composerAttachments.length, 2);
    f.files.remove(file.id);
    f.files.remove(file.id);
    assert.equal(f.files.list().length, 1);
    deleteSavedSession(f.store, f.info, f.dir);
    assert.equal(existsSync(join(f.dir, "attachments", f.id)), false);
    assert.equal(f.store.get("attachments", f.id), undefined);
  } finally {
    f.close();
  }
});

test("workspace migration relocates originals, saved manifests, and native backups into the worker's accessible storage", () => {
  const f = fixture();
  try {
    const file = f.files.upload(
      upload("report.pdf", Buffer.from("%PDF-fixture")),
    );
    const b = batch([file.id]);
    const prompt = attachmentPrompt(b.note, b.id, f.files.select(b));
    f.files.accept(b);
    f.store.put("transcript", f.id, [
      { id: "user", role: "user", text: prompt },
    ]);
    f.store.put("pending-input", f.id, { prompt, note: b.note, batchId: b.id });
    f.store.put("pi-backup", f.id, {
      entries: [{ message: { content: prompt } }],
    });
    const destination = prepareWorkspaceData(
      f.dir,
      join(f.dir, "app"),
      f.project,
    );
    const migrated = new Store(join(destination, "margin.sqlite"));
    try {
      const files = new AttachmentStore(migrated, destination, f.id);
      assert.equal(files.read(file.id).bytes.toString(), "%PDF-fixture");
      assert.ok(files.read(file.id).file.path.startsWith(destination));
      assert.deepEqual(
        readSessionPreview(migrated.db, f.id).messages[0].attachments,
        [file],
      );
      assert.ok(
        migrated
          .get<{ prompt: string }>("pending-input", f.id)!
          .prompt.includes(destination),
      );
      assert.ok(
        JSON.stringify(migrated.get("pi-backup", f.id)).includes(destination),
      );
      assert.equal(
        f.files.read(file.id).bytes.toString(),
        "%PDF-fixture",
        "original retained",
      );
    } finally {
      migrated.close();
    }
  } finally {
    f.close();
  }
});

test("real SDK expands a selected skill and preserves the manifest through native transcript projection", async () => {
  const f = fixture();
  const skillPath = join(f.dir, "SKILL.md");
  writeFileSync(skillPath, "# Review\nRead references carefully.");
  const models = await ModelRuntime.create({
    modelsPath: null,
    modelsStorePath: join(f.dir, "models.json"),
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async () => {
        throw new Error("No auth writes");
      },
      delete: async () => {},
    },
  });
  await models.setRuntimeApiKey("openai", "unused-fixture-key");
  const model = models.getModel("openai", "gpt-4.1");
  assert.ok(model);
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: f.dir,
    agentDir: f.dir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    skillsOverride: () => ({
      skills: [
        {
          name: "review",
          description: "Test",
          filePath: skillPath,
          baseDir: f.dir,
          sourceInfo: {
            path: skillPath,
            source: "custom",
            scope: "temporary",
            origin: "top-level",
          },
          disableModelInvocation: false,
        },
      ],
      diagnostics: [],
    }),
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: f.dir,
    agentDir: f.dir,
    modelRuntime: models,
    model,
    tools: [],
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: SessionManager.inMemory(f.dir),
  });
  // Intercept only the agent inference call, after the real SDK prompt preflight.
  session.agent.prompt = async (input) => {
    assert.ok(Array.isArray(input));
    for (const message of input) {
      assert.equal(message.role, "user");
      if (message.role === "user")
        session.sessionManager.appendMessage(message);
    }
  };
  try {
    const file = f.files.upload(upload());
    const b = batch([file.id], "Review the file");
    const prompt = attachmentPrompt(b.note, b.id, f.files.select(b));
    await session.prompt(`/skill:review ${prompt}`, {
      preflightResult: (ok) => {
        assert.equal(ok, true);
        f.files.accept(b);
      },
    });
    const messages = transcript(session.sessionManager.getBranch());
    assert.equal(messages[0].skill, "review");
    assert.equal(messages[0].text, prompt);
    const rendered = attachmentMessage(messages[0], f.files.list());
    assert.equal(rendered.text, b.note);
    assert.deepEqual(rendered.attachments, [file]);
  } finally {
    session.dispose();
    f.close();
  }
});

// Exercise the actual LiveSession adapter, substituting only the inference boundary.
function liveFixture() {
  const f = fixture();
  const manager = SessionManager.inMemory(f.dir);
  let accept = true;
  const prompts: string[] = [];
  const l = Object.assign(Object.create(LiveSession.prototype), {
    info: f.info,
    project: f.project,
    store: f.store,
    dataDir: f.dir,
    appRoot: f.dir,
    plugins: [],
    ready: Promise.resolve(),
    busy: false,
    messages: [],
    liveTools: new Map(),
    pluginState: {},
    children: new Set(),
    childOperations: 0,
    pluginOperations: 0,
    disposing: false,
    ui: new UiBridge(() => {}),
    recoveryRun: new RunRecovery(f.store, f.id),
    changed() {},
    agent: {
      sessionManager: manager,
      resourceLoader: { getSkills: () => ({ skills: [{ name: "review" }] }) },
      getAvailableThinkingLevels: () => [],
      async prompt(
        text: string,
        options: { preflightResult(ok: boolean): void },
      ) {
        prompts.push(text);
        options.preflightResult(accept);
        if (!accept) return;
        manager.appendMessage({
          role: "user",
          content: text,
          timestamp: Date.now(),
        });
      },
    },
  }) as LiveSession;
  return {
    ...f,
    l,
    prompts,
    reject() {
      accept = false;
    },
    accept() {
      accept = true;
    },
  };
}
const settle = async (l: LiveSession) => {
  for (let n = 0; n < 50 && l.busy; n++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(l.busy, false);
  await new Promise<void>((resolve) => setImmediate(resolve));
};

test("real send adapter accepts attachment-only messages, deduplicates retries, and preserves newer drafts", async () => {
  const f = liveFixture();
  try {
    const file = f.files.upload(upload("input.md"));
    const b = batch([file.id], "");
    assert.equal((await f.l.send(b)).status, "submitting");
    await settle(f.l);
    assert.equal((await f.l.send(b)).status, "accepted");
    assert.equal(f.prompts.length, 1);
    const payload = JSON.parse(f.prompts[0].slice(f.prompts[0].indexOf("{")));
    assert.equal(payload.message, "");
    assert.equal(
      readFileSync(payload.attachments[0].path, "utf8"),
      "# A real file\n",
    );
    assert.equal(f.l.snapshot().composerAttachments?.length, 0);
    assert.deepEqual(f.l.snapshot().messages[0].attachments, [file]);
    assert.equal(f.l.info.title, "input.md");
    const newer = f.files.upload(upload("new.md"));
    await f.l.send(b);
    assert.deepEqual(f.l.snapshot().composerAttachments, [newer]);
  } finally {
    f.close();
  }
});

test("preflight rejection retains text/files and a new batch can retry; missing file cannot be silently omitted", async () => {
  const f = liveFixture();
  try {
    const file = f.files.upload(upload());
    f.l.setComposer("Keep this note");
    f.reject();
    const b = batch([file.id], "Keep this note");
    await f.l.send(b);
    await settle(f.l);
    assert.equal((await f.l.send(b)).status, "rejected");
    assert.equal(f.l.snapshot().composer, "Keep this note");
    assert.deepEqual(f.l.snapshot().composerAttachments, [file]);
    f.accept();
    await f.l.send({ ...b, id: randomUUID() });
    await settle(f.l);
    assert.equal(f.l.snapshot().composer, "");
    await assert.rejects(f.l.send(batch([randomUUID()])), /not found/);
    assert.equal(f.prompts.length, 2);
  } finally {
    f.close();
  }
});

test("attachments combine with inline comments and skills without losing either structured input", async () => {
  const f = liveFixture();
  try {
    const file = f.files.upload(upload());
    f.l.messages = [{ id: "reply", role: "assistant", text: "Keep it" }];
    const commentId = randomUUID();
    f.store.put("comments", f.id, [
      {
        id: commentId,
        anchor: {
          messageId: "reply",
          start: 0,
          end: 7,
          quote: "Keep it",
          prefix: "",
          suffix: "",
        },
        text: "Use this reference",
        status: "draft",
        createdAt: 1,
      },
    ]);
    await f.l.send({
      ...batch([file.id]),
      commentIds: [commentId],
      skill: "review",
    });
    await settle(f.l);
    assert.ok(f.prompts[0].startsWith("/skill:review "));
    const manifest = JSON.parse(f.prompts[0].slice(f.prompts[0].indexOf("{")));
    const feedback = JSON.parse(
      manifest.message.slice(manifest.message.indexOf("{")),
    );
    assert.equal(feedback.inlineComments[0].comment, "Use this reference");
    assert.equal(manifest.attachments[0].name, file.name);
    assert.equal(f.store.comments(f.id)[0].status, "sent");
  } finally {
    f.close();
  }
});
