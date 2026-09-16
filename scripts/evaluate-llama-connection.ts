// Live, opt-in evaluation of the finished UI and native Margin host.
// Usage: npx tsx scripts/evaluate-llama-connection.ts /absolute/path/to/model.gguf
// Starts only owned temporary processes and stops them in finally.
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, cp, symlink, rm, writeFile } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import type { CustomConnectionView } from "../shared/custom-connections.ts";
import type { Snapshot } from "../shared/types.ts";

const modelFile = process.argv[2];
if (!modelFile) throw new Error("Pass an existing local GGUF model path.");
const root = resolve(".");
const output = join(root, ".margin-data/ai-connections-review");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "margin-llama-live-"));
const data = join(temporary, "data");
const workspace = join(temporary, "workspace");
const appCopy = join(temporary, "app");
await mkdir(join(data, "pi"), { recursive: true });
await mkdir(workspace);
await mkdir(appCopy);
// Serve a normal production copy: this worktree lives under .margin-data,
// whose hidden path Express intentionally excludes from absolute sendFile().
for (const name of [
  "server",
  "shared",
  "plugins",
  "skills",
  "scripts",
  "dist",
  "package.json",
  "margin.plugins.json",
  ".gitignore",
])
  await cp(join(root, name), join(appCopy, name), { recursive: true });
