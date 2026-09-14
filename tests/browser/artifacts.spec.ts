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
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await saved(page);
  await page.getByLabel("Close artifact review").click();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page.getByLabel("Review artifact")).toHaveValue(markdown.id);
  await expect(page.locator(".artifact-comment-text")).toHaveText(
    "Explore retention before adding more charts.",
  );
  await page
    .getByRole("button", { name: "Send feedback", exact: true })
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
test("Command/Ctrl+Enter saves only the focused artifact comment, while Enter stays multiline", async ({
  page,
}) => {
  const { id } = await seed(page);
  await page
    .getByRole("button", { name: "Comment on this page", exact: true })
    .click();
  const editor = page.getByLabel("Feedback 1", { exact: true });
  await editor.fill("First line");
  await editor.press("End");
  await editor.press("Enter");
  await editor.pressSequentially("Second line");
  await expect(editor).toHaveValue("First line\nSecond line");
  await editor.press("Meta+Enter");
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".artifact-attached-count")).toHaveText(
    "1 comment attached",
  );
  await saved(page);
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await editor.fill("Revised via Control+Enter");
  await editor.press("Control+Enter");
  await expect(editor).toHaveCount(0);
  await saved(page);
  const review = await (
    await page.request.get(`/api/sessions/${id}/artifacts`)
  ).json();
  expect(review.comments).toHaveLength(1);
  expect(review.comments[0]).toMatchObject({
    text: "Revised via Control+Enter",
    saved: true,
    delivery: "draft",
  });
  const chat = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(
    chat.messages.some(
      (m: { role: string; text: string }) =>
        m.role === "user" &&
        m.text.startsWith("I reviewed the generated artifacts"),
    ),
  ).toBe(false);
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
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await saved(page);
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open in new window", exact: true })
    .click();
  const popup = await popupPromise;
  await expect(popup.locator(".artifact-comment-text")).toHaveText(
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
test("ordinary agent Markdown, HTML and localhost links open wrapped without manual registration or automatic popups", async ({
  page,
}) => {
  await page.goto("/");
  const { id } = await (
    await page.request.post("/api/test/seed", { data: {} })
  ).json();
  const generated = await page.request.post(
    `/api/test/${id}/artifact-fixtures`,
    { data: { rawLinks: true } },
  );
  expect(generated.ok()).toBe(true);
  await page.goto(`/chats/${id}`);
  await expect(
    page.getByRole("link", { name: "Read generated report", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".artifact-window")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/sessions/${id}/artifacts`)).json())
      .artifacts,
  ).toHaveLength(0);
  for (const [link, heading] of [
    ["Read generated report", "Quarterly review"],
    ["Open HTML output", "HTML report"],
    ["Open local dashboard", "Review dashboard"],
  ]) {
    await page.getByRole("link", { name: link, exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Artifact review", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .frameLocator("iframe")
        .getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open file|Retarget/ }),
    ).toHaveCount(0);
    await page.getByLabel("Close artifact review").click();
  }
  expect(
    (await (await page.request.get(`/api/sessions/${id}/artifacts`)).json())
      .artifacts,
  ).toHaveLength(3);
  await expect(
    page.getByRole("link", { name: "External documentation" }),
  ).toHaveAttribute("href", "https://example.com/docs.md");
});

test("two saved comments across artifacts reopen as one sendable batch, retaining a page URL and overall feedback", async ({
  page,
}) => {
  const { id, markdown, app } = await seed(page);
  await page.getByLabel("Review artifact").selectOption(markdown.id);
  await expect(
    page.getByRole("button", { name: "Point to comment", exact: true }),
  ).toBeEnabled();
  await selectParagraph(page);
  await page
    .getByLabel("Feedback 1", { exact: true })
    .fill("First thought on the report.");
  await expect(
    page.getByRole("button", { name: "Send feedback", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".artifact-send")).toContainText(
    "Save your unfinished comment",
  );
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page
    .getByLabel("Feedback 1", { exact: true })
    .fill("An edited thought on the report.");
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByLabel("Review artifact").selectOption(app.id);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("link", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Artifact address")).toHaveValue(/\/details$/);
  await page
    .getByRole("button", { name: "Comment on this page", exact: true })
    .click();
  await page
    .getByLabel("Feedback 2", { exact: true })
    .fill("This whole page needs a clearer structure.");
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .getByLabel("Overall feedback", { exact: true })
    .fill("Keep both artifacts simple.");
  await saved(page);
  await page.getByLabel("Review artifact").selectOption(markdown.id);
  await page.getByLabel("Close artifact review").click();
  await page.reload();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page.locator(".artifact-attached-count")).toHaveText(
    "2 comments attached",
  );
  await expect(
    page.getByLabel("Overall feedback", { exact: true }),
  ).toHaveValue("Keep both artifacts simple.");
  await expect(
    page.getByRole("button", { name: "Send feedback", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: ".margin-data/artifact-review-simplified.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Send feedback", exact: true })
    .click();
  await expect(
    page.getByLabel("Overall feedback", { exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".artifact-attached-count")).toHaveText(
    "0 comments attached",
  );
  const state = await (await page.request.get(`/api/sessions/${id}`)).json();
  const sent = state.messages.find(
    (m: { role: string; text: string }) =>
      m.role === "user" && m.text.includes("artifactComments"),
  );
  const payload = JSON.parse(sent.text.slice(sent.text.indexOf("{")));
  expect(payload.artifactComments).toHaveLength(2);
  expect(payload.artifactComments[1].target).toMatchObject({
    kind: "page",
    route: "/details",
  });
  expect(payload.artifactComments[0].comment).toBe(
    "An edited thought on the report.",
  );
  expect(payload.overallReply).toBe("Keep both artifacts simple.");
  await page
    .getByLabel("Overall feedback", { exact: true })
    .fill("One more general thought, without inline comments.");
  await expect(
    page.getByRole("button", { name: "Send feedback", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Send feedback", exact: true })
    .click();
  await expect(
    page.getByLabel("Overall feedback", { exact: true }),
  ).toHaveValue("");
});

test("a blocked send explains the agent dialog and becomes usable again without losing the saved comment", async ({
  page,
}) => {
  const { id } = await seed(page);
  await page
    .getByRole("button", { name: "Comment on this page", exact: true })
    .click();
  await page
    .getByLabel("Feedback 1", { exact: true })
    .fill("Keep this while the agent waits.");
  await page
    .locator(".artifact-comment")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await saved(page);
  await page.request.post(`/api/test/${id}/dialog`, { data: {} });
  await expect(
    page.getByRole("button", { name: "Send feedback", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".artifact-send")).toContainText(
    "Answer the agent's question in chat",
  );
  const snapshot = await (await page.request.get(`/api/sessions/${id}`)).json();
  await page.request.post(
    `/api/sessions/${id}/dialogs/${snapshot.dialogs[0].id}`,
    { data: { cancelled: true } },
  );
  await expect(
    page.getByRole("button", { name: "Send feedback", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".artifact-attached-count")).toHaveText(
    "1 comment attached",
  );
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
  await page
    .getByLabel("Overall feedback", { exact: true })
    .fill("Keep the overall thought too.");
  // A drag starting inside the editor must not count as clicking the backdrop.
  const bounds = await page
    .getByLabel("Feedback 1", { exact: true })
    .boundingBox();
  await page.mouse.move(bounds!.x + 15, bounds!.y + 15);
  await page.mouse.down();
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await expect(
    page.getByRole("dialog", { name: "Artifact review", exact: true }),
  ).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(
    page.getByRole("dialog", { name: "Artifact review", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/artifacts/comments");
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page.getByLabel("Feedback 1", { exact: true })).toHaveValue(
    "Do not lose this unfinished comment",
  );
  await expect(
    page.getByLabel("Overall feedback", { exact: true }),
  ).toHaveValue("Keep the overall thought too.");
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
