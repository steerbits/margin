import { test, expect, type Page } from "@playwright/test";

const label = "Use your defaults and go";
const markdown = `## Proposed approach

Keep it small and dependency-free.

:reply[${label}]

Syntax example: \`:reply[Not an action]\`

> :reply[Quoted text]

\`\`\`md
:reply[Code sample]
\`\`\`

[Link :reply[Link label]](https://example.com)

:reply[Incomplete
`;
const action = (page: Page) =>
  page.getByRole("button", { name: `Send reply: ${label}`, exact: true });
const composer = (page: Page) => page.getByLabel("Message Pi", { exact: true });

async function seed(page: Page, extra = {}) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", {
    data: { title: "Reply actions", markdown, ...extra },
  });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await page.getByLabel("Starting skill").selectOption("");
  await expect(action(page)).toBeEnabled();
  return id as string;
}

for (const mobile of [false, true]) {
  test(`reply action sends its exact text with an empty draft on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const id = await seed(page);
    await expect(page.locator(".reply-action")).toHaveCount(1);
    await expect(page.locator(".message.assistant code")).toContainText([
      ":reply[Not an action]",
      ":reply[Code sample]",
    ]);
    await expect(action(page)).toHaveAttribute(
      "title",
      /current draft, saved comments, and attachments/,
    );
    await action(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.margin-data/reply-actions-${mobile ? "mobile" : "desktop"}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const request = page.waitForRequest((r) =>
      r.url().endsWith(`/sessions/${id}/send`),
    );
    if (mobile) await action(page).click();
    else {
      await action(page).focus();
      await page.keyboard.press("Enter");
    }
    expect((await request).postDataJSON()).toMatchObject({
      note: label,
      commentIds: [],
    });
    await expect(composer(page)).toHaveValue("");
    await expect(page.locator(".message.user").last()).toHaveText(label);
    await expect(
      page.getByRole("heading", { name: "Revised direction" }),
    ).toBeVisible();
    await expect(action(page)).toBeDisabled();
    await page.reload();
    await expect(action(page)).toBeDisabled();
    await expect(page.locator(".message.user").last()).toHaveText(label);
  });
}

test("appends to partial text and sends saved comments and attachments in the same batch", async ({
  page,
}) => {
  const id = await seed(page);
  await page
    .getByRole("button", { name: "Comment on reply", exact: true })
    .click();
  await page.getByLabel("Inline comment").fill("Keep it local.");
  await expect(action(page)).toBeDisabled();
  await expect(action(page)).toHaveAttribute("title", /Finish or cancel/);
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page.getByLabel("Choose attachments", { exact: true }).setInputFiles({
    name: "requirements.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Requirements"),
  });
  const files = page.getByLabel("Draft attachments", { exact: true });
  await expect(files).toContainText("requirements.md");
  await expect(files).not.toContainText("Uploading…");
  await composer(page).fill("Keep it dependency-free. Partial thought: ");
  await expect(action(page)).toBeEnabled();
  const request = page.waitForRequest((r) =>
    r.url().endsWith(`/sessions/${id}/send`),
  );
  await action(page).click();
  const batch = (await request).postDataJSON();
  expect(batch.note).toBe(
    `Keep it dependency-free. Partial thought: \n${label}`,
  );
  expect(batch.commentIds).toHaveLength(1);
  expect(batch.attachmentIds).toHaveLength(1);
  await expect(page.locator(".comment-state")).toHaveText("Sent");
  await expect(
    page.getByLabel("Sent attachments", { exact: true }),
  ).toContainText("requirements.md");
  await expect(composer(page)).toHaveValue("");
  await expect(page.locator(".message.user")).toHaveCount(2);
});

test("upload, dialog, and disconnected guards leave the draft alone", async ({
  page,
}) => {
  const id = await seed(page);
  await composer(page).fill("Do not lose this partial draft");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${id}/attachments`, async (route) => {
    await waiting;
    await route.continue().catch(() => {});
  });
  try {
    await page.getByLabel("Choose attachments", { exact: true }).setInputFiles({
      name: "pending.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Pending"),
    });
    await expect(
      page.getByLabel("Draft attachments", { exact: true }),
    ).toContainText("Uploading…");
    await expect(action(page)).toBeDisabled();
    await expect(action(page)).toHaveAttribute("title", /uploading/);
    await action(page).evaluate((button: HTMLButtonElement) => button.click());
    await expect(composer(page)).toHaveValue("Do not lose this partial draft");
  } finally {
    release();
  }
  await expect(action(page)).toBeEnabled();
  await page.request.post(`/api/test/${id}/dialog`, {
    data: { kind: "confirm", title: "Pending question" },
  });
  await expect(action(page)).toBeDisabled();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(action(page)).toBeEnabled();

  let reconnect!: () => void;
  const reconnecting = new Promise<void>((resolve) => {
    reconnect = resolve;
  });
  await page.route(`**/api/sessions/${id}/events`, async (route) => {
    await reconnecting;
    await route.continue().catch(() => {});
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".connection")).toHaveText("Reconnecting…");
    await expect(action(page)).toBeDisabled();
    await expect(composer(page)).toHaveValue("Do not lose this partial draft");
  } finally {
    reconnect();
  }
  await expect(action(page)).toBeEnabled();
});

