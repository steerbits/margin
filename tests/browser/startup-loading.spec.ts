import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Project, SessionInfo } from "../../shared/types.ts";

// Mock only API responses; exercise the built app with browser-local storage.
// No real chat data or provider calls are used by these startup scenarios.
const project: Project = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Existing workspace",
  path: "/fixture/existing-workspace",
  kind: "project",
};
const session: SessionInfo = {
  id: "10000000-0000-4000-8000-000000000002",
  projectId: project.id,
  title: "A saved conversation",
  createdAt: 1,
  updatedAt: 2,
  activity: {
    status: "finished",
    replyId: "reply",
    completionId: "completion",
  },
};
function bootstrap(sessions: SessionInfo[] = [session]) {
  return {
    projects: [project],
    sessions,
    models: [],
    readOnlyAuth: false,
    activePluginFolders: [],
    execution: { mode: "cco-workspaces" },
  };
}
async function setup(page: Page, sessions: SessionInfo[] = [session]) {
  const data = bootstrap(sessions);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/bootstrap" || path === "/api/sessions")
      return route.fulfill({ json: data });
    // Speculative chat previews are unnecessary to test home/workspace loading.
    return route.fulfill({
      status: 503,
      json: { error: "Preview not included in this UI fixture" },
    });
  });
  return data;
}
function gate() {
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  return { pending, release };
}
const openWorkspace = (page: Page) =>
  page
    .locator(".home-page")
    .getByRole("button", { name: "Open workspace", exact: true });
const savedChat = (page: Page) =>
  page.locator(`.sidebar [data-session-id="${session.id}"]`);
const screenshots = resolve(".margin-data/temporary/loading-ui/screenshots");

test("slow startup shows progress instead of ready/empty states, then displays existing chats", async ({
  page,
}) => {
  const data = await setup(page);
  const held = gate();
  let requests = 0;
  await page.route("**/api/bootstrap*", async (route) => {
    requests++;
    await held.pending;
    await route.fulfill({ json: data }).catch(() => {});
  });
  try {
    await page.goto("/");
    const loading = page.getByRole("button", {
      name: "Loading workspaces…",
      exact: true,
    });
    await expect(loading).toBeDisabled();
    await expect(loading).toHaveAttribute("aria-busy", "true");
    await expect(loading.locator(".spin")).toBeVisible();
    await expect(page.locator(".connection")).toHaveText("Loading Margin…");
    await expect(page.locator(".home-card-next")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Show sidebar", exact: true })
      .click();
    await expect(page.locator(".sidebar").getByRole("status")).toHaveText(
      "Loading conversations…",
    );
    await expect(
      page.getByText("Your conversations will appear here.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Chats from other workspaces will appear here.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "New workspace", exact: true }),
    ).toBeDisabled();
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: resolve(screenshots, "loading-desktop.png"),
    });
    held.release();
    await expect(openWorkspace(page)).toBeEnabled();
    await expect(savedChat(page)).toBeVisible();
    await expect(page.locator(".connection")).toHaveText("Ready");
    await expect(page.locator(".sidebar .spin")).toHaveCount(0);
    expect(requests).toBe(1);
    await page.screenshot({ path: resolve(screenshots, "loaded-desktop.png") });
  } finally {
    held.release();
  }
});

test("failed bootstrap stops loading and offers an in-place retry without changing read markers", async ({
  page,
}) => {
  const data = await setup(page);
  const read = JSON.stringify({ [session.id]: "completion" });
  await page.addInitScript(
    (value) => localStorage.setItem("margin.read", value),
    read,
  );
  const held = gate();
  let requests = 0;
  await page.route("**/api/bootstrap*", async (route) => {
    if (++requests === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Temporary startup failure" },
      });
    await held.pending;
    await route.fulfill({ json: data }).catch(() => {});
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "Temporary startup failure",
    );
    await expect(page.locator(".connection")).toHaveText("Loading failed");
    await expect(
      page.getByRole("button", { name: "Workspaces unavailable", exact: true }),
    ).toBeDisabled();
    await expect(
      page.locator(".home-page .spin, .connection .spin"),
    ).toHaveCount(0);
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: resolve(screenshots, "loading-error.png") });
    await page
      .getByRole("button", { name: "Retry loading", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Loading workspaces…", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    held.release();
    await expect(openWorkspace(page)).toBeEnabled();
    await expect(savedChat(page)).toBeVisible();
    await expect(savedChat(page).locator(".conversation-unread")).toHaveCount(
      0,
    );
    expect(await page.evaluate(() => localStorage.getItem("margin.read"))).toBe(
      read,
    );
    expect(requests).toBe(2);
  } finally {
    held.release();
  }
});

