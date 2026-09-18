import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { releaseSuites } from "./release-suites.ts";

// Build/test the current tracked working files, not HEAD; never rebuild the live
// app's dist or use its credentials/data. Keep the report and failed fixture.
const source = resolve(import.meta.dirname, "..");
const parent = join(source, ".margin-data/temporary/release-tests");
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, "run-"));
const app = join(root, "app");
mkdirSync(app);
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: source, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
for (const path of new Set(files)) {
  if (
    /^(?:\.margin-data|node_modules|dist|workspaces|\.git)(?:\/|$)/.test(
      path,
    ) ||
    /(^|\/)\.env(?:\.|$)/.test(path)
  )
    continue;
  try {
    cpSync(join(source, path), join(app, path), { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
symlinkSync(join(source, "node_modules"), join(app, "node_modules"), "dir");
execFileSync("git", ["init", "-q"], { cwd: app });
execFileSync("git", ["add", "."], { cwd: app });
execFileSync(
  "git",
  [
    "-c",
    "user.name=Release fixture",
    "-c",
    "user.email=fixture@invalid",
    "commit",
    "-qm",
    "Release candidate fixture",
  ],
  { cwd: app },
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("MARGIN_") && !key.startsWith("PI_") && key !== "PORT",
  ),
);
env.PI_CODING_AGENT_DIR = join(root, "private-pi");
env.MARGIN_DATA_DIR = join(app, ".margin-data");
mkdirSync(env.PI_CODING_AGENT_DIR, { recursive: true });
const results: { name: string; status: string; exitCode: number | null }[] = [];
console.log(`Release battery isolated in ${root}`);
for (const suite of releaseSuites) {
  console.log(`\n=== ${suite.name} ===`);
  const result = spawnSync(suite.command, suite.args, {
    cwd: app,
    env,
    stdio: "inherit",
  });
  results.push({
    name: suite.name,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
  });
  writeFileSync(
    join(root, "results.json"),
    JSON.stringify(
      {
        results,
        notRun: releaseSuites.slice(results.length).map((s) => s.name),
        manual: [
          "Real macOS sandbox enforcement (npm run test:sandbox from a normal Terminal)",
          "Live provider inference",
          "Human release-note/image review",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
console.log(`\nRelease results: ${join(root, "results.json")}`);
console.log(
  "OS sandbox, real provider inference, and human release-note review are separate manual checks.",
);
