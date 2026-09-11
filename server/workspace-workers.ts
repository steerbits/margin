import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, realpath, mkdtemp } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { Project } from "../shared/types.ts";
import { withinPath } from "./execution.ts";
import { ccoLaunchPlan } from "../scripts/start-cco.ts";
import { prepareWorkspaceData } from "./workspace-data.ts";

export interface WorkspaceWorker {
  projectId: string;
  port: number;
  token: string;
  process: ChildProcess;
}
export class WorkspaceWorkers {
  private workers = new Map<string, Promise<WorkspaceWorker>>();
  private children = new Set<ChildProcess>();
  private closed = false;
  constructor(
    private appRoot: string,
    private dataDir: string,
  ) {}

  get(project: Project): Promise<WorkspaceWorker> {
    if (this.closed)
      return Promise.reject(new Error("Margin is shutting down."));
    const existing = this.workers.get(project.id);
    if (existing) return existing;
    const pending = this.start(project, () => {
      if (this.workers.get(project.id) === pending)
        this.workers.delete(project.id);
    });
    this.workers.set(project.id, pending);
    void pending.catch(() => {
      if (this.workers.get(project.id) === pending)
        this.workers.delete(project.id);
    });
    return pending;
  }
  private async start(
    project: Project,
    exited: () => void,
  ): Promise<WorkspaceWorker> {
    const cwd = await realpath(project.path);
    if (cwd !== project.path)
      throw new Error(
        "Workspace path changed. Reopen the folder before starting it.",
      );
    const workerData = prepareWorkspaceData(
      this.dataDir,
      this.appRoot,
      project,
    );
    const piDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi");
    await mkdir(piDir, { recursive: true });
    const token = randomBytes(32).toString("hex");
    const launchParent = join(this.dataDir, "launcher-runs");
    await mkdir(launchParent, { recursive: true });
    if ((await realpath(launchParent)) !== launchParent)
      throw new Error("Launcher directory became a symbolic link.");
    const launchDir = await mkdtemp(join(launchParent, "run-"));
    const plan = workspaceWorkerPlan(
      this.appRoot,
      workerData,
      piDir,
      cwd,
      launchDir,
      token,
      project.id,
      project.name,
    );
    if (
      process.env.MARGIN_TEST_MODE === "1" &&
      process.env.MARGIN_DISPOSABLE_TEST_APP === "1"
    ) {
      plan.args.unshift(
        "--env",
        "MARGIN_TEST_MODE=1",
        "--env",
        "MARGIN_DISPOSABLE_TEST_APP=1",
      );
    }
    // Browser capabilities are never part of child arguments or environment.
    if (this.closed) throw new Error("Margin is shutting down.");
    const child = spawn(plan.command, plan.args, {
      cwd: launchDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: plan.env,
    });
    this.children.add(child);
    let diagnostics = "";
    const append = (text: string) => {
      diagnostics = (diagnostics + text).slice(-4000);
    };
    child.stderr?.on("data", (chunk) => append(String(chunk)));
    child.once("exit", () => {
      this.children.delete(child);
      exited();
    });
    child.once("error", () => this.children.delete(child));
    return await new Promise<WorkspaceWorker>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, worker?: WorkspaceWorker) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Keep consuming stdout after readiness so plugin logging cannot block.
        if (error) reject(error);
        else resolve(worker!);
      };
      const lines = createInterface({ input: child.stdout! });
      const timer = setTimeout(() => {
        void this.terminate(child).then(() =>
          finish(
            new Error(
              `cco did not finish starting for ${project.name}. ${diagnostics.trim()}`,
            ),
          ),
        );
      }, 30000);
      lines.on("line", (line) => {
        if (!line.startsWith("MARGIN_WORKER_READY ")) {
          append(line + "\n");
          return;
        }
        try {
          const ready = JSON.parse(line.slice("MARGIN_WORKER_READY ".length));
          if (
            !Number.isInteger(ready.port) ||
            ready.port < 1 ||
            ready.port > 65535 ||
            ready.projectId !== project.id
          )
            return;
          finish(undefined, {
            projectId: project.id,
            port: ready.port,
            token,
            process: child,
          });
        } catch {
          /* Ignore unrelated tool/plugin stdout. */
        }
      });
      child.once("error", (e) =>
        finish(
          new Error(
            `Could not start cco for ${project.name}: ${e.message}. Margin has not started an unsandboxed agent.`,
          ),
        ),
      );
      child.once("exit", (code) =>
        finish(
          new Error(
            `cco exited (${code}) for ${project.name}. ${diagnostics.trim()} Margin has not started an unsandboxed agent.`,
          ),
        ),
      );
    });
  }
  async requireIdle() {
    for (const pending of this.workers.values()) {
      const worker = await pending;
      const response = await fetch(
        `http://127.0.0.1:${worker.port}/api/worker/status`,
        {
          headers: { Authorization: `Bearer ${worker.token}` },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok || ((await response.json()) as { busy: boolean }).busy)
        throw new Error(
          "Finish or stop active agent work in all workspaces before changing Margin's code or plugins.",
        );
    }
  }
  private kill(child: ChildProcess, signal: NodeJS.Signals) {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }
  private async terminate(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid)
      return;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => this.kill(child, "SIGKILL"), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
      this.kill(child, "SIGTERM");
    });
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.children].map((child) => this.terminate(child)));
    await Promise.allSettled([...this.workers.values()]);
  }
}

