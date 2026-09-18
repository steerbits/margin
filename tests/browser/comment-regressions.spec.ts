import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, historyCount = 0) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", {
    data: { historyCount },
  });
  expect(response.ok()).toBeTruthy();
  const { id } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  return id as string;
}

test("commenting late in a long conversation keeps the passage and new editor visible", async ({
  page,
}) => {
  await seed(page, 7);
  const passage = page
    .locator("[data-annotation-root]")
    .last()
    .locator("p")
    .filter({ hasText: "Use a hosted database with a local cache." });
  await passage.scrollIntoViewIfNeeded();
  const before = await passage.boundingBox();
  const previousScroll = await page
    .locator(".scroll-area")
    .evaluate((el) => el.scrollTop);
  expect(previousScroll).toBeGreaterThan(3000);
  await passage.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Inline comment",
    exact: true,
  });
  // Assert visibility before a locator click/fill can scroll the editor into view.
  await expect(editor).toBeInViewport({ ratio: 1 });
  await expect(editor).toBeFocused();
  await expect(passage).toBeInViewport();
  const after = await passage.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(100);
  expect(
    await page.locator(".scroll-area").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(3000);
  await editor.fill("Keep this local.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page.getByRole("button", { name: "Edit comment", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Inline comment", exact: true }),
  ).toBeInViewport({ ratio: 1 });
});

test("short replies stay on one line while long unbroken text stays within the thread", async ({
  page,
}) => {
  await seed(page);
  for (const text of ["ok", "go ahead"]) {
    await page.getByLabel("Message", { exact: true }).fill(text);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const bubble = page.locator(".message.user .user-bubble").last();
    await expect(bubble).toHaveText(text);
    // Acceptance replaces the optimistic bubble. Reacquire the current node
    // while checking geometry so a detached paragraph's zero rects isn't
    // mistaken for a wrapping regression. Still require exactly one text line.
    await expect
      .poll(
        () =>
          bubble.locator("p").evaluate((el, expected) => {
            if (!el.isConnected || el.textContent !== expected) return 0;
            const r = document.createRange();
            r.selectNodeContents(el);
            return new Set(
              [...r.getClientRects()].map((rect) => Math.round(rect.top)),
            ).size;
          }, text),
        { message: `${text} should fit naturally on one line` },
      )
      .toBe(1);
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
  }
  const long = "unbroken".repeat(60);
  await page.getByLabel("Message", { exact: true }).fill(long);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const bubble = page.locator(".message.user .user-bubble").last();
  await expect(bubble).toHaveText(long);
  expect(
    await page
      .locator(".thread")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});

test("tool cards explain error and success colors with explicit outcomes", async ({
  page,
}) => {
  const id = await seed(page);
  await page.request.post(`/api/test/${id}/tools`, { data: {} });
  const failed = page
    .locator(".tool-card")
    .filter({ hasText: "rg missing-pattern" });
  await expect(failed.locator(".tool-outcome")).toHaveText("Exit 1");
  const done = page.locator(".tool-card").filter({ hasText: "printf done" });
  await expect(done.locator(".tool-outcome")).toHaveText("Done");
});
