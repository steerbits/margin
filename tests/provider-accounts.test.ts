import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import {
  ModelRuntime,
  CredentialSynchronizationError,
} from "@earendil-works/pi-coding-agent";
import type {
  AuthInteraction,
  Credential,
  Provider,
} from "@earendil-works/pi-ai";
import {
  ProviderAccounts,
  installProviderAccountRoutes,
  type AccountRuntime,
} from "../server/provider-accounts.ts";
import { loginPending, safeAuthUrl } from "../shared/provider-accounts.ts";
import { listModels } from "../server/models.ts";

const secret = "fixture-secret-never-send-to-browser";
const credential: Credential = {
  type: "oauth",
  access: secret,
  refresh: secret,
  expires: Date.now() + 3_600_000,
};
function fakeRuntime(login: AccountRuntime["login"]): AccountRuntime {
  return {
    getProviders: () =>
      [
        {
          id: "xai",
          name: "xAI",
          auth: {
            oauth: {
              name: "Grok",
              loginLabel: "Sign in with SuperGrok or X Premium",
            },
            apiKey: { login() {} },
          },
        },
        { id: "external", name: "Cloud credentials", auth: { apiKey: {} } },
      ] as unknown as Provider[],
    listCredentials: async () => [{ providerId: "xai", type: "oauth" }],
    checkAuth: async (id) =>
      id === "xai" ? { type: "oauth", source: secret } : undefined,
    login,
    logout: async () => {},
  };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Timed out waiting for login state");
}

test("provider metadata is capability-driven, with no credentials or secret source labels", async () => {
  const accounts = new ProviderAccounts(
    async () => fakeRuntime(async () => credential),
    false,
  );
  const view = await accounts.list();
  assert.equal(view.providers[0].name, "xAI (Grok)");
  assert.deepEqual(
    view.providers[0].methods.map((m) => m.type),
    ["oauth", "api_key"],
  );
  assert.deepEqual(view.providers[1].methods, []);
  assert.equal(view.providers[0].configured, true);
  assert.equal(JSON.stringify(view).includes(secret), false);
});

test("multi-step login supports selects, optional text, manual callback cancellation, and secret-free completion", async () => {
  let automaticCallback!: () => void;
  const received: string[] = [];
  const accounts = new ProviderAccounts(
    async () =>
      fakeRuntime(async (_id, _type, interaction) => {
        received.push(
          await interaction.prompt({
            type: "select",
            message: "Method",
            options: [{ id: "browser", label: "Browser" }],
          }),
        );
        received.push(
          await interaction.prompt({
            type: "text",
            message: "Optional enterprise domain",
          }),
        );
        interaction.notify({
          type: "auth_url",
          url: "https://example.com/authorize?state=fixture",
          instructions: "Authorize in browser",
        });
        const promptAbort = new AbortController();
        const fallback = interaction
          .prompt({
            type: "manual_code",
            message: "Paste redirect",
            signal: promptAbort.signal,
          })
          .catch(() => {});
        await new Promise<void>((resolve) => {
          automaticCallback = resolve;
        });
        promptAbort.abort();
        await fallback;
        return credential;
      }),
    false,
  );
  const { id } = accounts.start("xai", "oauth");
  try {
    assert.throws(() => accounts.start("xai", "oauth"), /still running/);
    await assert.rejects(accounts.remove("xai"), /still running/);
    await until(() => !!accounts.get(id).prompt);
    const first = accounts.get(id).prompt!;
    assert.throws(
      () => accounts.answer(id, first.id, "unlisted"),
      /displayed options/,
    );
    accounts.answer(id, first.id, "browser");
    await until(() => accounts.get(id).prompt?.type === "text");
    assert.throws(() => accounts.answer(id, first.id, "stale"), /finished/);
    accounts.answer(id, accounts.get(id).prompt!.id, "");
    await until(() => accounts.get(id).prompt?.type === "manual_code");
    const manual = accounts.get(id).prompt!;
    assert.equal("signal" in manual, false);
    assert.equal(accounts.get(id).events[0].type, "auth_url");
    automaticCallback();
    await until(() => !loginPending(accounts.get(id)));
    assert.deepEqual(received, ["browser", ""]);
    assert.equal(accounts.get(id).status, "connected");
    assert.deepEqual(accounts.get(id).events, []);
    assert.equal(accounts.get(id).prompt, undefined);
    assert.equal(JSON.stringify(accounts.get(id)).includes(secret), false);
    assert.throws(() => accounts.answer(id, manual.id, "too-late"), /finished/);
  } finally {
    accounts.close();
  }
});

