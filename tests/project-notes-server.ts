import {
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// Build fixtures in a disposable copy, not in the running app's dist/. Serving
// the production bundle also avoids sharing Vite's HMR port with a live app.
// Test hosts launched from a Margin agent must not inherit the real worker identity.
for (const key of [
  "MARGIN_WORKER_TOKEN",
  "MARGIN_RUNTIME_GENERATION",
  "MARGIN_WORKSPACE_ID",
  "MARGIN_WORKSPACE_PATH",
  "MARGIN_WORKSPACE_NAME",
  "MARGIN_WORKSPACE_RENAMED",
  "MARGIN_CCO_INFO",
  "MARGIN_INITIAL_PROJECTS",
])
  delete process.env[key];
const source = resolve(import.meta.dirname, "..");
const temporary = join(source, ".margin-data/temporary/browser-tests");
mkdirSync(temporary, { recursive: true });
const root = realpathSync(mkdtempSync(join(temporary, "app-")));
// Browser fixtures need a model catalog, never the developer's real login.
process.env.PI_CODING_AGENT_DIR = join(root, "fixture-pi");
mkdirSync(process.env.PI_CODING_AGENT_DIR);
writeFileSync(
  join(process.env.PI_CODING_AGENT_DIR, "auth.json"),
  JSON.stringify({
    openai: { type: "api_key", key: "unused-browser-fixture-key" },
    "openai-codex": {
      type: "oauth",
      access: "unused-browser-fixture-token",
      refresh: "unused-browser-fixture-token",
      expires: Date.now() + 3_600_000,
    },
  }),
  { mode: 0o600 },
);
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
// Two real disposable builds exercise version discovery without a public release.
if (process.env.MARGIN_TEST_INSTALLED_VERSION) {
  const { validVersion, parseReleaseManifest } = await import("../shared/updates.ts");
  const version = process.env.MARGIN_TEST_INSTALLED_VERSION;
  if (!validVersion(version)) throw new Error("Invalid disposable build version");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pkg.version = version;
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  const manifest = parseReleaseManifest({ schemaVersion: 1, lastHighlightedVersion: "1.1.0",
    latest: { version: "1.1.0", tag: "v1.1.0", commit: "a".repeat(40), highlighted: true,
      security: false, publishedAt: "2026-09-18T00:00:00Z", tests: { status: "passed" } } });
  mkdirSync(join(root, "data/updates"), { recursive: true });
  writeFileSync(join(root, "data/updates/cache.json"), JSON.stringify({ manifest,
    checkedAt: Date.now(), attemptedAt: Date.now(), nextCheck: Date.now() + 3600000 }));
}
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
    --backend) shift 2;;
    --env) export "$2"; shift 2;;
    --add-dir=*|--allow-readonly=*) shift;;
    --command) shift; exec "$@";;
    *) exit 97;;
  esac
done
`,
  );
  chmodSync(fake, 0o755);
  mkdirSync(join(root, "vendor", "cco"), { recursive: true });
  symlinkSync(fake, join(root, "vendor", "cco", "cco"));
  process.env.PATH = `${bin}:${process.env.PATH}`;
  const externalParent = realpathSync(mkdtempSync(join(temporary, "external-projects-")));
  process.env.MARGIN_WORKSPACE_PARENT = externalParent;
  process.on("exit", () => rmSync(externalParent, { recursive: true, force: true }));
  const originalLog = console.log;
  console.log = (...args) => {
    const link = String(args[0]).match(
      /http:\/\/127\.0\.0\.1:\d+\/#connect=([a-f0-9]+)/,
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
