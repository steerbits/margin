import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, SessionInfo, Snapshot } from "../../shared/types.ts";

const current = (page: Page) =>
  page.getByRole("navigation", { name: "Conversations", exact: true });
const other = (page: Page) =>
  page.getByRole("navigation", { name: "Other workspaces", exact: true });
const rows = (page: Page) => page.locator(".session-list > button");
const row = (page: Page, id: string) =>
  page.locator(`[data-session-id="${id}"]`);
const search = (page: Page) =>
  page.getByRole("searchbox", { name: "Search all chats" });

// Synthetic metadata makes overflow/status transitions deterministic; navigation
// and draft persistence are also exercised against the real API in the final test.
async function fixture(
  page: Page,
  {
    activeCurrent = 2,
    activeOther = 2,
    currentCount = 8,
    otherCount = 14,
  } = {},
) {
  await page.goto("/");
  const response = await page.request.get("/api/bootstrap");
  expect(response.ok(), await response.text()).toBe(true);
  const bootstrap = await response.json();
  const seed = await (
    await page.request.post("/api/test/seed", {
      data: { title: "Sidebar snapshot template" },
    })
  ).json();
  const template: Snapshot = await (
    await page.request.get(`/api/sessions/${seed.id}`)
  ).json();
  const projects: Project[] = [
    { ...bootstrap.projects[0], name: "Margin" },
    { id: "sidebar-website", name: "Website", path: "/fixture/website" },
    { id: "sidebar-research", name: "Research", path: "/fixture/research" },
  ];
  const make = (
    prefix: string,
    count: number,
    active: number,
    projectId: string,
  ): SessionInfo[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i}`,
      projectId,
      title:
        i === count - 1
          ? `${prefix} archived export`
          : `${prefix} conversation ${i + 1}`,
      createdAt: 1,
      updatedAt: 100 - i,
      activity: {
        status: i < active ? (i === 1 ? "waiting" : "running") : "idle",
      },
    }));
  const data = {
    projects,
    sessions: [
      ...make(
        "Local",
        Math.max(currentCount, activeCurrent + 2),
        activeCurrent,
        projects[0].id,
      ),
      ...make(
        "Website",
        Math.max(otherCount, activeOther + 2),
        activeOther,
        projects[1].id,
      ),
      ...make("Research", 2, 0, projects[2].id),
    ],
  };
  await page.route("**/api/bootstrap?*", (route) =>
    route.fulfill({ json: { ...bootstrap, ...data } }),
  );
  await page.route("**/api/sessions", (route) => route.fulfill({ json: data }));
  const snapshot = (url: string) => ({
    ...template,
    session: data.sessions.find(
      (s) => s.id === new URL(url).pathname.split("/")[3],
    )!,
    composer: "",
    busy: false,
  });
  await page.route("**/api/sessions/*/preview", (route) =>
    route.fulfill({ json: snapshot(route.request().url()) }),
  );
  await page.route("**/api/sessions/*/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ snapshot: snapshot(route.request().url()) })}\n\n`,
    }),
  );
  await page.goto(`/workspaces/${projects[0].id}`);
  await expect(current(page).locator("[data-session-id]")).toHaveCount(
    Math.max(5, activeCurrent),
  );
  return data;
}

