import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Comment, Snapshot } from "../../shared/types.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function seed(page: Page, title: string, historyCount = 7) {
  const response = await page.request.post("/api/test/seed", {
    data: { title, historyCount },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { id: string; snapshot: Snapshot };
}

const composer = (page: Page) => page.getByLabel("Message", { exact: true });
const row = (page: Page, id: string) =>
  page.locator(`[data-session-id="${id}"]`);

async function openChat(page: Page, id: string, mobile: boolean) {
  if (mobile) await page.getByRole("button", { name: "Show sidebar" }).click();
  await row(page, id).click();
  await expect(page).toHaveURL(`/chats/${id}`);
}

for (const mobile of [false, true]) {
  const device = mobile ? "mobile" : "desktop";

  test(`conversation links focus once, including cached and same-chat links on ${device}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const first = await seed(page, "Focus first");
    const second = await seed(page, "Focus second");
    await page.goto(`/chats/${first.id}`);
    await expect(composer(page)).toBeFocused();
    await expect(page.getByLabel("Starting skill")).toBeEnabled();
    await page.keyboard.type("First draft");
    await page.locator(".scroll-area").evaluate((el) => {
      el.scrollTop = 300;
      el.dispatchEvent(new Event("scroll"));
    });

    await openChat(page, second.id, mobile);
    await expect(composer(page)).toBeFocused();
    await page.keyboard.type("Second draft");
    await openChat(page, first.id, mobile);
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveValue("First draft");
    expect(
      await page.locator(".scroll-area").evaluate((el) => el.scrollTop),
    ).toBe(300);
    await expect(composer(page)).toBeInViewport({ ratio: 1 });

    // Clicking the already-selected link should also return focus to Reply.
    await openChat(page, first.id, mobile);
    await expect(composer(page)).toBeFocused();
    const skill = page.getByLabel("Starting skill");
    await expect(skill).toBeEnabled();
    await skill.focus();
    expect(
      (
        await page.request.post(`/api/test/${first.id}/tools`, { data: {} })
      ).ok(),
    ).toBe(true);
    await expect(page.locator(".tool-card")).not.toHaveCount(0);
    await expect(skill).toBeFocused();
  });

  test(`both comment links reveal the newest comment, closed or already open on ${device}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const { id, snapshot } = await seed(page, "Reveal newest comment");
    const replies = snapshot.messages.filter(
      (message) => message.role === "assistant",
    );
    // The newest comment is NOT last in passage order or in the stored array.
    const newestIndex = 4;
    const comments: Comment[] = replies.map((reply, index) => {
      const quote =
        index === replies.length - 1
          ? "A focused meeting-notes app"
          : `Earlier reply ${index + 1}`;
      return {
        id: randomUUID(),
        anchor: {
          messageId: reply.id,
          start: 0,
          end: quote.length,
          quote,
          prefix: "",
          suffix: "",
        },
        text:
          index === newestIndex
            ? "Newest comment on an earlier passage"
            : `Older comment ${index}`,
        createdAt: index === newestIndex ? 200 : 100,
        status: "draft",
      };
    });
    expect(
      (
        await page.request.put(`/api/sessions/${id}/comments`, {
          data: comments,
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`/chats/${id}`);
    await expect(page.getByLabel("Starting skill")).toBeEnabled();
    const newest = page.locator(
      `[data-comment-id="${comments[newestIndex].id}"]`,
    );
    const header = page
      .locator(".toolbar-actions")
      .getByRole("button", { name: /^Comments/ });
    const attached = page.getByRole("button", {
      name: `${comments.length} draft comments attached`,
      exact: true,
    });
    for (const link of [header, attached]) {
      await link.click();
      // No click/fill on the card that could mask a missing scroll.
      await expect(newest).toBeInViewport({ ratio: 1 });
      await page.locator(".scroll-area").evaluate((el, mobile) => {
        el.scrollTop = mobile ? 0 : el.scrollHeight;
      }, mobile);
      await expect(newest).not.toBeInViewport();
      await link.click();
      await expect(newest).toBeInViewport({ ratio: 1 });
      await page
        .getByRole("button", { name: "Close comments", exact: true })
        .click();
      await expect(page.locator(".comment-rail")).toHaveCount(0);
    }
  });

  test(`settings dismisses only on outside clicks and preserves autosaved defaults on ${device}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const { id } = await seed(page, "Settings backdrop", 0);
    await page.goto(`/chats/${id}`);
    let settings = { defaultModel: null, defaultThinkingLevel: null };
    let saves = 0;
    await page.route("**/api/settings", (route) => {
      if (route.request().method() === "PUT") { saves++; settings = route.request().postDataJSON(); }
      return route.fulfill({
        json: {
          settings,
          models: [
            {
              id: "reasoner",
              provider: "test",
              name: "Reasoner",
              thinkingLevels: ["low", "high"],
            },
          ],
        },
      });
    });
    const button = page.getByRole("button", { name: "Settings", exact: true });
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await button.click();
    await dialog
      .getByLabel("Default model", { exact: true })
      .selectOption(JSON.stringify(["pi", "test", "reasoner"]));
    await dialog
      .getByRole("heading", { name: "Settings", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    // Dialog padding also belongs to the inside, not the backdrop.
    await page.mouse.click(bounds.x + 4, bounds.y + 4);
    await expect(dialog).toBeVisible();
    // Dragging a selection out of the dialog must not dismiss it.
    await page.mouse.move(bounds.x + 30, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(saves).toBe(1);
    await button.click();
    await expect(
      dialog.getByLabel("Default model", { exact: true }),
    ).toHaveValue(JSON.stringify(["pi", "test", "reasoner"]));
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}

test("an uncached conversation focuses when its delayed preview arrives", async ({
  page,
}) => {
  const first = await seed(page, "Already loaded", 0);
  const second = await seed(page, "Delayed preview", 0);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${second.id}/preview`, async (route) => {
    await pending;
    await route.continue().catch(() => {});
  });
  await page.route(`**/api/sessions/${second.id}/events`, (route) =>
    route.abort(),
  );
  try {
    await page.goto(`/chats/${first.id}`);
    await expect(page.getByLabel("Starting skill")).toBeEnabled();
    await openChat(page, second.id, false);
    await expect(page.locator(".conversation-loading")).toBeVisible();
    await expect(composer(page)).toHaveCount(0);
    release();
    await expect(composer(page)).toBeFocused();
    await page.keyboard.type("Typing before the live stream connects");
    await expect(composer(page)).toHaveValue(
      "Typing before the live stream connects",
    );
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
