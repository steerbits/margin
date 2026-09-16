import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { defaultSettings } from "../../shared/settings.ts";
import type { ModelInfo } from "../../shared/types.ts";
import type {
  ProviderAccountsView,
  ProviderLogin,
} from "../../shared/provider-accounts.ts";

const screenshots = ".margin-data/ai-connections-review";
let endpoint: string;
let server: Server;
const received: { authorization?: string; body: any }[] = [];
test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
  server = createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ data: [{ id: "local-coder", owned_by: "llamacpp" }] }),
      );
      return;
    }
    if (req.url?.startsWith("/props")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ default_generation_settings: { n_ctx: 4096 } }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    if (JSON.parse(body).model === "missing-model") {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: "Unknown model" } }));
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.end(
      'data: {"id":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":null}]}\n\n' +
        'data: {"id":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
        "data: [DONE]\n\n",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function setup(page: Page, realCustom = false) {
  let models: ModelInfo[] = [];
  let login: ProviderLogin | undefined;
  const answers: string[] = [];
  const accounts: ProviderAccountsView = {
    readOnly: false,
    providers: [
      {
        id: "openai-codex",
        name: "ChatGPT / Codex",
        configured: false,
        stored: false,
        methods: [{ type: "oauth", label: "Sign in with OpenAI" }],
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        configured: false,
        stored: false,
        methods: [
          { type: "oauth", label: "Sign in with OpenRouter" },
          { type: "api_key", label: "Use API key" },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic (Claude)",
        configured: false,
        stored: false,
        methods: [
          { type: "oauth", label: "Sign in with Claude" },
          { type: "api_key", label: "Use API key" },
        ],
      },
      {
        id: "google",
        name: "Google (Gemini)",
        configured: false,
        stored: false,
        methods: [{ type: "api_key", label: "Use API key" }],
      },
    ],
  };
  await page.route("**/api/bootstrap*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), models, sessions: [] },
    });
  });
  await page.route("**/api/settings", async (route) => {
    if (realCustom) return route.continue();
    return route.fulfill({ json: { settings: defaultSettings, models } });
  });
  if (!realCustom)
    await page.route("**/api/custom-connections", (route) =>
      route.fulfill({ json: { connections: [], readOnly: false } }),
    );
  await page.route(/\/api\/provider-accounts(?:\/.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const body = method === "POST" ? route.request().postDataJSON() : undefined;
    if (url.pathname.endsWith("/provider-accounts"))
      return route.fulfill({ json: { ...accounts, login } });
    if (url.pathname.endsWith("/login") && method === "POST") {
      login = {
        id: "browser-fixture-login",
        providerId: body.providerId,
        method: body.method,
        status: "pending",
        expiresAt: Date.now() + 600000,
        events: [],
        prompt:
          body.method === "api_key"
            ? { id: "key", type: "secret", message: "Enter API key" }
            : undefined,
      };
      if (body.method === "oauth")
        login.events = [
          {
            type: "auth_url",
            url: "https://auth.openai.com/authorize",
            instructions:
              "Sign in with your ChatGPT account, then return to Margin.",
          },
        ];
    } else if (url.pathname.endsWith("/answer")) {
      answers.push(body.value);
      if (body.value === "invalid-fixture-key") {
        login!.status = "error";
        login!.message = "Sign-in failed. Check your API key and try again.";
      } else {
        login!.status = "connected";
        login!.message = "Connection saved.";
        const provider = accounts.providers.find(
          (p) => p.id === login!.providerId,
        )!;
        provider.configured = true;
        provider.stored = true;
        models = [
          {
            provider: provider.id,
            id: "connected-model",
            name: "Connected model",
            connectionSource: "saved",
            subscription: false,
            thinkingLevels: ["off"],
          },
        ];
      }
      login!.prompt = undefined;
    } else if (method === "DELETE") {
      login!.status = "cancelled";
      login!.events = [];
      login!.prompt = undefined;
    }
    return route.fulfill({ json: login });
  });
  return {
    answers,
    connectCodex() {
      login!.status = "connected";
      login!.events = [];
      accounts.providers[0].configured = true;
      accounts.providers[0].stored = true;
      models = [
        {
          provider: "openai-codex",
          id: "codex-fixture",
          name: "Codex",
          connectionSource: "saved",
          subscription: false,
          thinkingLevels: ["low", "high"],
        },
      ];
    },
  };
}
async function openConnections(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect an AI provider", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Settings", exact: true });
}
async function capture(page: Page, name: string) {
  await page.screenshot({
    path: `${screenshots}/${name}.png`,
    animations: "disabled",
  });
}

test("first installation and connection picker use the existing Settings overlay", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Connect an AI provider", exact: true }),
  ).toBeVisible();
  await capture(page, "01-first-install");
  await page
    .getByRole("button", { name: "Connect an AI provider", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.locator(".settings-accounts")).toHaveAttribute(
    "open",
    "",
  );
  await expect(
    dialog.getByRole("button", { name: /ChatGPT \/ Codex/ }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Add custom connection/ }),
  ).toBeVisible();
  await capture(page, "02-ai-connections");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(dialog.getByText("Choose your AI provider")).toBeVisible();
});

