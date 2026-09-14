import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, realpath, mkdtemp } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { RuntimeOwner, processState } from "./runtime-owner.ts";
import { boundedLines, WorkerDiagnostics, runtimeLog } from "./runtime-log.ts";
import type { Project } from "../shared/types.ts";
import { withinPath } from "./execution.ts";
import { ccoLaunchPlan } from "../scripts/start-cco.ts";
import { prepareWorkspaceData } from "./workspace-data.ts";

export interface WorkspaceWorker {
  projectId: string;
  port: number;
  token: string;
  process: ChildProcess;
  runtimePid: number;
  generation: string;
}
export class WorkspaceWorkers {
  private workers = new Map<string, Promise<WorkspaceWorker>>();
  private children = new Set<ChildProcess>();
  private closed = false;
  private monitors = new Set<() => void>();
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
  isStarted(projectId: string) {
    return this.workers.has(projectId);
  }
  async rename(project: Project) {
    const pending = this.workers.get(project.id);
    if (!pending) return;
    const worker = await pending;
    const response = await fetch(
      `http://127.0.0.1:${worker.port}/api/projects/${project.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${worker.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: project.name }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      throw new Error(((await response.json()) as { error: string }).error);
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
    const owner = new RuntimeOwner(workerData);
    let generation: string;
    try {
      generation = owner.reserve().generation;
      return await this.launch(
        project,
        cwd,
        workerData,
        owner,
        generation,
        exited,
      );
    } catch (error) {
      try {
        const record = owner.current();
        if (record?.generation === generation! && !record.runtimePid)
          owner.update(record.generation, { reservationFailed: true });
      } finally {
        owner.close();
      }
      throw error;
    }
  }
  private async launch(
    project: Project,
    cwd: string,
    workerData: string,
    owner: RuntimeOwner,
    generation: string,
    exited: () => void,
  ): Promise<WorkspaceWorker> {
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
      project.renamed,
      generation,
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
    runtimeLog(workerData, {
      event: "launch",
      generation,
      launcherPid: child.pid,
    });
    const diagnostics = new WorkerDiagnostics();
    let runtimePid: number | undefined;
    let finished = false;
    const append = (text: string) => diagnostics.append(text);
    child.stderr?.on("data", (chunk) =>
      diagnostics.append(String(chunk), true),
    );
    let monitor: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (monitor) clearInterval(monitor);
      this.monitors.delete(cleanup);
      if (!finished) {
        finished = true;
        owner.close();
      }
    };
    const checkRuntime = () => {
      if (finished || !runtimePid || processState(runtimePid) !== "dead")
        return;
      const reason = diagnostics.reason(child.exitCode, child.signalCode);
      const expected = !!owner.current()?.expectedStop;
      owner.update(generation, { reason });
      runtimeLog(workerData, {
        event: "runtime-exit",
        generation,
        pid: runtimePid,
        launcherPid: child.pid,
        code: child.exitCode,
        signal: child.signalCode,
        expected,
        reason,
      });
      if (!expected)
        console.error(
          `Margin workspace ${project.name}: ${reason}. Details: ${join(workerData, "runtime", "events.jsonl")}`,
        );
      // Keep the ownership record: a replacement must independently verify
      // runtime AND managed-command deaths, even across gateway restarts.
      exited();
      cleanup();
    };
    return await new Promise<WorkspaceWorker>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, worker?: WorkspaceWorker) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          runtimeLog(workerData, {
            event: "startup-failed",
            generation,
            launcherPid: child.pid,
            reason: "worker startup failed",
          });
          try {
            owner.update(generation, { reservationFailed: true });
          } catch {
            /* Do not turn startup failure handling into an unhandled exception. */
          }
          // The caller closes this owner on failure.
          if (monitor) clearInterval(monitor);
          this.monitors.delete(cleanup);
          finished = true;
          reject(error);
        } else {
          this.monitors.add(cleanup);
          monitor = setInterval(() => {
            try {
              checkRuntime();
            } catch {
              /* Fail closed: retain this worker. */
            }
          }, 1000);
          monitor.unref();
          resolve(worker!);
        }
      };
      const timer = setTimeout(() => {
        void this.terminate(child).finally(() =>
          finish(
            new Error(
              `cco did not finish starting for ${project.name}. ${diagnostics.tail.trim()}`,
            ),
          ),
        );
      }, 30000);
      const lines = boundedLines((line) => {
        if (!line.startsWith("MARGIN_WORKER_READY ")) {
          append(line + "\n");
          return;
        }
        if (settled) return;
        try {
          const ready = JSON.parse(line.slice("MARGIN_WORKER_READY ".length));
          if (
            !Number.isInteger(ready.port) ||
            ready.port < 1 ||
            ready.port > 65535 ||
            ready.projectId !== project.id ||
            ready.generation !== generation ||
            !Number.isSafeInteger(ready.pid) ||
            ready.pid <= 0 ||
            owner.current()?.runtimePid !== ready.pid
          )
            return;
          runtimePid = ready.pid;
          runtimeLog(workerData, {
            event: "ready",
            generation,
            pid: runtimePid,
            launcherPid: child.pid,
          });
          finish(undefined, {
            projectId: project.id,
            port: ready.port,
            token,
            process: child,
            runtimePid: ready.pid,
            generation,
          });
        } catch {
          /* Ignore malformed/plugin stdout. */
        }
      });
      child.stdout?.on("data", (chunk) => lines(String(chunk)));
      child.once("error", (e) => {
        this.children.delete(child);
        finish(
          new Error(
            `Could not start cco for ${project.name}: ${e.message}. Margin has not started an unsandboxed agent.`,
          ),
        );
      });
      child.once("exit", (code, signal) => {
        this.children.delete(child);
        const reason = diagnostics.reason(code, signal);
        runtimeLog(workerData, {
          event: "launcher-exit",
          generation,
          launcherPid: child.pid,
          pid: runtimePid,
          code,
          signal,
          expected: this.closed,
          reason,
        });
        if (!settled)
          finish(
            new Error(
              `cco exited (${code}) for ${project.name}. ${diagnostics.tail.trim()} Margin has not started an unsandboxed agent.`,
            ),
          );
        else if (!finished) {
          // Wrapper-only exit is NOT runtime death. Continue routing to the
          // same runtime and let the OS-liveness monitor observe its exit.
          try {
            checkRuntime();
          } catch {
            /* Retain ownership on uncertainty. */
          }
        }
      });
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
      try {
        child.kill(signal);
      } catch {
        /* Ownership remains held if exit cannot be verified. */
      }
    }
  }
  private async terminate(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid)
      return;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => this.kill(child, "SIGKILL"), 5000);
      const deadline = setTimeout(finish, 7500);
      function finish() {
        clearTimeout(timer);
        clearTimeout(deadline);
        child.off("exit", finish);
        done();
      }
      child.once("exit", finish);
      this.kill(child, "SIGTERM");
    });
  }
  async close() {
    this.closed = true;
    // An exited launcher may have a healthy runtime. Ask the authenticated
    // runtime to stop as well, rather than forgetting it and spawning a twin.
    await Promise.allSettled(
      [...this.workers.values()].map(async (pending) => {
        const worker = await pending;
        await fetch(`http://127.0.0.1:${worker.port}/api/worker/shutdown`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${worker.token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(5000),
        });
      }),
    );
    await Promise.all([...this.children].map((child) => this.terminate(child)));
    for (const cleanup of [...this.monitors]) cleanup();
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
  renamed = false,
  generation = "",
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
    MARGIN_RUNTIME_GENERATION: generation,
    MARGIN_WORKSPACE_ID: id,
    MARGIN_WORKSPACE_PATH: project,
    MARGIN_WORKSPACE_NAME: name,
    MARGIN_WORKSPACE_RENAMED: renamed ? "1" : "0",
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
  // Avoid tsx's extra launcher process; the ownership handshake still verifies
  // the actual runtime inside cco's native/Docker wrapper.
  const command = plan.args.indexOf("--command");
  plan.args.splice(
    command + 1,
    plan.args.length - command - 1,
    process.execPath,
    "--import",
    join(appRoot, "node_modules/tsx/dist/loader.mjs"),
    join(appRoot, "server/index.ts"),
  );
  return { ...plan, env: { ...process.env, ...fields } };
}
