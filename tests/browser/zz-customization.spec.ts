import { test, expect, type Locator, type Page } from "@playwright/test";
import { showSidebar } from "./navigation-helpers.ts";

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(
    baseURL !== "http://127.0.0.1:4328",
    "Code-history UI tests require the disposable app configuration.",
  );
  await page.goto("/");
  await showSidebar(page);
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Customize Margin", exact: true }),
  ).toBeVisible();
});

test("Margin has a special workspace and examples prepare source-workspace prompts", async ({
  page,
}) => {
  await expect(
    page
      .getByRole("combobox", { name: "Project", exact: true })
      .locator("option")
      .filter({ hasText: /^Margin$/ }),
  ).toHaveCount(1);
  await page
    .locator(".example-card")
    .filter({ hasText: "Let your assistant work with notes" })
    .getByRole("button", { name: "Use this prompt" })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    /Extend the project-notes plugin/,
  );
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const id = await page.evaluate(() => localStorage.getItem("margin.session"));
  const snapshot = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(snapshot.session.projectId).toBe(boot.marginProjectId);
});
test("Customize Margin switches an ordinary workspace back to Margin", async ({
  page,
}) => {
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const external = {
    id: "external-workspace",
    name: "External workspace",
    path: "/tmp/external-workspace",
    kind: "project",
  };
  await page.route("**/api/workspaces/choose", (route) =>
    route.fulfill({ json: { project: external } }),
  );
  await page.getByRole("button", { name: "New workspace" }).click();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(external.id);

  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();

  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(boot.marginProjectId);
  await expect(
    page
      .getByRole("combobox", { name: "Project", exact: true })
      .locator("option:checked"),
  ).toHaveText("Margin");
});

