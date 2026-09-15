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

for (const mobile of [false, true]) {
  test(`new conversation focuses the message box once on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    if (mobile)
      await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.getByRole("button", { name: /New conversation.*⌘/ }).click();
    const composer = page.getByLabel("Message Pi", { exact: true });
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

test("welcome's Start a conversation focuses the message box", async ({
  page,
}) => {
  const id = await seed(page);
  const snapshot = await (await page.request.get(`/api/sessions/${id}`)).json();
  await page.goto(`/workspaces/${snapshot.session.projectId}`);
  await page
    .getByRole("button", { name: "Start a conversation", exact: true })
    .click();
  await expect(page.getByLabel("Message Pi", { exact: true })).toBeFocused();
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
    const composer = page.getByLabel("Message Pi", { exact: true });
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
