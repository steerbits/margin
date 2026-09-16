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
    // Keep the backend context for screen readers, not in the visible label.
    await expect(status).toHaveRole("status");
    await expect(status).toHaveAccessibleName("Pi: Ready");
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute("aria-hidden", "true");
    await expect(dot).toHaveCSS("animation-name", "none");

    await page.getByLabel("Message Pi", { exact: true }).fill("Check status");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(status).toHaveText("Running");
    await expect(status).toHaveAccessibleName("Pi: Running");
    await expect(dot).toHaveCSS("animation-name", "status-pulse");
    await expect(dot).toHaveCSS("animation-duration", "1.4s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dot).toHaveCSS("animation-name", "none");
    await expect(status).toHaveText("Running");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(dot).toHaveCSS("animation-name", "status-pulse");

    await expect(status).toHaveText("Finished");
    await expect(dot).toHaveCSS("animation-name", "none");
    const dialog = await page.request.post(`/api/test/${id}/dialog`, {
      data: {},
    });
    expect(dialog.ok()).toBe(true);
    await expect(status).toHaveText("Waiting for you");
    await expect(dot).toHaveCSS("animation-name", "none");
  });
}
