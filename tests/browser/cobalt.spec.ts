import { test, expect, type Page, type Locator } from "@playwright/test";

const colors = {
  primary: "rgb(66, 99, 212)",
  strong: "rgb(54, 85, 191)",
  soft: "rgb(237, 241, 252)",
  highlight: "rgb(238, 242, 255)",
  active: "rgb(220, 229, 250)",
};
const screenshots = ".margin-data/temporary/cobalt/screenshots";

async function seed(page: Page) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", {
    data: {
      title: "A local meeting-notes app",
      markdown:
        "## A focused meeting-notes app\n\nKeep notes in a local SQLite file.\n\nMake action items optional.\n\nStart small, then review the first version together.",
    },
  });
  expect(response.ok()).toBe(true);
  const { id, snapshot } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  return { id, projectId: snapshot.session.projectId as string };
}

async function selectPassage(page: Page, text: string) {
  const passage = page
    .locator("[data-annotation-root] p")
    .filter({ hasText: text });
  await passage.scrollIntoViewIfNeeded();
  await passage.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  return passage;
}

async function expectFill(locator: Locator, color: string) {
  await expect(locator).toHaveCSS("background-color", color);
}

// Compare the actual rendered DOM against the pre-Cobalt cascade, without
// maintaining a second stylesheet or a machine-specific screenshot baseline.
async function expectLayoutAndSemanticStatesUnchanged(page: Page) {
  const result = await page.evaluate(() => {
    const properties = [
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "letter-spacing",
      "padding",
      "margin",
      "border-width",
      "border-radius",
      "display",
      "gap",
    ];
    const capture = () => ({
      layout: [...document.querySelectorAll<HTMLElement>(".app, .app *")].map(
        (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return [
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            ...properties.map((property) => style.getPropertyValue(property)),
          ];
        },
      ),
      semantic: [...document.querySelectorAll("[data-semantic-state]")].map(
        (el) => {
          const style = getComputedStyle(el);
          return [
            style.backgroundColor,
            style.color,
            style.opacity,
            style.borderColor,
          ];
        },
      ),
    });
    const cobalt = capture();
    const removed: { sheet: CSSStyleSheet; index: number; text: string }[] = [];
    for (const sheet of document.styleSheets) {
      for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
        const text = sheet.cssRules[index].cssText;
        if (!text.includes("--cobalt")) continue;
        removed.push({ sheet, index, text });
        sheet.deleteRule(index);
      }
    }
    try {
      return { cobalt, neutral: capture(), removed: removed.length };
    } finally {
      for (const { sheet, index, text } of removed.reverse())
        sheet.insertRule(text, index);
    }
  });
  expect(result.removed).toBeGreaterThan(10);
  expect(result.cobalt.layout).toEqual(result.neutral.layout);
  expect(result.cobalt.semantic).toEqual(result.neutral.semantic);
}

