import { test, expect } from "@playwright/test";
import {
  defaultSettings,
  modelKey,
  type SettingsView,
} from "../../shared/settings.ts";

test("settings save new-chat defaults, preserve existing chats, cancel edits, and work on mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toBeVisible();
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const before = (await (
    await page.request.get("/api/settings")
  ).json()) as SettingsView;
  const model = before.models.find(
    (m) => m.backend === "pi" && m.thinkingLevels?.includes("high"),
  )!;
  expect(model).toBeTruthy();
  const reference = {
    id: model.id,
    provider: model.provider,
    backend: model.backend,
  };
  const firstResponse = await page.request.post("/api/sessions", {
    data: { projectId: boot.projects[0].id },
  });
  expect(firstResponse.ok(), await firstResponse.text()).toBe(true);
  const first = (await firstResponse.json()).session.id;
  await page.goto(`/chats/${first}`);
  await expect(
    page.getByRole("combobox", { name: "Thinking effort", exact: true }),
  ).toBeVisible();
  const initial = await (
    await page.request.get(`/api/sessions/${first}`)
  ).json();
  const originalLevel = initial.thinking.available.find(
    (level: string) => level !== "high",
  );
  expect(
    (
      await page.request.post(`/api/sessions/${first}/thinking`, {
        data: { level: originalLevel },
      })
    ).ok(),
  ).toBe(true);
  const original = await (
    await page.request.get(`/api/sessions/${first}`)
  ).json();
  const button = page.getByRole("button", { name: "Settings", exact: true });
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  try {
    await button.click();
    await expect(
      dialog.getByLabel("Default model", { exact: true }),
    ).toBeEnabled();
    await dialog
      .getByLabel("Default model", { exact: true })
      .selectOption(modelKey(model));
    await dialog
      .getByLabel("Thinking effort", { exact: true })
      .selectOption("high");
    await expect(
      dialog.getByLabel("Thinking effort").locator("option"),
    ).toHaveCount(model.thinkingLevels!.length + 1);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const saved = { defaultModel: reference, defaultThinkingLevel: "high" };
    expect(
      (await (await page.request.get("/api/settings")).json()).settings,
    ).toEqual(saved);
    const unchanged = await (
      await page.request.get(`/api/sessions/${first}`)
    ).json();
    expect(unchanged.thinking).toEqual(original.thinking);
    expect(unchanged.session.model).toEqual(original.session.model);
    await page.reload();
    await button.click();
    await expect(
      dialog.getByLabel("Default model", { exact: true }),
    ).toHaveValue(modelKey(model));
    await expect(dialog.getByLabel("Thinking effort")).toHaveValue("high");
    await page.screenshot({ path: ".margin-data/settings-desktop.png" });
    await dialog.getByLabel("Thinking effort").selectOption("");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      (await (await page.request.get("/api/settings")).json()).settings,
    ).toEqual(saved);
    await page.getByRole("button", { name: /New conversation.*⌘/ }).click();
    await expect(page).not.toHaveURL(`/chats/${first}`);
    await expect(
      page.getByRole("combobox", { name: "Thinking effort", exact: true }),
    ).toHaveValue("high");
    const next = page.url().match(/\/chats\/([^/?]+)/)![1];
    const state = await (
      await page.request.get(`/api/sessions/${next}`)
    ).json();
    expect(state.session.model.id).toBe(model.id);
    expect(state.session.model.provider).toBe(model.provider);
    await page.setViewportSize({ width: 390, height: 844 });
    await button.click();
    await expect(
      dialog.getByLabel("Default model", { exact: true }),
    ).toHaveValue(modelKey(model));
    await page.screenshot({ path: ".margin-data/settings-mobile.png" });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  } finally {
    await page.request.put("/api/settings", { data: before.settings });
  }
});

test("failed saves retain edits; unavailable models and unsupported thinking have recovery paths", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  const models: SettingsView["models"] = [
    {
      id: "reasoner",
      provider: "test",
      name: "Reasoner",
      subscription: false,
      thinkingLevels: ["low", "high"],
    },
    {
      id: "plain",
      provider: "test",
      name: "Plain",
      subscription: false,
      thinkingLevels: ["off"],
    },
  ];
  let settings = { ...defaultSettings };
  let failSave = true;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") {
      if (failSave)
        return route.fulfill({
          status: 400,
          json: { error: "Storage is temporarily unavailable." },
        });
      settings = route.request().postDataJSON();
    }
    await route.fulfill({ json: { settings, models } });
  });
  const button = page.getByRole("button", { name: "Settings", exact: true });
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await button.click();
  await dialog
    .getByLabel("Default model", { exact: true })
    .selectOption(modelKey(models[0]));
  await dialog.getByLabel("Thinking effort").selectOption("high");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Storage is temporarily unavailable.",
  );
  await expect(dialog.getByLabel("Thinking effort")).toHaveValue("high");
  await dialog
    .getByLabel("Default model", { exact: true })
    .selectOption(modelKey(models[1]));
  await expect(dialog.getByLabel("Thinking effort")).toHaveValue("");
  await expect(dialog.getByRole("status")).toContainText("reset");
  await expect(
    dialog.getByLabel("Thinking effort").locator("option"),
  ).toHaveCount(2);
  failSave = false;
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  settings = {
    defaultModel: { id: "removed", provider: "test" },
    defaultThinkingLevel: "high",
  };
  await button.click();
  await expect(dialog.getByLabel("Default model", { exact: true })).toHaveValue(
    modelKey(settings.defaultModel),
  );
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(/The saved model is unavailable/),
  ).toBeVisible();
  await dialog
    .getByLabel("Default model", { exact: true })
    .selectOption(modelKey(models[0]));
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});