test("cancel, expiry, unsupported methods and retry; abort actually reaches Pi", async () => {
  let signal: AbortSignal | undefined;
  const accounts = new ProviderAccounts(
    async () =>
      fakeRuntime(async (_id, _type, interaction) => {
        signal = interaction.signal;
        await interaction.prompt({ type: "secret", message: "Secret" });
        return credential;
      }),
    false,
    150,
  );
  let { id } = accounts.start("xai", "oauth");
  await until(() => !!accounts.get(id).prompt);
  accounts.cancel(id);
  await until(() => accounts.get(id).status === "cancelled");
  assert.equal(signal?.aborted, true);
  assert.equal(accounts.get(id).prompt, undefined);
  ({ id } = accounts.start("xai", "oauth"));
  await until(() => accounts.get(id).status === "expired");
  assert.equal(signal?.aborted, true);
  ({ id } = accounts.start("external", "oauth"));
  await until(() => accounts.get(id).status === "error");
  assert.match(accounts.get(id).message!, /does not expose/);
  accounts.close();
});

test("errors never serialize token response bodies; synchronization errors preserve committed success", async () => {
  let error: Error = new Error(`token exchange body=${secret}`);
  const runtime = fakeRuntime(async () => {
    throw error;
  });
  const accounts = new ProviderAccounts(async () => runtime, false);
  let { id } = accounts.start("xai", "oauth");
  await until(() => !loginPending(accounts.get(id)));
  assert.equal(accounts.get(id).status, "error");
  assert.equal(JSON.stringify(accounts.get(id)).includes(secret), false);
  error = new CredentialSynchronizationError("xai", "login", credential, {
    cause: new Error(secret),
  });
  ({ id } = accounts.start("xai", "oauth"));
  await until(() => !loginPending(accounts.get(id)));
  assert.equal(accounts.get(id).status, "connected");
  assert.match(accounts.get(id).message!, /were saved/);
  assert.equal(JSON.stringify(accounts.get(id)).includes(secret), false);
  runtime.logout = async () => {
    throw new CredentialSynchronizationError("xai", "logout", undefined, {
      cause: new Error(secret),
    });
  };
  assert.match((await accounts.remove("xai")).warning!, /were removed/);
});

test("unsafe links, blank secrets and shell/env API-key expressions are rejected", async () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/a",
    "https://user:password@example.com",
    "bad",
  ])
    assert.equal(safeAuthUrl(url), undefined);
  assert.equal(
    safeAuthUrl("https://example.com/login"),
    "https://example.com/login",
  );
  const accounts = new ProviderAccounts(
    async () =>
      fakeRuntime(async (_id, type, interaction) => {
        if (type === "oauth")
          interaction.notify({ type: "auth_url", url: "javascript:alert(1)" });
        await interaction.prompt({ type: "secret", message: "Key" });
        return credential;
      }),
    false,
  );
  let { id } = accounts.start("xai", "oauth");
  await until(() => accounts.get(id).status === "error");
  assert.equal(accounts.get(id).events.length, 0);
  ({ id } = accounts.start("xai", "api_key"));
  await until(() => !!accounts.get(id).prompt);
  const promptId = accounts.get(id).prompt!.id;
  for (const value of ["!echo secret", "${SECRET}", " ", " $SECRET"])
    assert.throws(() => accounts.answer(id, promptId, value));
  accounts.answer(id, promptId, "literal-key");
  await until(() => accounts.get(id).status === "connected");
});

test("read-only mode prevents login/logout before any runtime operation", async () => {
  let calls = 0;
  const accounts = new ProviderAccounts(async () => {
    calls++;
    return fakeRuntime(async () => credential);
  }, true);
  assert.throws(() => accounts.start("xai", "oauth"), /MARGIN_AUTH_READ_ONLY/);
  await assert.rejects(accounts.remove("xai"), /MARGIN_AUTH_READ_ONLY/);
  assert.equal(calls, 0);
});