for (const width of [1440, 390]) {
  test(`Cobalt accents, comments and unchanged geometry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page);
    const device = width === 390 ? "mobile" : "desktop";
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    const message = page.getByLabel("Message", { exact: true });
    await expect(send).toBeDisabled();
    await expectFill(send, "rgb(243, 243, 243)");
    await send.hover({ force: true });
    // Preserve the existing disabled-hover rule; never turn a disabled Send blue.
    await expectFill(send, "rgba(0, 0, 0, 0)");
    await expect(page.locator(".app-header")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(page.locator(".sidebar")).toHaveCSS(
      "background-color",
      "rgb(249, 249, 249)",
    );
    await expect(page.locator(".markdown")).toHaveCSS(
      "color",
      "rgb(33, 33, 33)",
    );
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${screenshots}/${device}-disabled.png` });

    if (width === 390)
      await page
        .getByRole("button", { name: "Show sidebar", exact: true })
        .click();
    const selected = page.locator(".session-list > button.selected");
    await expectFill(selected, colors.soft);
    await expect(selected).toHaveCSS("color", colors.strong);
    await selected.hover();
    await expectFill(selected, colors.soft);
    await expectLayoutAndSemanticStatesUnchanged(page);
    if (width === 390) {
      await page.screenshot({ path: `${screenshots}/mobile-navigation.png` });
      await page
        .getByRole("button", { name: "Close sidebar", exact: true })
        .click();
    }

    await message.fill("Keep this small and local.");
    await expectFill(send, colors.primary);
    await expect(page.locator(".composer")).toHaveCSS(
      "border-top-color",
      colors.primary,
    );
    await send.hover();
    await expectFill(send, colors.strong);
    await page.screenshot({ path: `${screenshots}/${device}-hover.png` });
    await page.mouse.move(0, 0);
    // Reach Send by keyboard rather than asserting a programmatic focus alone.
    await message.focus();
    for (
      let i = 0;
      i < 15 && !(await send.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(send).toBeFocused();
    await expect(send).toHaveCSS("outline-color", colors.primary);
    await expect(send).toHaveCSS("outline-style", "solid");
    await expect(send).toHaveCSS("outline-width", "2px");
    await page.screenshot({ path: `${screenshots}/${device}-focus.png` });
    await expectLayoutAndSemanticStatesUnchanged(page);
    await message.fill("");

    for (const [quote, text] of [
      ["Keep notes in a local SQLite file.", "Yes, keep storage local."],
      ["Make action items optional.", "Let me choose when to add tasks."],
    ]) {
      await selectPassage(page, quote);
      const action = page.getByRole("button", { name: "Comment", exact: true });
      await expectFill(action, colors.primary);
      await action.hover();
      await expectFill(action, colors.strong);
      await action.click();
      const add = page.getByRole("button", {
        name: "Add comment",
        exact: true,
      });
      await expect(add).toBeDisabled();
      await expectFill(add, "rgb(33, 33, 33)");
      await page.getByLabel("Inline comment", { exact: true }).fill(text);
      await expectFill(add, colors.primary);
      await add.hover();
      await expectFill(add, colors.strong);
      await add.click();
      if (width === 390)
        await page
          .getByRole("button", { name: "Close comments", exact: true })
          .click();
    }
    if (width === 390)
      await page.getByRole("button", { name: /^Comments/ }).click();
    await expect(page.locator(".comment-card")).toHaveCount(2);
    await expect(page.locator(".count").first()).toHaveCSS(
      "background-color",
      colors.soft,
    );
    const chip = page.locator(".batch-chip");
    await expectFill(chip, colors.soft);
    await chip.hover();
    await expectFill(chip, colors.active);
    await page.mouse.move(0, 0);
    await page.locator(".comment-quote").last().click();
    await expect(page.locator(".comment-card.active")).toHaveCSS(
      "border-top-color",
      colors.primary,
    );
    await expect(page.locator(".comment-meta .avatar").last()).toHaveCSS(
      "background-color",
      colors.soft,
    );
    const passage = page
      .locator("[data-annotation-root] p")
      .filter({ hasText: "Make action items optional." });
    await expect
      .poll(() =>
        passage.evaluate((el) => ({
          normal: getComputedStyle(el, "::highlight(margin-comments)")
            .backgroundColor,
          active: getComputedStyle(el, "::highlight(margin-active)")
            .backgroundColor,
          ink: getComputedStyle(el, "::highlight(margin-active)").color,
          normalRanges: (CSS as any).highlights.get("margin-comments").size,
          activeRanges: (CSS as any).highlights.get("margin-active").size,
        })),
      )
      .toEqual({
        normal: colors.highlight,
        active: colors.active,
        ink: "rgb(33, 33, 33)",
        normalRanges: 1,
        activeRanges: 1,
      });
    await expectLayoutAndSemanticStatesUnchanged(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390) {
      await page.locator(".comment-card.active").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${screenshots}/mobile-comment-panel.png`,
      });
      await page
        .getByRole("button", { name: "Close comments", exact: true })
        .click();
      await page.locator(".scroll-area").evaluate((el) => {
        el.scrollTop = 0;
      });
      await expect(passage).toBeInViewport();
    }
    await page.screenshot({ path: `${screenshots}/${device}-comments.png` });
  });
}

test("welcome and semantic states retain their existing cascade", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { projectId } = await seed(page);
  await page.goto(`/workspaces/${projectId}`);
  await page
    .locator(".workspace-home")
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page.locator(".welcome-icon")).toBeVisible();
  await expectFill(page.locator(".welcome-icon"), colors.soft);
  await expect(page.locator(".welcome-icon")).toHaveCSS("color", colors.strong);
  const start = page.getByRole("button", {
    name: "Start a conversation",
    exact: true,
  });
  await expectFill(start, colors.primary);
  await expectLayoutAndSemanticStatesUnchanged(page);
  await page.screenshot({ path: `${screenshots}/desktop-welcome.png` });

  // Isolated selector fixtures cover semantic combinations regardless of how
  // quickly live success/error/Stop states transition. These are not UX shots.
  await page.locator(".app").evaluate((app) => {
    const fixture = document.createElement("section");
    fixture.id = "semantic-fixtures";
    fixture.innerHTML = `
      <button data-semantic-state class="primary" disabled>Disabled primary</button>
      <button data-semantic-state class="send-button" disabled>Disabled send</button>
      <button data-semantic-state class="selection-action" disabled>Disabled selection</button>
      <button data-semantic-state class="batch-chip" disabled>Disabled badge</button>
      <div class="comment-actions"><button data-semantic-state class="primary" disabled>Disabled add</button></div>
      <div class="management-actions"><button data-semantic-state class="primary danger">Delete</button></div>
      <div class="comment-actions management-actions"><button data-semantic-state class="primary danger">Danger in comment actions</button></div>
      <button data-semantic-state class="stop-button">Stop</button>
      <div data-semantic-state class="connection connected">Connected</div>
      <i data-semantic-state class="streaming-dot"></i>
      <details class="tool-card error"><summary data-semantic-state>Error</summary></details>
      <span data-semantic-state class="chat-status failed">Failed</span>`;
    app.append(fixture);
  });
  await expectLayoutAndSemanticStatesUnchanged(page);
  for (const button of await page.locator("#semantic-fixtures button").all()) {
    // The fixed-position selection fixture can overlap another fixture button.
    await button.hover({ force: true });
    await expectLayoutAndSemanticStatesUnchanged(page);
  }
});
