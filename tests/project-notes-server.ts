import {
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// Build fixtures in a disposable copy, not in the running app's dist/. Serving
// the production bundle also avoids sharing Vite's HMR port with a live app.
const source = resolve(import.meta.dirname, "..");
const root = realpathSync(mkdtempSync(join(tmpdir(), "margin-notes-e2e-app-")));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
for (const path of [
  "src",
  "server",
  "shared",
  "plugins",
  "skills",
  "scripts",
  "tests/plugins",
  "index.html",
  "package.json",
  "vite.config.ts",
  ".gitignore",
  "margin.plugins.json",
])
  cpSync(join(source, path), join(root, path), { recursive: true });
symlinkSync(join(source, "node_modules"), join(root, "node_modules"), "dir");
execFileSync("git", ["init", "-q", root]);
process.env.MARGIN_TEST_MODE = "1";
process.env.MARGIN_DISPOSABLE_TEST_APP = "1";
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
if (process.env.MARGIN_GATEWAY_TEST === "1") {
  // This shim tests process/HTTP routing only. It does NOT apply an OS sandbox.
  const bin = join(root, "test-bin");
  mkdirSync(bin);
  const fake = join(bin, "cco");
  writeFileSync(
    fake,
    `#!/bin/bash
set -e
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) export "$2"; shift 2;;
    --add-dir=*|--allow-readonly=*) shift;;
    --command) shift; exec "$@";;
    *) exit 97;;
  esac
done
`,
  );
  chmodSync(fake, 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.MARGIN_WORKSPACE_PARENT = join(root, "external-projects");
  const originalLog = console.log;
  console.log = (...args) => {
    const link = String(args[0]).match(
      /http:\/\/127\.0\.0\.1:4329\/#connect=([a-f0-9]+)/,
    );
    if (link)
      writeFileSync(
        join(source, ".margin-data/gateway-test-link.json"),
        JSON.stringify({ url: link[0], root }),
      );
    originalLog(...args);
  };
  await import(pathToFileURL(join(root, "server/gateway.ts")).href);
} else await import(pathToFileURL(join(root, "server/index.ts")).href);
