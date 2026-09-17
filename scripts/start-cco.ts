import { spawn } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { withinPath } from "../server/execution.ts";
import { bundledCco, configureInstallation } from "./installation.ts";
import { parsePort } from "./launch-port.mjs";

export interface LaunchOptions {
  project: string;
  extra: string[];
  dev: boolean;
  dryRun: boolean;
  help: boolean;
  port?: number;
}
export function parseLaunchOptions(
  args: string[],
  appRoot: string,
): LaunchOptions {
  const options: LaunchOptions = {
    project: appRoot,
    extra: [],
    dev: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dev") options.dev = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--port") {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error("--port requires a value.");
      options.port = parsePort(value);
    } else if (arg === "--project" || arg === "--add-dir") {
      const path = args[++i];
      if (!path || path.startsWith("--"))
        throw new Error(`${arg} requires a folder path.`);
      if (arg === "--project") options.project = path;
      else options.extra.push(path);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export function ccoLaunchPlan(
  options: LaunchOptions,
  appRoot: string,
  dataDir: string,
  piDir: string,
  environment: NodeJS.ProcessEnv,
) {
  const writablePaths = [
    ...new Set([options.project, dataDir, piDir, ...options.extra]),
  ];
  const args: string[] = ["--backend", "native"];
  for (const path of writablePaths)
    if (!withinPath(path, options.project)) args.push(`--add-dir=${path}`);
  // Needed when cco selects Docker and the runtime source is outside the project mount.
  if (!writablePaths.some((path) => withinPath(appRoot, path)))
    args.push(`--allow-readonly=${appRoot}`);
  const launch = {
    mode: "cco" as const,
    projectRoot: options.project,
    writablePaths,
  };
  const env: Record<string, string> = {
    NODE_ENV: options.dev ? "development" : "production",
    MARGIN_DATA_DIR: dataDir,
    MARGIN_CCO_INFO: JSON.stringify(launch),
    PI_CODING_AGENT_DIR: piDir,
  };
  for (const key of ["PORT", "MARGIN_AUTH_READ_ONLY"])
    if (environment[key] !== undefined) env[key] = environment[key]!;
  if (options.port !== undefined) env.PORT = String(options.port);
  for (const [key, value] of Object.entries(env))
    args.push("--env", `${key}=${value}`);
  args.push(
    "--command",
    "node",
    join(appRoot, "node_modules/tsx/dist/cli.mjs"),
  );
  if (options.dev) args.push("watch");
  args.push(join(appRoot, "server/index.ts"));
  return { command: bundledCco(appRoot), args, cwd: options.project, launch };
}

export async function main(args = process.argv.slice(2)) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseLaunchOptions(args, appRoot);
  if (options.help) {
    console.log(
      "Usage: npm start -- [--project FOLDER] [--add-dir FOLDER] [--port PORT] [--dev] [--dry-run]\n\nRuns the whole server through cco defaults. The default project is Margin's source folder. Add more writable folders at launch; other readable folders can still be inspected. Pi state and Margin data are writable so login refresh and saved chats work.",
    );
    return;
  }
  const expand = (path: string) =>
    resolve(path.replace(/^~(?=\/|$)/, homedir()));
  options.project = await realpath(expand(options.project));
  options.extra = await Promise.all(
    options.extra.map(async (path) => realpath(expand(path))),
  );
  for (const path of [options.project, ...options.extra])
    if (!(await stat(path)).isDirectory())
      throw new Error(`Not a folder: ${path}`);
  const { dataDir, piDir } = configureInstallation(appRoot);
  const plan = ccoLaunchPlan(options, appRoot, dataDir, piDir, process.env);
  if (options.dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  await mkdir(dataDir, { recursive: true });
  await mkdir(piDir, { recursive: true });
  console.log(`Starting Margin through cco. Project: ${options.project}`);
  console.log(
    `Writable application paths: ${plan.launch.writablePaths.join(", ")}`,
  );
  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    stdio: "inherit",
    env: process.env,
  });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const interrupt = () => forward("SIGINT"),
    terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  await new Promise<void>((done) => {
    child.once("error", (error) => {
      console.error(
        `Could not start bundled cco: ${error.message}. Check the release files and run this command in your normal terminal.`,
      );
      process.exitCode = 1;
      done();
    });
    child.once("exit", (code, signal) => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
      if (code && code !== 0)
        console.error(
          "cco did not start or exited with an error. Margin has not fallen back to native execution. If sandbox_apply was denied, launch from your normal terminal.",
        );
      done();
    });
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
