import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";

const row = (page: Page, id: string) =>
  page.locator(`[data-session-id="${id}"]`);
const dot = (page: Page, id: string) =>
  row(page, id).locator(".conversation-unread");
const action = (page: Page, name: string) =>
  page.getByRole("menuitem", { name, exact: true });

async function seed(page: Page, title: string, empty = false) {
  const response = await page.request.post("/api/test/seed", {
    data: { title, empty },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).id as string;
}
async function showSidebar(page: Page) {
  const show = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await show.isVisible()) await show.click();
}
async function ready(page: Page, id: string) {
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await showSidebar(page);
}
async function complete(page: Page, id: string) {
  const before = (await (await page.request.get(`/api/sessions/${id}`)).json())
    .session.activity?.completionId;
  const result = await page.request.post(`/api/sessions/${id}/send`, {
    data: { id: randomUUID(), note: "Complete a reply", commentIds: [] },
  });
  expect(result.ok()).toBe(true);
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(`/api/sessions/${id}`)
      ).json();
      return snapshot.session.activity?.completionId;
    })
    .toBeTruthy();
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(`/api/sessions/${id}`)
      ).json();
      return snapshot.session.activity?.completionId;
    })
    .not.toBe(before);
}

test("manual unread survives visibility, focus and reload until explicitly reopened", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page, "Manual reminder");
  await ready(page, id);
  await complete(page, id);
  await page.bringToFront();
  await page.locator(".scroll-area").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(dot(page, id)).toHaveCount(0);
  await row(page, id).click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    "Mark unread",
    "Delete conversation",
  ]);
  await action(page, "Mark unread").click();
  await expect(dot(page, id)).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.reload();
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await expect(dot(page, id)).toHaveCount(1);
  await row(page, id).click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    "Mark as read",
    "Delete conversation",
  ]);
  await page.keyboard.press("Escape");
  await row(page, id).click();
  await expect(dot(page, id)).toHaveCount(0);
});

test("read/unread toggles don't navigate, work without completions and sync between tabs", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const current = await seed(page, "Stay in this chat");
  const target = await seed(page, "Empty reminder", true);
  await ready(page, current);
  const otherTab = await context.newPage();
  await ready(otherTab, current);
  await page.bringToFront();
  await row(page, target).click({ button: "right" });
  await action(page, "Mark unread").click();
  await expect(dot(page, target)).toHaveCount(1);
  await expect(dot(otherTab, target)).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`/chats/${current}$`));
  await row(page, target).click({ button: "right" });
  await action(page, "Mark as read").click();
  await expect(dot(page, target)).toHaveCount(0);
  await expect(dot(otherTab, target)).toHaveCount(0);
  await row(page, target).click({ button: "right" });
  await action(page, "Mark unread").click();
  await row(page, target).click();
  await expect(dot(page, target)).toHaveCount(0);
  await expect(dot(otherTab, target)).toHaveCount(0);
  await otherTab.close();
});

