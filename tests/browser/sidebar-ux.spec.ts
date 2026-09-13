import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
const row = (page: Page, id: string) =>
  page.locator(`[data-session-id="${id}"]`);
async function seed(page: Page, title: string, responseDelay = 80) {
  const response = await page.request.post("/api/test/seed", {
    data: { title, responseDelay },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).id as string;
}
async function open(page: Page, id: string) {
  await row(page, id).click();
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
}

test("sidebar uses one-line titles, an inline spinner/unread dot, and contextual deletion", async ({
  page,
}) => {
  await page.goto("/");
  const first = await seed(page, "First conversation", 1500);
  const second = await seed(page, "Second conversation");
  await page.goto(`/chats/${first}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await expect(row(page, first)).toHaveText("First conversation");
  await expect(row(page, first).locator("svg")).toHaveCount(0);
  await expect(
    page
      .locator(".toolbar")
      .getByRole("button", { name: "Delete conversation", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".sidebar")
      .getByRole("button", { name: "All workspaces", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".sidebar-heading")
      .getByRole("button", { name: "Rename workspace", exact: true }),
  ).toBeVisible();
  const options = page
    .getByRole("combobox", { name: "Project", exact: true })
    .locator("option");
  await expect(options.last()).toHaveText("All workspaces…");
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await page.request.post(`/api/sessions/${first}/send`, {
    data: { id: randomUUID(), note: "Run briefly", commentIds: [] },
  });
  await expect(row(page, first).locator(".conversation-spinner")).toBeVisible();
  await expect(row(page, first)).toHaveText("First conversation");
  const height = await row(page, first).evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(height).toBeLessThan(48);
  await expect(row(page, first).locator(".conversation-unread")).toHaveCount(1);
  await expect(row(page, first).locator(".conversation-spinner")).toHaveCount(
    0,
  );
  await open(page, first);
  await page.bringToFront();
  await page.locator(".scroll-area").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(row(page, first).locator(".conversation-unread")).toHaveCount(0);
  const currentUrl = page.url();
  // Deleting a different row does not select it or discard the current chat.
  await row(page, second).click({ button: "right" });
  await expect(page).toHaveURL(currentUrl);
  await page
    .getByRole("menuitem", { name: "Delete conversation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Second conversation");
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(row(page, second)).toHaveCount(0);
  await expect(page).toHaveURL(currentUrl);
  await row(page, first).focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.screenshot({
    path: ".margin-data/sidebar-refinement.png",
    fullPage: true,
  });
});

test("cached switches paint in one frame while the stream and outgoing save are blocked", async ({
  page,
}) => {
  await page.goto("/");
  const first = await seed(page, "Cached first");
  const second = await seed(page, "Cached second");
  await page.goto(`/chats/${first}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await page.getByLabel("Message Pi").fill("First draft");
  await open(page, second);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${first}/events`, async (route) => {
    await blocked;
    await route.continue().catch(() => {});
  });
  await page.route(`**/api/sessions/${second}/composer`, async (route) => {
    await blocked;
    await route.continue().catch(() => {});
  });
  let sends = 0;
  await page.route(`**/api/sessions/${first}/send`, (route) => {
    sends++;
    return route.fulfill({ json: { status: "accepted" } });
  });
  try {
    await page.getByLabel("Message Pi").fill("Second draft still saving");
    const timing = await page.evaluate(async (id) => {
      const start = performance.now();
      document
        .querySelector<HTMLButtonElement>(`[data-session-id="${id}"]`)!
        .click();
      await new Promise(requestAnimationFrame);
      return {
        milliseconds: performance.now() - start,
        title: document
          .querySelector(".conversation-title")
          ?.textContent?.trim(),
        draft: document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Message Pi"]',
        )?.value,
        loading: !!document.querySelector(".conversation-loading"),
      };
    }, first);
    expect(timing.title).toBe("Cached first");
    expect(timing.draft).toBe("First draft");
    expect(timing.loading).toBe(false);
    expect(timing.milliseconds).toBeLessThan(200);
    writeFileSync(
      ".margin-data/chat-switch-timing.json",
      JSON.stringify(timing, null, 2),
    );
    await page.getByLabel("Message Pi").press("Control+Enter");
    expect(sends).toBe(0);
    await row(page, second).click();
    await expect(page.getByLabel("Message Pi")).toHaveValue(
      "Second draft still saving",
    );
    await expect(page.getByLabel("Starting skill")).toBeEnabled();
    await page.getByLabel("Message Pi").fill("Second draft with a newer edit");
    release();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/sessions/${second}`)).json())
            .composer,
      )
      .toBe("Second draft with a newer edit");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a failed background save retains its chat's draft across rapid switches", async ({
  page,
}) => {
  await page.goto("/");
  const first = await seed(page, "Retained draft");
  const second = await seed(page, "Unrelated chat");
  await page.goto(`/chats/${first}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await page.route(`**/api/sessions/${first}/composer`, (route) =>
    route.fulfill({ status: 503, json: { error: "Temporary save failure" } }),
  );
  await page.getByLabel("Message Pi").fill("Keep this even when saving fails");
  await open(page, second);
  await expect(page.getByRole("alert")).toContainText("Temporary save failure");
  await open(page, first);
  await expect(page.getByLabel("Message Pi")).toHaveValue(
    "Keep this even when saving fails",
  );
  await page.unroute(`**/api/sessions/${first}/composer`);
  await open(page, second);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/sessions/${first}`)).json())
          .composer,
    )
    .toBe("Keep this even when saving fails");
});

