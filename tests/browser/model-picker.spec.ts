import { test, expect, type Locator, type Page } from "@playwright/test";
import type { ModelInfo } from "../../shared/types.ts";
import {
  defaultSettings,
  modelKey,
  type MarginSettings,
} from "../../shared/settings.ts";

function fixtures(): ModelInfo[] {
  return [
    {
      id: "local",
      provider: "llama-cpp",
      name: "Local coder",
      connectionSource: "custom",
      subscription: false,
    },
    {
      id: "same-model",
      provider: "openrouter",
      name: "Anthropic: Claude Sonnet",
      connectionSource: "key",
      subscription: false,
    },
    {
      id: "same-model",
      provider: "anthropic",
      name: "Claude Sonnet",
      connectionSource: "saved",
      subscription: true,
      thinkingLevels: ["low", "high"],
    },
    {
      id: "codex",
      provider: "openai-codex",
      name: "GPT Codex",
      connectionSource: "saved",
      subscription: true,
      thinkingLevels: ["low", "high"],
    },
  ];
}
async function mockModels(page: Page, models: ModelInfo[]) {
  let settings: MarginSettings = { ...defaultSettings };
  await page.route("**/api/bootstrap*", async (route) => {
    const response = await route.fetch();
    const boot = await response.json();
    await route.fulfill({ json: { ...boot, models } });
  });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT")
      settings = route.request().postDataJSON();
    await route.fulfill({ json: { settings, models } });
  });
  return {
    get settings() {
      return settings;
    },
  };
}
async function expectGroups(select: Locator) {
  await expect(select.locator("optgroup")).toHaveCount(3);
  expect(
    await select
      .locator("optgroup")
      .evaluateAll((groups) => groups.map((g) => g.getAttribute("label"))),
  ).toEqual(["Saved Connections", "Keys", "Custom"]);
  await expect(select.locator(":scope > hr")).toHaveCount(2);
  expect(
    await select.evaluate((el) =>
      [...el.children]
        .filter((child) => child.tagName !== "OPTION")
        .map((child) => child.tagName),
    ),
  ).toEqual(["OPTGROUP", "HR", "OPTGROUP", "HR", "OPTGROUP"]);
}

test("welcome and Settings share ordered groups, provider-first labels, exact identities and separators", async ({
  page,
}) => {
  const models = fixtures();
  const state = await mockModels(page, models);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/");
  const welcome = page.getByLabel("Start with a model");
  await expectGroups(welcome);
  await expect(
    welcome.locator("optgroup[label='Saved Connections'] option"),
  ).toHaveText(["Anthropic • Claude Sonnet", "ChatGPT / Codex • GPT Codex"]);
  await expect(welcome.locator("optgroup[label='Keys'] option")).toHaveText([
    "OpenRouter • Anthropic: Claude Sonnet",
  ]);
  await expect(welcome.locator("optgroup[label='Custom'] option")).toHaveText([
    "llama.cpp • Local coder",
  ]);
  const requests: { model: ModelInfo }[] = [];
  await page.route("**/api/sessions", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      status: 400,
      json: { error: "Fixture stops before creating an agent." },
    });
  });
  await welcome.selectOption({
    label: "OpenRouter • Anthropic: Claude Sonnet",
  });
  await page
    .getByRole("button", { name: "Start a conversation", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].model.provider).toBe("openrouter");
  expect(requests[0].model.id).toBe("same-model");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const defaults = dialog.getByLabel("Default model");
  await expectGroups(defaults);
  await expect(
    defaults.locator("optgroup[label='Saved Connections'] option"),
  ).toHaveText([
    "Anthropic • Claude Sonnet (extra usage)",
    "ChatGPT / Codex • GPT Codex (subscription)",
  ]);
  await defaults.selectOption(modelKey(models[1]));
  models[1].connectionSource = "saved";
  await dialog
    .getByRole("button", { name: "Refresh available models" })
    .click();
  await expect(defaults.locator("optgroup[label='Keys']")).toHaveCount(0);
  await expect(defaults.locator(":scope > hr")).toHaveCount(1);
  await expect(defaults).toHaveValue(modelKey(models[1]));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  expect(state.settings.defaultModel).toEqual({
    id: "same-model",
    provider: "openrouter",
  });
  // Refresh can remove the explicit new-chat choice. Do not silently fall back
  // to Automatic or send a session request for a different provider.
  models.splice(1, 1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(defaults.locator("option:checked")).toHaveText(
    /\(unavailable\)$/,
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(welcome.locator("option:checked")).toHaveText(
    "Selected model unavailable — choose another",
  );
  await expect(
    page.getByRole("button", { name: "Start a conversation", exact: true }),
  ).toBeDisabled();
  models.splice(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(dialog.locator("details.settings-accounts")).toHaveAttribute("open", "");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(welcome).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect an AI provider", exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(
    consoleErrors.filter((text) =>
      /select|optgroup|<hr>|hydration/i.test(text),
    ),
  ).toEqual([]);
});