test("New workspace directly invokes the native chooser and selects its result", async ({
  page,
}) => {
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const project = boot.projects.find((p: any) => p.id === boot.marginProjectId);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/api/workspaces/choose", async (route) => {
    calls++;
    await gate;
    await route.fulfill({ json: { project } });
  });
  const button = page.getByRole("button", {
    name: "New workspace",
    exact: true,
  });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(
    page.getByText("Choose or create a folder in the system dialog."),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Workspace name")).toHaveCount(0);
  release();
  await expect(button).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(project.id);
  expect(calls).toBe(1);
});
test("plugin controls retain code/data and clearly indicate restart-required changes", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Plugins", exact: false }).click();
  const control = page.getByRole("checkbox", { name: "Enable Project Notes" });
  await expect(control).toBeChecked();
  await control.uncheck();
  await expect(page.getByText("Restart needed", { exact: true })).toBeVisible();
  const data = await (await page.request.get("/api/customize")).json();
  const notes = data.plugins.find((p: any) => p.id === "project-notes");
  expect(notes.active).toBe(true);
  expect(notes.enabled).toBe(false);
  await control.check();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("No restart is needed");
});
test("history previews changes, restores an older version, and can return to the newer state", async ({
  page,
}) => {
  // This round trip captures the entire disposable source repeatedly. Wait for
  // each real filesystem operation, rather than spending a 5s DOM assertion
  // budget while Git is still working (captures can take 6–14s on test hosts).
  test.setTimeout(180000);
  async function checkpointAction(
    button: Locator,
    operation: "create" | "preview" | "restore",
  ) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) => {
          const path = new URL(response.url()).pathname;
          return (
            response.request().method() ===
              (operation === "preview" ? "GET" : "POST") &&
            (operation === "create"
              ? path === "/api/customize/checkpoints"
              : path.startsWith("/api/customize/checkpoints/") &&
                path.endsWith(`/${operation}`))
          );
        },
        { timeout: 30000 },
      ),
      button.click(),
    ]);
    expect(response.ok(), await response.text()).toBe(true);
  }
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByLabel("Checkpoint name").fill("Before experiment");
  await checkpointAction(
    page.getByRole("button", { name: "Save checkpoint", exact: true }),
    "create",
  );
  await expect(
    page.getByRole("heading", { name: "Before experiment", exact: true }),
  ).toBeVisible();
  const first = (await (await page.request.get("/api/customize")).json())
    .history.checkpoints[0];
  await page.request.post("/api/test/customization-file", {
    data: { text: "A new customization" },
  });
  await page.getByLabel("Checkpoint name").fill("With experiment");
  await checkpointAction(
    page.getByRole("button", { name: "Save checkpoint", exact: true }),
    "create",
  );
  await expect(
    page.getByRole("heading", { name: "With experiment", exact: true }),
  ).toBeVisible();
  const second = (await (await page.request.get("/api/customize")).json())
    .history.checkpoints[0];
  const previewBefore = page
    .locator(".checkpoint-list article")
    .filter({
      has: page.getByRole("heading", {
        name: "Before experiment",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Preview changes" });
  await checkpointAction(previewBefore, "preview");
  await expect(
    page.getByRole("dialog", { name: "Preview checkpoint changes" }),
  ).toContainText("checkpoint-example.txt");
  await expect(
    page.getByRole("dialog", { name: "Preview checkpoint changes" }),
  ).toContainText("deleted");
  const dialog = page.getByRole("dialog", {
    name: "Preview checkpoint changes",
  });
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await checkpointAction(previewBefore, "preview");
  // Preview alone has not changed the current code.
  expect(
    (
      await (
        await page.request.get(
          `/api/customize/checkpoints/${second.id}/preview`,
        )
      ).json()
    ).files,
  ).toHaveLength(0);
  await checkpointAction(
    page.getByRole("button", { name: "Save current state & restore" }),
    "restore",
  );
  await expect(
    page.getByRole("dialog", { name: "Preview checkpoint changes" }),
  ).toHaveCount(0);
  await checkpointAction(
    page.getByRole("button", { name: "Return to before the last restore" }),
    "preview",
  );
  await expect(
    page.getByRole("dialog", { name: "Preview checkpoint changes" }),
  ).toContainText("added");
  await checkpointAction(
    page.getByRole("button", { name: "Save current state & restore" }),
    "restore",
  );
  await expect(
    page.getByRole("dialog", { name: "Preview checkpoint changes" }),
  ).toHaveCount(0);
  expect(
    (
      await (
        await page.request.get(
          `/api/customize/checkpoints/${second.id}/preview`,
        )
      ).json()
    ).files,
  ).toHaveLength(0);
  // Leave the disposable server matching its original loaded source for following tests.
  const original = await (
    await page.request.get(`/api/customize/checkpoints/${first.id}/preview`)
  ).json();
  await page.request.post(`/api/customize/checkpoints/${first.id}/restore`, {
    data: { token: original.token },
  });
});

test("opening Customize Margin on a narrow screen closes the covering sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Back to conversation" }).click();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveClass(/sidebar-hidden/);
  await expect(
    page.getByRole("heading", { name: "Customize Margin", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("cancelling the native chooser keeps the current workspace and Customize view", async ({
  page,
}) => {
  const selected = await page
    .getByRole("combobox", { name: "Project", exact: true })
    .inputValue();
  await page.route("**/api/workspaces/choose", (route) =>
    route.fulfill({ json: { project: null } }),
  );
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New workspace", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(selected);
  await expect(
    page.getByRole("heading", { name: "Customize Margin", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("older server routes show restart instructions and can retry", async ({
  page,
}) => {
  await page.route("**/api/customize", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unknown API route." }),
    }),
  );
  await page.getByRole("button", { name: "Back to conversation" }).click();
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Restart Margin to finish updating",
  );
  await expect(page.getByText("Loading customization workspace…")).toHaveCount(
    0,
  );
  await page.unroute("**/api/customize");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start customization chat" }),
  ).toBeVisible();
  await page.route("**/api/workspaces/choose", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unknown API route." }),
    }),
  );
  const button = page.getByRole("button", {
    name: "New workspace",
    exact: true,
  });
  await button.click();
  await expect(page.getByRole("alert")).toContainText(
    "Restart Margin to finish updating",
  );
  await expect(button).toBeEnabled();
  await page.unroute("**/api/workspaces/choose");
  await page.route("**/api/workspaces/choose", (route) =>
    route.fulfill({ json: { project: null } }),
  );
  await button.click();
  await expect(button).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