await symlink(join(root, "node_modules"), join(appCopy, "node_modules"), "dir");
execFileSync("git", ["init", "-q", appCopy]);
// The real app/runtime runs, with only the read tool enabled for this probe.
await writeFile(
  join(data, "pi/settings.json"),
  JSON.stringify({
    defaultTools: ["read"],
    retry: { enabled: false },
  }),
);
const marker = `margin-live-llama-${randomUUID()}`;
const fixture = join(workspace, "connection-check.txt");
await writeFile(fixture, marker);
const results: { check: string; status: string; detail?: unknown }[] = [];
const children: ChildProcess[] = [];
const logs: ReturnType<typeof createWriteStream>[] = [];
let browser: Browser | undefined;
let page: Page | undefined;
let sessionUrl: string | undefined;
let llama: ChildProcess | undefined;
let app: ChildProcess | undefined;
let llamaPort = 0;
let appPort = 0;
function pass(check: string, detail?: unknown) {
  results.push({ check, status: "passed", detail });
  console.log(JSON.stringify(results.at(-1)));
}
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
function start(
  binary: string,
  args: string[],
  name: string,
  env: NodeJS.ProcessEnv,
) {
  const log = createWriteStream(join(output, name + ".log"), { mode: 0o600 });
  logs.push(log);
  const child = spawn(binary, args, {
    cwd: name === "llama-live-margin" ? appCopy : root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout!.pipe(log, { end: false });
  child.stderr!.pipe(log, { end: false });
  child.on("error", (error) => {
    console.error(`${name}: ${error.message}`);
  });
  return child;
}
async function stop(child?: ChildProcess) {
  if (
    !child ||
    child.exitCode !== null ||
    child.signalCode !== null ||
    !child.pid
  )
    return;
  const ended = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 8000);
  await ended;
  clearTimeout(force);
}
async function ready(url: string, child: ChildProcess, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Process exited before readiness: ${url}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function portClosed(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}
const env: NodeJS.ProcessEnv = {};
for (const key of [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
])
  if (process.env[key]) env[key] = process.env[key];
const watchdog = setTimeout(() => {
  for (const child of children) child.kill("SIGTERM");
}, 300_000);
try {
  llamaPort = await freePort();
  appPort = await freePort();
  llama = start(
    "/opt/homebrew/bin/llama-server",
    [
      "--model",
      modelFile,
      "--host",
      "127.0.0.1",
      "--port",
      String(llamaPort),
      "--alias",
      "Qwen3.6-27B-local",
      "--ctx-size",
      "4096",
      "--parallel",
      "1",
      "--batch-size",
      "256",
      "--ubatch-size",
      "128",
      "--threads",
      "4",
      "--reasoning",
      "off",
      "--no-mmproj",
      "--no-webui",
      "--cache-ram",
      "0",
    ],
    "llama-live-server",
    env,
  );
  app = start(
    process.execPath,
    ["--import", "tsx", "scripts/start-native.ts"],
    "llama-live-margin",
    {
      ...env,
      PORT: String(appPort),
      MARGIN_DATA_DIR: data,
      NODE_ENV: "production",
    },
  );
  console.log(
    JSON.stringify({
      stage:
        "Loading Qwen at 4096 tokens and starting an isolated production Margin host",
      llamaPid: llama.pid,
      appPid: app.pid,
    }),
  );
  await Promise.all([
    ready(`http://127.0.0.1:${llamaPort}/health`, llama, 180_000),
    ready(`http://127.0.0.1:${appPort}/`, app, 45_000),
  ]);
  pass("Owned local servers ready", { llamaPort, appPort, context: 4096 });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(15_000);
  const appUrl = `http://127.0.0.1:${appPort}`;
  await page.goto(appUrl);
  const boot = await (await page.request.get(appUrl + "/api/bootstrap")).json();
  assert.equal(boot.models.length, 0);
  await page
    .getByRole("button", { name: "Connect an AI provider", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: /Add custom connection/ }).click();
  await dialog
    .getByLabel("Base URL", { exact: true })
    .fill(`http://127.0.0.1:${llamaPort}/v1`);
  await dialog
    .getByLabel("Authentication", { exact: true })
    .selectOption("none");
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Find models", exact: true })
    .click();
  await expect(dialog.getByLabel("Model ID", { exact: true })).toHaveValue(
    "Qwen3.6-27B-local",
  );
  pass(
    "Finished Settings form discovers the real llama model without an API key",
  );
  const savedResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/custom-connections/save"),
    { timeout: 90_000 },
  );
  await dialog
    .getByRole("button", { name: "Test & save", exact: true })
    .click();
  const response = await savedResponse;
  const saved = (await response.json()) as {
    connection: CustomConnectionView;
    error?: string;
  };
  assert.equal(response.status(), 200, saved.error);
  assert.equal(saved.connection.contextSource, "server");
  assert.equal(saved.connection.contextWindow, 4096);
  await expect(
    dialog.getByText(/Reply received and connection saved/),
  ).toBeVisible();
  pass("Real test-and-save uses detected 4096-token context", saved.connection);
  await page.screenshot({
    path: join(output, "11-llama-live-connection.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  const projectResponse = await page.request.post(appUrl + "/api/projects", {
    data: { path: workspace },
  });
  assert.equal(projectResponse.status(), 200);
  const project = await projectResponse.json();
  const sessionResponse = await page.request.post(appUrl + "/api/sessions", {
    data: {
      projectId: project.id,
      model: {
        provider: saved.connection.id,
        id: saved.connection.modelId,
        backend: "pi",
      },
    },
  });
  assert.equal(sessionResponse.status(), 200);
  const session = (await sessionResponse.json()) as Snapshot;
  const sessionId = session.session.id;
  sessionUrl = `${appUrl}/api/sessions/${sessionId}`;
  await page.goto(`${appUrl}/chats/${sessionId}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled({
    timeout: 25_000,
  });
  await page.getByLabel("Starting skill").selectOption("");
  const composer = page.getByRole("textbox", { name: /^Message / });
  await composer.fill(
    `Read ${fixture} using the read tool. Reply with only the exact contents of the file.`,
  );
  const send = page.waitForResponse(
    (response) => response.url().endsWith(`/sessions/${sessionId}/send`),
    { timeout: 20_000 },
  );
  await composer.press("Control+Enter");
  assert.equal((await send).status(), 200);
  console.log(
    JSON.stringify({
      stage: "Waiting for real Qwen tool call and streamed answer in Margin",
    }),
  );
  let sawStreaming = false;
  let snapshot: Snapshot | undefined;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    snapshot = (await (
      await page.request.get(`${appUrl}/api/sessions/${sessionId}`)
    ).json()) as Snapshot;
    if (snapshot.messages.some((message) => message.streaming))
      sawStreaming = true;
    if (
      !snapshot.busy &&
      snapshot.messages.some(
        (message) =>
          message.role === "assistant" && (message.text || message.error),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(snapshot);
  const answer = snapshot.messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  assert.equal(
    answer?.text.trim(),
    marker,
    JSON.stringify({ messages: snapshot.messages, notices: snapshot.notices }),
  );
  assert.ok(
    snapshot.messages.some(
      (message) =>
        message.tool?.name === "read" && message.tool.status === "success",
    ),
  );
  pass("Normal Margin chat performs a real read-tool round trip", {
    answer: answer.text,
    sawStreaming,
    context: 4096,
  });
  await page.screenshot({
    path: join(output, "12-llama-live-chat.png"),
    animations: "disabled",
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: /^Message / })).toBeVisible();
  const reloaded = await (
    await page.request.get(appUrl + "/api/custom-connections")
  ).json();
  assert.ok(
    reloaded.connections.some(
      (connection: CustomConnectionView) =>
        connection.id === saved.connection.id,
    ),
  );
  pass("Connection and completed chat survive browser reload");
  await stop(llama);
  assert.ok(await portClosed(llamaPort));
  const failedResponse = await page.request.post(
    appUrl + "/api/custom-connections/save",
    {
      data: {
        id: saved.connection.id,
        api: "openai-completions",
        baseUrl: saved.connection.baseUrl,
        authentication: "none",
        modelId: saved.connection.modelId,
      },
      timeout: 70_000,
    },
  );
  assert.equal(failedResponse.status(), 400);
  pass("Stopped llama server returns a recoverable failed connection check");
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: join(output, "llama-live-failure.png") })
      .catch(() => {});
    await writeFile(
      join(output, "llama-live-failure-page.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => "Page unavailable"),
    );
    if (sessionUrl) {
      const state = await page.request
        .get(sessionUrl)
        .then((r) => r.json())
        .catch(() => undefined);
      await writeFile(
        join(output, "llama-live-failure-state.json"),
        JSON.stringify(state ?? {}, null, 2),
      );
    }
  }
  results.push({
    check: "Live llama evaluation",
    status: "failed",
    detail: error instanceof Error ? error.message : String(error),
  });
  console.error(JSON.stringify(results.at(-1)));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await stop(app);
  await stop(llama);
  clearTimeout(watchdog);
  for (const log of logs) log.end();
  const stopped = {
    llama: !llamaPort || (await portClosed(llamaPort)),
    margin: !appPort || (await portClosed(appPort)),
  };
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    join(output, "llama-live-results.json"),
    JSON.stringify(
      { when: new Date().toISOString(), modelFile, results, stopped },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ stage: "Cleanup complete", stopped }));
  if (!stopped.llama || !stopped.margin) process.exitCode = 1;
}
