import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointHistory } from "../server/checkpoints.ts";
import { build } from "esbuild";
import { resolve } from "node:path";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "margin-history-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  git("init", "-q");
  writeFileSync(
    join(root, ".gitignore"),
    ".margin-data/\n.env*\nnode_modules/\nworkspaces/\n",
  );
  writeFileSync(join(root, "app.txt"), "version one");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@local",
    "commit",
    "-qm",
    "Initial",
  );
  const data = join(root, ".margin-data");
  mkdirSync(data);
  const history = new CheckpointHistory(root, data);
  return {
    root,
    data,
    git,
    history,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function gitShim(f: ReturnType<typeof fixture>, code: string) {
  const realGit = execFileSync("/bin/sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  const bin = join(f.data, "git-shim");
  mkdirSync(bin);
  const shim = join(bin, "git");
  writeFileSync(
    shim,
    `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
${code}
{
const child = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(child.status ?? 1);
}
`,
  );
  chmodSync(shim, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  return () => {
    process.env.PATH = previous;
  };
}

test("checkpoints use finite file input and round-trip large binary and empty files", () => {
  const f = fixture();
  const restorePath = gitShim(
    f,
    `
if (args.includes('--stdin') || args.includes('--index-info') || args.includes('commit-tree')) {
  if (!fs.fstatSync(0).isFile()) {
    console.error('Checkpoint input must be a regular file, not a pipe');
    process.exit(98);
  }
}
`,
  );
  try {
    const bytes = Buffer.alloc(256 * 1024 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    writeFileSync(join(f.root, "large.bin"), bytes);
    writeFileSync(join(f.root, "empty.txt"), "");
    const saved = f.history.save("Large captured input");
    writeFileSync(join(f.root, "large.bin"), "changed");
    writeFileSync(join(f.root, "empty.txt"), "changed");
    const preview = f.history.preview(saved.id);
    f.history.restore(saved.id, preview.token);
    assert.deepEqual(readFileSync(join(f.root, "large.bin")), bytes);
    assert.equal(readFileSync(join(f.root, "empty.txt")).length, 0);
    assert.equal(
      readdirSync(f.history.directory).some((name) =>
        name.startsWith("git-input-"),
      ),
      false,
    );
  } finally {
    restorePath();
    f.close();
  }
});

test(
  "a hung Git command is killed, releases the history lock, and permits retry",
  { timeout: 15000 },
  () => {
    const f = fixture();
    const initial = f.history.save("Initial");
    const pidFile = join(f.data, "hung-git.pid");
    const restorePath = gitShim(
      f,
      `
if (args.includes('hash-object')) {
  fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else
`,
    );
    try {
      assert.throws(
        () => f.history.save("Stuck checkpoint"),
        /Code history timed out.*hash-object/,
      );
      const pid = Number(readFileSync(pidFile, "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.equal(
        existsSync(join(f.history.directory, "operation.lock")),
        false,
      );
      assert.equal(
        readdirSync(f.history.directory).some((name) =>
          name.startsWith("git-input-"),
        ),
        false,
      );
      restorePath();
      assert.equal(f.history.state().checkpoints.length, 1);
      assert.equal(f.history.state().checkpoints[0].id, initial.id);
      assert.equal(f.history.save("Retry").name, "Retry");
    } finally {
      restorePath();
      f.close();
    }
  },
);

test("checkpoints preview, restore, and roll forward without changing Git branch/index or private data", () => {
  const f = fixture();
  try {
    const head = f.git("rev-parse", "HEAD"),
      index = readFileSync(join(f.root, ".git/index"));
    writeFileSync(join(f.data, "notes.sqlite"), "private notes");
    writeFileSync(join(f.root, ".env"), "secret");
    const a = f.history.save("Before panel");
    writeFileSync(join(f.root, "app.txt"), "version two");
    mkdirSync(join(f.root, "plugins"));
    writeFileSync(join(f.root, "plugins/new.ts"), "new plugin");
    const b = f.history.save("With panel");
    const p = f.history.preview(a.id);
    assert.equal(readFileSync(join(f.root, "app.txt"), "utf8"), "version two");
    assert.equal(
      p.files.some((x) => x.path.includes(".env")),
      false,
    );
    assert.equal(
      p.files.find((x) => x.path === "plugins/new.ts")?.change,
      "deleted",
    );
    const restored = f.history.restore(a.id, p.token);
    assert.equal(restored.restored, true);
    assert.equal(readFileSync(join(f.root, "app.txt"), "utf8"), "version one");
    assert.equal(existsSync(join(f.root, "plugins/new.ts")), false);
    assert.equal(
      readFileSync(join(f.data, "notes.sqlite"), "utf8"),
      "private notes",
    );
    assert.equal(readFileSync(join(f.root, ".env"), "utf8"), "secret");
    const forward = f.history.preview(f.history.state().returnToId!);
    f.history.restore(forward.checkpoint.id, forward.token);
    assert.equal(readFileSync(join(f.root, "app.txt"), "utf8"), "version two");
    assert.equal(
      readFileSync(join(f.root, "plugins/new.ts"), "utf8"),
      "new plugin",
    );
    assert.ok(f.history.state().checkpoints.some((x) => x.id === a.id));
    assert.ok(f.history.state().checkpoints.some((x) => x.id === b.id));
    assert.equal(f.git("rev-parse", "HEAD"), head);
    assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  } finally {
    f.close();
  }
});
test("a stale preview cannot overwrite code changed since preview", () => {
  const f = fixture();
  try {
    const a = f.history.save("A");
    writeFileSync(join(f.root, "app.txt"), "B");
    const p = f.history.preview(a.id);
    writeFileSync(join(f.root, "app.txt"), "C");
    assert.throws(() => f.history.restore(a.id, p.token), /changed since/);
    assert.equal(readFileSync(join(f.root, "app.txt"), "utf8"), "C");
  } finally {
    f.close();
  }
});
test("restore refuses an ignored-file collision rather than overwriting uncaptured data", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "personal.txt"), "old code");
    const a = f.history.save("A");
    f.git("check-ignore", "--no-index", ".env");
    writeFileSync(
      join(f.root, ".gitignore"),
      ".margin-data/\n.env*\npersonal.txt\n",
    );
    writeFileSync(join(f.root, "personal.txt"), "private new data");
    const p = f.history.preview(a.id);
    assert.throws(
      () => f.history.restore(a.id, p.token),
      /uncaptured|ignored/i,
    );
    assert.equal(
      readFileSync(join(f.root, "personal.txt"), "utf8"),
      "private new data",
    );
  } finally {
    f.close();
  }
});
test("capture refuses parent symlinks into excluded data before saving protected contents", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "src"));
    writeFileSync(join(f.root, "src/file"), "code");
    f.git("add", "src/file");
    mkdirSync(join(f.data, "private"));
    writeFileSync(join(f.data, "private/file"), "private data");
    rmSync(join(f.root, "src"), { recursive: true });
    symlinkSync(join(f.data, "private"), join(f.root, "src"), "dir");
    assert.throws(() => f.history.save("Do not leak"), /symbolic link/i);
    assert.equal(
      existsSync(join(f.data, "history/operation.lock")),
      false,
      "A failed checkpoint must release its lock",
    );
  } finally {
    f.close();
  }
});
test("file/directory transitions can be restored in both directions without deleting unrelated files", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "shape"), "file");
    f.git("add", "shape");
    const a = f.history.save("File");
    rmSync(join(f.root, "shape"));
    mkdirSync(join(f.root, "shape"));
    writeFileSync(join(f.root, "shape/child"), "child");
    const b = f.history.save("Folder");
    let p = f.history.preview(a.id);
    f.history.restore(a.id, p.token);
    assert.equal(readFileSync(join(f.root, "shape"), "utf8"), "file");
    p = f.history.preview(b.id);
    f.history.restore(b.id, p.token);
    assert.equal(readFileSync(join(f.root, "shape/child"), "utf8"), "child");
  } finally {
    f.close();
  }
});
test("completed but unrecorded restore is reconciled and keeps the return checkpoint", () => {
  const f = fixture();
  try {
    const a = f.history.save("A");
    writeFileSync(join(f.root, "app.txt"), "B");
    const b = f.history.save("B");
    writeFileSync(join(f.root, "app.txt"), "version one");
    const path = join(f.data, "history/checkpoints.json");
    const j = JSON.parse(readFileSync(path, "utf8"));
    j.pendingRestore = { target: a.id, backup: b.id };
    writeFileSync(path, JSON.stringify(j));
    const p = f.history.preview(a.id);
    f.history.restore(a.id, p.token);
    assert.equal(f.history.state().error, undefined);
    assert.equal(f.history.state().currentId, a.id);
    assert.equal(f.history.state().returnToId, b.id);
    assert.equal(f.history.state().activationPending, true);
  } finally {
    f.close();
  }
});
test("startup acknowledgement obeys the same history-operation lock", () => {
  const f = fixture();
  try {
    f.history.save("A");
    const path = join(f.data, "history/checkpoints.json");
    const j = JSON.parse(readFileSync(path, "utf8"));
    j.activationPending = true;
    writeFileSync(path, JSON.stringify(j));
    writeFileSync(join(f.data, "history/operation.lock"), String(process.pid));
    assert.throws(() => f.history.acknowledgeStartup(), /operation/);
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).activationPending,
      true,
    );
  } finally {
    f.close();
  }
});
test("a live history lock blocks safely and a dead owner's lock recovers without restarting the server", () => {
  const f = fixture();
  try {
    f.history.save("Initial checkpoint");
    const lock = join(f.data, "history/operation.lock");
    writeFileSync(lock, String(process.pid));
    assert.throws(
      () => f.history.save("While another operation runs"),
      /Another history operation is running/,
    );
    assert.equal(
      readFileSync(lock, "utf8"),
      String(process.pid),
      "Never remove a potentially live operation's lock",
    );
    const exitedPid = execFileSync(
      process.execPath,
      ["-e", "console.log(process.pid)"],
      { encoding: "utf8" },
    ).trim();
    writeFileSync(lock, exitedPid);
    assert.equal(
      f.history.save("Retry without restart").name,
      "Retry without restart",
    );
    assert.equal(existsSync(lock), false);
  } finally {
    f.close();
  }
});

