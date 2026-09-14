import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { modelInfo } from "../server/models.ts";
import { Store } from "../server/store.ts";
import {
  defaultSettings,
  modelKey,
  type MarginSettings,
} from "../shared/settings.ts";
import {
  installSettingsRoutes,
  newConversationSettings,
  readSettings,
  settingsSchema,
  validateSettings,
} from "../server/settings.ts";
import type { ModelInfo } from "../shared/types.ts";

const codex: ModelInfo = {
  id: "gpt-5.6-sol",
  provider: "openai-codex",
  name: "Codex",
  subscription: true,
  backend: "pi",
  thinkingLevels: ["low", "medium", "high", "xhigh"],
};
const plain: ModelInfo = {
  id: "plain",
  provider: "other",
  name: "Plain",
  subscription: false,
  thinkingLevels: ["off"],
};
const plugin: ModelInfo = {
  ...plain,
  backend: "another-runtime",
  thinkingLevels: undefined,
};
const models = [plain, plugin, codex];
const saved: MarginSettings = {
  defaultModel: { id: codex.id, provider: codex.provider },
  defaultThinkingLevel: "high",
};

test("new conversations use saved defaults; explicit model overrides remain local", () => {
  assert.equal(newConversationSettings(defaultSettings, models).model, codex);
  const first = newConversationSettings(saved, models);
  assert.equal(first.model, codex);
  assert.equal(first.initialThinkingLevel, "high");
  const override = newConversationSettings(saved, models, plain);
  assert.equal(override.model, plain);
  assert.equal(override.initialThinkingLevel, undefined);
  const updated: MarginSettings = {
    defaultModel: plain,
    defaultThinkingLevel: "off",
  };
  assert.equal(newConversationSettings(updated, models).model, plain);
  assert.equal(first.model, codex);
  assert.equal(first.initialThinkingLevel, "high");
  assert.equal(saved.defaultThinkingLevel, "high");
  assert.equal(
    newConversationSettings({ ...saved, defaultThinkingLevel: null }, models)
      .initialThinkingLevel,
    undefined,
  );
});

test("provider/backend identity and unsupported levels are validated without silent fallback", () => {
  assert.notEqual(modelKey(plugin), modelKey(plain));
  assert.equal(
    newConversationSettings(defaultSettings, models, plugin).model,
    plugin,
  );
  assert.throws(
    () =>
      validateSettings(
        {
          ...saved,
          defaultModel: { ...saved.defaultModel!, provider: "openai" },
        },
        models,
      ),
    /unavailable/,
  );
  assert.throws(() => newConversationSettings(saved, [plain]), /unavailable/);
  assert.equal(newConversationSettings(saved, [plain], plain).model, plain);
  assert.throws(
    () => validateSettings({ ...saved, defaultThinkingLevel: "max" }, models),
    /thinking effort/,
  );
  assert.throws(
    () => validateSettings({ ...saved, defaultModel: plain }, models),
    /thinking effort/,
  );
  assert.throws(
    () => validateSettings({ ...saved, defaultModel: plugin }, models),
    /thinking effort/,
  );
  assert.throws(
    () => newConversationSettings(defaultSettings, []),
    /No available model/,
  );
  assert.doesNotThrow(() => validateSettings(defaultSettings, []));
  assert.equal(
    settingsSchema.safeParse({ ...saved, defaultThinkingLevel: "imaginary" })
      .success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({ ...saved, unrelated: true }).success,
    false,
  );
});

test("model capabilities include the exact SDK-supported effort levels", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-model-levels-"));
  try {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      modelsStorePath: join(dir, "models.json"),
      credentials: {
        read: async () => undefined,
        list: async () => [],
        modify: async () => {
          throw new Error("No credential writes");
        },
        delete: async () => {},
      },
    });
    const real = runtime.getModel("openai-codex", "gpt-5.6-sol");
    assert.ok(real);
    const supported = getSupportedThinkingLevels(real);
    assert.deepEqual(modelInfo(runtime, real).thinkingLevels, supported);
    for (const level of supported)
      assert.equal(
        settingsSchema.safeParse({ ...saved, defaultThinkingLevel: level })
          .success,
        true,
      );
    assert.ok(supported.includes("high"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("settings routes persist across database reopen and reject invalid saves atomically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-settings-"));
  let store = new Store(join(dir, "margin.sqlite"));
  const app = express();
  app.use(express.json());
  installSettingsRoutes(app, store, async () => models);
  app.use(
    (
      e: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/settings`;
  const put = (body: unknown) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.deepEqual(
      (await (await fetch(url)).json()).settings,
      defaultSettings,
    );
    assert.equal((await put(saved)).status, 200);
    assert.deepEqual((await (await fetch(url)).json()).settings, saved);
    assert.equal(
      (await put({ ...saved, defaultThinkingLevel: "max" })).status,
      400,
    );
    assert.deepEqual(readSettings(store), saved);
    store.close();
    store = new Store(join(dir, "margin.sqlite"));
    assert.deepEqual(readSettings(store), saved);
  } finally {
    await new Promise<void>((r, reject) =>
      server.close((e) => (e ? reject(e) : r())),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
