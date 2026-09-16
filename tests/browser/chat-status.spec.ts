import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`top status omits the agent name and keeps the running pulse at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const response = await page.request.post("/api/test/seed", {
      data: { empty: true, responseDelay: 3000 },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const { id } = await response.json();
    await page.goto(`/chats/${id}`);
    await expect(page.getByLabel("Starting skill")).toBeEnabled();

    const status = page.locator(".chat-status:visible");
    const dot = status.locator("i");
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText("Ready");
    await expect(status).toHaveRole("status");
    await expect(status).toHaveAccessibleName("Ready");
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute("aria-hidden", "true");
    await expect(dot).toHaveCSS("animation-name", "none");

    await page.getByLabel("Message", { exact: true }).fill("Check status");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(status).toHaveText("Running");
    await expect(status).toHaveAccessibleName("Running");
    await expect(dot).toHaveCSS("animation-name", "status-pulse");
    await expect(dot).toHaveCSS("animation-duration", "1.4s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dot).toHaveCSS("animation-name", "none");
    await expect(status).toHaveText("Running");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(dot).toHaveCSS("animation-name", "status-pulse");

    await expect(status).toHaveText("Finished");
    await expect(status).toHaveAccessibleName("Finished");
    await expect(dot).toHaveCSS("animation-name", "none");
    await expect(page.locator(".agent-label > span").first()).toHaveText(
      "Assistant",
    );
    await expect(page.locator("body")).not.toContainText(/\bPi\b/);
    await page.screenshot({ path: `.margin-data/status-cleanup-${width}.png` });
    const dialog = await page.request.post(`/api/test/${id}/dialog`, {
      data: {},
    });
    expect(dialog.ok()).toBe(true);
    await expect(status).toHaveText("Waiting for you");
    await expect(status).toHaveAccessibleName("Waiting for you");
    await expect(page.locator(".question-label")).toHaveText(
      "Waiting for your answer",
    );
    await expect(page.locator("body")).not.toContainText(/\bPi\b/);
    await expect(dot).toHaveCSS("animation-name", "none");
    // Do not leave a waiting source-workspace session blocking later tests.
    await page.getByRole("button", { name: "SQLite", exact: true }).click();
    await expect(status).toHaveText("Finished");
  });
}