test("an edit arriving while the before-restore checkpoint is saved is not overwritten", () => {
  const f = fixture();
  try {
    const a = f.history.save("A");
    writeFileSync(join(f.root, "app.txt"), "B");
    const p = f.history.preview(a.id);
    const h = f.history as any;
    const original = h.checkpoint.bind(h);
    h.checkpoint = (...args: any[]) => {
      const c = original(...args);
      if (args[1] === "before-restore")
        writeFileSync(join(f.root, "app.txt"), "new outside edit");
      return c;
    };
    assert.throws(() => f.history.restore(a.id, p.token), /changed/i);
    assert.equal(
      readFileSync(join(f.root, "app.txt"), "utf8"),
      "new outside edit",
    );
  } finally {
    f.close();
  }
});

test("standalone recovery still rolls forward after source files are restored away", async () => {
  const f = fixture();
  try {
    const a = f.history.save("A");
    mkdirSync(join(f.root, "scripts"));
    writeFileSync(join(f.root, "scripts/experiment.ts"), "new code");
    const b = f.history.save("B");
    const cli = join(f.data, "recovery", "recover.mjs");
    mkdirSync(join(f.data, "recovery"));
    await build({
      entryPoints: [resolve("scripts/checkpoint-cli.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: cli,
    });
    const p = f.history.preview(a.id);
    f.history.restore(a.id, p.token);
    assert.equal(existsSync(join(f.root, "scripts/experiment.ts")), false);
    const invoke = (...args: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [cli, "--root", f.root, "--data", f.data, ...args],
          { encoding: "utf8" },
        ),
      );
    const preview = invoke("preview", b.id);
    invoke("restore", b.id, preview.token);
    assert.equal(
      readFileSync(join(f.root, "scripts/experiment.ts"), "utf8"),
      "new code",
    );
  } finally {
    f.close();
  }
});
