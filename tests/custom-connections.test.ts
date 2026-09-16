import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CustomConnections } from "../server/custom-connections.ts";
import {
  configureCustomCompaction,
  installCustomModelSupport,
  refreshCustomSessionModel,
} from "../server/custom-model-runtime.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { listModels } from "../server/models.ts";
import type { CustomConnectionInput } from "../shared/custom-connections.ts";

function completion(model = "local-coder") {
  const events = [
    {
      id: "test",
      object: "chat.completion.chunk",
      model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "OK" },
          finish_reason: null,
        },
      ],
    },
    {
      id: "test",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
    },
  ];
  return new Response(
    events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
async function fixture(
  options: {
    auth?: boolean;
    discovery?: boolean;
    error?: number;
    context?: number;
    unknownContext?: boolean;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "margin-custom-test-"));
  const requests: { url: string; headers: Headers; body?: any }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, headers, body });
    assert.equal(init?.redirect, "error");
    if (
      options.auth &&
      headers.get("authorization") !== "Bearer fixture-secret"
    )
      return Response.json(
        { error: { message: "Invalid API key" } },
        { status: 401 },
      );
    if (url.endsWith("/models")) {
      if (options.discovery === false) return new Response("", { status: 404 });
      return Response.json({
        data: [
          {
            id: "local-coder",
            owned_by: options.unknownContext ? "custom" : "llamacpp",
            meta: { n_ctx_train: 262144 },
          },
        ],
      });
    }
    if (url.includes("/props"))
      return Response.json({
        default_generation_settings: { n_ctx: options.context ?? 4096 },
      });
    if (options.error)
      return Response.json(
        { error: { message: "fixture-secret DO NOT EXPOSE upstream error" } },
        { status: options.error },
      );
    return completion();
  };
  const service = new CustomConnections(dir, false, fetcher);
  const input: CustomConnectionInput = {
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:9999/v1",
    authentication: options.auth ? "api_key" : "none",
    ...(options.auth ? { apiKey: "fixture-secret" } : {}),
    modelId: "local-coder",
  };
  return {
    dir,
    requests,
    service,
    input,
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test("custom no-auth connection discovers active 4K context, performs inference, persists, and reloads in Margin", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.service.discover(f.input)).models[0].id,
      "local-coder",
    );
    const saved = await f.service.save(f.input);
    assert.equal(saved.connection.contextWindow, 4096);
    assert.equal(saved.connection.contextSource, "server");
    const request = f.requests.find((r) => r.body)!;
    assert.equal(
      request.headers.has("authorization"),
      false,
      "no dummy auth is sent",
    );
    assert.equal(
      request.body.max_completion_tokens,
      64,
      "Pi's fixed 4K reserve must not reduce this to one token",
    );
    assert.equal((await stat(join(f.dir, "models.json"))).mode & 0o777, 0o600);
    const runtime = installCustomModelSupport(
      await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: join(f.dir, "models.json"),
        modelsStorePath: join(f.dir, "catalog.json"),
        allowModelNetwork: false,
      }),
    );
    const available = await listModels(runtime);
    assert.equal(
      available.find((m) => m.provider === saved.connection.id)
        ?.connectionSource,
      "custom",
    );
    assert.deepEqual((await new CustomConnections(f.dir).list()).connections, [
      saved.connection,
    ]);
  } finally {
    await f.close();
  }
});

test("API keys are tested and saved privately, omitted from views, and preserved for edits on the same endpoint", async () => {
  const f = await fixture({ auth: true });
  try {
    const saved = await f.service.save(f.input);
    assert.ok(
      f.requests.find((r) => r.body)?.headers.get("authorization") ===
        "Bearer fixture-secret",
    );
    assert.ok(
      !JSON.stringify(await f.service.list()).includes("fixture-secret"),
    );
    assert.ok(!JSON.stringify(saved).includes("fixture-secret"));
    await f.service.save({
      ...f.input,
      id: saved.connection.id,
      apiKey: "",
      name: "Team gateway",
    });
    assert.equal((await f.service.list()).connections[0].name, "Team gateway");
    await assert.rejects(
      f.service.save({
        ...f.input,
        id: saved.connection.id,
        apiKey: "",
        baseUrl: "https://another.example/v1",
      }),
      /key again/,
    );
  } finally {
    await f.close();
  }
});

