import { test, expect, type Page } from "@playwright/test";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { InstructionsView } from "../../shared/instructions.ts";

const folders: string[] = [];
test.afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
async function workspace(page: Page) {
  await page.goto("/");
  const folder = realpathSync(
    mkdtempSync(join(tmpdir(), "margin-instructions-browser-")),
  );
  folders.push(folder);
  const response = await page.request.post("/api/projects", {
    data: { path: folder },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  await page.goto(`/workspaces/${project.id}`);
  await expect(
    page.getByRole("heading", {
      name: `Workspace instructions · ${project.name}`,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add instructions", exact: true }),
  ).toBeEnabled();
  return {
    ...project,
    file: join(folder, "AGENTS.md"),
    endpoint: `/api/projects/${project.id}/instructions`,
  };
}
const editor = (page: Page) =>
  page.getByRole("textbox", {
    name: "Workspace instructions Markdown",
    exact: true,
  });
async function edit(page: Page, text: string) {
  await page.locator(".instructions-heading button").click();
  await expect(editor(page)).toBeFocused();
  await editor(page).fill(text);
}

test("workspace breadcrumb opens its home, preserves chat state, and new conversation still offers a model", async ({
  page,
}) => {
  const project = await workspace(page);
  const seeded = await (
    await page.request.post("/api/test/seed", {
      data: { projectId: project.id, historyCount: 6 },
    })
  ).json();
  await page.goto(`/chats/${seeded.id}`);
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  await page.getByLabel("Message", { exact: true }).fill("Keep my chat draft");
  await page.locator(".scroll-area").evaluate((node) => {
    node.scrollTop = 250;
    node.dispatchEvent(new Event("scroll"));
  });
  let chooserCalls = 0;
  await page.route("**/api/workspaces/choose", (route) => {
    chooserCalls++;
    return route.fulfill({ json: { project: null } });
  });
  await page
    .getByRole("link", { name: `Workspace home: ${project.name}`, exact: true })
    .click();
  await expect(page).toHaveURL(`/workspaces/${project.id}`);
  expect(chooserCalls).toBe(0);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Project notes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.locator(`[data-session-id="${seeded.id}"]`).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep my chat draft",
  );
  expect(
    await page.locator(".scroll-area").evaluate((node) => node.scrollTop),
  ).toBe(250);
  await page.locator(".project-breadcrumb").click();
  await page
    .locator(".workspace-home")
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page).toHaveURL(`/workspaces/${project.id}?view=new`);
  await expect(page.getByLabel("Start with a model")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Start with a model")).toBeVisible();
  await page
    .getByRole("button", { name: "Start a conversation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chats\//);
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
});

test("explicit saves, empty files, clean closes, and Escape confirmation preserve exact text", async ({
  page,
}) => {
  const project = await workspace(page);
  await edit(page, "# Conventions\nUse pnpm. 日本語 🐈\n");
  expect(existsSync(project.file)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(
    page.getByText(`Unsaved changes to ${project.name}’s instructions.`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep editing", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor(page)).toBeFocused();
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await expect(editor(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
  expect(readFileSync(project.file, "utf8")).toBe(
    "# Conventions\nUse pnpm. 日本語 🐈\n",
  );
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save and close", exact: true }),
  ).toBeDisabled();
  await editor(page).fill("discard me");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  expect(readFileSync(project.file, "utf8")).not.toContain("discard me");
  await edit(page, "");
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await expect(
    page.getByText("This file is empty.", { exact: true }),
  ).toBeVisible();
  expect(existsSync(project.file)).toBe(true);
  expect(readFileSync(project.file, "utf8")).toBe("");
});

test("Back and Forward restore the URL before in-place confirmation and retain the intended destination", async ({
  page,
}) => {
  const project = await workspace(page);
  await page.getByRole("button", { name: "Margin home", exact: true }).click();
  await page.locator(`.home-recents [data-project-id="${project.id}"]`).click();
  await edit(page, "Keep during history traversal");
  await page.goBack();
  await expect(page).toHaveURL(`/workspaces/${project.id}`);
  await expect(
    page.getByRole("button", { name: "Save and leave", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor(page)).toHaveValue("Keep during history traversal");
  await page.goBack();
  await page
    .getByRole("button", { name: "Save and leave", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  expect(readFileSync(project.file, "utf8")).toBe(
    "Keep during history traversal",
  );
  await page.goForward();
  await expect(page).toHaveURL(`/workspaces/${project.id}`);
  await page
    .getByRole("link", { name: "View global instructions", exact: true })
    .click();
  await expect(page).toHaveURL("/customize/instructions");
  await page.goBack();
  await edit(page, "Discard on forward");
  await page.goForward();
  await expect(page).toHaveURL(`/workspaces/${project.id}`);
  await page
    .getByRole("button", { name: "Discard and leave", exact: true })
    .click();
  await expect(page).toHaveURL("/customize/instructions");
  expect(readFileSync(project.file, "utf8")).toBe(
    "Keep during history traversal",
  );
});

test("sidebar, Customize tabs and native chooser share the guard; global and local files stay separate", async ({
  page,
}) => {
  const project = await workspace(page);
  const original = (await (
    await page.request.get("/api/instructions/global")
  ).json()) as InstructionsView;
  try {
    await edit(page, "WORKSPACE_SCOPE_TEST");
    await page
      .getByRole("link", { name: "View global instructions", exact: true })
      .click();
    await expect(page).toHaveURL(`/workspaces/${project.id}`);
    await page
      .getByRole("button", { name: "Save and leave", exact: true })
      .click();
    await expect(page).toHaveURL("/customize/instructions");
    await page.reload(); // The return workspace must survive reloading Customize.
    await expect(
      page.getByText("YOUR APP WORKSPACE", { exact: true }),
    ).toBeVisible();
    const globalEditor = page.getByRole("textbox", {
      name: "Global instructions Markdown",
      exact: true,
    });
    await page.locator(".instructions-heading button").click();
    await expect(globalEditor).not.toHaveValue("WORKSPACE_SCOPE_TEST");
    await globalEditor.fill("GLOBAL_SCOPE_TEST");
    await page.getByRole("button", { name: "Examples", exact: true }).click();
    await expect(page).toHaveURL("/customize/instructions");
    await page
      .getByRole("button", { name: "Save and leave", exact: true })
      .click();
    await expect(page).toHaveURL("/customize/examples");
    expect(readFileSync(original.path, "utf8")).toBe("GLOBAL_SCOPE_TEST");
    expect(readFileSync(project.file, "utf8")).toBe("WORKSPACE_SCOPE_TEST");
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await expect(page).toHaveURL(`/workspaces/${project.id}`);
    await edit(page, "Unsaved workspace edit");
    let chooserCalls = 0;
    await page.route("**/api/workspaces/choose", (route) => {
      chooserCalls++;
      return route.fulfill({ json: { project: null } });
    });
    await page
      .getByRole("button", { name: "New workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Keep editing", exact: true }),
    ).toBeVisible();
    expect(chooserCalls).toBe(0);
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Customize Margin", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Discard and leave", exact: true })
      .click();
    await expect(page).toHaveURL("/customize/examples");
    expect(readFileSync(project.file, "utf8")).toBe("WORKSPACE_SCOPE_TEST");
  } finally {
    if (original.exists) writeFileSync(original.path, original.content);
    else rmSync(original.path, { force: true });
  }
});

test("failed save never leaves; retry succeeds, stale saves preserve external edits, reload requires confirmation", async ({
  page,
}) => {
  const project = await workspace(page);
  await edit(page, "My retained draft");
  await page.route(`**${project.endpoint}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, json: { error: "Disk unavailable" } })
      : route.continue(),
  );
  await page
    .getByRole("link", { name: "View global instructions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save and leave", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Disk unavailable");
  await expect(page).toHaveURL(`/workspaces/${project.id}`);
  await expect(editor(page)).toHaveValue("My retained draft");
  await page.unroute(`**${project.endpoint}`);
  await page
    .getByRole("button", { name: "Save and leave", exact: true })
    .click();
  await expect(page).toHaveURL("/customize/instructions");
  await page
    .getByRole("button", { name: "Back to conversation", exact: true })
    .click();
  await edit(page, "Stale local draft");
  writeFileSync(project.file, "External file change");
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("file changed");
  await expect(editor(page)).toHaveValue("Stale local draft");
  expect(readFileSync(project.file, "utf8")).toBe("External file change");
  await page
    .getByRole("button", { name: "Reload saved file", exact: true })
    .click();
  await expect(
    page.getByText(
      "Replace your draft with the saved file? Copy anything you want to keep first.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor(page)).toHaveValue("Stale local draft");
  await page
    .getByRole("button", { name: "Reload saved file", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace draft", exact: true })
    .click();
  await expect(editor(page)).toHaveValue("External file change");
  await expect(
    page.getByRole("button", { name: "Save and close", exact: true }),
  ).toBeDisabled();
});

test("existing alternate files are blocked and read failures do not masquerade as empty instructions", async ({
  page,
}) => {
  const project = await workspace(page);
  writeFileSync(join(project.path, "CLAUDE.md"), "Legacy project instructions");
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("CLAUDE.md");
  await expect(
    page.getByRole("button", { name: "Add instructions", exact: true }),
  ).toBeDisabled();
  expect(existsSync(project.file)).toBe(false);
  await page.route(`**${project.endpoint}`, (route) =>
    route.fulfill({ status: 500, json: { error: "Permission denied" } }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Permission denied");
  await expect(
    page.getByRole("button", { name: "Add instructions", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No workspace instructions yet.", { exact: true }),
  ).toHaveCount(0);
});

test("mobile editor keeps actions visible and native reload warning protects edits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = await workspace(page);
  await edit(page, "Use pnpm.\n".repeat(90));
  await editor(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "Save and close", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  const field = (await editor(page).boundingBox())!;
  const footer = (await page.locator(".instructions-footer").boundingBox())!;
  expect(footer.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".margin-data/instructions-mobile.png",
    fullPage: true,
  });
  const warning = page.waitForEvent("dialog");
  // A dismissed reload never emits a new load event. Trigger it in the page
  // rather than waiting on Playwright's page.reload() navigation promise.
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(editor(page)).toHaveValue("Use pnpm.\n".repeat(90));
  expect(existsSync(project.file)).toBe(false);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
});

test("mobile Notes history keeps the editor mounted; workspace switching closes the picker before confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });
  const first = await workspace(page);
  const second = await workspace(page);
  await page.goto(`/workspaces/${first.id}`);
  await expect(
    page.getByRole("button", { name: "Add instructions", exact: true }),
  ).toBeEnabled();
  await edit(page, "Keep this when closing Notes");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Notes", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Notes", exact: true }),
  ).toHaveCount(0);
  await expect(editor(page)).toHaveValue("Keep this when closing Notes");
  await expect(
    page.getByRole("button", { name: "Keep editing", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (!(await page.locator(".sidebar").isVisible()))
    await page
      .getByRole("button", { name: "Show sidebar", exact: true })
      .click();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption("__all__");
  await page
    .getByRole("dialog", { name: "All workspaces", exact: true })
    .locator(`[data-project-id="${second.id}"]`)
    .click();
  await expect(
    page.getByRole("dialog", { name: "All workspaces", exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(`/workspaces/${first.id}`);
  await page
    .getByRole("button", { name: "Save and leave", exact: true })
    .click();
  await expect(page).toHaveURL(`/workspaces/${second.id}`);
  expect(readFileSync(first.file, "utf8")).toBe("Keep this when closing Notes");
  expect(existsSync(second.file)).toBe(false);
});

test("two browsers reject stale revisions and existing Settings still autosaves independently", async ({
  page,
  context,
}) => {
  const project = await workspace(page);
  await edit(page, "First tab draft");
  const second = await context.newPage();
  try {
    await second.goto(`/workspaces/${project.id}`);
    await expect(
      second.getByRole("button", { name: "Add instructions", exact: true }),
    ).toBeEnabled();
    await edit(second, "Second tab draft");
    await second
      .getByRole("button", { name: "Save and close", exact: true })
      .click();
    await expect(editor(second)).toHaveCount(0);
    await page
      .getByRole("button", { name: "Save and close", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("file changed");
    expect(readFileSync(project.file, "utf8")).toBe("Second tab draft");
    let settingsSaves = 0;
    const current = await (await page.request.get("/api/settings")).json();
    await page.route("**/api/settings", (route) => {
      if (route.request().method() === "PUT") {
        settingsSaves++;
        current.settings = route.request().postDataJSON();
      }
      return route.fulfill({ json: current });
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const select = page.getByLabel("Default model", { exact: true });
    await select.selectOption({ index: 1 });
    await expect.poll(() => settingsSaves).toBe(1);
    await page
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(editor(page)).toHaveValue("First tab draft");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect(page.locator(".instructions-preview")).toHaveText(
      "Second tab draft",
    );
    await page.screenshot({
      path: ".margin-data/instructions-desktop.png",
      fullPage: true,
    });
  } finally {
    await second.close();
  }
});