// Resolve Git metadata as data, without running project-controlled Git helpers
// in the privileged launcher. Match cco's normal linked-worktree write grant.
function gitMetadata(project: string): string[] {
  for (let path = project; ; path = dirname(path)) {
    const dot = join(path, ".git");
    if (existsSync(dot)) {
      let git = dot;
      if (!statSync(dot).isDirectory()) {
        const match = /^gitdir: (.+)\s*$/.exec(
          readFileSync(dot, "utf8").trim(),
        );
        if (!match) return [];
        git = resolve(path, match[1]);
      }
      try {
        git = realpathSync(git);
        const commonFile = join(git, "commondir");
        const common = realpathSync(
          existsSync(commonFile)
            ? resolve(git, readFileSync(commonFile, "utf8").trim())
            : git,
        );
        const head = readFileSync(join(git, "HEAD"), "utf8").trim();
        if (
          !/^(ref: refs\/[^\s]+|[a-f0-9]{40}|[a-f0-9]{64})$/.test(head) ||
          !statSync(join(common, "objects")).isDirectory() ||
          !statSync(join(common, "refs")).isDirectory()
        )
          return [];
        // cco accepts normal metadata and linked worktrees beneath common/worktrees.
        if (git !== common && !withinPath(git, join(common, "worktrees")))
          return [];
        return [common];
      } catch {
        return [];
      }
    }
    if (dirname(path) === path) return [];
  }
}
export function workspaceWorkerPlan(
  appRoot: string,
  dataDir: string,
  piDir: string,
  project: string,
  launchDir: string,
  token: string,
  id: string,
  name: string,
) {
  const gitDirs = gitMetadata(project);
  const plan = ccoLaunchPlan(
    {
      project: launchDir,
      extra: [project, ...gitDirs],
      dev: false,
      dryRun: false,
      help: false,
    },
    appRoot,
    dataDir,
    piDir,
    { ...process.env, PORT: "0" },
  );
  const fields = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    BASH_ENV: "",
    ENV: "",
    NODE_OPTIONS: "",
    NODE_PATH: "",
    LD_PRELOAD: "",
    LD_LIBRARY_PATH: "",
    DYLD_INSERT_LIBRARIES: "",
    DYLD_LIBRARY_PATH: "",
    GIT_CEILING_DIRECTORIES: dirname(launchDir),
    MARGIN_WORKER_TOKEN: token,
    MARGIN_WORKSPACE_ID: id,
    MARGIN_WORKSPACE_PATH: project,
    MARGIN_WORKSPACE_NAME: name,
    MARGIN_CCO_INFO: JSON.stringify({
      mode: "cco",
      projectRoot: project,
      writablePaths: [project, dataDir, piDir, launchDir, ...gitDirs],
    }),
    MARGIN_DATA_DIR: dataDir,
    PORT: "0",
    NODE_ENV: "production",
  };
  // Overrides go after ccoLaunchPlan's envs and before the command separator.
  const at = plan.args.indexOf("--command");
  plan.args.splice(
    at,
    0,
    ...Object.entries(fields).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
  );
  plan.args[plan.args.indexOf("--command") + 1] = process.execPath;
  return { ...plan, env: { ...process.env, ...fields } };
}
