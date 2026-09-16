import { test, expect } from "@playwright/test";
import type { Snapshot } from "../../shared/types.ts";

for (const width of [1440, 390]) {
  test(`legacy backend labels stay out of UI copy at ${width}px without rewriting messages`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const seed = await page.request.post("/api/test/seed", {
      data: { markdown: "Keep this historical reference to Pi unchanged." },
    });
    expect(seed.ok()).toBe(true);
    const { id } = await seed.json();
    const snapshot: Snapshot = await (
      await page.request.get(`/api/sessions/${id}`)
    ).json();
    snapshot.session.backend = "pi";
    snapshot.session.backendLabel = "Pi";
    snapshot.session.activity = { status: "finished" };
    await page.route(`**/api/sessions/${id}/preview`, (route) =>
      route.fulfill({ json: snapshot }),
    );
    await page.route(`**/api/sessions/${id}/events`, (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ snapshot })}\n\n`,
      }),
    );
    await page.goto(`/chats/${id}`);
    const status = page.locator(".chat-status:visible");
    await expect(status).toHaveText("Finished");
    await expect(status).toHaveAccessibleName("Finished");
    await expect(page.locator(".agent-label > span").first()).toHaveText(
      "Assistant",
    );
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveAttribute(
      "placeholder",
      "Message… or select a passage above to comment",
    );
    await expect(page.locator(".message.assistant .markdown")).toHaveText(
      "Keep this historical reference to Pi unchanged.",
    );
    const labels = await page
      .locator("[aria-label], [title], [placeholder]")
      .evaluateAll((nodes) =>
        nodes
          .flatMap((node) => [
            node.getAttribute("aria-label"),
            node.getAttribute("title"),
            node.getAttribute("placeholder"),
          ])
          .filter(Boolean)
          .join("\n"),
      );
    expect(labels).not.toMatch(/\bpi\b/i);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await expect(
      settings.getByLabel("Default model", { exact: true }),
    ).toBeEnabled();
    await expect(
      settings.getByLabel("Thinking effort").locator('option[value=""]'),
    ).toHaveText("Runtime default");
    await expect(settings).not.toContainText(/\bpi\b/i);
    await settings.getByRole("button", { name: "Cancel", exact: true }).click();

    const showSidebar = page.getByRole("button", {
      name: "Show sidebar",
      exact: true,
    });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page
      .getByRole("button", { name: "Customize Margin", exact: true })
      .click();
    const example = page
      .locator(".example-card")
      .filter({ hasText: "Let your assistant work with notes" });
    await expect(example).toBeVisible();
    expect(
      (await page.locator(".example-card").allTextContents()).join("\n"),
    ).not.toMatch(/\bpi\b/i);
  });
}
