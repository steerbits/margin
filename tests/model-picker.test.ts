import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { listModels, modelConnectionSource } from "../server/models.ts";
import {
  groupedModels,
  modelLabel,
  modelBillingSuffix,
} from "../shared/model-picker.ts";
import { modelKey } from "../shared/settings.ts";
import type { ModelInfo } from "../shared/types.ts";

const model = (
  provider: string,
  source: ModelInfo["connectionSource"],
  name = "Same model",
): ModelInfo => ({
  id: "same-id",
  name,
  provider,
  subscription: false,
  connectionSource: source,
});

test("connection grouping follows Pi auth-source metadata, not provider names", () => {
  const expected = {
    stored: "saved",
    environment: "key",
    runtime: "key",
    fallback: "custom",
    models_json_key: "custom",
    models_json_command: "custom",
  } as const;
  for (const [source, group] of Object.entries(expected))
    assert.equal(
      modelConnectionSource(
        {
          getProviderAuthStatus: () => ({
            configured: true,
            source: source as keyof typeof expected,
          }),
        },
        "any-provider",
      ),
      group,
    );
});

test("three ordered groups preserve all available choices and sort provider first without changing identity", () => {
  const models = [
    model("llama-cpp", "custom"),
    model("openrouter", "key", "Anthropic: Claude Sonnet"),
    model("openai-codex", "saved"),
    model("anthropic", "saved", "Claude Sonnet"),
    model("groq", "key"),
  ];
  const before = structuredClone(models);
  const groups = groupedModels(models);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Saved Connections", "Keys", "Custom"],
  );
  assert.deepEqual(
    groups.flatMap((g) => g.models.map((m) => m.provider)),
    ["anthropic", "openai-codex", "groq", "openrouter", "llama-cpp"],
  );
  assert.deepEqual(
    new Set(groups.flatMap((g) => g.models.map(modelKey))),
    new Set(models.map(modelKey)),
  );
  assert.deepEqual(
    models,
    before,
    "Presentation sorting must not mutate automatic model selection order",
  );
  assert.deepEqual(
    groupedModels([
      { ...model("anthropic", "saved", "Claude 10"), id: "ten" },
      { ...model("anthropic", "saved", "Claude 2"), id: "two" },
    ])[0].models.map((m) => m.id),
    ["two", "ten"],
  );
  assert.deepEqual(groupedModels([]), []);
  assert.deepEqual(
    groupedModels([models[1]]).map((g) => g.label),
    ["Keys"],
  );
  const plugin = {
    ...models[0],
    connectionSource: undefined,
    backend: "plugin",
  };
  assert.equal(groupedModels([plugin])[0].id, "custom");
  assert.equal(modelLabel(plugin), "llama.cpp • Same model (plugin)");
});

test("provider-first names distinguish direct and routed models and retain billing hints", () => {
  const claude = model("anthropic", "saved", "Claude Sonnet");
  assert.equal(modelLabel(claude), "Anthropic • Claude Sonnet");
  assert.equal(
    modelLabel(model("openrouter", "key", "Anthropic: Claude Sonnet")),
    "OpenRouter • Anthropic: Claude Sonnet",
  );
  assert.equal(
    modelBillingSuffix({ ...claude, subscription: true }),
    " (extra usage)",
  );
  assert.equal(
    modelBillingSuffix({
      ...claude,
      provider: "openai-codex",
      subscription: true,
    }),
    " (subscription)",
  );
  assert.equal(modelBillingSuffix(claude), "");
  assert.equal(
    modelLabel({ ...claude, provider: "custom-id", providerName: "Local Lab" }),
    "Local Lab • Claude Sonnet",
  );
  assert.equal(
    modelLabel({ ...claude, provider: "constructor" }),
    "constructor • Claude Sonnet",
  );
});

test("real SDK availability excludes unconfigured models; saved credentials, environment keys and custom configuration group correctly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-model-picker-"));
  const envBefore = new Map(
    ["ANTHROPIC_API_KEY", "XAI_API_KEY"].map((key) => [key, process.env[key]]),
  );
  process.env.ANTHROPIC_API_KEY = "fixture-env-anthropic";
  process.env.XAI_API_KEY = "fixture-env-xai";
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("anthropic", async () => ({
    type: "api_key",
    key: "fixture-saved-key",
  }));
  const modelsPath = join(dir, "models.json");
  writeFileSync(
    modelsPath,
    JSON.stringify({
      providers: {
        "fixture-local": {
          name: "Fixture local",
          api: "openai-completions",
          baseUrl: "http://localhost:1/v1",
          apiKey: "fixture-custom-key",
          models: [{ id: "local-model" }],
        },
        "fixture-unconfigured": {
          api: "openai-completions",
          baseUrl: "http://localhost:1/v1",
          models: [{ id: "must-stay-hidden" }],
        },
      },
    }),
  );
  try {
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath,
      modelsStorePath: join(dir, "catalog.json"),
      allowModelNetwork: false,
    });
    const models = await listModels(runtime);
    assert.ok(runtime.getModels("fixture-unconfigured").length > 0);
    assert.ok(!models.some((m) => m.provider === "fixture-unconfigured"));
    for (const [provider, source] of [
      ["anthropic", "saved"],
      ["xai", "key"],
      ["fixture-local", "custom"],
    ]) {
      const subset = models.filter((m) => m.provider === provider);
      assert.ok(subset.length > 0);
      assert.ok(subset.every((m) => m.connectionSource === source));
    }
    assert.ok(!JSON.stringify(models).includes("fixture-env"));
    assert.ok(!JSON.stringify(models).includes("fixture-saved-key"));
    assert.ok(!JSON.stringify(models).includes("fixture-custom-key"));
    assert.ok(!JSON.stringify(models).includes("API_KEY"));
    await credentials.delete("anthropic");
    assert.ok(
      (await listModels(runtime))
        .filter((m) => m.provider === "anthropic")
        .every((m) => m.connectionSource === "key"),
    );
    await credentials.modify("fixture-local", async () => ({
      type: "api_key",
      key: "saved-local",
    }));
    assert.equal(
      (await listModels(runtime)).find((m) => m.provider === "fixture-local")!
        .connectionSource,
      "saved",
    );
  } finally {
    for (const [key, value] of envBefore) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
