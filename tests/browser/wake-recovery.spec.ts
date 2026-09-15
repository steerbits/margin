import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, options = {}) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", { data: options });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(page.locator(".connection")).toHaveText("Connected");
  return id as string;
}
async function wake(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("offline browser catches up to a completed run without reload, resend, or losing an unsaved composer", async ({
  page,
  context,
}) => {
  const id = await seed(page, { historyCount: 6, responseDelay: 3000 });
  const composer = page.getByRole("textbox", {
    name: "Message Pi",
    exact: true,
  });
  await composer.fill("Continue the original task");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator(".connection")).toHaveText("Reconnecting…");
  await composer.fill("Private unsent draft written while offline");
  await page.waitForTimeout(700); // let the debounced save actually fail
  const scroller = page.locator(".scroll-area");
  await scroller.evaluate((el) => {
    el.scrollTop = 240;
    el.dispatchEvent(new Event("scroll"));
  });
  const top = await scroller.evaluate((el) => el.scrollTop);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/sessions/${id}`)).json()).busy,
    )
    .toBe(false);
  const before = await (await page.request.get(`/api/sessions/${id}`)).json();
  const count = before.messages.filter(
    (m: { role: string }) => m.role === "user",
  ).length;
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await context.setOffline(false);
  await wake(page);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(
    page.getByRole("heading", { name: "Revised direction" }),
  ).toBeAttached();
  await expect(composer).toHaveValue(
    "Private unsent draft written while offline",
  );
  await expect
    .poll(async () =>
      Math.abs((await scroller.evaluate((el) => el.scrollTop)) - top),
    )
    .toBeLessThan(5);
  expect(navigations).toBe(0);
  const after = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(
    after.messages.filter((m: { role: string }) => m.role === "user"),
  ).toHaveLength(count);
});

test("wake preserves a not-yet-saved inline comment and opens only one replacement stream", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("button", { name: "Comment on reply", exact: true })
    .click();
  const editor = page.getByRole("textbox", {
    name: "Inline comment",
    exact: true,
  });
  await editor.fill("Do not lose this unfinished comment");
  let streams = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/events")) streams++;
  });
  await wake(page);
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect.poll(() => streams).toBe(1);
  await expect(editor).toHaveValue("Do not lose this unfinished comment");
});

test("a broken stream reconnects after failures without navigating the page", async ({
  page,
}) => {
  const id = await seed(page);
  let failures = 0;
  await page.route(`**/api/sessions/${id}/events`, async (route) => {
    if (failures++ < 2) return route.abort("failed");
    await route.continue();
  });
  await wake(page);
  await expect(page.locator(".connection")).toHaveText("Reconnecting…");
  await expect(page.locator(".connection")).toHaveText("Connected", {
    timeout: 15_000,
  });
  expect(failures).toBe(3);
  await expect(
    page.getByRole("heading", { name: "A focused meeting-notes app" }),
  ).toBeAttached();
});
