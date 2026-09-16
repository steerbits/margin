// Explicit live evaluation: reads an existing credential store, never mutates it.
// Usage: npx tsx scripts/evaluate-connections.ts /absolute/path/to/auth.json
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ModelRuntime,
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type { Credential } from "@earendil-works/pi-ai";
import { CustomConnections } from "../server/custom-connections.ts";
import { listModels, readOnlyCredentials } from "../server/models.ts";
import { installCustomModelSupport } from "../server/custom-model-runtime.ts";

const authPath = process.argv[2];
if (!authPath)
  throw new Error(
    "Pass the absolute path to a credential store for this live evaluation.",
  );
const original = await readFile(authPath, "utf8");
const credentials = JSON.parse(original) as Record<string, Credential>;
const openrouter = credentials.openrouter;
const key =
  openrouter?.type === "api_key"
    ? openrouter.key
    : process.env.OPENROUTER_API_KEY;
const dir = await mkdtemp(join(tmpdir(), "margin-live-connections-"));
const results: { check: string; status: string; detail?: unknown }[] = [];
async function record(check: string, task: () => Promise<unknown>) {
  try {
    const detail = await task();
    results.push({ check, status: "passed", detail });
  } catch {
    // Provider errors can contain secrets. Keep this report deliberately bounded.
    results.push({
      check,
      status: "failed",
      detail:
        "No successful reply; inspect account eligibility or reauthorize in the isolated preview.",
    });
    process.exitCode = 1;
  }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  let routerModel = "openai/gpt-4.1-mini";
  await record(
    "OpenRouter: API-key login, live inference and credential reload",
    async () => {
      assert.ok(key, "No OpenRouter key");
      const options = {
        authPath: join(dir, "auth.json"),
        modelsPath: null,
        modelsStorePath: join(dir, "catalog.json"),
        allowModelNetwork: false,
      };
      const runtime = await ModelRuntime.create(options);
      await runtime.login("openrouter", "api_key", {
        notify() {},
        async prompt(prompt) {
          assert.equal(prompt.type, "secret");
          return key;
        },
      });
      const model =
        runtime.getModel("openrouter", routerModel) ??
        runtime.getModel("openrouter", "openai/gpt-4o-mini");
      assert.ok(model);
      routerModel = model.id;
      const response = await runtime.completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: "Reply with the single word OK.",
              timestamp: Date.now(),
            },
          ],
        },
        { maxTokens: 32, signal: AbortSignal.timeout(60_000), maxRetries: 0 },
      );
      assert.equal(response.stopReason, "stop");
      assert.ok(
        response.content.some(
          (block) => block.type === "text" && block.text.trim(),
        ),
      );
      const restarted = await ModelRuntime.create(options);
      assert.ok(
        (await restarted.getAvailable("openrouter")).some(
          (item) => item.id === model.id,
        ),
      );
      return {
        model: model.id,
        stopReason: response.stopReason,
        tokens: response.usage.totalTokens,
      };
    },
  );
  await record(
    "Custom OpenAI-compatible connection: live test-and-save against OpenRouter",
    async () => {
      assert.ok(key);
      const service = new CustomConnections(join(dir, "custom"));
      const result = await service.save({
        api: "openai-completions",
        baseUrl: "https://openrouter.ai/api/v1",
        authentication: "api_key",
        apiKey: key,
        modelId: routerModel,
        name: "Live custom evaluation",
      });
      const fresh = installCustomModelSupport(
        await ModelRuntime.create({
          authPath: join(dir, "custom", "auth.json"),
          modelsPath: join(dir, "custom", "models.json"),
          modelsStorePath: join(dir, "custom", "catalog.json"),
          allowModelNetwork: false,
        }),
      );
      assert.ok(
        (await listModels(fresh)).some(
          (model) => model.provider === result.connection.id,
        ),
      );
      const marker = `margin-tool-check-${randomUUID()}`;
      const fixture = join(dir, "tool-fixture.txt");
      await writeFile(fixture, marker);
      const settings = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      });
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        settingsManager: settings,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noContextFiles: true,
        systemPrompt:
          "Follow the user's instructions. Use the read tool to read the requested test file.",
      });
      await loader.reload();
      const { session } = await createAgentSession({
        cwd: dir,
        agentDir: dir,
        modelRuntime: fresh,
        model: fresh.getModel(result.connection.id, routerModel),
        tools: ["read"],
        thinkingLevel: "off",
        resourceLoader: loader,
        settingsManager: settings,
        sessionManager: SessionManager.inMemory(),
      });
      let toolUsed = false;
      session.subscribe((event) => {
        if (
          event.type === "tool_execution_end" &&
          event.toolName === "read" &&
          !event.isError
        )
          toolUsed = true;
      });
      const timer = setTimeout(() => void session.abort(), 60_000);
      try {
        await session.prompt(
          `Read ${fixture} using the read tool, then reply with only its exact contents.`,
        );
        assert.ok(toolUsed);
        const final = session.messages
          .filter((message) => message.role === "assistant")
          .at(-1);
        assert.equal(
          final?.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("")
            .trim(),
          marker,
        );
      } finally {
        clearTimeout(timer);
        session.dispose();
      }
      return {
        model: result.connection.modelId,
        contextSource: result.connection.contextSource,
        toolRoundTrip: "read tool returned the exact fixture contents",
      };
    },
  );
  await record(
    "ChatGPT / Codex: existing browser login and live inference",
    async () => {
      assert.equal(credentials["openai-codex"]?.type, "oauth");
      const runtime = await ModelRuntime.create({
        credentials: readOnlyCredentials(authPath),
        modelsPath: null,
        modelsStorePath: join(dir, "codex-catalog.json"),
        allowModelNetwork: false,
      });
      const model =
        runtime.getModel("openai-codex", "gpt-5.6-sol") ??
        runtime.getModels("openai-codex")[0];
      assert.ok(model);
      const response = await runtime.completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: "Reply with the single word OK.",
              timestamp: Date.now(),
            },
          ],
        },
        {
          maxTokens: 64,
          reasoning: "low",
          signal: AbortSignal.timeout(60_000),
          maxRetries: 0,
        },
      );
      assert.equal(response.stopReason, "stop");
      assert.ok(
        response.content.some(
          (block) => block.type === "text" && block.text.trim(),
        ),
      );
      return {
        model: model.id,
        stopReason: response.stopReason,
        tokens: response.usage.totalTokens,
      };
    },
  );
  assert.equal(
    await readFile(authPath, "utf8"),
    original,
    "Original credentials changed during evaluation",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
  const output = resolve(".margin-data/ai-connections-review");
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "live-results.json"),
    JSON.stringify({ when: new Date().toISOString(), results }, null, 2),
  );
}
