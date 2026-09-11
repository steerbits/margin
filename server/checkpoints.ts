import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  Checkpoint,
  CheckpointPreview,
  HistoryState,
} from "../shared/customization.ts";

type FileEntry = { path: string; mode: string; oid: string };
type Journal = {
  version: 1;
  checkpoints: Checkpoint[];
  currentId?: string;
  returnToId?: string;
  pendingRestore?: { target: string; backup: string };
  activationPending?: boolean;
};
const omitted = new Set([
  ".git",
  ".margin-data",
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
]);

export class CheckpointHistory {
  readonly root: string;
  readonly directory: string;
  private journalPath: string;
  constructor(
    root: string,
    readonly dataDir: string,
  ) {
    this.root = realpathSync(root);
    this.directory = join(resolve(dataDir), "history");
    this.journalPath = join(this.directory, "checkpoints.json");
  }
  private git(args: string[], input?: string | Buffer, index?: string): Buffer {
    return execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "commit.gpgSign=false",
        "-C",
        this.root,
        ...args,
      ],
      {
        input,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          ...(index ? { GIT_INDEX_FILE: index } : {}),
          GIT_AUTHOR_NAME: "Margin checkpoint",
          GIT_AUTHOR_EMAIL: "checkpoint@margin.local",
          GIT_COMMITTER_NAME: "Margin checkpoint",
          GIT_COMMITTER_EMAIL: "checkpoint@margin.local",
        },
      },
    );
  }
  private requireRepository() {
    if (
      realpathSync(
        this.git(["rev-parse", "--show-toplevel"]).toString().trim(),
      ) !== this.root
    )
      throw new Error(
        "History requires a Git repository rooted at Margin's source folder.",
      );
  }
  private journal(): Journal {
    if (!existsSync(this.journalPath)) return { version: 1, checkpoints: [] };
    const data = JSON.parse(readFileSync(this.journalPath, "utf8")) as Journal;
    if (data.version !== 1 || !Array.isArray(data.checkpoints))
      throw new Error(
        "The checkpoint journal is not readable by this version. Use the saved recovery command.",
      );
    return data;
  }
  private writeJournal(data: Journal) {
    mkdirSync(this.directory, { recursive: true });
    const tmp = `${this.journalPath}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.journalPath);
  }
  private locked<T>(fn: () => T): T {
    mkdirSync(this.directory, { recursive: true });
    const lock = join(this.directory, "operation.lock");
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(readFileSync(lock, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0)
        throw new Error(
          "Another history operation holds the lock. Inspect operation.lock before retrying.",
        );
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          rmSync(lock);
          return this.locked(fn);
        }
      }
      throw new Error(
        "Another history operation is running. Try again when it finishes.",
      );
    }
    writeFileSync(fd, String(process.pid));
    try {
      this.requireRepository();
      return fn();
    } finally {
      closeSync(fd);
      rmSync(lock, { force: true });
    }
  }
  private permitted(path: string) {
    if (
      !path ||
      isAbsolute(path) ||
      path.split("/")[0].toLowerCase() === "workspaces" ||
      path
        .split("/")
        .some(
          (s) =>
            s === ".." ||
            s === "." ||
            !s ||
            omitted.has(s.toLowerCase()) ||
            s.startsWith(".margin-restore-") ||
            (s.toLowerCase().startsWith(".env") &&
              s.toLowerCase() !== ".env.example") ||
            s === ".DS_Store",
        ) ||
      path.endsWith(".log")
    )
      return false;
    const location = resolve(this.root, path);
    const relData = relative(
      existsSync(this.dataDir)
        ? realpathSync(this.dataDir)
        : resolve(this.dataDir),
      location,
    );
    return !(
      relData === "" ||
      (!relData.startsWith(`..${sep}`) &&
        relData !== ".." &&
        !isAbsolute(relData))
    );
  }
  private safeLocation(
    path: string,
    deleting = new Set<string>(),
    directoryTargets = new Set<string>(),
  ) {
    if (!this.permitted(path))
      throw new Error(`Protected path is outside code history: ${path}`);
    const parts = path.split("/");
    let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]);
      let stat;
      try {
        stat = lstatSync(current);
      } catch (e) {
        if (
          ["ENOENT", "ENOTDIR"].includes(
            (e as NodeJS.ErrnoException).code ?? "",
          )
        )
          continue;
        throw e;
      }
      if (stat.isSymbolicLink())
        throw new Error(`Restore will not follow a symbolic link: ${path}`);
      if (
        i < parts.length - 1 &&
        !stat.isDirectory() &&
        !deleting.has(parts.slice(0, i + 1).join("/"))
      )
        throw new Error(`A file blocks the target folder: ${path}`);
      if (
        i === parts.length - 1 &&
        stat.isDirectory() &&
        !directoryTargets.has(path)
      )
        throw new Error(`A folder occupies a target file path: ${path}`);
    }
    return join(this.root, path);
  }
  private capture(): { tree: string; files: FileEntry[] } {
    const paths = [
      ...new Set(
        this.git([
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ])
          .toString()
          .split("\0")
          .filter((p) => p && this.permitted(p)),
      ),
    ].sort();
    const files: FileEntry[] = [];
    const indexModes = new Map(
      this.git(["ls-files", "--stage", "-z"])
        .toString()
        .split("\0")
        .filter(Boolean)
        .map((row) => {
          const tab = row.indexOf("\t");
          return [row.slice(tab + 1), row.slice(0, 6)] as const;
        }),
    );
    for (const path of paths) {
      const location = join(this.root, path);
      let stat;
      try {
        stat = lstatSync(location);
      } catch (e) {
        if (
          ["ENOENT", "ENOTDIR"].includes(
            (e as NodeJS.ErrnoException).code ?? "",
          )
        )
          continue;
        throw e;
      }
      if (stat.isDirectory()) {
        if (indexModes.get(path) === "160000")
          throw new Error(`Checkpoints do not support submodules: ${path}`);
        continue;
      }
      // Reject every linked ancestor, including aliases into in-root private data.
      let ancestor = this.root;
      for (const part of path.split("/").slice(0, -1)) {
        ancestor = join(ancestor, part);
        if (lstatSync(ancestor).isSymbolicLink())
          throw new Error(
            `Checkpoint will not follow a symbolic link: ${path}`,
          );
      }
      const parent = realpathSync(dirname(location));
      const rel = relative(this.root, parent);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new Error(`Code path resolves outside Margin: ${path}`);
      if (!stat.isFile() && !stat.isSymbolicLink())
        throw new Error(`Checkpoint cannot capture this file type: ${path}`);
      const contents = stat.isSymbolicLink()
        ? Buffer.from(readlinkSync(location))
        : readFileSync(location);
      const after = lstatSync(location);
      if (
        after.ino !== stat.ino ||
        after.mtimeMs !== stat.mtimeMs ||
        after.size !== stat.size
      )
        throw new Error(
          "Code changed while making the checkpoint. Retry when editing has finished.",
        );
      const oid = this.git(["hash-object", "-w", "--stdin"], contents)
        .toString()
        .trim();
      files.push({
        path,
        mode: stat.isSymbolicLink()
          ? "120000"
          : stat.mode & 0o111
            ? "100755"
            : "100644",
        oid,
      });
    }
    const temporary = mkdtempSync(join(this.directory, "index-")),
      index = join(temporary, "index");
    try {
      this.git(["read-tree", "--empty"], undefined, index);
      if (files.length)
        this.git(
          ["update-index", "-z", "--index-info"],
          files.map((f) => `${f.mode} ${f.oid}\t${f.path}\0`).join(""),
          index,
        );
      return {
        tree: this.git(["write-tree"], undefined, index).toString().trim(),
        files,
      };
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  private checkpoint(
    name: string,
    kind: Checkpoint["kind"],
    current: ReturnType<CheckpointHistory["capture"]>,
    deduplicate = false,
  ): Checkpoint {
    const journal = this.journal();
    const matching = journal.checkpoints.findLast(
      (c) => c.tree === current.tree,
    );
    if (deduplicate && matching) {
      this.target(matching.id);
      return matching;
    }
    const id = randomUUID();
    const commit = this.git(
      ["commit-tree", current.tree],
      `Margin checkpoint: ${name}\n`,
    )
      .toString()
      .trim();
    this.git(["update-ref", `refs/margin/checkpoints/${id}`, commit]);
    const checkpoint: Checkpoint = {
      id,
      name,
      createdAt: Date.now(),
      commit,
      tree: current.tree,
      kind,
    };
    journal.checkpoints.push(checkpoint);
    this.writeJournal(journal);
    return checkpoint;
  }
  save(name: string, kind: Checkpoint["kind"] = "manual", deduplicate = false) {
    return this.locked(() =>
      this.checkpoint(
        name.trim().slice(0, 100) || "Untitled checkpoint",
        kind,
        this.capture(),
        deduplicate,
      ),
    );
  }
  withSavedState<T>(name: string, operation: () => T): T {
    return this.locked(() => {
      this.checkpoint(name, "automatic", this.capture(), true);
      return operation();
    });
  }
  state(): HistoryState {
    const recovery = join(resolve(this.dataDir), "recovery", "recover.mjs");
    const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
    const command = `node ${quote(recovery)} --root ${quote(this.root)} --data ${quote(resolve(this.dataDir))} list`;
    try {
      this.requireRepository();
      const j = this.journal();
      return {
        available: true,
        checkpoints: [...j.checkpoints].reverse(),
        currentId: j.currentId,
        returnToId: j.returnToId,
        activationPending: !!j.activationPending,
        pendingRestoreTarget: j.pendingRestore?.target,
        recoveryCommand: command,
        ...(j.pendingRestore
          ? {
              error:
                "A restore was interrupted. The before-restore checkpoint is preserved; use Preview/Restore or the recovery command.",
            }
          : {}),
      };
    } catch (e) {
      return {
        available: false,
        error: e instanceof Error ? e.message : String(e),
        checkpoints: [],
        activationPending: false,
        recoveryCommand: command,
      };
    }
  }
  acknowledgeStartup() {
    if (!existsSync(this.journalPath)) return;
    this.locked(() => {
      const j = this.journal();
      if (j.activationPending && !j.pendingRestore) {
        j.activationPending = false;
        this.writeJournal(j);
      }
    });
  }
  private target(id: string) {
    const checkpoint = this.journal().checkpoints.find((c) => c.id === id);
    if (!checkpoint) throw new Error("Checkpoint not found.");
    const commit = this.git([
      "rev-parse",
      `refs/margin/checkpoints/${checkpoint.id}`,
    ])
      .toString()
      .trim();
    if (commit !== checkpoint.commit)
      throw new Error("Checkpoint reference has changed.");
    const tree = this.git(["rev-parse", `${commit}^{tree}`])
      .toString()
      .trim();
    if (tree !== checkpoint.tree)
      throw new Error("Checkpoint tree does not match its journal.");
    const files = this.git(["ls-tree", "-rz", "--full-tree", tree])
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((row) => {
        const tab = row.indexOf("\t");
        const [mode, , oid] = row.slice(0, tab).split(" ");
        return { mode, oid, path: row.slice(tab + 1) };
      });
    for (const file of files)
      if (!this.permitted(file.path))
        throw new Error(`Checkpoint contains a protected path: ${file.path}`);
    return { checkpoint, files };
  }
  private previewFor(
    target: ReturnType<CheckpointHistory["target"]>,
    current: ReturnType<CheckpointHistory["capture"]>,
  ): CheckpointPreview {
    const a = new Map(current.files.map((f) => [f.path, f])),
      b = new Map(target.files.map((f) => [f.path, f]));
    const files: CheckpointPreview["files"] = [];
    for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const old = a.get(path),
        next = b.get(path);
      if (old?.oid === next?.oid && old?.mode === next?.mode) continue;
      files.push({
        path,
        change: !old ? "added" : !next ? "deleted" : "modified",
      });
    }
    const diff = this.git([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      current.tree,
      target.checkpoint.tree,
    ]).toString();
    return {
      checkpoint: target.checkpoint,
      token: createHash("sha256")
        .update(`${current.tree}:${target.checkpoint.commit}`)
        .digest("hex"),
      files,
      diff,
    };
  }
  preview(id: string) {
    return this.locked(() => this.previewFor(this.target(id), this.capture()));
  }
  currentTree() {
    return this.locked(() => this.capture().tree);
  }
  setActivationPending(pending: boolean) {
    this.locked(() => {
      const j = this.journal();
      j.activationPending = pending;
      this.writeJournal(j);
    });
  }
  restore(id: string, token: string) {
    return this.locked(() => {
      const target = this.target(id),
        current = this.capture(),
        preview = this.previewFor(target, current);
      if (preview.token !== token)
        throw new Error(
          "Code changed since this preview. Preview again before restoring.",
        );
      if (!preview.files.length) {
        const pending = this.journal();
        if (pending.pendingRestore?.target === id) {
          const backup = pending.checkpoints.find(
            (c) => c.id === pending.pendingRestore!.backup,
          );
          pending.returnToId = backup?.id;
          pending.currentId = id;
          pending.activationPending = true;
          delete pending.pendingRestore;
          this.writeJournal(pending);
          return { restored: true, checkpoint: target.checkpoint, backup };
        }
        return { restored: false, checkpoint: target.checkpoint };
      }
      const deleting = new Set(
        preview.files.filter((f) => f.change === "deleted").map((f) => f.path),
      );
      const targetByPath = new Map(target.files.map((f) => [f.path, f]));
      const currentByPath = new Map(current.files.map((f) => [f.path, f]));
      const directoryTargets = new Set<string>();
      const inspectDirectory = (path: string) => {
        for (const name of readdirSync(join(this.root, path))) {
          const child = `${path}/${name}`;
          const stat = lstatSync(join(this.root, child));
          if (stat.isSymbolicLink())
            throw new Error(`A symbolic link blocks restoration: ${child}`);
          if (stat.isDirectory()) inspectDirectory(child);
          else if (!deleting.has(child))
            throw new Error(
              `Uncaptured or ignored files occupy the restore target: ${child}`,
            );
        }
      };
      for (const file of preview.files.filter((f) => f.change === "added")) {
        const path = join(this.root, file.path);
        let stat;
        try {
          stat = lstatSync(path);
        } catch (e) {
          if (
            ["ENOENT", "ENOTDIR"].includes(
              (e as NodeJS.ErrnoException).code ?? "",
            )
          )
            continue;
          throw e;
        }
        if (stat.isDirectory()) {
          inspectDirectory(file.path);
          directoryTargets.add(file.path);
        } else
          throw new Error(
            `An uncaptured or ignored file occupies the restore target: ${file.path}`,
          );
      }
      const contents = new Map<string, Buffer>();
      for (const file of preview.files) {
        this.safeLocation(file.path, deleting, directoryTargets);
        const source = targetByPath.get(file.path);
        if (source) {
          if (!["100644", "100755"].includes(source.mode))
            throw new Error(
              `Restoring symbolic links or submodules is not supported: ${file.path}`,
            );
          contents.set(file.path, this.git(["cat-file", "blob", source.oid]));
        }
      }
      const backup = this.checkpoint(
        `Before restore · ${new Date().toLocaleString()}`,
        "before-restore",
        current,
        true,
      );
      if (this.capture().tree !== current.tree)
        throw new Error(
          "Code changed while saving the pre-restore checkpoint. Nothing was restored; preview again.",
        );
      const j = this.journal();
      j.pendingRestore = { target: id, backup: backup.id };
      j.returnToId = backup.id;
      this.writeJournal(j);
      const verifyUnchanged = (path: string) => {
        const expected = currentByPath.get(path);
        const location = join(this.root, path);
        if (!expected) {
          if (existsSync(location))
            throw new Error(`A new file appeared during restore: ${path}`);
          return;
        }
        const stat = lstatSync(location);
        if (!stat.isFile())
          throw new Error(`File type changed during restore: ${path}`);
        const oid = this.git(["hash-object", "--stdin"], readFileSync(location))
          .toString()
          .trim();
        const mode = stat.mode & 0o111 ? "100755" : "100644";
        if (oid !== expected.oid || mode !== expected.mode)
          throw new Error(`File changed during restore: ${path}`);
      };
      const removeEmpty = (path: string) => {
        for (const name of readdirSync(join(this.root, path))) {
          const child = join(path, name);
          if (!lstatSync(join(this.root, child)).isDirectory())
            throw new Error(
              `A new file appeared in ${path}; leaving it untouched.`,
            );
          removeEmpty(child);
        }
        rmdirSync(join(this.root, path));
      };
      try {
        for (const file of preview.files.filter(
          (f) => f.change === "deleted",
        )) {
          this.safeLocation(file.path);
          verifyUnchanged(file.path);
          rmSync(this.safeLocation(file.path));
        }
        for (const directory of directoryTargets) removeEmpty(directory);
        for (const file of preview.files.filter(
          (f) => f.change !== "deleted",
        )) {
          const path = this.safeLocation(file.path);
          mkdirSync(dirname(path), { recursive: true });
          const temporary = join(
            dirname(path),
            `.margin-restore-${randomUUID()}`,
          );
          writeFileSync(temporary, contents.get(file.path)!, {
            mode:
              targetByPath.get(file.path)!.mode === "100755" ? 0o755 : 0o644,
          });
          try {
            this.safeLocation(file.path);
            verifyUnchanged(file.path);
            renameSync(temporary, path);
          } finally {
            rmSync(temporary, { force: true });
          }
          chmodSync(
            path,
            targetByPath.get(file.path)!.mode === "100755" ? 0o755 : 0o644,
          );
        }
      } catch (e) {
        throw new Error(
          `Restore was interrupted. Your previous code is saved as “${backup.name}” (${backup.id}). ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const final = this.journal();
      final.currentId = id;
      final.returnToId = backup.id;
      delete final.pendingRestore;
      final.activationPending = true;
      this.writeJournal(final);
      return { restored: true, checkpoint: target.checkpoint, backup };
    });
  }
}