test("manual model entry works without discovery and exposes provisional context honestly", async () => {
  const f = await fixture({ discovery: false });
  try {
    assert.equal((await f.service.discover(f.input)).models.length, 0);
    const result = await f.service.save(f.input);
    assert.equal(result.connection.contextSource, "provisional");
    assert.match(result.message, /provisional/);
    const explicit = await f.service.save({ ...f.input, contextWindow: 6000 });
    assert.equal(explicit.connection.contextWindow, 6000);
    assert.equal(explicit.connection.contextSource, "manual");
  } finally {
    await f.close();
  }
});

test("invalid keys and failed inference save nothing and do not return raw provider errors", async () => {
  for (const error of [401, 404, 500]) {
    const f = await fixture({ error });
    try {
      await assert.rejects(
        f.service.save(f.input),
        (e) => !String(e).includes("fixture-secret"),
      );
      assert.equal((await f.service.list()).connections.length, 0);
    } finally {
      await f.close();
    }
  }
  const f = await fixture({ auth: true });
  try {
    await assert.rejects(
      f.service.discover({ ...f.input, apiKey: "bad" }),
      /credentials/,
    );
    assert.equal((await f.service.list()).connections.length, 0);
  } finally {
    await f.close();
  }
});

test("updates preserve unrelated Pi providers; renaming and removal affect only the selected custom connection", async () => {
  const f = await fixture();
  try {
    const unrelated = {
      apiKey: "$EXTERNAL_KEY",
      baseUrl: "https://example.com",
    };
    await writeFile(
      join(f.dir, "models.json"),
      JSON.stringify({ providers: { existing: unrelated } }),
    );
    const first = await f.service.save(f.input);
    const second = await f.service.save({
      ...f.input,
      name: "Another local model",
    });
    await f.service.rename(first.connection.id, "My laptop");
    assert.equal((await f.service.list()).connections[0].name, "My laptop");
    await f.service.remove(first.connection.id);
    assert.equal(
      (await f.service.list()).connections[0].id,
      second.connection.id,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(f.dir, "models.json"), "utf8")).providers
        .existing,
      unrelated,
    );
    await assert.rejects(f.service.remove("existing"), /not found/);
  } finally {
    await f.close();
  }
});

test("literal-only inputs, URL validation, explicit authentication, read-only mode and cancellation", async () => {
  const f = await fixture();
  try {
    for (const patch of [
      { baseUrl: "file:///etc/passwd" },
      { baseUrl: "https://secret@example.com/v1" },
      { authentication: "api_key", apiKey: "" },
      { apiKey: "!touch /tmp/unwanted" },
      { headers: { "X-Test": "$SECRET" } },
      { headers: { "X-Test": "bad\r\nvalue" } },
    ])
      await assert.rejects(f.service.save({ ...f.input, ...patch }));
    await assert.rejects(
      new CustomConnections(f.dir, true).save(f.input),
      /disabled/,
    );
    await assert.rejects(
      f.service.save(f.input, AbortSignal.abort()),
      /abort/i,
    );
    assert.equal((await f.service.list()).connections.length, 0);
    assert.equal(f.requests.filter((r) => r.body).length, 0);
  } finally {
    await f.close();
  }
});

test("small custom contexts get session-local compaction thresholds; built-in settings stay intact", () => {
  const settings = SettingsManager.inMemory({
    branchSummary: { reserveTokens: 5000 },
  });
  const defaults = settings.getCompactionSettings();
  const branchDefaults = settings.getBranchSummarySettings();
  let model = { provider: "margin-custom-test", contextWindow: 4096 } as any;
  configureCustomCompaction(settings, () => model);
  assert.equal(settings.getCompactionSettings().reserveTokens, 1024);
  assert.ok(settings.getCompactionSettings().keepRecentTokens < 4096);
  model = { provider: "openai-codex", contextWindow: 200000 };
  assert.deepEqual(settings.getCompactionSettings(), defaults);
  assert.deepEqual(settings.getBranchSummarySettings(), branchDefaults);
});

test("saved reasoning/compatibility and explicit reply limits roundtrip; no-auth cannot silently become API-key auth", async () => {
  const f = await fixture();
  try {
    const result = await f.service.save({
      ...f.input,
      reasoning: true,
      supportsDeveloperRole: true,
      supportsReasoningEffort: true,
      maxTokens: 2000,
    });
    const view = (await f.service.list()).connections[0];
    assert.equal(view.reasoning, true);
    assert.equal(view.supportsDeveloperRole, true);
    assert.equal(view.supportsReasoningEffort, true);
    assert.equal(view.maxTokens, 2000);
    await assert.rejects(
      f.service.save({
        ...f.input,
        id: result.connection.id,
        authentication: "api_key",
      }),
      /Enter an API key/,
    );
    await assert.rejects(
      f.service.save({ ...f.input, api: "google-generative-ai" }),
      /requires a key/,
    );
  } finally {
    await f.close();
  }
});