test("delayed plugin composer and comment responses stay with their original chat", async ({
  page,
}) => {
  await page.goto("/");
  const first = await seed(page, "Original callback target");
  const second = await seed(page, "Current callback target");
  const makeComment = async (id: string, text: string) => {
    const snapshot = await (
      await page.request.get(`/api/sessions/${id}`)
    ).json();
    const reply = snapshot.messages.find((m: any) => m.role === "assistant");
    const quote = "A focused meeting-notes app";
    await page.request.put(`/api/sessions/${id}/comments`, {
      data: [
        {
          id: randomUUID(),
          anchor: {
            messageId: reply.id,
            start: 0,
            end: quote.length,
            quote,
            prefix: "",
            suffix: "",
          },
          text,
          status: "draft",
          createdAt: Date.now(),
        },
      ],
    });
  };
  await makeComment(first, "Original comment");
  await makeComment(second, "Current comment must remain");
  await page.goto(`/chats/${first}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  let releasePlugin!: () => void;
  let releaseComment!: () => void;
  const pluginGate = new Promise<void>((resolve) => {
    releasePlugin = resolve;
  });
  const commentGate = new Promise<void>((resolve) => {
    releaseComment = resolve;
  });
  await page.route(
    `**/api/sessions/${first}/plugins/lab/load`,
    async (route) => {
      await pluginGate;
      await route.continue();
    },
  );
  await page.route(`**/api/sessions/${first}/comments`, async (route) => {
    await commentGate;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Prepare delayed draft", exact: true })
      .click();
    await page.getByRole("button", { name: /^Comments/ }).click();
    await page
      .getByRole("button", { name: "Delete comment", exact: true })
      .click();
    await open(page, second);
    await page.getByLabel("Message Pi").fill("Current draft must remain");
    await page.getByRole("button", { name: /^Comments/ }).click();
    await expect(page.locator(".comment-text")).toHaveText(
      "Current comment must remain",
    );
    releasePlugin();
    releaseComment();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/sessions/${first}`)).json())
            .composer,
      )
      .toBe("Draft prepared for the original chat");
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/sessions/${first}`)).json())
            .comments.length,
      )
      .toBe(0);
    await expect(page.getByLabel("Message Pi")).toHaveValue(
      "Current draft must remain",
    );
    await expect(page.locator(".comment-text")).toHaveText(
      "Current comment must remain",
    );
    await open(page, first);
    await expect(page.getByLabel("Message Pi")).toHaveValue(
      "Draft prepared for the original chat",
    );
  } finally {
    releasePlugin();
    releaseComment();
    await page.unrouteAll({ behavior: "wait" });
  }
});
