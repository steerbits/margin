import { test, expect } from "@playwright/test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { modelKey, type SettingsView } from "../../shared/settings.ts";

test("gateway owns shared defaults and supplies fresh creation-time values to every workspace", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/settings")).status()).toBe(401);
  expect((await request.put("/api/settings", { data: {} })).status()).toBe(401);
  const { url } = JSON.parse(
    readFileSync(".margin-data/gateway-test-link.json", "utf8"),
  );
  const folders = [
    mkdtempSync(join(tmpdir(), "margin-defaults-a-")),
    mkdtempSync(join(tmpdir(), "margin-defaults-b-")),
  ];
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  const before = (await (
    await page.request.get("/api/settings")
  ).json()) as SettingsView;
  const model = before.models.find(
    (m) =>
      m.backend === "pi" &&
      m.thinkingLevels?.includes("high") &&
      m.thinkingLevels.includes("low"),
  )!;
  expect(model).toBeTruthy();
  const saved = {
    defaultModel: {
      id: model.id,
      provider: model.provider,
      backend: model.backend,
    },
    defaultThinkingLevel: "high",
  };
  const create = async (projectId: string) => {
    // A stale/malicious caller cannot inject its own app defaults into a worker.
    const response = await page.request.post("/api/sessions", {
      data: {
        projectId,
        defaults: { defaultModel: null, defaultThinkingLevel: "off" },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const id = (await response.json()).session.id;
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/sessions/${id}`)).json())
            .thinking?.level,
      )
      .toBe("high");
    const state = await (await page.request.get(`/api/sessions/${id}`)).json();
    expect(modelKey(state.session.model)).toBe(modelKey(model));
    return id as string;
  };
  try {
    const savedResponse = await page.request.put("/api/settings", {
      data: saved,
    });
    expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
    const ids: string[] = [];
    for (const folder of folders) {
      const project = await (
        await page.request.post("/api/projects", { data: { path: folder } })
      ).json();
      ids.push(await create(project.id));
    }
    await page.goto(`/chats/${ids[1]}`);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(
      dialog.getByLabel("Default model", { exact: true }),
    ).toHaveValue(modelKey(model));
    await expect(dialog.getByLabel("Thinking effort")).toHaveValue("high");
    await dialog.getByLabel("Thinking effort").selectOption("low");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    for (const id of ids)
      expect(
        (await (await page.request.get(`/api/sessions/${id}`)).json()).thinking
          .level,
      ).toBe("high");
    await page.getByRole("button", { name: /New conversation.*⌘/ }).click();
    await expect(page).not.toHaveURL(`/chats/${ids[1]}`);
    await expect(
      page.getByRole("combobox", { name: "Thinking effort", exact: true }),
    ).toHaveValue("low");
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(dialog.getByLabel("Thinking effort")).toHaveValue("low");
  } finally {
    await page.request.put("/api/settings", { data: before.settings });
    for (const folder of folders)
      rmSync(folder, { recursive: true, force: true });
  }
});
