import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function seed(page: Page) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", { data: {} });
  expect(response.ok()).toBeTruthy();
  const { id } = await response.json();
  const fixtures = await page.request.post(
    `/api/test/${id}/artifact-fixtures`,
    { data: {} },
  );
  expect(fixtures.ok()).toBeTruthy();
  const data = await fixtures.json();
  await page.goto(`/chats/${id}`);
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  return { id: id as string, ...data };
}
async function selectParagraph(page: Page) {
  const frame = page.frameLocator('iframe[title="Review artifact content"]');
  await frame
    .locator("p")
    .first()
    .evaluate((el) => {
      const selection = window.getSelection()!,
        range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
}
async function saved(page: Page) {
  await expect(page.locator(".artifact-send")).toContainText(
    "Saved in this conversation",
  );
}
test("artifact Markdown selection persists across close/reload and sends precise feedback into its conversation", async ({
  page,
}) => {
  const { id, markdown } = await seed(page);
  await page.getByLabel("Review artifact").selectOption(markdown.id);
  await expect(
    page.getByRole("button", { name: "Point to comment", exact: true }),
  ).toBeEnabled();
  await selectParagraph(page);
  await page
    .getByLabel("Feedback 1", { exact: true })
    .fill("Explore retention before adding more charts.");
  await saved(page);
  await page.getByLabel("Close artifact review").click();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page.getByLabel("Review artifact")).toHaveValue(markdown.id);
  await expect(page.getByLabel("Feedback 1", { exact: true })).toHaveValue(
    "Explore retention before adding more charts.",
  );
  await page
    .getByRole("button", { name: "Send 1 comment", exact: true })
    .click();
  await expect(page.locator(".artifact-comment-meta").first()).toContainText(
    "Sent",
  );
  await expect
    .poll(async () =>
      JSON.stringify(
        (await (await page.request.get(`/api/sessions/${id}`)).json()).messages,
      ),
    )
    .toContain("artifactComments");
  const state = await (await page.request.get(`/api/sessions/${id}`)).json();
  const feedback = state.messages.find(
    (m: { role: string; text: string }) =>
      m.role === "user" && m.text.includes("artifactComments"),
  );
  const payload = JSON.parse(feedback.text.slice(feedback.text.indexOf("{")));
  expect(payload.artifactComments[0].target.quote).toBe(
    "Revenue grew steadily, but retention needs attention.",
  );
  expect(payload.artifactComments[0].artifact.location).toBe(markdown.location);
  await page.getByLabel("Close artifact review").click();
  await page.reload();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page.locator(".artifact-comment-text")).toHaveText(
    "Explore retention before adding more charts.",
  );
});
test("artifact runtime proxy supports real modal interactions and Vite HMR without losing a draft or activating a pointed button", async ({
  page,
}) => {
  const { id, app } = await seed(page);
  await expect(page.getByLabel("Artifact address")).toHaveValue(app.location);
  const frame = page.frameLocator('iframe[title="Review artifact content"]');
  await frame.getByRole("button", { name: "Open settings" }).click();
  await page
    .getByRole("button", { name: "Point to comment", exact: true })
    .click();
  await frame.getByRole("button", { name: "Save", exact: true }).click();
  await expect(frame.locator("#hits")).toHaveText("0");
  await page
    .getByLabel("Feedback 1", { exact: true })
    .fill("Make clear what this saves; unfinished thought…");
  await saved(page);
  await page.request.post(`/api/test/${id}/artifact-update`, { data: {} });
  await expect(
    frame.getByRole("heading", { name: "Updated dashboard" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel("Feedback 1", { exact: true })).toHaveValue(
    "Make clear what this saves; unfinished thought…",
  );
  await expect(page.locator(".artifact-comment-meta")).toContainText(
    "Original target changed",
  );
  await page.getByRole("button", { name: "Use app", exact: true }).click();
  await frame.getByRole("button", { name: "Open settings" }).click();
  await frame
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(frame.locator("#hits")).toHaveText("1");
  await page.screenshot({
    path: ".margin-data/artifact-review-live-app.png",
    fullPage: true,
  });
});
test("artifact HTML originals remain clean and a new review window shares durable comments", async ({
  page,
}) => {
  const { id, html, root } = await seed(page);
  const before = readFileSync(join(root, "page.html"), "utf8");
  await page.getByLabel("Review artifact").selectOption(html.id);
  await expect(
    page.getByRole("button", { name: "Point to comment", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Point to comment", exact: true })
    .click();
  const frame = page.frameLocator('iframe[title="Review artifact content"]');
  await frame.getByRole("button", { name: "Try button" }).click();
  await page
    .getByLabel("Feedback 1", { exact: true })
    .fill("Give this action a specific label.");
  await saved(page);
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open in new window", exact: true })
    .click();
  const popup = await popupPromise;
  await expect(popup.getByLabel("Feedback 1", { exact: true })).toHaveValue(
    "Give this action a specific label.",
  );
  expect(popup.url()).toContain(`/review/${id}`);
  const originalPromise = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open original", exact: true })
    .click();
  const original = await originalPromise;
  await expect(
    original.getByRole("button", { name: "Try button" }),
  ).toBeVisible();
  expect(await original.locator('script[src*="_margin_preview"]').count()).toBe(
    0,
  );
  expect(readFileSync(join(root, "page.html"), "utf8")).toBe(before);
  await original.close();
  await popup.close();
});
test("artifact unfinished drafts recover after failed network saves and explicit deletion is retained", async ({
  page,
}) => {
  const { markdown } = await seed(page);
  await page.getByLabel("Review artifact").selectOption(markdown.id);
  await expect(
    page.getByRole("button", { name: "Point to comment", exact: true }),
  ).toBeEnabled();
  await page.route("**/artifacts/comments", (route) => route.abort());
  await selectParagraph(page);
  await page
    .getByLabel("Feedback 1", { exact: true })
    .fill("Do not lose this unfinished comment");
  await expect(page.locator(".artifact-notice")).toContainText(
    "Not saved to Margin yet",
  );
  await page.getByLabel("Close artifact review").click();
  await page.unroute("**/artifacts/comments");
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page.getByLabel("Feedback 1", { exact: true })).toHaveValue(
    "Do not lose this unfinished comment",
  );
  await saved(page);
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.locator(".artifact-comment")).toHaveCount(0);
  await page.getByLabel("Close artifact review").click();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page.locator(".artifact-comment")).toHaveCount(0);
});
