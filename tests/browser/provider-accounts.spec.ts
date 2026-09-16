import { test, expect, type Page } from "@playwright/test";
import type {
  ProviderAccountsView,
  ProviderLogin,
} from "../../shared/provider-accounts.ts";
import { defaultSettings } from "../../shared/settings.ts";

function fixture() {
  const view: ProviderAccountsView = {
    readOnly: false,
    providers: [
      {
        id: "openai-codex",
        name: "ChatGPT / Codex",
        configured: true,
        authType: "oauth",
        stored: true,
        methods: [{ type: "oauth", label: "Sign in with OpenAI" }],
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
        id: "xai",
        name: "xAI (Grok)",
        configured: false,
        stored: false,
        methods: [
          { type: "oauth", label: "Sign in with SuperGrok or X Premium" },
          { type: "api_key", label: "Use API key" },
        ],
      },
      {
        id: "external",
        name: "External cloud",
        configured: true,
        stored: false,
        authType: "api_key",
        methods: [],
      },
    ],
  };
  return view;
}
async function mockAccounts(page: Page, view: ProviderAccountsView) {
  let flow: ProviderLogin | undefined;
  let cancelled = 0;
  let removed = 0;
  let lost = false;
  let polls = 0;
  const answers: string[] = [];
  await page.route(/\/api\/provider-accounts(?:\/.*)?$/, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/provider-accounts",
      "",
    );
    const method = route.request().method();
    if (method === "GET" && path.startsWith("/login/")) polls++;
    if (lost && method === "GET" && path.startsWith("/login/"))
      return route.fulfill({
        status: 400,
        json: { error: "This sign-in is no longer available. Start again." },
      });
    if (!path) return route.fulfill({ json: { ...view, login: flow } });
    if (path === "/login" && method === "POST") {
      const body = route.request().postDataJSON();
      flow = {
        id: crypto.randomUUID(),
        providerId: body.providerId,
        method: body.method,
        status: "pending",
        events: [],
        expiresAt: Date.now() + 600_000,
      };
      if (body.method === "api_key")
        flow.prompt = {
          id: crypto.randomUUID(),
          type: "secret",
          message: "Enter API key",
        };
      else if (body.providerId === "xai")
        flow.events = [
          {
            type: "device_code",
            userCode: "ABCD-EFGH",
            verificationUri: "https://auth.x.ai/activate",
          },
        ];
      else
        flow.prompt = {
          id: crypto.randomUUID(),
          type: "select",
          message: "Select login method",
          options: [
            { id: "browser", label: "Browser login" },
            { id: "device", label: "Device code login" },
          ],
        };
    } else if (path.endsWith("/answer")) {
      const { value } = route.request().postDataJSON();
      if (value.startsWith("!"))
        return route.fulfill({
          status: 400,
          json: { error: "Enter a literal API key, not a shell command." },
        });
      answers.push(value);
      if (flow?.prompt?.type === "select") {
        flow.prompt = {
          id: crypto.randomUUID(),
          type: "manual_code",
          message: "Paste authorization code / redirect URL",
        };
        flow.events = [
          {
            type: "auth_url",
            url: "https://example.com/authorize",
            instructions:
              "Finish sign-in in the browser, or paste the redirect here.",
          },
        ];
      } else if (flow) {
        delete flow.prompt;
        flow.events = [];
        flow.status = flow.method === "api_key" ? "connected" : "error";
        flow.message =
          flow.method === "api_key"
            ? "Credentials saved."
            : "Sign-in failed. Try again.";
      }
    } else if (method === "DELETE") {
      if (path.startsWith("/login/") && flow) {
        cancelled++;
        flow.status = "cancelled";
        delete flow.prompt;
        flow.events = [];
      } else {
        removed++;
        view.providers.find((p) => p.id === path.slice(1))!.stored = false;
        return route.fulfill({ json: {} });
      }
    }
    await route.fulfill({ json: flow });
  });
  return {
    get flow() {
      return flow!;
    },
    get cancelled() {
      return cancelled;
    },
    get removed() {
      return removed;
    },
    answers,
    get polls() {
      return polls;
    },
    set lost(value: boolean) {
      lost = value;
    },
  };
}
async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByLabel("Default model")).toBeEnabled();
  if (
    !(await dialog
      .locator("details.settings-accounts")
      .evaluate((el) => (el as HTMLDetailsElement).open))
  )
    await dialog.locator(".settings-accounts > summary").click();
  const add = dialog.getByRole("button", { name: "+ Add connection", exact: true });
  if (await add.isVisible()) await add.click();
  await dialog.locator(".provider-browse > summary").click();
  return dialog;
}

