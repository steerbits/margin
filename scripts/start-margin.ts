import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { parseLaunchOptions } from "./start-cco.ts";
import { configureInstallation } from "./installation.ts";
import { claimLauncher } from "./launcher-owner.ts";
import { DEFAULT_PORT, selectPort } from "./launch-port.mjs";
import { ensureStartupBuild } from "./startup-build.ts";

async function checkSandbox(appRoot: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        resolve(appRoot, "node_modules/tsx/dist/loader.mjs"),
        resolve(appRoot, "scripts/check-cco.ts"),
      ],
      { stdio: "inherit" },
    );
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (code === 0) done();
      else {
        process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
        reject(
          new Error(
            "Sandbox verification failed. Margin was not started; run from a normal Terminal.",
          ),
        );
      }
    });
  });
}

export async function main(
  args = process.argv.slice(2),
  verifySandbox = false,
) {
  let owner: ReturnType<typeof claimLauncher> | undefined;
  try {
    const appRoot = await realpath(
      resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    );
    const options = parseLaunchOptions(args, appRoot);
    if (options.help) {
      console.log(
        "Usage: bash start.sh [--port PORT] [--project FOLDER] [--add-dir FOLDER] [--dev] [--dry-run]\n       npm start -- [same options]\n\nOpens Margin's local launcher. Choose any writable folder in the browser; each workspace gets its own cco worker. --project selects an initial workspace; --add-dir pre-registers more workspaces. New workspace opens the macOS folder dialog, including New Folder. MARGIN_WORKSPACE_PARENT can set its initial location.\n\n--port overrides PORT, then the saved installation port (default: 4317), for this launch only. If occupied, check up to 10 higher ports and ask before switching. Without a terminal, exit with an explicit --port command. Only one launcher may run per checkout, regardless of port or data directory.",
      );
      return;
    }
    if (options.dryRun) {
      console.log(
        JSON.stringify(
          {
            launcher: "server/gateway.ts",
            sandbox: "one cco worker per workspace",
            initialWorkspace: options.project,
            portOverride: options.port,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (process.env.MARGIN_CCO_INFO || process.env.MARGIN_WORKER_TOKEN)
      throw new Error(
        "Start the Margin launcher from a normal Terminal, outside an existing Margin worker.",
      );
    // Take ownership before probing ports, checking the sandbox or rebuilding.
    // Another start from this checkout must never be offered a different port.
    owner = claimLauncher(appRoot);
    if (options.port !== undefined) process.env.PORT = String(options.port);
    const installation = configureInstallation(appRoot);
    const port = await selectPort(process.env.PORT ?? DEFAULT_PORT);
    process.env.PORT = String(port);
    if (verifySandbox) await checkSandbox(appRoot);
    if (!options.dev) await ensureStartupBuild(appRoot);
    console.log(`Private Pi configuration: ${installation.piDir}`);
    console.log(`Bundled cco: ${installation.cco}`);
    process.env.NODE_ENV = options.dev ? "development" : "production";
    process.env.MARGIN_INITIAL_PROJECTS = JSON.stringify(
      await Promise.all(
        [options.project, ...options.extra].map((p) =>
          realpath(resolve(p.replace(/^~(?=\/|$)/, homedir()))),
        ),
      ),
    );
    await import("../server/gateway.ts");
    try {
      owner.listening(port);
    } catch (error) {
      // The server is already live. Keep its PID claim even if publishing the
      // URL fails; releasing ownership here would permit a duplicate launcher.
      console.error(
        `Margin started, but could not record its ownership URL: ${String(error)}`,
      );
    }
  } catch (error) {
    owner?.release();
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode ||= 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
