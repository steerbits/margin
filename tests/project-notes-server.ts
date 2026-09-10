import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// Build fixtures in a disposable copy, not in the running app's dist/. Serving
// the production bundle also avoids sharing Vite's HMR port with a live app.
const source = resolve(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "margin-notes-e2e-app-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
for (const path of [
  "src",
  "server",
  "shared",
  "plugins",
  "skills",
  "tests/plugins",
  "index.html",
  "package.json",
  "vite.config.ts",
])
  cpSync(join(source, path), join(root, path), { recursive: true });
symlinkSync(join(source, "node_modules"), join(root, "node_modules"), "dir");
process.env.MARGIN_TEST_MODE = "1";
process.env.MARGIN_DATA_DIR = join(root, "data");
process.env.NODE_ENV = "production";
execFileSync(
  process.execPath,
  [join(root, "node_modules/vite/bin/vite.js"), "build"],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  },
);
await import(pathToFileURL(join(root, "server/index.ts")).href);
