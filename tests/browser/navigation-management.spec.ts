import { test, expect, type Page } from "@playwright/test";
import { openDefaultWorkspace } from "./navigation-helpers.ts";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

async function seed(page: Page, historyCount = 0) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", {
    data: { historyCount },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  return id as string;
}
const chatRow = (page: Page, id: string) =>
  page.locator(`.session-list button[data-session-id="${id}"]`);

test("conversation creation and selection change URLs; deep links, panels and Customize survive history and reload", async ({
  page,
  context,
}) => {
  const id = await seed(page);
  await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Keep this draft while navigating");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/chats/${id}\\?panel=project-notes%3Anotes$`),
  );
  await page.reload();
  await expect(page.getByLabel("Project notes", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this draft while navigating",
  );
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await expect(page).toHaveURL(/\/customize\/examples$/);
  await page.getByRole("button", { name: /^Plugins/ }).click();
  await expect(page).toHaveURL(/\/customize\/plugins$/);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Plugins/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/customize\/examples$/);
  await page.goBack();
  await expect(page.getByLabel("Project notes", { exact: true })).toBeVisible();
  const fresh = await context.newPage();
  await fresh.goto(`/chats/${id}`);
  await expect(
    fresh.getByRole("heading", { name: "A focused meeting-notes app" }),
  ).toBeAttached();
  await fresh.close();
  await page.locator("button.new-chat").click();
  await expect(page).not.toHaveURL(new RegExp(`/chats/${id}`));
  await expect(page).toHaveURL(/\/chats\/[a-f0-9-]{36}/);
  await chatRow(page, id).click();
  await expect(page).toHaveURL(new RegExp(`/chats/${id}`));
  await page.screenshot({
    path: ".margin-data/navigation-desktop.png",
    fullPage: true,
  });
  await page.goto(`/chats/${randomUUID()}`);
  await expect(
    page.getByRole("heading", { name: "Destination unavailable" }),
  ).toBeVisible();
});

test("Back preserves an unsaved inline comment and stays on its conversation", async ({
  page,
}) => {
  const id = await seed(page);
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await page.getByRole("button", { name: "Back to conversation" }).click();
  await page
    .getByRole("button", { name: "Comment on reply", exact: true })
    .click();
  await page.getByLabel("Inline comment").fill("Do not lose this");
  const before = page.url();
  await page.goBack();
  await expect(page).toHaveURL(before);
  await expect(page.getByLabel("Inline comment")).toHaveValue(
    "Do not lose this",
  );
  await expect(page.getByRole("alert")).toContainText("draft comment");
});