test("mark as read acknowledges only the latest completion without selecting the chat", async ({
  page,
}) => {
  await page.goto("/");
  const current = await seed(page, "Reading here");
  const target = await seed(page, "Background completion");
  await ready(page, current);
  await complete(page, target);
  await expect(dot(page, target)).toHaveCount(1);
  await row(page, target).click({ button: "right" });
  await action(page, "Mark as read").click();
  await expect(dot(page, target)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/chats/${current}$`));
  await page.reload();
  await expect(dot(page, target)).toHaveCount(0);
  await complete(page, target);
  await expect(dot(page, target)).toHaveCount(1);
});

test("keyboard menu order, active-chat safeguards and viewport clamping", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page, "Keyboard actions");
  await ready(page, id);
  await row(page, id).focus();
  await page.keyboard.press("Shift+F10");
  await expect(action(page, "Mark unread")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(action(page, "Delete conversation")).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(dot(page, id)).toHaveCount(1);
  await expect(row(page, id)).toBeFocused();
  await page.request.post(`/api/test/${id}/dialog`, {
    data: { kind: "input" },
  });
  await expect(row(page, id).locator(".conversation-waiting")).toBeVisible();
  await row(page, id).evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 1439,
        clientY: 999,
      }),
    ),
  );
  await expect(page.getByRole("menuitem")).toHaveText([
    "Mark as read",
    "Stop conversation",
    "Delete conversation",
  ]);
  await expect(action(page, "Delete conversation")).toBeDisabled();
  const bounds = await page.getByRole("menu").boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1432);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(992);
  await page.keyboard.press("End");
  await expect(action(page, "Stop conversation")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.request.post(`/api/sessions/${id}/stop`, { data: {} });
});

// WebKit has no public Playwright touch-hold API. Dispatch real PointerEvent
// objects to exercise our gesture logic there; the fallback uses touchscreen.tap.
async function pointer(target: Locator, type: string, x: number, y: number) {
  await target.dispatchEvent(type, {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: y,
    bubbles: true,
  });
}

test.describe("mobile conversation actions", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("tap fallback toggles state and preserves deletion confirmation, including search results", async ({
    page,
  }) => {
    await page.goto("/");
    const id = await seed(page, "Mobile menu target", true);
    const current = await seed(page, "Mobile current chat");
    await ready(page, current);
    await page
      .getByRole("searchbox", { name: "Search all chats" })
      .fill("Mobile menu target");
    const trigger = page.getByRole("button", {
      name: "Actions for Mobile menu target",
      exact: true,
    });
    await expect(trigger).toBeVisible();
    const size = await trigger.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(44);
    expect(size!.height).toBeGreaterThanOrEqual(44);
    await trigger.tap();
    await expect(page.getByRole("menuitem")).toHaveText([
      "Mark unread",
      "Delete conversation",
    ]);
    await action(page, "Mark unread").tap();
    await expect(dot(page, id)).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`/chats/${current}$`));
    await trigger.tap();
    await action(page, "Mark as read").tap();
    await expect(dot(page, id)).toHaveCount(0);
    await trigger.tap();
    await action(page, "Delete conversation").tap();
    await expect(page.getByRole("dialog")).toContainText("Mobile menu target");
    await page.getByRole("button", { name: "Cancel", exact: true }).tap();
    await expect(row(page, id)).toBeVisible();
  });

  test("long press opens once and release doesn't select; ordinary tap still opens", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/");
    const target = await seed(page, "Long press target", true);
    const current = await seed(page, "Keep current on hold");
    await ready(page, current);
    const button = row(page, target);
    const rect = (await button.boundingBox())!;
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    if (browserName === "chromium") {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await expect(page.getByRole("menu")).toBeVisible();
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    } else {
      await pointer(button, "pointerdown", x, y);
      await expect(page.getByRole("menu")).toBeVisible();
      await pointer(button, "pointerup", x, y);
      await button.dispatchEvent("click", { detail: 1 });
    }
    // Native contextmenu after our timer must not reopen or refocus the menu.
    await page.keyboard.press("ArrowDown");
    await expect(action(page, "Delete conversation")).toBeFocused();
    await button.dispatchEvent("contextmenu", { clientX: x, clientY: y });
    await expect(action(page, "Delete conversation")).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(1);
    await expect(page.getByRole("menuitem")).toHaveText([
      "Mark unread",
      "Delete conversation",
    ]);
    await expect(page).toHaveURL(new RegExp(`/chats/${current}$`));
    await page.screenshot({
      path: `.margin-data/temporary/conversation-menu/${browserName}-mobile.png`,
    });
    await page.keyboard.press("Escape");
    await button.tap();
    await expect(page).toHaveURL(new RegExp(`/chats/${target}$`));
  });

  test("moving, scrolling, cancellation and short taps do not trigger a long press", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/");
    if (browserName === "chromium") {
      for (let i = 0; i < 5; i++) await seed(page, `Scroll fixture ${i}`, true);
    }
    const id = await seed(page, "Cancelled gestures");
    await ready(page, id);
    const button = row(page, id);
    const rect = (await button.boundingBox())!;
    const x = rect.x + 30,
      y = rect.y + 20;
    for (const cancel of [
      "move",
      "scroll",
      "cancel",
      "release",
      "multitouch",
    ]) {
      await pointer(button, "pointerdown", x, y);
      if (cancel === "move") await pointer(button, "pointermove", x, y + 25);
      if (cancel === "scroll")
        await page
          .locator("#current-workspace-chats-list")
          .dispatchEvent("scroll");
      if (cancel === "cancel") await pointer(button, "pointercancel", x, y);
      if (cancel === "release") await pointer(button, "pointerup", x, y);
      if (cancel === "multitouch")
        await button.dispatchEvent("pointerdown", {
          pointerType: "touch",
          pointerId: 2,
          isPrimary: false,
        });
      await page.waitForTimeout(600);
      await expect(page.getByRole("menu")).toHaveCount(0);
      await pointer(button, "pointerup", x, y);
    }
    if (browserName === "chromium") {
      // Exercise actual browser panning as well as the synthetic cancellation cases.
      await page.setViewportSize({ width: 390, height: 600 });
      const list = page.locator("#current-workspace-chats-list");
      await expect
        .poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight))
        .toBe(true);
      await list.evaluate((el) => {
        el.scrollTop = 0;
      });
      const bounds = (await list.boundingBox())!;
      const cdp = await context.newCDPSession(page);
      const start = { x: bounds.x + 40, y: bounds.y + bounds.height - 20 };
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [start],
      });
      for (let distance = 15; distance <= 90; distance += 15) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: start.x, y: start.y - distance }],
        });
        await page.waitForTimeout(25);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(() => list.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      await page.waitForTimeout(600);
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
      await cdp.detach();
    }
  });
});