test("two deduplicated sections have soft caps, full workspace-first tooltips and live status", async ({
  page,
}) => {
  const data = await fixture(page);
  await expect(page.locator(".section-active-count")).toHaveCount(0);
  await expect(other(page).locator("[data-session-id]")).toHaveCount(10);
  await expect(current(page).locator("button").first()).toHaveAttribute(
    "data-session-id",
    "Local-0",
  );
  await expect(other(page).locator("button").first()).toHaveAttribute(
    "data-session-id",
    "Website-0",
  );
  await expect(row(page, "Website-0")).toHaveAttribute(
    "title",
    "Website — Website conversation 1",
  );
  await expect(row(page, "Website-0")).toHaveAttribute(
    "aria-label",
    /Running$/,
  );
  await expect(
    row(page, "Website-1").getByRole("img", { name: "Waiting for you" }),
  ).toBeVisible();
  await expect(row(page, "Website-0").locator(".session-title")).toHaveText(
    "Website conversation 1",
  );
  const ids = await rows(page).evaluateAll((elements) =>
    elements.map((e) => e.getAttribute("data-session-id")),
  );
  expect(new Set(ids).size).toBe(ids.length);
  const running = data.sessions.find((s) => s.id === "Website-0")!;
  running.activity = {
    status: "finished",
    completionId: "new-completion",
    replyId: "new-reply",
  };
  await expect(
    row(page, running.id).getByRole("img", { name: "Unread" }),
  ).toBeVisible();
  await expect(other(page).locator("button").first()).toHaveAttribute(
    "data-session-id",
    "Website-1",
  );
  await expect(
    row(page, running.id).locator(".conversation-spinner"),
  ).toHaveCount(0);
  await expect(page.locator(".section-active-count")).toHaveCount(0);
  await page.screenshot({
    path: ".margin-data/sidebar-workspaces-desktop.png",
    fullPage: true,
  });
});

test("Show more reveals ten at a time and stays immediately beneath the rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await fixture(page, { currentCount: 25, otherCount: 35 });
  const more = (list: ReturnType<typeof current>) =>
    list.getByRole("button", { name: "Show more", exact: true });
  const geometry = await other(page).evaluate((list) => {
    const chats = list.querySelectorAll("[data-session-id]");
    const last = chats[chats.length - 1].getBoundingClientRect();
    const more = list
      .querySelector(".sidebar-show-more")!
      .getBoundingClientRect();
    const search = document
      .querySelector(".sidebar-search")!
      .getBoundingClientRect();
    return {
      afterLast: more.top - last.bottom,
      searchGap: search.top - more.bottom,
    };
  });
  expect(geometry.afterLast).toBeGreaterThanOrEqual(0);
  expect(geometry.afterLast).toBeLessThan(10);
  expect(geometry.searchGap).toBeGreaterThan(80);
  await expect(
    page.getByRole("button", { name: /Show all|Show less/ }),
  ).toHaveCount(0);

  for (const [list, counts] of [
    [current(page), [15, 25]],
    [other(page), [20, 30, 37]],
  ] as const) {
    for (const count of counts) {
      const previousIds = await list
        .locator("[data-session-id]")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-session-id")),
        );
      await more(list).scrollIntoViewIfNeeded();
      const scrollTop = await list.evaluate((list) => list.scrollTop);
      await more(list).click();
      await expect(list.locator("[data-session-id]")).toHaveCount(count);
      const nextIds = await list
        .locator("[data-session-id]")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-session-id")),
        );
      expect(previousIds.every((id) => nextIds.includes(id))).toBe(true);
      expect(new Set(nextIds).size).toBe(count);
      await expect
        .poll(() => list.evaluate((list) => list.scrollTop))
        .toBe(scrollTop);
    }
    await expect(more(list)).toHaveCount(0);
  }
});

test("paging adds ten beyond overflowing activity and keyboard focus enters the new rows", async ({
  page,
}) => {
  await fixture(page, {
    activeCurrent: 7,
    activeOther: 13,
    currentCount: 32,
    otherCount: 40,
  });
  const localMore = current(page).getByRole("button", {
    name: "Show more",
    exact: true,
  });
  await localMore.focus();
  await localMore.press("Enter");
  await expect(current(page).locator("[data-session-id]")).toHaveCount(17);
  await expect(row(page, "Local-7")).toBeFocused();
  await other(page)
    .getByRole("button", { name: "Show more", exact: true })
    .click();
  await expect(other(page).locator("[data-session-id]")).toHaveCount(23);
  await search(page).fill("archived");
  await expect(rows(page)).toHaveCount(3);
  await search(page).press("Escape");
  await expect(current(page).locator("[data-session-id]")).toHaveCount(17);
  await expect(other(page).locator("[data-session-id]")).toHaveCount(23);
});

