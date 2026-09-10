import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const folders: string[] = [];
test.afterAll(() => {
  for (const folder of folders)
    rmSync(folder, { recursive: true, force: true });
});
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Project notes", exact: true });
const panel = (page: Page) =>
  page.getByRole("region", { name: "Project notepad" });
const status = (page: Page) => panel(page).getByRole("status");
const saveButton = (page: Page) =>
  page.getByRole("button", { name: "Save notes", exact: true });
const endpoint = (id: string, action: string) =>
  `/api/sessions/${id}/plugins/project-notes/${action}`;

async function createProject(request: APIRequestContext) {
  const path = mkdtempSync(join(tmpdir(), "margin-notes-browser-"));
  folders.push(path);
  const response = await request.post("/api/projects", { data: { path } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}
async function createSession(request: APIRequestContext, projectId: string) {
  const response = await request.post("/api/sessions", { data: { projectId } });
  expect(response.ok()).toBeTruthy();
  const id = (await response.json()).session.id as string;
  await expect
    .poll(async () => {
      const snapshot = await (await request.get(`/api/sessions/${id}`)).json();
      return snapshot.pluginState["project-notes"] !== undefined;
    })
    .toBe(true);
  return id;
}
async function visit(page: Page, id: string) {
  await page.evaluate((id) => localStorage.setItem("margin.session", id), id);
  await page.reload();
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await openNotes(page);
}
async function openNotes(page: Page) {
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(editor(page)).toBeEnabled();
  await expect(status(page)).not.toHaveText("Loading notes…");
}
async function setup(page: Page) {
  await page.goto("/");
  const project = await createProject(page.request);
  const id = await createSession(page.request, project);
  await visit(page, id);
  return { id, project };
}
async function load(page: Page, id: string) {
  const response = await page.request.post(endpoint(id, "load"), { data: {} });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).result.note as {
    text: string;
    revision: number;
  };
}
async function remoteSave(
  page: Page,
  id: string,
  text: string,
  revision: number,
) {
  const response = await page.request.post(endpoint(id, "save"), {
    data: { text, revision },
  });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).result.saved).toBe(true);
}
async function save(page: Page, text: string) {
  await editor(page).fill(text);
  await expect(status(page)).toHaveText("Unsaved changes");
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved");
}

test("notes save literal text, persist on reload and new sessions, isolate projects, and can be cleared", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { id, project } = await setup(page);
  await expect(editor(page)).toHaveValue("");
  await expect(saveButton(page)).toBeDisabled();
  const text =
    "  # Decisions\n日本語 📝 <script>alert('not executable')</script>\n\n";
  await save(page, text);
  expect(await load(page, id)).toEqual({ text, revision: 1 });
  await visit(page, id);
  await expect(editor(page)).toHaveValue(text);
  const sameProject = await createSession(page.request, project);
  await visit(page, sameProject);
  await expect(editor(page)).toHaveValue(text);
  const other = await createSession(
    page.request,
    await createProject(page.request),
  );
  await visit(page, other);
  await expect(editor(page)).toHaveValue("");
  await save(page, "Other project's note");
  await visit(page, id);
  await expect(editor(page)).toHaveValue(text);
  await save(page, "");
  await visit(page, sameProject);
  await expect(editor(page)).toHaveValue("");
  expect((await load(page, other)).text).toBe("Other project's note");
  expect(errors).toEqual([]);
});

test("unsaved drafts survive closing and switching sessions/projects; hidden drafts warn before reload", async ({
  page,
}) => {
  const { id, project } = await setup(page);
  const second = await createSession(page.request, project);
  const otherProject = await createProject(page.request);
  await createSession(page.request, otherProject);
  // Refresh bootstrap to expose both sessions/projects before starting a draft.
  await visit(page, id);
  await editor(page).fill("Keep this project draft");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await openNotes(page);
  await expect(editor(page)).toHaveValue("Keep this project draft");
  await page
    .getByRole("navigation", { name: "Conversations" })
    .locator("button:not(.selected)")
    .click();
  await openNotes(page);
  await expect(editor(page)).toHaveValue("Keep this project draft");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("margin.session")))
    .toBe(second);
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(otherProject);
  await page
    .getByRole("navigation", { name: "Conversations" })
    .getByRole("button")
    .click();
  await openNotes(page);
  await expect(editor(page)).toHaveValue("");
  await editor(page).fill("Other draft");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  const leaving = page.waitForEvent("dialog");
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const dialog = await leaving;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(project);
  await page
    .getByRole("navigation", { name: "Conversations" })
    .getByRole("button")
    .first()
    .click();
  await openNotes(page);
  await expect(editor(page)).toHaveValue("Keep this project draft");
  expect((await load(page, id)).text).toBe("");
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved");
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(otherProject);
  await expect(
    page.getByRole("navigation", { name: "Conversations" }).getByRole("button"),
  ).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "Conversations" })
    .getByRole("button")
    .click();
  await openNotes(page);
  await expect(editor(page)).toHaveValue("Other draft");
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved");
});

