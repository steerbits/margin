import {
  copyFileSync,
  cpSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  realpathSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Project, SessionInfo } from "../shared/types.ts";
import { Store } from "./store.ts";

export function workspaceDataDir(
  dataDir: string,
  appRoot: string,
  project: Project,
) {
  return resolve(project.path) === resolve(appRoot)
    ? dataDir
    : join(dataDir, "workspace-data", project.id);
}

// One-way copy on first use. The original database and session files stay intact.
// Each worker subsequently owns its workspace's database and native session files.
export function prepareWorkspaceData(
  dataDir: string,
  appRoot: string,
  project: Project,
) {
  const targetDir = workspaceDataDir(dataDir, appRoot, project);
  if (targetDir === dataDir) return targetDir;
  const control = new Store(join(dataDir, "margin.sqlite"));
  const previous = control.get<{ ready?: boolean; prepared?: string }>(
    "workspace-storage",
    project.id,
  );
  if (previous?.ready || (previous?.prepared && existsSync(targetDir))) {
    try {
      assertDataPath(targetDir, join(targetDir, "margin.sqlite"));
      control.put("workspace-storage", project.id, { ready: true });
      return targetDir;
    } finally {
      control.close();
    }
  }
  if (existsSync(targetDir)) {
    control.close();
    throw new Error(
      "Existing workspace data needs recovery; it has not been overwritten.",
    );
  }
  const staging = mkdtempSync(join(dataDir, "workspace-import-"));
  const target = new Store(join(staging, "margin.sqlite"));
  try {
    const source = new Store(join(dataDir, "margin.sqlite"));
    try {
      const sessions = source
        .sessions()
        .filter((s) => s.projectId === project.id);
      const ids = new Set(sessions.map((s) => s.id));
      // Keep uploaded originals available in the worker's allowed data directory.
      const oldAttachments = join(realpathSync(dataDir), "attachments");
      const newAttachments = join(targetDir, "attachments");
      const relocate = (value: unknown): unknown => {
        if (typeof value === "string")
          return value
            .replaceAll(`${oldAttachments}/`, `${newAttachments}/`)
            .replaceAll(
              JSON.stringify(`${oldAttachments}/`).slice(1, -1),
              JSON.stringify(`${newAttachments}/`).slice(1, -1),
            );
        if (Array.isArray(value)) return value.map(relocate);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, relocate(item)]),
          );
        return value;
      };
      for (const id of ids) {
        const uploaded = join(oldAttachments, id);
        if (existsSync(uploaded)) {
          assertDataPath(dataDir, uploaded);
          // AttachmentStore validates individual file paths before later reads.
          cpSync(uploaded, join(staging, "attachments", id), {
            recursive: true,
            dereference: false,
          });
        }
      }
      const rows = source.db
        .prepare("SELECT kind, id, value FROM records")
        .all() as { kind: string; id: string; value: string }[];
      target.db.exec("BEGIN IMMEDIATE");
      try {
        target.put("project", project.id, project);
        for (const row of rows) {
          const isSessionData =
            row.kind !== "project" &&
            !row.kind.startsWith("plugin:") &&
            ids.has(row.id);
          const isPluginData =
            row.kind.startsWith("plugin:") &&
            row.kind.endsWith(`:${project.id}`);
          if (!isSessionData && !isPluginData) continue;
          let value = relocate(JSON.parse(row.value));
          if (row.kind === "session") {
            const info = value as SessionInfo;
            if (info.sessionFile) {
              const destination = join(
                staging,
                "pi-sessions",
                project.id,
                basename(info.sessionFile),
              );
              mkdirSync(join(staging, "pi-sessions", project.id), {
                recursive: true,
              });
              if (existsSync(info.sessionFile)) {
                if (existsSync(join(oldAttachments, info.id))) {
                  const lines = readFileSync(info.sessionFile, "utf8")
                    .trimEnd()
                    .split("\n");
                  writeFileSync(
                    destination,
                    lines
                      .map((line) => JSON.stringify(relocate(JSON.parse(line))))
                      .join("\n") + "\n",
                    { mode: 0o600 },
                  );
                } else copyFileSync(info.sessionFile, destination);
              }
              // If the source is missing, the existing pi-backup record can restore it.
              info.sessionFile = join(
                targetDir,
                "pi-sessions",
                project.id,
                basename(destination),
              );
            }
          }
          target.put(row.kind, row.id, value);
        }
        for (const id of ids) {
          const batches = source.db
            .prepare("SELECT id, status FROM batches WHERE session_id=?")
            .all(id) as { id: string; status: string }[];
          for (const batch of batches)
            target.markBatch(id, batch.id, batch.status);
        }
        const modelFile = join(dataDir, "models-store.json");
        if (existsSync(modelFile))
          copyFileSync(modelFile, join(staging, "models-store.json"));
        target.put("migration", "workspace-v1", {
          projectId: project.id,
          copiedAt: Date.now(),
        });
        target.db.exec("COMMIT");
      } catch (error) {
        target.db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      source.close();
    }
  } finally {
    target.close();
    control.close();
  }
  const publication = new Store(join(dataDir, "margin.sqlite"));
  try {
    mkdirSync(join(dataDir, "workspace-data"), { recursive: true });
    assertDataPath(dataDir, join(dataDir, "workspace-data"));
    publication.put("workspace-storage", project.id, { prepared: staging });
    renameSync(staging, targetDir);
    publication.put("workspace-storage", project.id, { ready: true });
  } finally {
    publication.close();
  }
  return targetDir;
}

export function assertDataPath(root: string, path: string) {
  // Both paths are absolute and canonical at registration. Never follow a
  // replacement symlink while the privileged launcher reads worker storage.
  if (
    realpathSync(root) !== resolve(root) ||
    realpathSync(path) !== resolve(path)
  )
    throw new Error(
      "Workspace data moved or became a symbolic link. It has not been modified.",
    );
}