test("row tooltips retain the full truncated title after the workspace, without status", async ({
  page,
}) => {
  const data = await fixture(page);
  const title =
    "Review all export edge cases and preserve every original customer field";
  data.sessions.find((s) => s.id === "Website-0")!.title = title;
  await expect(row(page, "Website-0").locator(".session-title")).toHaveText(
    title,
  );
  expect(
    await row(page, "Website-0")
      .locator(".session-title")
      .evaluate((text) => text.scrollWidth > text.clientWidth),
  ).toBe(true);
  await expect(row(page, "Website-0")).toHaveAttribute(
    "title",
    `Website — ${title}`,
  );
  await expect(row(page, "Website-0")).toHaveAttribute(
    "aria-label",
    `Website — ${title} — Running`,
  );
  await expect(
    row(page, "Website-0").getByRole("img", { name: "Running" }),
  ).toHaveAttribute("title", "Running");
});

test("active counts appear only when active rows are outside the list viewport", async ({
  page,
}) => {
  const data = await fixture(page, { activeCurrent: 4, activeOther: 6 });
  const localCount = page.locator(
    ".current-workspace-chats .section-active-count",
  );
  const otherCount = page.locator(
    ".other-workspace-chats .section-active-count",
  );
  await expect(localCount).toHaveCount(0);
  await expect(otherCount).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 650 });
  await expect(localCount).toHaveText("4 active");
  await expect(otherCount).toHaveText("6 active");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(localCount).toHaveCount(0);
  await expect(otherCount).toHaveCount(0);

  // Inactive-row overflow alone is not a reason to show the count.
  await other(page).evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
  await expect(otherCount).toHaveText("6 active");
  await other(page).evaluate((list) => {
    list.scrollTop = 0;
  });
  await expect(otherCount).toHaveCount(0);

  await current(page)
    .getByRole("button", { name: "Show more", exact: true })
    .click();
  // Let paging restore the reading position before exercising a new scroll.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(localCount).toHaveCount(0);
  await current(page).evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
  await expect(localCount).toHaveText("4 active");
  await current(page).evaluate((list) => {
    list.scrollTop = 0;
  });
  await expect(localCount).toHaveCount(0);

  // Completing offscreen activity clears the cue, without requiring a scroll.
  await other(page).evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
  await expect(otherCount).toHaveText("6 active");
  for (const session of data.sessions)
    if (session.projectId !== data.projects[0].id)
      session.activity = { status: "finished" };
  await expect(otherCount).toHaveCount(0);
});

test("all active chats remain in independently scrollable lists, including on short and mobile screens", async ({
  page,
}) => {
  await fixture(page, { activeCurrent: 7, activeOther: 13 });
  await expect(current(page).locator("[data-session-id]")).toHaveCount(7);
  await expect(other(page).locator("[data-session-id]")).toHaveCount(13);
  for (const viewport of [
    { width: 1440, height: 650 },
    { width: 390, height: 667 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.locator(".current-workspace-chats .section-active-count"),
    ).toHaveText("7 active");
    await expect(
      page.locator(".other-workspace-chats .section-active-count"),
    ).toHaveText("13 active");
    const geometry = await page.evaluate(() => {
      const a = document.querySelector<HTMLElement>(
        ".current-workspace-chats .session-list",
      )!;
      const b = document.querySelector<HTMLElement>(
        ".other-workspace-chats .session-list",
      )!;
      const input = document
        .querySelector(".sidebar-search")!
        .getBoundingClientRect();
      return {
        currentOverflow: a.scrollHeight > a.clientHeight,
        otherOverflow: b.scrollHeight > b.clientHeight,
        currentHeight: a.clientHeight,
        otherHeight: b.clientHeight,
        searchBottom: input.bottom,
        width: document.documentElement.scrollWidth,
      };
    });
    expect(geometry.currentOverflow).toBe(true);
    expect(geometry.otherOverflow).toBe(true);
    expect(geometry.currentHeight).toBeGreaterThan(35);
    expect(geometry.otherHeight).toBeGreaterThan(35);
    expect(geometry.searchBottom).toBeLessThanOrEqual(viewport.height);
    expect(geometry.width).toBeLessThanOrEqual(viewport.width);
    await row(page, "Website-12").scrollIntoViewIfNeeded();
    await expect(row(page, "Website-12")).toBeVisible();
    await expect(search(page)).toBeVisible();
  }
  await page.screenshot({
    path: ".margin-data/sidebar-workspaces-mobile.png",
    fullPage: true,
  });
  await row(page, "Website-12").click();
  await expect(page).toHaveURL(/\/chats\/Website-12$/);
  await expect(page.locator(".app")).toHaveClass(/sidebar-hidden/);
});

test("global search finds hidden chats, supports keyboard opening, and retains context actions", async ({
  page,
}) => {
  const data = await fixture(page);
  await expect(row(page, "Website-13")).toHaveCount(0);
  await search(page).fill("  WEBSITE  archived ");
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, "Website-13")).toBeVisible();
  await expect(current(page)).toHaveCount(0);
  await page.screenshot({
    path: ".margin-data/sidebar-workspaces-search.png",
    fullPage: true,
  });
  await search(page).press("ArrowUp");
  await expect(row(page, "Website-13")).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Delete conversation", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row(page, "Website-13")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chats\/Website-13$/);
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(data.projects[1].id);
  await expect(search(page)).toHaveValue("");
  await expect(row(page, "Website-13")).toHaveAttribute("aria-current", "page");
  await expect(
    other(page).locator('[data-session-id^="Website-"]'),
  ).toHaveCount(0);
  await search(page).fill("no such chat");
  await expect(
    page.getByText("No matching chats.", { exact: false }),
  ).toBeVisible();
  await search(page).press("Escape");
  await expect(other(page)).toBeVisible();
  await search(page).fill("Research");
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Clear chat search" }).click();
  await expect(search(page)).toBeFocused();
  await search(page).fill("Local archived");
  await search(page).press("Enter");
  await expect(page).toHaveURL(/\/chats\/Local-7$/);
});