test("reply actions respect source-workspace send availability", async ({
  page,
}) => {
  const id = await seed(page);
  await page.route(`**/api/sessions/${id}/send-availability`, (route) =>
    route.fulfill({
      json: {
        block: {
          reason: "Another source task is running.",
          sessionId: "other",
        },
      },
    }),
  );
  await expect(action(page)).toBeDisabled();
  await expect(action(page)).toHaveAttribute(
    "title",
    "Another source task is running.",
  );
  await composer(page).fill("Wait for the other task.");
  await action(page).evaluate((button: HTMLButtonElement) => button.click());
  await expect(composer(page)).toHaveValue("Wait for the other task.");
  await page.unroute(`**/api/sessions/${id}/send-availability`);
  await expect(action(page)).toBeEnabled();
  await expect(composer(page)).toHaveValue("Wait for the other task.");
  await expect(page.locator(".message.user")).toHaveCount(1);
});

test("double clicks submit once; combined draft is persisted before the request", async ({
  page,
}) => {
  const id = await seed(page);
  await composer(page).fill("Keep it small.");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(`**/api/sessions/${id}/send`, async (route) => {
    requests++;
    await waiting;
    await route.continue().catch(() => {});
  });
  try {
    // Same-tick clicks challenge the synchronous outbox guard, not just disabled styling.
    await action(page).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => requests).toBe(1);
    await expect(action(page)).toBeDisabled();
    await expect(composer(page)).toHaveValue("");
    const snapshot = await (
      await page.request.get(`/api/sessions/${id}`)
    ).json();
    expect(snapshot.composer).toBe(`Keep it small.\n${label}`);
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "Revised direction" }),
  ).toBeVisible();
  await expect(page.locator(".message.user")).toHaveCount(2);
  expect(requests).toBe(1);
});

test("failed send restores combined text; the same action retries without duplicate text or a new batch ID", async ({
  page,
}) => {
  const id = await seed(page);
  await composer(page).fill("Keep my draft.");
  let failedBatch: { id: string; note: string };
  await page.route(`**/api/sessions/${id}/send`, (route) => {
    failedBatch = route.request().postDataJSON();
    return route.fulfill({
      status: 503,
      json: { error: "Simulated reply-action failure" },
    });
  });
  await action(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated reply-action failure",
  );
  await expect(composer(page)).toHaveValue(`Keep my draft.\n${label}`);
  await expect(action(page)).toBeEnabled();
  await page.unroute(`**/api/sessions/${id}/send`);
  const retry = page.waitForRequest((r) =>
    r.url().endsWith(`/sessions/${id}/send`),
  );
  await action(page).click();
  expect((await retry).postDataJSON()).toMatchObject(failedBatch!);
  await expect(page.locator(".message.user").last()).toHaveText(
    `Keep my draft. ${label}`,
  );
  await expect(
    page.getByRole("heading", { name: "Revised direction" }),
  ).toBeVisible();
  await expect(page.locator(".message.user")).toHaveCount(2);
});

test("typing during a failed action send is recovered and does not repeat the choice on retry", async ({
  page,
}) => {
  const id = await seed(page);
  await composer(page).fill("Original thought.");
  let reject!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reject = resolve;
  });
  await page.route(`**/api/sessions/${id}/send`, async (route) => {
    await waiting;
    await route.fulfill({
      status: 503,
      json: { error: "Delayed send failure" },
    });
  });
  try {
    await action(page).click();
    await expect(composer(page)).toHaveValue("");
    await composer(page).fill("Also preserve this newer thought.");
  } finally {
    reject();
  }
  const expected = `Original thought.\n${label}\n\nAlso preserve this newer thought.`;
  await expect(composer(page)).toHaveValue(expected);
  await expect(action(page)).toBeEnabled();
  await page.unroute(`**/api/sessions/${id}/send`);
  const request = page.waitForRequest((r) =>
    r.url().endsWith(`/sessions/${id}/send`),
  );
  await action(page).click();
  expect((await request).postDataJSON().note).toBe(expected);
  await expect(
    page.getByRole("heading", { name: "Revised direction" }),
  ).toBeVisible();
  await expect(page.locator(".message.user")).toHaveCount(2);
});

test("reply-button selections remain stable for inline comments", async ({
  page,
}) => {
  const id = await seed(page);
  await action(page).evaluate((button) => {
    const range = document.createRange();
    range.selectNodeContents(button.querySelector("span")!);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(
    page.getByRole("button", { name: "Comment", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => getSelection()!.toString())).toBe(label);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByLabel("Inline comment").fill("Only for this proposal.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const snapshot = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(snapshot.comments[0].anchor.quote).toBe(label);
  await page.reload();
  await expect(page.locator(".comment-text")).toHaveText(
    "Only for this proposal.",
  );
  await expect(action(page)).toBeEnabled();
});

test("selection is not a send gesture; ordinary user text never gains buttons", async ({
  page,
}) => {
  await seed(page);
  let sends = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/send")) sends++;
  });
  await action(page).evaluate((button) => {
    const range = document.createRange();
    range.selectNodeContents(button);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  expect(sends).toBe(0);
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await composer(page).fill(":reply[User content is inert]");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message.user").last()).toHaveText(
    ":reply[User content is inert]",
  );
  await expect(page.locator(".message.user .reply-action")).toHaveCount(0);
});
