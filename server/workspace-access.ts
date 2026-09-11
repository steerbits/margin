import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ExecutionInfo } from "../shared/types.ts";
import type { WorkspaceFolders } from "../shared/workspaces.ts";
import { withinPath } from "./execution.ts";
import { createWorkspace } from "./workspaces.ts";

// Match canonical folders against the launch grants. cco still enforces the
// OS policy; this prevents offering projects the running server cannot edit.
export class WorkspaceAccess {
  private grants: string[];
  readonly root: string;
  readonly workspaceParent: string;
  private locations: string[];
  constructor(
    private execution: ExecutionInfo,
    private appRoot: string,
    dataDir: string,
    piDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi"),
  ) {
    const canonical = (path: string) => {
      try {
        return realpathSync(path);
      } catch {
        return null;
      }
    };
    this.grants =
      execution.mode === "cco"
        ? execution.writablePaths.map(canonical).filter((p): p is string => !!p)
        : [];
    this.root = realpathSync(
      execution.mode === "cco" ? execution.projectRoot : appRoot,
    );
    this.workspaceParent = join(this.root, "workspaces");
    // Automatic state grants are not useful starting locations for projects.
    // They remain accessible when navigating an allowed project folder.
    const state = new Set([canonical(dataDir), canonical(piDir)]);
    this.locations = [
      ...new Set([this.root, ...this.grants.filter((p) => !state.has(p))]),
    ].filter(
      (p, _, all) => !all.some((other) => other !== p && withinPath(p, other)),
    );
  }
  requireDirectory(path: string): string {
    const canonical = realpathSync(path);
    if (!statSync(canonical).isDirectory()) throw new Error("Choose a folder.");
    if (
      this.execution.mode === "cco" &&
      !this.grants.some((root) => withinPath(canonical, root))
    )
      throw new Error(
        "This folder is not writable in this server session. Choose a folder from the workspace picker.",
      );
    accessSync(canonical, constants.W_OK | constants.X_OK);
    return canonical;
  }
  canOpen(path: string): boolean {
    try {
      this.requireDirectory(path);
      return true;
    } catch {
      return false;
    }
  }
  private folder(path: string) {
    return {
      path,
      name:
        path === realpathSync(this.appRoot) ? "Margin" : basename(path) || path,
    };
  }
  async browse(
    path = this.root,
    showHidden = false,
  ): Promise<WorkspaceFolders> {
    const current = this.requireDirectory(path);
    const folders = (await readdir(current, { withFileTypes: true }))
      .filter(
        (e) =>
          (e.isDirectory() || e.isSymbolicLink()) &&
          (showHidden || !e.name.startsWith(".")),
      )
      .flatMap((e) => {
        const child = join(current, e.name);
        return this.canOpen(child) ? [{ name: e.name, path: child }] : [];
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    const parent = dirname(current);
    return {
      roots: this.locations
        .filter((p) => this.canOpen(p))
        .map((p) => this.folder(p)),
      current: this.folder(current),
      parent: parent !== current && this.canOpen(parent) ? parent : null,
      folders,
      workspaceParent: this.workspaceParent,
    };
  }
  async create(name: string) {
    // Check before mkdir as well as after it: an existing symlink must never
    // redirect new workspaces outside the allowed locations.
    this.requireDirectory(this.root);
    try {
      this.requireDirectory(this.workspaceParent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await mkdir(this.workspaceParent);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    return createWorkspace(this.requireDirectory(this.workspaceParent), name);
  }
}