test("real Pi API-key login persists privately, exposes Claude/Grok models to a fresh worker runtime, and removes credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-account-sdk-"));
  const options = { authPath: join(dir, "auth.json"), modelsPath: null };
  const accounts = new ProviderAccounts(
    () => ModelRuntime.create(options),
    false,
  );
  try {
    for (const provider of ["anthropic", "xai"]) {
      const { id } = accounts.start(provider, "api_key");
      await until(() => !!accounts.get(id).prompt);
      accounts.answer(id, accounts.get(id).prompt!.id, secret);
      await until(() => !loginPending(accounts.get(id)));
      assert.equal(
        accounts.get(id).status,
        "connected",
        accounts.get(id).message,
      );
    }
    assert.equal(statSync(options.authPath).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(readFileSync(options.authPath, "utf8")).anthropic.key,
      secret,
    );
    const worker = await ModelRuntime.create(options);
    const models = await listModels(worker);
    assert.ok(
      models.some(
        (m) =>
          m.provider === "anthropic" &&
          m.id.startsWith("claude-") &&
          m.thinkingLevels?.length,
      ),
    );
    assert.ok(
      models.some((m) => m.provider === "xai" && m.id.startsWith("grok-")),
    );
    assert.equal(JSON.stringify(await accounts.list()).includes(secret), false);
    await accounts.remove("anthropic");
    const stored = JSON.parse(readFileSync(options.authPath, "utf8"));
    assert.equal(stored.anthropic, undefined);
    assert.equal(stored.xai.key, secret);
  } finally {
    accounts.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real xAI SDK device login and locked token refresh stay server-side (mock HTTP)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "margin-xai-sdk-"));
  const options = { authPath: join(dir, "auth.json"), modelsPath: null };
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    requests.push(String(url));
    if (String(url) === "https://auth.x.ai/oauth2/device/code")
      return Response.json({
        device_code: "private-device-code",
        user_code: "PUBLIC-CODE",
        verification_uri: "https://auth.x.ai/activate",
        interval: 0.01,
        expires_in: 60,
      });
    if (String(url) === "https://auth.x.ai/oauth2/token")
      return Response.json({
        access_token: secret,
        refresh_token: secret,
        expires_in: 3600,
      });
    throw new Error(`Unexpected network request: ${url}`);
  });
  const accounts = new ProviderAccounts(
    () => ModelRuntime.create(options),
    false,
  );
  try {
    const { id } = accounts.start("xai", "oauth");
    await until(() => !loginPending(accounts.get(id)));
    assert.equal(
      accounts.get(id).status,
      "connected",
      accounts.get(id).message,
    );
    assert.equal(requests.length, 2);
    const stored = JSON.parse(readFileSync(options.authPath, "utf8"));
    assert.equal(stored.xai.type, "oauth");
    assert.equal(stored.xai.access, secret);
    assert.equal(JSON.stringify(await accounts.list()).includes(secret), false);
    const fresh = await ModelRuntime.create(options);
    assert.ok(
      (await listModels(fresh)).some(
        (m) => m.provider === "xai" && m.subscription,
      ),
    );
    stored.xai.expires = Date.now() - 1000;
    writeFileSync(options.authPath, JSON.stringify(stored));
    const otherWorker = await ModelRuntime.create(options);
    const auth = await Promise.all([
      fresh.getAuth("xai"),
      otherWorker.getAuth("xai"),
    ]);
    assert.equal(auth[0]?.auth.apiKey, secret);
    assert.equal(auth[1]?.auth.apiKey, secret);
    assert.equal(
      requests.length,
      3,
      "Only one of the two runtimes should refresh the expired credential",
    );
    assert.ok(
      JSON.parse(readFileSync(options.authPath, "utf8")).xai.expires >
        Date.now(),
    );
  } finally {
    accounts.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP adapter validates input, accepts prompt replies, and returns no-store secret-free JSON", async () => {
  const runtime = fakeRuntime(
    async (_id, _type, interaction: AuthInteraction) => {
      assert.equal(
        await interaction.prompt({ type: "secret", message: "Key" }),
        secret,
      );
      return credential;
    },
  );
  const accounts = new ProviderAccounts(async () => runtime, false);
  const app = express();
  app.use(express.json());
  installProviderAccountRoutes(app, accounts);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/provider-accounts`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const bad = await post("/login", {
      providerId: "xai",
      method: "invalid",
      secret,
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.text()).includes(secret), false);
    const response = await post("/login", {
      providerId: "xai",
      method: "api_key",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    const { id } = await response.json();
    await until(() => !!accounts.get(id).prompt);
    const answer = await post(`/login/${id}/answer`, {
      promptId: accounts.get(id).prompt!.id,
      value: secret,
    });
    assert.equal(answer.status, 200);
    assert.equal((await answer.text()).includes(secret), false);
    await until(() => accounts.get(id).status === "connected");
    assert.equal((await (await fetch(base)).text()).includes(secret), false);
    assert.equal((await fetch(`${base}/login/not-an-id`)).status, 400);
  } finally {
    accounts.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
