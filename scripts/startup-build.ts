import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { validVersion } from "../shared/updates.ts";

function buildProblem(root: string): string | undefined {
  const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!validVersion(source.version))
    throw new Error(
      "package.json must have a stable x.y.z version before starting Margin.",
    );
  try {
    const build = JSON.parse(
      readFileSync(join(root, "dist/margin-build.json"), "utf8"),
    );
    if (!validVersion(build.version))
      return "build version is missing or invalid";
    if (build.version !== source.version)
      return `source is v${source.version}, build is v${build.version}`;
    if (statSync(join(root, "dist/index.html")).isFile()) return;
  } catch {
    // A missing or damaged build is repaired by the same production build.
  }
  return "production build is missing or incomplete";
}

/** Call only after claiming this checkout's launcher ownership. */
export async function ensureStartupBuild(root: string): Promise<void> {
  const marker = join(root, ".margin-data/startup-build-pending");
  const problem =
    buildProblem(root) ??
    (existsSync(marker)
      ? "the previous startup build did not finish"
      : undefined);
  if (!problem) return;
  console.log(`Building Margin before startup (${problem})…`);
  mkdirSync(join(root, ".margin-data"), { recursive: true });
  // Keep this marker after failure/interruption, even if Vite already emitted
  // matching metadata. The next start must retry the whole build.
  writeFileSync(marker, "Build must finish before startup.\n", { mode: 0o600 });
  await new Promise<void>((done, reject) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: root,
      stdio: "inherit",
      detached: true,
    });
    let interrupted = false;
    const forward = (signal: NodeJS.Signals) => {
      interrupted = true;
      // npm launches compiler/bundler children; stop the entire build group.
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      }
    };
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => {
      cleanup();
      reject(
        new Error(
          `Could not run the startup build: ${error.message}. Margin was not started.`,
        ),
      );
    });
    child.once("exit", (code) => {
      cleanup();
      if (code === 0 && !interrupted) done();
      else
        reject(
          new Error(
            "Startup build failed or was interrupted. Margin was not started. Fix the build error above and start again.",
          ),
        );
    });
  });
  const remaining = buildProblem(root);
  if (remaining)
    throw new Error(
      `Startup build did not produce a matching app (${remaining}). Margin was not started.`,
    );
  rmSync(marker);
}
