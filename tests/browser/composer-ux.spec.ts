import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", {
    data: { historyCount: 7 },
  });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  return id as string;
}

async function mockNewConversation(page: Page) {
  // Exercise creation in the UI, but use scripted replies, never a live model.
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await page.request.post("/api/test/seed", {
      data: { empty: true, title: "New conversation" },
    });
    expect(response.ok()).toBe(true);
    await route.fulfill({ json: (await response.json()).snapshot });
  });
}

for (const mobile of [false, true]) {
  test(`new conversation focuses the message box once on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    if (mobile)
      await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.getByRole("button", { name: /New conversation.*⌘/ }).click();
    const composer = page.getByLabel("Message", { exact: true });
    // Check before fill/click can hide a missing autofocus.
    await expect(composer).toBeFocused();
    await expect(composer).toBeInViewport({ ratio: 1 });
    if (mobile) await expect(page.locator(".sidebar")).not.toBeVisible();
    await page.keyboard.type("Ready to type immediately");
    await expect(composer).toHaveValue("Ready to type immediately");

    // Live snapshots must not repeatedly take focus back from other controls.
    const skill = page.getByLabel("Starting skill");
    await expect(skill).toBeEnabled();
    await skill.focus();
    const id = page.url().match(/\/chats\/([^/?]+)/)![1];
    const response = await page.request.post(`/api/test/${id}/tools`, {
      data: {},
    });
    expect(response.ok()).toBe(true);
    await expect(page.locator(".tool-card")).not.toHaveCount(0);
    await expect(skill).toBeFocused();
    await expect(composer).toHaveValue("Ready to type immediately");
  });
}

for (const mobile of [false, true]) {
  test(`empty composer stays beneath the welcome until Send on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await mockNewConversation(page);
    if (mobile)
      await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.getByRole("button", { name: /New conversation.*⌘/ }).click();
    const composer = page.getByLabel("Message", { exact: true });
    await expect(composer).toBeFocused();
    await expect(page.getByLabel("Starting skill")).toBeEnabled();
    const welcome = (await page.locator(".empty-conversation").boundingBox())!;
    const form = (await page.locator(".composer").boundingBox())!;
    // Match the former in-thread spacing, rather than anchoring an empty chat.
    expect(form.y - (welcome.y + welcome.height)).toBeCloseTo(30, 0);
    const originalY = (await composer.boundingBox())!.y;
    await page.keyboard.type("Begin the conversation");
    expect((await composer.boundingBox())!.y).toBeCloseTo(originalY, 0);
    await page.screenshot({
      path: `.margin-data/composer-empty-${mobile ? "mobile" : "desktop"}.png`,
    });

    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/sessions/*/send", async (route) => {
      await pending;
      await route.continue().catch(() => {});
    });
    try {
      if (mobile) await page.keyboard.press("Control+Enter");
      else {
        const firstFrame = await page.evaluate(async () => {
          document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click();
          await new Promise(requestAnimationFrame);
          return {
            draft: document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!.value,
            bubble: document.querySelector(".message.user")?.textContent,
            inline: !!document.querySelector(".composer-inline"),
          };
        });
        expect(firstFrame.draft).toBe("");
        expect(firstFrame.bubble).toContain("Begin the conversation");
        expect(firstFrame.inline).toBe(false);
      }
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeDisabled();
      const dock = page.locator(".composer-dock");
      await expect
        .poll(async () => {
          const bounds = (await dock.boundingBox())!;
          return Math.abs(
            bounds.y + bounds.height - page.viewportSize()!.height,
          );
        })
        .toBeLessThan(2);
      // Keyboard submission retains focus when the composer changes position.
      if (mobile) await expect(composer).toBeFocused();
      await expect(composer).toHaveValue("");
      await expect(page.locator(".message.user")).toHaveCount(1);
      await expect(page.locator(".message.user")).toContainText("Begin the conversation");
      await expect(page.locator(".send-status")).toHaveText("Sending…");
    } finally {
      release();
    }
    await expect(page.locator(".message.user").last()).toContainText(
      "Begin the conversation",
    );
    await expect(page.locator(".send-status")).toHaveCount(0);
    await expect(page.locator(".message.user")).toHaveCount(1);
    await expect(composer).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("Starting skill")).toBeEnabled();
    await page.locator(".scroll-area").evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(composer).toBeInViewport({ ratio: 1 });
    const dock = (await page.locator(".composer-dock").boundingBox())!;
    expect(dock.y + dock.height).toBeCloseTo(page.viewportSize()!.height, 0);
  });
}

test("failed first send restores the inline draft; accepted send keeps its bubble before live messages arrive", async ({
  page,
}) => {
  await seed(page);
  await mockNewConversation(page);
  await page.getByRole("button", { name: /New conversation.*⌘/ }).click();
  // The previous chat's composer is still enabled while creation is in flight.
  // Wait for the new chat, rather than accidentally typing into the old one.
  await expect(page.getByRole("heading", { name: "What would you like to work on?" })).toBeVisible();
  const composer = page.getByLabel("Message", { exact: true });
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await composer.fill("Preserve this first draft");
  await page.route("**/api/sessions/*/send", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Simulated send failure" },
    }),
  );
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await send.click();
  await expect(page.getByRole("alert")).toContainText("Simulated send failure");
  await expect(send).toBeEnabled();
  await expect(composer).toHaveValue("Preserve this first draft");
  const welcome = (await page.locator(".empty-conversation").boundingBox())!;
  const form = (await page.locator(".composer").boundingBox())!;
  expect(form.y - (welcome.y + welcome.height)).toBeCloseTo(30, 0);

  await page.unroute("**/api/sessions/*/send");
  await page.route("**/api/sessions/*/send", (route) =>
    route.fulfill({
      json: { status: "accepted" },
    }),
  );
  await send.click();
  await expect(page.locator(".send-status")).toHaveText("Sent");
  await expect(composer).toHaveValue("");
  await expect(page.locator(".message.user")).toHaveCount(1);
  await expect(page.locator(".message.user")).toContainText("Preserve this first draft");
  const dock = (await page.locator(".composer-dock").boundingBox())!;
  expect(dock.y + dock.height).toBeCloseTo(page.viewportSize()!.height, 0);
});

test("welcome's Start a conversation focuses the message box", async ({
  page,
}) => {
  const id = await seed(page);
  const snapshot = await (await page.request.get(`/api/sessions/${id}`)).json();
  await page.goto(`/workspaces/${snapshot.session.projectId}`);
  await page
    .getByRole("button", { name: "Start a conversation", exact: true })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1200, height: 520 },
  { width: 390, height: 844 },
]) {
  test(`reply stays in view while reading and typing at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await seed(page);
    const conversation = page.locator(".scroll-area");
    const composer = page.getByLabel("Message", { exact: true });
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(send).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel("Model", { exact: true })).toBeInViewport({
      ratio: 1,
    });
    const before = (await composer.boundingBox())!;
    const box = (await conversation.boundingBox())!;
    expect(box.height).toBeGreaterThan(100);
    const scrollBefore = await conversation.evaluate((el) => el.scrollTop);
    expect(scrollBefore).toBeGreaterThan(3000);
    await page.mouse.move(box.x + 30, box.y + 40);
    await page.mouse.wheel(0, -700);
    await expect
      .poll(() => conversation.evaluate((el) => el.scrollTop))
      .toBeLessThan(scrollBefore - 200);
    await expect(composer).toBeInViewport({ ratio: 1 });
    expect((await composer.boundingBox())!.y).toBeCloseTo(before.y, 0);

    await conversation.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(send).toBeInViewport({ ratio: 1 });
    await composer.fill("A reply about an earlier passage");
    expect(await conversation.evaluate((el) => el.scrollTop)).toBe(0);
    expect((await composer.boundingBox())!.y).toBeCloseTo(before.y, 0);

    // At the end, no message is hidden underneath the pinned composer.
    await conversation.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const end = await page.locator(".reply-end").last().boundingBox();
    const composerTop = (await page.locator(".composer").boundingBox())!.y;
    expect(end!.y + end!.height).toBeLessThanOrEqual(composerTop);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.margin-data/composer-${viewport.width}x${viewport.height}.png`,
    });
  });
}