test("real cross-workspace switching and search preserve drafts and discover a newly added workspace", async ({
  page,
}) => {
  await page.goto("/");
  const seed = await (
    await page.request.post("/api/test/seed", {
      data: { title: "Original workspace draft" },
    })
  ).json();
  await page.goto(`/chats/${seed.id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await page.getByLabel("Message Pi").fill("Keep the original workspace draft");
  const folder = mkdtempSync(join(tmpdir(), "margin-sidebar-search-"));
  try {
    const projectResponse = await page.request.post("/api/projects", {
      data: { path: folder },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json();
    const chatResponse = await page.request.post("/api/sessions", {
      data: { projectId: project.id },
    });
    expect(chatResponse.ok()).toBe(true);
    const second: Snapshot = await chatResponse.json();
    // Polling must bring in the new project's metadata as well as its chat.
    await expect(row(page, second.session.id)).toBeVisible();
    await row(page, second.session.id).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${second.session.id}$`));
    await expect(
      page.getByRole("combobox", { name: "Project", exact: true }),
    ).toHaveValue(project.id);
    await expect(page.getByLabel("Starting skill")).toBeEnabled();
    await page.getByLabel("Message Pi").fill("Keep the second workspace draft");
    await search(page).fill("Original workspace draft");
    await search(page).press("Enter");
    await expect(page).toHaveURL(new RegExp(`/chats/${seed.id}$`));
    await expect(page.getByLabel("Message Pi")).toHaveValue(
      "Keep the original workspace draft",
    );
    await row(page, second.session.id).click();
    await expect(page.getByLabel("Message Pi")).toHaveValue(
      "Keep the second workspace draft",
    );
    await page.goBack();
    await expect(page.getByLabel("Message Pi")).toHaveValue(
      "Keep the original workspace draft",
    );
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/sessions/${seed.id}`)).json())
            .composer,
      )
      .toBe("Keep the original workspace draft");
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/sessions/${second.session.id}`)
            ).json()
          ).composer,
      )
      .toBe("Keep the second workspace draft");
    await page
      .getByRole("button", { name: "Comment on reply", exact: true })
      .click();
    await page.getByLabel("Inline comment").fill("Keep this unsent comment");
    const commentUrl = page.url();
    await search(page).fill(project.name);
    await search(page).press("Enter");
    await expect(page).toHaveURL(commentUrl);
    await expect(page.getByLabel("Inline comment")).toHaveValue(
      "Keep this unsent comment",
    );
    await expect(search(page)).toHaveValue(project.name);
    await expect(page.getByRole("alert")).toContainText("draft comment");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
