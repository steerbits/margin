import { test, expect, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = (page: Page) =>
  page.getByRole("button", { name: "Margin home", exact: true });
async function seed(page: Page, options: Record<string, unknown> = {}) {
  const response = await page.request.post("/api/test/seed", {
    data: { title: "A draft to keep", ...options },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).id as string;
}

test("home preserves sidebar context, drafts, history, and explicit collapse across reloads", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to Margin" }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  const id = await seed(page);
  await page.goto(`/chats/${id}`);
  const composer = page.getByLabel("Message", { exact: true });
  await expect(composer).toBeEnabled();
  await expect(page.locator(".sidebar")).toBeVisible();
  await composer.fill("Keep this unfinished thought.");
  const project = await page.locator(".project-select").inputValue();
  await home(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".project-select")).toHaveValue(project);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/sessions/${id}`)).json()).composer,
    )
    .toBe("Keep this unfinished thought.");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
  await expect(composer).toHaveValue("Keep this unfinished thought.");
  await page.goForward();
  await expect(page.locator(".home-page")).toBeVisible();
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.reload();
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  const show = page.getByRole("button", { name: "Show sidebar", exact: true });
  await show.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.locator(`[data-session-id="${id}"]`).click();
  await expect(composer).toHaveValue("Keep this unfinished thought.");
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
  await expect(composer).toHaveValue("Keep this unfinished thought.");
});

test("recent workspaces search names and paths and open independently of AI setup", async ({
  page,
}) => {
  await page.route("**/api/bootstrap*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), models: [] } });
  });
  await page.goto("/");
  const folders: string[] = [];
  const projects: { id: string; path: string; name: string }[] = [];
  try {
    for (const name of ["Design notes", "Research journal"]) {
      const folder = await mkdtemp(join(tmpdir(), "margin-home-search-"));
      folders.push(folder);
      const response = await page.request.post("/api/projects", {
        data: { path: folder },
      });
      expect(response.ok()).toBe(true);
      const project = await response.json();
      await page.request.patch(`/api/projects/${project.id}`, {
        data: { name },
      });
      projects.push({ ...project, name });
    }
    await page.reload();
    const recent = page.getByRole("region", { name: "Recent workspaces" });
    const search = recent.getByRole("textbox", { name: "Search workspaces" });
    await search.fill("DESIGN");
    await expect(recent.locator("[data-project-id]")).toHaveCount(1);
    await expect(recent.locator("[data-project-id]")).toContainText(
      "Design notes",
    );
    await search.fill(projects[1].path);
    await expect(recent.locator("[data-project-id]")).toHaveCount(1);
    await expect(recent.locator("[data-project-id]")).toContainText(
      "Research journal",
    );
    await search.fill("no matching project");
    await expect(
      recent.getByText("No workspaces match your search."),
    ).toBeVisible();
    await search.fill("Design");
    await recent.locator(`[data-project-id="${projects[0].id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${projects[0].id}$`));
    await expect(
      page.getByRole("button", { name: "Connect an AI provider", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();
    await page
      .getByRole("button", { name: "Hide sidebar", exact: true })
      .click();
    await home(page).click();
    await page
      .getByRole("link", { name: "Customize Margin", exact: true })
      .click();
    await expect(page.locator(".sidebar")).not.toBeVisible();
    await home(page).click();
    await expect(page.locator(".project-select")).toHaveValue(projects[0].id);
    await page
      .locator(`.home-page [data-project-id="${projects[1].id}"]`)
      .click();
    await expect(page.locator(".sidebar")).not.toBeVisible();
  } finally {
    for (const folder of folders)
      await rm(folder, { recursive: true, force: true });
  }
});

test("home keeps a background run reachable without marking it read", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page, { responseDelay: 2500 });
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  const response = await page.request.post(`/api/sessions/${id}/send`, {
    data: { id: crypto.randomUUID(), note: "Keep working", commentIds: [] },
  });
  expect(response.ok()).toBe(true);
  await home(page).click();
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(
    page.locator(`[data-session-id="${id}"] .conversation-unread`),
  ).toHaveCount(1);
  await page.locator(`[data-session-id="${id}"]`).click();
  await expect(
    page.getByRole("heading", { name: "Revised direction", exact: true }),
  ).toBeVisible();
});

test("home navigation respects an unfinished inline comment", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page);
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await page
    .getByRole("button", { name: "Comment on reply", exact: true })
    .click();
  await page
    .getByLabel("Inline comment", { exact: true })
    .fill("Keep this comment draft");
  await home(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Finish or cancel your draft comment",
  );
  await expect(page).toHaveURL(new RegExp(`/chats/${id}\\?panel=comments$`));
  await expect(page.getByLabel("Inline comment", { exact: true })).toHaveValue(
    "Keep this comment draft",
  );
});

for (const width of [1440, 390, 320]) {
  test(`global sidebar toggle remains available on home, chat and customization at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".home-page")).toBeVisible();
    const toggle = page.locator(".app-header .sidebar-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await toggle.click();
    await page
      .getByRole("link", { name: "Customize Margin", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Customize Margin", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".sidebar")).not.toBeVisible();
    await expect(toggle).toBeVisible();
    await home(page).click();
    await expect(page.locator(".home-page")).toBeVisible();
    const id = await seed(page);
    await page.goto(`/chats/${id}`);
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    await expect(toggle).toBeVisible();
    await expect(page.locator(".toolbar .sidebar-toggle")).toHaveCount(0);
    expect(
      await page
        .locator(".brand > span")
        .evaluate(
          (left) =>
            left.getBoundingClientRect().right <=
            document.querySelector(".header-right")!.getBoundingClientRect()
              .left,
        ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mkdir(".margin-data/homepage-review", { recursive: true });
    await page.screenshot({
      path: `.margin-data/homepage-review/06-chat-toggle-${width}.png`,
    });
  });
}

test("returning through Customize and home keeps the chat's reading position", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page, { historyCount: 7 });
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await page.locator(".scroll-area").evaluate((el) => {
    el.scrollTop = 350;
    el.dispatchEvent(new Event("scroll"));
  });
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await home(page).click();
  await page.locator(`[data-session-id="${id}"]`).click();
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await expect
    .poll(() => page.locator(".scroll-area").evaluate((el) => el.scrollTop))
    .toBe(350);
});

test("a failed draft save can be recovered after visiting home", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page);
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await page.route(`**/api/sessions/${id}/composer`, (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Temporary save failure" },
    }),
  );
  await page
    .getByLabel("Message", { exact: true })
    .fill("Preserve this despite the failed save.");
  await home(page).click();
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Temporary save failure");
  await page.locator(`[data-session-id="${id}"]`).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Preserve this despite the failed save.",
  );
  await page.unroute(`**/api/sessions/${id}/composer`);
  await page
    .getByLabel("Message", { exact: true })
    .fill("Preserve this despite the failed save. Recovered.");
  await home(page).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/sessions/${id}`)).json()).composer,
    )
    .toBe("Preserve this despite the failed save. Recovered.");
});
