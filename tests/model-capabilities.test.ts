import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveThinking,
  thinkingModelFields,
} from "../server/model-capabilities.ts";
import { applyThinkingPayload } from "../server/custom-model-runtime.ts";
import {
  capabilityLevels,
  thinkingChoiceLabel,
} from "../shared/model-capabilities.ts";
import type { CustomConnectionInput } from "../shared/custom-connections.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  loadCustomModelSupport,
  setCustomThinkingSelection,
} from "../server/custom-model-runtime.ts";
const input: CustomConnectionInput = {
  api: "openai-completions",
  baseUrl: "http://127.0.0.1:9999/v1",
  authentication: "none",
  modelId: "anything",
};
test("unknown or boolean-only capability metadata doesn't invent effort controls", () => {
  for (const metadata of [
    undefined,
    { reasoning: true },
    { capabilities: { thinking: true } },
  ]) {
    const control = resolveThinking(input, metadata);
    assert.equal(control.mode, "server");
    assert.deepEqual(capabilityLevels(control), []);
    assert.equal(thinkingModelFields(control).reasoning, false);
  }
});

test("catalog models retain their SDK dialect: older Claude uses budgets and Gemini 2.x uses thinkingBudget", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-capability-wire-"));
  try {
    for (const [api, baseUrl, modelId] of [
      [
        "anthropic-messages",
        "https://api.anthropic.com/v1",
        "claude-haiku-4-5",
      ],
      [
        "google-generative-ai",
        "https://generativelanguage.googleapis.com/v1beta",
        "gemini-2.5-flash",
      ],
    ] as const) {
      const control = resolveThinking({ ...input, api, baseUrl, modelId });
      assert.equal(control.source, "catalog");
      const id = "margin-custom-native";
      const path = join(dir, "models.json");
      await writeFile(
        path,
        JSON.stringify({
          providers: {
            [id]: {
              api,
              baseUrl,
              apiKey: "fixture-only",
              models: [
                {
                  id: modelId,
                  contextWindow: 32000,
                  maxTokens: 8192,
                  ...thinkingModelFields(control),
                },
              ],
              margin: { thinkingControl: control },
            },
          },
        }),
      );
      const runtime = await loadCustomModelSupport(
        await ModelRuntime.create({
          modelsPath: path,
          modelsStorePath: join(dir, "catalog.json"),
          credentials: new InMemoryCredentialStore(),
          allowModelNetwork: false,
        }),
        path,
      );
      setCustomThinkingSelection(runtime, "medium");
      const abort = new AbortController();
      let payload: any;
      await runtime
        .streamSimple(
          runtime.getModel(id, modelId)!,
          {
            messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
          },
          {
            signal: abort.signal,
            onPayload(value) {
              payload = value;
              abort.abort();
            },
          },
        )
        .result();
      assert.ok(payload);
      if (api === "anthropic-messages") {
        assert.equal(payload.thinking.type, "enabled");
        assert.ok(payload.thinking.budget_tokens > 0);
        assert.equal(payload.output_config?.effort, undefined);
      } else {
        assert.equal(
          typeof payload.config.thinkingConfig.thinkingBudget,
          "number",
        );
        assert.equal(payload.config.thinkingConfig.thinkingLevel, undefined);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persisted default and explicit toggle choices reach the SDK as distinct requests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-capability-toggle-"));
  try {
    const control = resolveThinking({
      ...input,
      thinking: { mode: "toggle", transport: "llama-cpp" },
    });
    const path = join(dir, "models.json");
    const id = "margin-custom-toggle";
    await writeFile(
      path,
      JSON.stringify({
        providers: {
          [id]: {
            api: input.api,
            baseUrl: input.baseUrl,
            apiKey: "fixture-only",
            models: [
              {
                id: "local",
                contextWindow: 8192,
                maxTokens: 2048,
                ...thinkingModelFields(control),
              },
            ],
            margin: { thinkingControl: control },
          },
        },
      }),
    );
    const runtime = await loadCustomModelSupport(
      await ModelRuntime.create({
        modelsPath: path,
        modelsStorePath: join(dir, "catalog.json"),
        credentials: new InMemoryCredentialStore(),
      }),
      path,
    );
    for (const choice of [null, "medium", "off"] as const) {
      setCustomThinkingSelection(runtime, choice);
      let payload: any;
      await runtime
        .streamSimple(
          runtime.getModel(id, "local")!,
          {
            messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
          },
          {
            reasoning: "high",
            fetch: async (_input, init) => {
              payload = JSON.parse(String(init?.body));
              return new Response(
                'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                { headers: { "Content-Type": "text/event-stream" } },
              );
            },
          },
        )
        .result();
      if (choice === null)
        assert.equal(payload.chat_template_kwargs, undefined);
      else
        assert.equal(
          payload.chat_template_kwargs.enable_thinking,
          choice !== "off",
        );
      assert.equal(payload.reasoning_effort, undefined);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("server profiles detect template toggles without relying on model names", () => {
  const control = resolveThinking(
    input,
    { owned_by: "llamacpp" },
    {
      chat_template:
        "{% if enable_thinking is defined and enable_thinking %}...",
    },
  );
  assert.equal(control.mode, "toggle");
  assert.deepEqual(capabilityLevels(control), ["off", "medium"]);
  assert.equal(thinkingChoiceLabel("medium", control), "On");
  assert.equal(
    resolveThinking({ ...input, modelId: "qwen-thinking" }).mode,
    "server",
  );
});
test("manual effort levels, no-thinking and always-enabled are distinct", () => {
  const effort = resolveThinking({
    ...input,
    thinking: { mode: "effort", levels: ["low", "high"] },
  });
  assert.deepEqual(capabilityLevels(effort), ["low", "high"]);
  assert.equal(thinkingModelFields(effort).thinkingLevelMap.medium, null);
  assert.equal(
    resolveThinking({ ...input, thinking: { mode: "unsupported" } }).mode,
    "unsupported",
  );
  const always = resolveThinking({ ...input, thinking: { mode: "always" } });
  assert.deepEqual(capabilityLevels(always), []);
  assert.throws(
    () =>
      resolveThinking({
        ...input,
        thinking: { mode: "effort", transport: "llama-cpp", levels: ["low"] },
      }),
    /not distinct effort/,
  );
});
test("Server default emits no thinking override for every supported API shape", () => {
  const control = resolveThinking(input);
  const payload: any = {
    reasoning_effort: "none",
    enable_thinking: false,
    reasoning: { enabled: false },
    thinking: { type: "disabled" },
    chat_template_kwargs: { enable_thinking: false, other: true },
    output_config: { effort: "low" },
    config: { thinkingConfig: { thinkingBudget: 0 } },
    thinking_budget_tokens: 1024,
  };
  applyThinkingPayload(payload, input.api, control, null, 2048);
  assert.equal(payload.reasoning_effort, undefined);
  assert.equal(payload.reasoning, undefined);
  assert.equal(payload.thinking, undefined);
  assert.equal(payload.thinking_budget_tokens, undefined);
  assert.deepEqual(payload.chat_template_kwargs, { other: true });
  assert.deepEqual(payload.config, {});
});
test("explicit controls map to transport-specific fields; toggles don't pretend to offer graded effort", () => {
  const toggle = resolveThinking(
    input,
    { owned_by: "llamacpp" },
    { chat_template: "{% if enable_thinking %}" },
  );
  const on = applyThinkingPayload({}, input.api, toggle, "medium", 2048);
  assert.deepEqual(on.chat_template_kwargs, { enable_thinking: true });
  assert.equal(on.reasoning_format, "deepseek");
  const off = applyThinkingPayload({}, input.api, toggle, "off", 2048);
  assert.equal(off.chat_template_kwargs.enable_thinking, false);
  const effort = resolveThinking({
    ...input,
    thinking: { mode: "effort", levels: ["off", "high"] },
  });
  assert.equal(
    applyThinkingPayload({}, "openai-completions", effort, "off", 2048)
      .reasoning_effort,
    "none",
  );
  assert.equal(
    applyThinkingPayload({}, "openai-responses", effort, "high", 2048).reasoning
      .effort,
    "high",
  );
  assert.equal(
    applyThinkingPayload({}, "anthropic-messages", effort, "high", 2048)
      .output_config.effort,
    "high",
  );
  assert.equal(
    applyThinkingPayload({}, "google-generative-ai", effort, "high", 2048)
      .config.thinkingConfig.thinkingLevel,
    "HIGH",
  );
});