test("chat model picker keeps routed identities and an unavailable current model never looks switched", async ({
  page,
}) => {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", {
    data: { empty: true },
  });
  expect(response.ok()).toBe(true);
  const { id, snapshot } = await response.json();
  const current = snapshot.session.model as ModelInfo;
  const models = [
    ...fixtures(),
    { ...current, connectionSource: "saved" as const },
  ];
  await mockModels(page, models);
  const modelChanges: { provider: string; id: string }[] = [];
  await page.route(`**/api/sessions/${id}/model`, (route) => {
    modelChanges.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await page.goto(`/chats/${id}`);
  const select = page.getByLabel("Model", { exact: true });
  await expect(select).toBeEnabled();
  await expectGroups(select);
  await select.selectOption({ label: "OpenRouter • Anthropic: Claude Sonnet" });
  await expect.poll(() => modelChanges.length).toBe(1);
  expect(modelChanges[0]).toEqual({ provider: "openrouter", id: "same-model" });
  // The server never changed the model in this test; removing it from available
  // choices must retain an explicit disabled marker rather than display row 1.
  models.pop();
  await page.reload();
  await expect(select.locator("option:checked")).toHaveText(/\(unavailable\)$/);
  await expect(select.locator("option:checked")).toBeDisabled();
  expect(
    (await (await page.request.get(`/api/sessions/${id}`)).json()).session.model
      .id,
  ).toBe(current.id);
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(select).toBeInViewport({ ratio: 1 });
  const bounds = await select.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: ".margin-data/grouped-model-chat-mobile.png" });
  models.splice(0);
  await page.reload();
  await expect(select).toBeDisabled();
  await expect(select.locator("option:checked")).toHaveText(
    "Configure a model in Settings",
  );
  await page
    .getByRole("button", { name: "Open Settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
});

test("empty pickers explain setup and link directly to provider accounts without fake selectable models", async ({
  page,
}) => {
  await mockModels(page, []);
  await page.goto("/");
  await expect(page.getByLabel("Start with a model")).toHaveCount(0);
  await page.getByRole("button", { name: "Connect an AI provider", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByLabel("Default model").locator("option")).toHaveText(
    ["Connect a provider first"],
  );
  await expect(dialog.locator("details.settings-accounts")).toHaveAttribute("open", "");
  await dialog.locator(".settings-accounts > summary").click();
  await dialog
    .getByRole("button", { name: "Connect a provider", exact: true })
    .click();
  await expect(dialog.locator("details.settings-accounts")).toHaveAttribute("open", "");
});

test("native group headers and keyboard selection work in an expanded listbox preview", async ({
  page,
}) => {
  await mockModels(page, fixtures());
  await page.goto("/");
  const select = page.getByLabel("Start with a model");
  await expectGroups(select);
  // OS popups are outside page screenshots. Expand the same options into a
  // native listbox to review group labels and keyboard navigation. Chromium
  // omits <hr> in listbox mode; this is not a visual test of the popup's rules.
  await select.evaluate((el) => {
    (el as HTMLSelectElement).size = 12;
  });
  await expect(select.locator("optgroup").first()).toBeVisible();
  await select.focus();
  await page.keyboard.press("End");
  await expect(select.locator("option:checked")).toHaveText(
    "llama.cpp • Local coder",
  );
  await page.keyboard.press("ArrowUp");
  await expect(select.locator("option:checked")).toHaveText(
    "OpenRouter • Anthropic: Claude Sonnet",
  );
  await page.screenshot({
    path: ".margin-data/grouped-model-listbox-preview.png",
  });
});