test("a delayed save preserves newer edits even if the panel is closed before the reply", async ({
  page,
}) => {
  const { id } = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${endpoint(id, "save")}`, async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await editor(page).fill("Submitted");
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saving…");
  await editor(page).fill("A newer edit");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  release();
  await expect.poll(async () => (await load(page, id)).text).toBe("Submitted");
  await openNotes(page);
  await expect(editor(page)).toHaveValue("A newer edit");
  await expect(status(page)).toHaveText("Unsaved changes");
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved");
  expect((await load(page, id)).text).toBe("A newer edit");
});

test("load/save failures show errors and permit retry without losing edits", async ({
  page,
}) => {
  await page.goto("/");
  const id = await createSession(
    page.request,
    await createProject(page.request),
  );
  await page.route(`**${endpoint(id, "load")}`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Notes storage unavailable" },
    }),
  );
  await page.evaluate((id) => localStorage.setItem("margin.session", id), id);
  await page.reload();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "Notes storage unavailable",
  );
  await expect(editor(page)).toBeDisabled();
  await page.unroute(`**${endpoint(id, "load")}`);
  await page.getByRole("button", { name: "Refresh notes" }).click();
  await expect(editor(page)).toBeEnabled();
  await editor(page).fill("Do not lose this");
  await page.route(`**${endpoint(id, "save")}`, (route) =>
    route.fulfill({ status: 503, json: { error: "Disk full" } }),
  );
  await saveButton(page).click();
  await expect(panel(page).getByRole("alert")).toContainText("Disk full");
  await expect(editor(page)).toHaveValue("Do not lose this");
  expect((await load(page, id)).text).toBe("");
  await page.unroute(`**${endpoint(id, "save")}`);
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved");
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
});

test("stale saves retain both versions and require explicit conflict resolution", async ({
  page,
}) => {
  const { id, project } = await setup(page);
  await save(page, "Original");
  const other = await createSession(page.request, project);
  await editor(page).fill("My version");
  await remoteSave(page, other, "Their version", 1);
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Conflict — draft kept");
  await expect(editor(page)).toHaveValue("My version");
  await expect(page.getByLabel("Latest saved note")).toHaveValue(
    "Their version",
  );
  expect((await load(page, id)).text).toBe("Their version");
  await expect(saveButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Keep my draft" }).click();
  expect((await load(page, id)).text).toBe("Their version");
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved");
  expect((await load(page, id)).text).toBe("My version");
  await editor(page).fill("Another draft");
  await remoteSave(page, other, "New saved version", 3);
  await page.getByRole("button", { name: "Refresh notes" }).click();
  await expect(page.getByLabel("Latest saved note")).toHaveValue(
    "New saved version",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Use saved note" }).click();
  await expect(editor(page)).toHaveValue("Another draft");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Use saved note" }).click();
  await expect(editor(page)).toHaveValue("New saved version");
  await expect(status(page)).toHaveText("Saved");
});

test("reopening a stale session loads project storage instead of its old published panel state", async ({
  page,
}) => {
  const { id, project } = await setup(page);
  const other = await createSession(page.request, project);
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await remoteSave(page, other, "Saved elsewhere", 0);
  const stale = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(stale.pluginState["project-notes"].note.text).toBe("");
  await openNotes(page);
  await expect(editor(page)).toHaveValue("Saved elsewhere");
  await remoteSave(page, other, "Refreshed on focus", 1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor(page)).toHaveValue("Refreshed on focus");
});

test("Notes is reachable on a narrow screen with a long conversation and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", { data: {} });
  expect(response.ok()).toBeTruthy();
  await visit(page, (await response.json()).id);
  await expect(editor(page)).toBeInViewport();
  await save(page, "Readable on a small screen");
  await expect(saveButton(page)).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await editor(page).evaluate((el) => el.clientWidth > 200)).toBe(true);
  await page.screenshot({
    path: ".margin-data/project-notes-narrow.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".margin-data/project-notes-desktop.png",
    fullPage: true,
  });
});