test("OpenRouter API key entry, invalid key recovery and model refresh", async ({
  page,
}) => {
  const state = await setup(page);
  const dialog = await openConnections(page);
  await dialog.getByRole("button", { name: /OpenRouter Sign in or/ }).click();
  await expect(
    dialog.getByRole("link", { name: /Create an API key on OpenRouter/ }),
  ).toHaveAttribute("href", "https://openrouter.ai/settings/keys");
  await dialog
    .getByRole("button", { name: "Use API key", exact: true })
    .click();
  await dialog
    .getByLabel("Enter API key", { exact: true })
    .fill("invalid-fixture-key");
  await dialog
    .getByRole("button", { name: "Save API key", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Check your API key");
  await dialog
    .getByRole("button", { name: "Use API key", exact: true })
    .click();
  await dialog
    .getByLabel("Enter API key", { exact: true })
    .fill("screenshot-fixture-key");
  await dialog.locator(".account-login").scrollIntoViewIfNeeded();
  await capture(page, "03-openrouter-api-key");
  await dialog
    .getByRole("button", { name: "Save API key", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Default model").locator("option"),
  ).toContainText(["Connected model"]);
  expect(state.answers).toEqual([
    "invalid-fixture-key",
    "screenshot-fixture-key",
  ]);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("fixture-key");
});

test("Codex browser handoff, cancel, retry and return to model selection", async ({
  page,
}) => {
  const state = await setup(page);
  const dialog = await openConnections(page);
  await dialog
    .getByRole("button", { name: /ChatGPT \/ Codex Use your/ })
    .click();
  await dialog
    .getByRole("button", { name: "Sign in with OpenAI", exact: true })
    .click();
  await expect(
    dialog.getByRole("link", { name: "Open sign-in page" }),
  ).toHaveAttribute("href", /^https:\/\/auth.openai.com/);
  await dialog.locator(".account-login").scrollIntoViewIfNeeded();
  await capture(page, "04-codex-sign-in");
  await dialog
    .getByRole("button", { name: "Cancel sign-in", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Sign in with OpenAI", exact: true })
    .click();
  state.connectCodex();
  await expect(
    dialog.getByLabel("Default model").locator("option"),
  ).toContainText(["Codex"]);
});

test("custom form preserves explicit auth choice, manual IDs and advanced fields on mobile", async ({
  page,
}) => {
  await setup(page);
  const dialog = await openConnections(page);
  await dialog.getByRole("button", { name: /Add custom connection/ }).click();
  await expect(
    dialog.getByLabel("Authentication", { exact: true }),
  ).toHaveValue("api_key");
  await expect(dialog.getByLabel("API key", { exact: true })).toBeVisible();
  await dialog
    .getByLabel("Base URL", { exact: true })
    .fill("https://gateway.example.com/v1");
  await dialog.getByLabel("Model ID", { exact: true }).fill("team-coder");
  await dialog
    .getByLabel("API key", { exact: true })
    .fill("example-only-not-a-real-key");
  await capture(page, "05-custom-api-key");
  await dialog
    .getByLabel("Authentication", { exact: true })
    .selectOption("none");
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveCount(0);
  await dialog
    .getByLabel("Base URL", { exact: true })
    .fill("http://localhost:8080/v1");
  await capture(page, "06-custom-local");
  await dialog.locator(".connection-advanced > summary").click();
  await dialog
    .getByLabel("Connection name", { exact: true })
    .fill("My local model");
  await dialog
    .getByLabel("Context size (tokens)", { exact: true })
    .fill("4096");
  await dialog.locator(".connection-advanced").scrollIntoViewIfNeeded();
  await capture(page, "07-custom-advanced");
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.locator(".connection-advanced > summary").click();
  await dialog.locator(".custom-connection-form").scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await capture(page, "08-custom-mobile");
});

test("custom test-and-save reaches a real HTTP server, persists, refreshes models, and supports edit/remove", async ({
  page,
}) => {
  await setup(page, true);
  const dialog = await openConnections(page);
  // The backend fixture has built-in models, so expand connections explicitly if needed.
  if (
    !(await dialog
      .locator(".settings-accounts")
      .evaluate((el) => (el as HTMLDetailsElement).open))
  )
    await dialog.locator(".settings-accounts > summary").click();
  await dialog.getByRole("button", { name: /Add custom connection/ }).click();
  await dialog.getByLabel("Base URL", { exact: true }).fill(endpoint);
  await dialog
    .getByLabel("Authentication", { exact: true })
    .selectOption("none");
  await dialog
    .getByRole("button", { name: "Find models", exact: true })
    .click();
  await expect(dialog.getByLabel("Model ID", { exact: true })).toHaveValue(
    "local-coder",
  );
  await dialog.getByLabel("Model ID", { exact: true }).fill("missing-model");
  await dialog
    .getByRole("button", { name: "Test & save", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "could not find this model",
  );
  await dialog.getByRole("alert").scrollIntoViewIfNeeded();
  await capture(page, "09-custom-error");
  await dialog.getByLabel("Model ID", { exact: true }).fill("local-coder");
  await dialog
    .getByRole("button", { name: "Test & save", exact: true })
    .click();
  await expect(
    dialog.getByText(/Reply received and connection saved/),
  ).toBeVisible();
  expect(received.at(-1)?.authorization).toBeUndefined();
  expect(received.at(-1)?.body.max_completion_tokens).toBe(64);
  await expect(
    dialog.getByLabel("Default model").locator("option"),
  ).toContainText(["local-coder"]);
  await dialog
    .getByText(/Reply received and connection saved/)
    .scrollIntoViewIfNeeded();
  await capture(page, "10-connection-ready");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.locator(".settings-accounts > summary").click();
  await expect(dialog.locator(".saved-custom-connection")).toContainText(
    "local-coder",
  );
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.locator(".connection-advanced > summary").click();
  await dialog
    .getByLabel("Connection name", { exact: true })
    .fill("My local coder");
  await dialog
    .getByRole("button", { name: "Test & save", exact: true })
    .click();
  await expect(dialog.locator(".saved-custom-connection")).toContainText(
    "My local coder",
  );
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(dialog.locator(".saved-custom-connection")).toHaveCount(0);
});