test("Grok device sign-in works in Settings on mobile, refreshes models, and autosaves default edits independently", async ({
  page,
}) => {
  const view = fixture();
  const state = await mockAccounts(page, view);
  let saves = 0;
  const claude = {
    id: "claude-fixture",
    name: "Claude fixture",
    provider: "anthropic",
    backend: "pi",
    subscription: true,
    thinkingLevels: ["low", "high"],
  };
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "PUT") saves++;
    return route.fulfill({
      json: {
        settings: defaultSettings,
        models: state.flow?.status === "connected" ? [claude] : [],
      },
    });
  });
  const dialog = await openSettings(page);
  await dialog.getByLabel("Find a provider").fill("grok");
  await expect(dialog.getByLabel("Provider", { exact: true })).toHaveValue(
    "xai",
  );
  await dialog
    .getByRole("button", { name: "Sign in with SuperGrok or X Premium" })
    .click();
  await expect(dialog.getByText("ABCD-EFGH")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("link", { name: "Open verification page" }),
  ).toHaveAttribute("href", "https://auth.x.ai/activate");
  await expect(
    dialog.getByRole("link", { name: "Open verification page" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await dialog.getByText("ABCD-EFGH").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".margin-data/provider-accounts-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByText("ABCD-EFGH").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".margin-data/provider-accounts-mobile.png" });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  state.flow.status = "connected";
  state.flow.events = [];
  state.flow.message = "Credentials saved.";
  view.providers.find((p) => p.id === "xai")!.configured = true;
  await expect(dialog.getByText("Credentials saved.")).toBeVisible();
  await expect(
    dialog
      .getByLabel("Default model")
      .locator("option", { hasText: "Claude fixture" }),
  ).toHaveCount(1);
  await dialog
    .getByLabel("Default model")
    .selectOption({ label: "Anthropic • Claude fixture (extra usage)" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(saves).toBe(1);
  expect(state.cancelled).toBe(0);
});

test("browser fallback, errors, secret entry, shared logout confirmation and closing cancellation", async ({
  page,
}) => {
  const state = await mockAccounts(page, fixture());
  const dialog = await openSettings(page);
  await dialog.getByLabel("Provider", { exact: true }).selectOption("openai-codex");
  await dialog.getByRole("button", { name: "Sign in with OpenAI" }).click();
  await dialog.getByLabel("Select login method").selectOption("browser");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    dialog.getByRole("link", { name: "Open sign-in page" }),
  ).toBeVisible();
  await dialog
    .getByLabel("Paste authorization code / redirect URL")
    .fill("https://localhost/callback?code=fixture&state=fixture");
  await dialog
    .getByRole("button", { name: "Submit code / redirect URL" })
    .click();
  await expect(dialog.getByText("Sign-in failed. Try again.")).toBeVisible();
  await dialog
    .getByLabel("Provider", { exact: true })
    .selectOption("anthropic");
  await expect(dialog.getByText(/separately billed extra usage/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "Use API key", exact: true })
    .click();
  const input = dialog.getByLabel("Enter API key");
  await expect(input).toHaveAttribute("type", "password");
  await input.fill("!echo key");
  await dialog.getByRole("button", { name: "Save API key", exact: true }).click();
  await expect(
    dialog.getByText("Enter a literal API key, not a shell command."),
  ).toBeVisible();
  const beforePolls = state.polls;
  await expect.poll(() => state.polls).toBeGreaterThan(beforePolls + 1);
  await expect(
    dialog.getByText("Enter a literal API key, not a shell command."),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await input.fill("fixture-secret");
  await dialog.getByRole("button", { name: "Save API key", exact: true }).click();
  await expect(dialog.getByText("Credentials saved.")).toBeVisible();
  expect(state.answers).toContain("fixture-secret");
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("fixture-secret");
  await dialog
    .getByLabel("Provider", { exact: true })
    .selectOption("openai-codex");
  await dialog.getByRole("button", { name: "Remove saved login…" }).click();
  await expect(dialog.getByText(/This also affects\s+terminal sessions sharing these credentials/)).toBeVisible();
  expect(state.removed).toBe(0);
  await dialog.getByRole("button", { name: "Keep login" }).click();
  await dialog.getByRole("button", { name: "Remove saved login…" }).click();
  await dialog
    .getByRole("button", { name: "Remove saved credentials", exact: true })
    .click();
  await expect.poll(() => state.removed).toBe(1);
  await dialog.getByLabel("Provider", { exact: true }).selectOption("external");
  await expect(dialog.getByText(/Interactive login is unavailable/)).toBeVisible();
  await dialog.getByLabel("Provider", { exact: true }).selectOption("xai");
  await dialog
    .getByRole("button", { name: "Sign in with SuperGrok or X Premium" })
    .click();
  await expect(dialog.getByText("ABCD-EFGH")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.cancelled).toBe(1);
});

test("a server-lost login has a retry path rather than a permanently disabled form", async ({
  page,
}) => {
  const state = await mockAccounts(page, fixture());
  const dialog = await openSettings(page);
  await dialog.getByLabel("Provider", { exact: true }).selectOption("xai");
  await dialog
    .getByRole("button", { name: "Sign in with SuperGrok or X Premium" })
    .click();
  await expect(dialog.getByText("ABCD-EFGH")).toBeVisible();
  state.lost = true;
  await expect(
    dialog.getByText("This sign-in is no longer available. Start again."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Sign in with SuperGrok or X Premium" }),
  ).toBeEnabled();
  state.lost = false;
  await dialog
    .getByRole("button", { name: "Sign in with SuperGrok or X Premium" })
    .click();
  await expect(dialog.getByText("ABCD-EFGH")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect.poll(() => state.cancelled).toBe(1);
});

test("real native host exposes read-only account status and rejects credential mutations", async ({
  page,
}) => {
  const dialog = await openSettings(page);
  await expect(
    dialog.getByText(/Account changes are disabled by MARGIN_AUTH_READ_ONLY/),
  ).toBeVisible();
  await dialog.getByLabel("Provider", { exact: true }).selectOption("xai");
  await expect(
    dialog.getByRole("button", { name: "Sign in with SuperGrok or X Premium" }),
  ).toBeDisabled();
  const res = await page.request.post("/api/provider-accounts/login", {
    data: { providerId: "xai", method: "oauth" },
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("MARGIN_AUTH_READ_ONLY");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
});
