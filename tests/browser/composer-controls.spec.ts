import { test, expect } from "@playwright/test";

for (const width of [1440, 768, 390, 320]) {
  test(`composer controls stay inside the reply box at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const response = await page.request.post("/api/test/seed", {
      data: { title: "Reply box cleanup" },
    });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    await page.goto(`/chats/${id}`);
    const form = page.locator("form.composer");
    const controls = [
      form.getByRole("button", { name: "Attach files", exact: true }),
      form.getByLabel("Starting skill"),
      form.getByLabel("Model", { exact: true }),
      form.getByLabel("Thinking effort"),
      form.getByRole("button", { name: "Send message", exact: true }),
    ];
    await expect(controls[1]).toBeEnabled();
    await controls[1].selectOption("shape-with-me");
    const bounds = (await form.boundingBox())!;
    const boxes = [];
    for (const control of controls) {
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      boxes.push(box);
    }
    // Full-width desktop keeps attachments, skills, model and thinking on one line.
    if (width === 1440) {
      const centers = boxes.map((box) => box.y + box.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(3);
    }
    // Wrapped controls must never overlap each other or cover Send.
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const first = boxes[a],
          second = boxes[b];
        expect(
          first.x + first.width <= second.x ||
            second.x + second.width <= first.x ||
            first.y + first.height <= second.y ||
            second.y + second.height <= first.y,
        ).toBe(true);
      }
    }
    await expect(
      page.getByRole("button", { name: "Reload skills" }),
    ).toHaveCount(0);
    await expect(page.locator(".composer-hint")).not.toContainText(
      /guide your next message|Your skill sets the pace/,
    );
    await expect(page.locator(".composer-dock-content")).not.toContainText(
      "ChatGPT subscription",
    );
    await expect(page.locator(".app-header")).not.toContainText(
      /local workspace|Powered by Pi|cco|Native/,
    );
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".connection")).toHaveText("Connected");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.margin-data/composer-controls-${width}.png`,
    });
  });
}

test("browser title follows conversation navigation, live naming, reload and non-chat routes", async ({
  page,
}) => {
  await page.goto("/");
  const firstResponse = await page.request.post("/api/test/seed", {
    data: { empty: true, title: "New conversation" },
  });
  expect(firstResponse.ok()).toBe(true);
  const first = await firstResponse.json();
  const secondResponse = await page.request.post("/api/test/seed", {
    data: { title: "A different conversation" },
  });
  expect(secondResponse.ok()).toBe(true);
  const second = await secondResponse.json();
  await page.goto(`/chats/${first.id}`);
  await expect(page).toHaveTitle("Margin · New conversation");
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await page.getByLabel("Starting skill").selectOption("");
  await page
    .getByLabel("Message Pi", { exact: true })
    .fill("Name this conversation");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page).toHaveTitle("Margin · Name this conversation");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await page.locator(`[data-session-id="${second.id}"]`).click();
  await expect(page).toHaveTitle("Margin · A different conversation");
  await page.goBack();
  await expect(page).toHaveTitle("Margin · Name this conversation");
  await page.reload();
  await expect(page).toHaveTitle("Margin · Name this conversation");
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  await expect(page).toHaveTitle("Margin · Customize Margin");
  await page.goBack();
  await expect(page).toHaveTitle("Margin · Name this conversation");
  await page.goto(`/workspaces/${first.snapshot.session.projectId}`);
  await expect(
    page.getByRole("button", { name: "Start a conversation", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Margin");
  await page.goto("/chats/missing-conversation");
  await expect(page).toHaveTitle("Margin");
});