test("workspace names persist without moving folders, and recents retain searchable access to all", async ({
  page,
}) => {
  await page.goto("/");
  const folder = mkdtempSync(join(tmpdir(), "margin-navigation-projects-"));
  try {
    const projects: { id: string; path: string; name: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const path = join(folder, `Project ${i}`);
      mkdirSync(path);
      const result = await page.request.post("/api/projects", {
        data: { path },
      });
      projects.push(await result.json());
    }
    for (const project of projects) {
      await page.goto(`/workspaces/${project.id}`);
      await expect(
        page.getByRole("combobox", { name: "Project", exact: true }),
      ).toHaveValue(project.id);
    }
    const select = page.getByRole("combobox", { name: "Project", exact: true });
    await expect(select.locator('option:not([value="__all__"])')).toHaveCount(
      5,
    );
    await page
      .getByRole("combobox", { name: "Project", exact: true })
      .selectOption("__all__");
    await page
      .getByRole("textbox", { name: "Search workspaces" })
      .fill("Project 0");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Project 0/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${projects[0].id}$`));
    await page
      .getByRole("button", { name: "Rename workspace", exact: true })
      .click();
    await page
      .getByLabel("Workspace name", { exact: true })
      .fill("Customer Portal");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(select.locator("option:checked")).toHaveText(
      "Customer Portal",
    );
    await page.reload();
    await expect(select.locator("option:checked")).toHaveText(
      "Customer Portal",
    );
    const reopened = await (
      await page.request.post("/api/projects", {
        data: { path: projects[0].path },
      })
    ).json();
    expect(reopened).toMatchObject({
      id: projects[0].id,
      name: "Customer Portal",
      path: projects[0].path,
    });
    expect(existsSync(projects[0].path)).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("deletion requires Stop, confirms, removes native chat data and preserves shared notes", async ({
  page,
}) => {
  const id = await seed(page);
  const before = await (await page.request.get(`/api/sessions/${id}`)).json();
  await page.request.post(
    `/api/projects/${before.session.projectId}/plugins/project-notes/save`,
    { data: { text: "Shared workspace notes", revision: 0 } },
  );
  await page.request.post(`/api/test/${id}/dialog`, {
    data: { kind: "input" },
  });
  await chatRow(page, id).click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Delete conversation", exact: true }),
  ).toBeDisabled();
  expect(
    (await page.request.delete(`/api/sessions/${id}`, { data: {} })).status(),
  ).toBe(409);
  await page
    .getByRole("menuitem", { name: "Stop conversation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/sessions/${id}`)).json()).dialogs
          .length,
    )
    .toBe(0);
  await chatRow(page, id).click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Delete conversation", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("menuitem", { name: "Delete conversation", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await page.request.get(`/api/sessions/${id}`)).ok()).toBe(true);
  await chatRow(page, id).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete conversation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/workspaces/${before.session.projectId}$`),
  );
  expect((await page.request.get(`/api/sessions/${id}`)).ok()).toBe(false);
  expect(existsSync(before.session.sessionFile)).toBe(false);
  const notes = await (
    await page.request.post(
      `/api/projects/${before.session.projectId}/plugins/project-notes/load`,
      { data: {} },
    )
  ).json();
  expect(notes.result.note.text).toBe("Shared workspace notes");
  await page.goto(`/chats/${id}`);
  await expect(
    page.getByRole("heading", { name: "Destination unavailable" }),
  ).toBeVisible();
});

test("finished stays unread in Customize, across reload, and while the latest reply is offscreen", async ({
  page,
}) => {
  const id = await seed(page, 8);
  await page.bringToFront();
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await page.request.post(`/api/sessions/${id}/send`, {
    data: { id: randomUUID(), note: "Finish while away", commentIds: [] },
  });
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    1,
  );
  await page.reload();
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    1,
  );
  await chatRow(page, id).click();
  await expect(
    page.getByRole("heading", { name: "Revised direction" }),
  ).toBeVisible();
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    0,
  );
  // Reading an older section while a later reply arrives must leave that reply unread.
  await page.locator(".scroll-area").evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll"));
  });
  await page.request.post(`/api/sessions/${id}/send`, {
    data: {
      id: randomUUID(),
      note: "Another background reply",
      commentIds: [],
    },
  });
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    1,
  );
  await page.locator(".scroll-area").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll"));
  });
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    0,
  );
});

test("Shape with me is the first-message default; choosing another skill and deleting it have predictable fallbacks", async ({
  page,
}) => {
  await openDefaultWorkspace(page);
  const hub = await (await page.request.get("/api/customize")).json();
  const skills = join(hub.project.path, "skills");
  const original = join(skills, "shape-with-me", "SKILL.md");
  const source = readFileSync(original, "utf8");
  const extra = join(skills, "test-added-skill");
  mkdirSync(extra);
  writeFileSync(
    join(extra, "SKILL.md"),
    "---\nname: test-added-skill\ndescription: A fixture skill for testing selection.\n---\nRespond normally.\n",
  );
  try {
    await page.locator("button.new-chat").click();
    const picker = page.getByLabel("Starting skill");
    await expect(picker).toBeEnabled();
    await expect(picker).toHaveValue("shape-with-me");
    await expect(picker.locator("option:checked")).toHaveText("Shape with me");
    await expect(picker.locator('option[value="think-with-me"]')).toHaveCount(0);
    await picker.selectOption("test-added-skill");
    const chosen = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.locator("button.new-chat").click();
    await expect(picker).toHaveValue("shape-with-me");
    await chatRow(page, chosen).click();
    await expect(picker).toHaveValue("test-added-skill");
    await picker.selectOption("");
    // Resource reloads still preserve the selection, without a composer button.
    const reloaded = await page.request.post(`/api/sessions/${chosen}/reload`, {
      data: {},
    });
    expect(reloaded.ok()).toBe(true);
    await expect(picker).toBeEnabled();
    await expect(picker).toHaveValue("");
    rmSync(original);
    await page.locator("button.new-chat").click();
    await expect(picker).toBeEnabled();
    await expect(picker).toHaveValue("");
    await expect(
      picker.locator('option[value="test-added-skill"]'),
    ).toHaveCount(1);
  } finally {
    writeFileSync(original, source);
    rmSync(extra, { recursive: true, force: true });
  }
});

test("root shows home with access to the last chat and plugin navigation preserves drafts", async ({
  page,
}) => {
  const id = await seed(page);
  const state = await (await page.request.get(`/api/sessions/${id}`)).json();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Margin", exact: true })).toBeVisible();
  await chatRow(page, id).click();
  await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Plugin navigation preserves this");
  await page
    .getByRole("button", { name: "Open chat workspace", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/workspaces/${state.session.projectId}$`),
  );
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Plugin navigation preserves this",
  );
  await page
    .getByRole("button", { name: "Rename workspace", exact: true })
    .click();
  await page.getByLabel("Workspace name").fill("A pending name");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("unread respects simulated tab focus and is not cleared behind a narrow plugin dialog", async ({
  page,
  context,
}) => {
  const id = await seed(page);
  await page.bringToFront();
  // Headless Chromium reports all pages focused; simulate the browser focus signal.
  await page.evaluate(() =>
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    }),
  );
  await page.request.post(`/api/sessions/${id}/send`, {
    data: {
      id: randomUUID(),
      note: "Complete without tab focus",
      commentIds: [],
    },
  });
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    1,
  );
  await page.evaluate(() => {
    delete (document as unknown as { hasFocus?: () => boolean }).hasFocus;
    window.dispatchEvent(new Event("focus"));
  });
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 600, height: 800 });
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Notes" })).toBeVisible();
  await page.request.post(`/api/sessions/${id}/send`, {
    data: { id: randomUUID(), note: "Complete behind Notes", commentIds: [] },
  });
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.locator(".scroll-area").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll"));
  });
  await expect(chatRow(page, id).locator(".conversation-unread")).toHaveCount(
    0,
  );
  await page.screenshot({
    path: ".margin-data/navigation-mobile.png",
    fullPage: true,
  });
});
