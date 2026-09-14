import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import type { RuntimeOwner } from "./runtime-owner.ts";

export function managedShell(
  owner?: { storage: RuntimeOwner; generation: string },
  shellPath?: string,
): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout, env }) {
      if (signal?.aborted) throw new Error("aborted");
      if (
        timeout !== undefined &&
        (!Number.isFinite(timeout) ||
          timeout <= 0 ||
          timeout * 1000 > 2_147_483_647)
      )
        throw new Error("Invalid command timeout.");
      owner?.storage.assert(owner.generation);
      const shell =
        shellPath ?? (existsSync("/bin/bash") ? "/bin/bash" : "bash");
      const guardian = spawn(
        process.execPath,
        [fileURLToPath(new URL("./shell-supervisor.mjs", import.meta.url))],
        {
          cwd,
          env,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      let timedOut = false;
      let registered = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const kill = (child: ChildProcess) => {
        // The guardian handles SIGTERM by killing its own process group; IPC
        // disconnection supplies the same guarantee on SDK OOM/SIGKILL.
        child.kill("SIGTERM");
      };
      const abort = () => kill(guardian);
      try {
        return await new Promise<{ exitCode: number | null }>(
          (resolve, reject) => {
            let result: { code?: number | null; error?: string } | undefined;
            let settled = false,
              releaseRequested = false;
            let drainTimer: ReturnType<typeof setTimeout> | undefined;
            const releaseAfterIdle = () => {
              if (drainTimer) clearTimeout(drainTimer);
              drainTimer = setTimeout(() => {
                if (settled || releaseRequested) return;
                releaseRequested = true;
                guardian.send({ release: true }, (error) => {
                  if (error) {
                    kill(guardian);
                    finish(error);
                  }
                });
              }, 100);
            };
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              if (drainTimer) clearTimeout(drainTimer);
              guardian.stdout?.destroy();
              guardian.stderr?.destroy();
              if (error) reject(error);
              else if (signal?.aborted) reject(new Error("aborted"));
              else if (timedOut) reject(new Error(`timeout:${timeout}`));
              else if (!releaseRequested)
                reject(
                  new Error(
                    "Managed shell was interrupted before its output settled.",
                  ),
                );
              else if (!result || result.error)
                reject(
                  new Error(result?.error ?? "Managed shell was interrupted."),
                );
              else resolve({ exitCode: result.code ?? null });
            };
            const output = (data: Buffer) => {
              onData(data);
              if (result && !releaseRequested) releaseAfterIdle();
            };
            guardian.stdout?.on("data", output);
            guardian.stderr?.on("data", output);
            guardian.on("message", (message) => {
              result = message as typeof result;
              // Match Pi's post-exit output grace without abandoning the
              // guardian while descendants are still producing tool output.
              releaseAfterIdle();
            });
            guardian.once("error", (error) => finish(error));
            guardian.once("exit", () => {
              try {
                if (registered)
                  owner?.storage.guardian(
                    owner.generation,
                    guardian.pid!,
                    false,
                  );
              } catch (error) {
                finish(error as Error);
                return;
              }
              finish();
            });
            guardian.once("spawn", () => {
              try {
                // Persist before sending the command; an unrecorded guardian has
                // no permission/input to execute anything if the host dies here.
                if (owner)
                  owner.storage.guardian(owner.generation, guardian.pid!, true);
                registered = true;
                if (signal?.aborted) {
                  abort();
                  return;
                }
                guardian.send(
                  { command, cwd, env: env ?? process.env, shell },
                  (error) => {
                    if (error) {
                      kill(guardian);
                      finish(error);
                    }
                  },
                );
              } catch (error) {
                kill(guardian);
                finish(error as Error);
              }
            });
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
            if (timeout !== undefined)
              timer = setTimeout(() => {
                timedOut = true;
                abort();
              }, timeout * 1000);
          },
        );
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