test("open custom sessions refresh edited endpoints and refuse removed connections", async () => {
  const f = await fixture();
  try {
    const saved = await f.service.save(f.input);
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: join(f.dir, "models.json"),
      modelsStorePath: join(f.dir, "catalog.json"),
    });
    const oldModel = runtime.getModel(saved.connection.id, f.input.modelId)!;
    await f.service.save({
      ...f.input,
      id: saved.connection.id,
      baseUrl: "http://127.0.0.1:9998/v1",
    });
    const updated = await refreshCustomSessionModel(runtime, oldModel);
    assert.equal(updated.baseUrl, "http://127.0.0.1:9998/v1");
    await f.service.remove(saved.connection.id);
    await assert.rejects(
      refreshCustomSessionModel(runtime, updated),
      /removed or is unavailable/,
    );
  } finally {
    await f.close();
  }
});

test("existing Pi JSONC is accepted without evaluating expressions or dropping unrelated provider entries", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.dir, "models.json"),
      '\uFEFF{\n// existing manual setup\n"providers": {"existing": {"baseUrl":"https://example.com", "apiKey":"$KEY",},},}',
    );
    await f.service.save(f.input);
    const config = JSON.parse(
      await readFile(join(f.dir, "models.json"), "utf8"),
    );
    assert.equal(config.providers.existing.apiKey, "$KEY");
    assert.equal(config.providers.existing.baseUrl, "https://example.com");
  } finally {
    await f.close();
  }
});

test("cancelling a connection waiting to commit cannot save it later", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    let release!: () => void;
    let queued!: () => void;
    const reachedQueue = new Promise<void>((resolve) => {
      queued = resolve;
    });
    const service = f.service as any;
    service.writing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mutate = service.mutate.bind(service);
    service.mutate = (...args: unknown[]) => {
      const result = mutate(...args);
      queued();
      return result;
    };
    const saving = f.service.save(f.input, controller.signal);
    const rejected = assert.rejects(saving, /abort/i);
    await reachedQueue;
    controller.abort();
    release();
    await rejected;
    assert.equal((await f.service.list()).connections.length, 0);
  } finally {
    await f.close();
  }
});

test("Responses, Anthropic and Google custom API formats complete a real HTTP protocol round trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-custom-protocols-"));
  const requests: { path: string; headers: any; body: any }[] = [];
  const server = createServer(async (req, res) => {
    if (req.url?.endsWith("/models")) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          data: [{ id: "local-coder", context_length: 4096 }],
          models: [{ name: "models/local-coder", inputTokenLimit: 4096 }],
        }),
      );
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({
      path: req.url!,
      headers: req.headers,
      body: JSON.parse(raw),
    });
    res.setHeader("Content-Type", "text/event-stream");
    let events: any[];
    if (req.url?.includes("streamGenerateContent")) {
      events = [
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "OK" }] },
              finishReason: "STOP",
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 1,
            totalTokenCount: 13,
          },
        },
      ];
    } else if (req.url?.includes("/messages")) {
      events = [
        {
          type: "message_start",
          message: {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            content: [],
            model: "local-coder",
            usage: { input_tokens: 12, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "OK" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
      ];
    } else {
      const item = {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "OK", annotations: [] }],
      };
      events = [
        {
          type: "response.created",
          response: { id: "resp_fixture", status: "in_progress", output: [] },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, status: "in_progress", content: [] },
        },
        {
          type: "response.output_text.delta",
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: "OK",
        },
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: "resp_fixture",
            status: "completed",
            output: [item],
            usage: {
              input_tokens: 12,
              output_tokens: 1,
              total_tokens: 13,
              input_tokens_details: {},
              output_tokens_details: {},
            },
          },
        },
      ];
    }
    res.end(
      events
        .map(
          (event) =>
            `${event.type ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
        )
        .join(""),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const service = new CustomConnections(dir);
    for (const api of [
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai",
    ] as const) {
      const result = await service.save({
        api,
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        authentication: "api_key",
        apiKey: "fixture-secret",
        modelId: "local-coder",
      });
      assert.equal(result.connection.api, api);
    }
    assert.equal(requests[0].headers.authorization, "Bearer fixture-secret");
    assert.equal(requests[0].body.max_output_tokens, 64);
    assert.equal(requests[1].headers["x-api-key"], "fixture-secret");
    assert.equal(requests[1].body.max_tokens, 64);
    assert.equal(requests[2].headers["x-goog-api-key"], "fixture-secret");
    assert.equal(requests[2].body.generationConfig.maxOutputTokens, 64);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