test("an unresponsive bootstrap becomes a retryable timeout rather than an endless spinner", async ({
  page,
}) => {
  const data = await setup(page);
  // Keep the real AbortSignal/fetch cancellation, shortening only this budget.
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => timeout(ms === 45000 ? 100 : ms);
  });
  const held = gate();
  await page.route("**/api/bootstrap*", async (route) => {
    await held.pending;
    await route.fulfill({ json: data }).catch(() => {});
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "Loading took too long",
    );
    await expect(
      page.getByRole("button", { name: "Retry loading", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".connection")).toHaveText("Loading failed");
  } finally {
    held.release();
  }
});

test("fresh browser preferences reveal saved chats on desktop without creating a preference", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await expect(openWorkspace(page)).toBeEnabled();
  await expect(savedChat(page)).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("margin.sidebar")),
  ).toBeNull();
  // This task deliberately leaves the existing per-origin unread behavior alone.
  await expect(savedChat(page).locator(".conversation-unread")).toHaveCount(1);
  expect(
    await page.evaluate(() => localStorage.getItem("margin.read")),
  ).toBeNull();
});

test("an explicit collapse survives loading, reloads, and first workspace entry", async ({
  page,
}) => {
  await setup(page);
  await page.addInitScript(() =>
    localStorage.setItem("margin.sidebar", "closed"),
  );
  await page.goto("/");
  await expect(openWorkspace(page)).toBeEnabled();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await page.locator(`.home-page [data-project-id="${project.id}"]`).click();
  await expect(page.locator(".workspace-home")).toBeVisible();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".workspace-home")).toBeVisible();
  await expect(page.locator(".sidebar")).not.toBeVisible();
});

test("collapsing while startup is pending is not undone when the chats arrive", async ({
  page,
}) => {
  const data = await setup(page);
  const held = gate();
  await page.route("**/api/bootstrap*", async (route) => {
    await held.pending;
    await route.fulfill({ json: data }).catch(() => {});
  });
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Show sidebar", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Hide sidebar", exact: true })
      .click();
    held.release();
    await expect(openWorkspace(page)).toBeEnabled();
    await expect(page.locator(".sidebar")).not.toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("margin.sidebar")),
    ).toBe("closed");
  } finally {
    held.release();
  }
});

for (const preference of [null, "open"] as const) {
  test(`a checkout without chats respects the ${preference ?? "absent"} sidebar preference`, async ({
    page,
  }) => {
    await setup(page, []);
    if (preference)
      await page.addInitScript(
        (value) => localStorage.setItem("margin.sidebar", value),
        preference,
      );
    await page.goto("/");
    await expect(openWorkspace(page)).toBeEnabled();
    await expect(page.locator(".sidebar")).toBeVisible({
      visible: preference === "open",
    });
  });
}

for (const width of [390, 320]) {
  test(`startup stays readable and does not auto-open the mobile sidebar at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const data = await setup(page);
    const held = gate();
    await page.route("**/api/bootstrap*", async (route) => {
      await held.pending;
      await route.fulfill({ json: data }).catch(() => {});
    });
    try {
      await page.goto("/");
      const spinner = page
        .getByRole("button", { name: "Loading workspaces…", exact: true })
        .locator(".spin");
      await expect(spinner).toBeVisible();
      await expect(spinner).toHaveCSS("animation-name", "none");
      await mkdir(screenshots, { recursive: true });
      await page.screenshot({
        path: resolve(screenshots, `loading-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      held.release();
      await expect(openWorkspace(page)).toBeEnabled();
      await expect(page.locator(".sidebar")).not.toBeVisible();
      await page
        .getByRole("button", { name: "Show sidebar", exact: true })
        .click();
      await expect(savedChat(page)).toBeVisible();
    } finally {
      held.release();
    }
  });
}
