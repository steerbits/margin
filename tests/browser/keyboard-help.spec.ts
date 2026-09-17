import { test, expect, type Page } from "@playwright/test";
import { marginHelpPrompt, marginIssuesUrl } from "../../shared/help.ts";

async function seed(page: Page, options: Record<string, unknown> = {}) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", { data: options });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await page.getByLabel("Starting skill").selectOption("");
  return id as string;
}
const message = (page: Page) => page.getByLabel("Message", { exact: true });
const state = async (page: Page, id: string) =>
  (await page.request.get(`/api/sessions/${id}`)).json();

async function nonSubmittingKeys(editor: ReturnType<typeof message>) {
  await editor.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await editor.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  await editor.dispatchEvent("keydown", { key: "Enter", repeat: true });
}

test("reply Enter sends exactly once; Shift+Enter, IME, held Enter, empty and busy drafts do not", async ({
  page,
}) => {
  const id = await seed(page, { responseDelay: 2000 });
  let sends = 0;
  await page.route(`**/api/sessions/${id}/send`, async (route) => {
    sends++;
    await route.continue();
  });
  await message(page).press("Enter");
  await message(page).fill("First line");
  await message(page).press("End");
  await message(page).press("Shift+Enter");
  await message(page).pressSequentially("Second line");
  await nonSubmittingKeys(message(page));
  await expect(message(page)).toHaveValue("First line\nSecond line");
  expect(sends).toBe(0);
  await message(page).press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await message(page).fill("Next message");
  await message(page).press("Enter");
  await expect(message(page)).toHaveValue("Next message");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  expect(sends).toBe(1);
  expect(
    (await state(page, id)).messages
      .filter((m: any) => m.role === "user")
      .at(-1).text,
  ).toBe("First line\nSecond line");
});

test("reply comments attach with Enter, edit with legacy shortcuts, and send together only from the reply", async ({
  page,
}) => {
  const id = await seed(page);
  const before = (await state(page, id)).messages.length;
  for (const text of ["First thought", "Second thought"]) {
    await page
      .getByRole("button", { name: "Comment on reply", exact: true })
      .first()
      .click();
    const editor = page.getByLabel("Inline comment", { exact: true });
    await editor.fill(text);
    await editor.press("End");
    await editor.press("Shift+Enter");
    await editor.pressSequentially("More detail");
    await nonSubmittingKeys(editor);
    await expect(editor).toHaveValue(`${text}\nMore detail`);
    await message(page).press("Enter");
    await expect(editor).toBeVisible();
    await editor.press("Enter");
    await expect(editor).toHaveCount(0);
  }
  expect((await state(page, id)).messages).toHaveLength(before);
  const edit = page
    .getByRole("button", { name: "Edit comment", exact: true })
    .first();
  for (const key of ["Meta+Enter", "Control+Enter"]) {
    await edit.click();
    await page
      .getByLabel("Inline comment", { exact: true })
      .fill(`Edited with ${key}`);
    await page.getByLabel("Inline comment", { exact: true }).press(key);
    await expect(
      page.getByLabel("Inline comment", { exact: true }),
    ).toHaveCount(0);
  }
  await expect(
    page.getByRole("button", { name: "Send 2 comments", exact: true }),
  ).toBeEnabled();
  await message(page).press("Enter");
  await expect
    .poll(async () =>
      (await state(page, id)).comments.map((c: any) => c.status),
    )
    .toEqual(["sent", "sent"]);
  const sent = (await state(page, id)).messages
    .filter((m: any) => m.role === "user")
    .at(-1).text;
  const payload = JSON.parse(sent.slice(sent.indexOf("{")));
  expect(payload.inlineComments).toHaveLength(2);
  expect(payload.overallReply).toBe("");
});

test("question input submits with Enter, long-form editor keeps newlines, and pending questions block reply Enter", async ({
  page,
}) => {
  const id = await seed(page);
  for (const kind of ["input", "editor"]) {
    await page.request.post(`/api/test/${id}/dialog`, {
      data: { kind, title: "Your answer" },
    });
    // The section and its textarea share a name; use the textbox role explicitly.
    const textbox = page.getByRole("textbox", {
      name: "Your answer",
      exact: true,
    });
    await textbox.fill("First");
    await textbox.press("End");
    await textbox.press(kind === "input" ? "Shift+Enter" : "Enter");
    await textbox.pressSequentially("Second");
    await expect(textbox).toHaveValue("First\nSecond");
    await message(page).fill("Blocked by question");
    await message(page).press("Enter");
    await expect(message(page)).toHaveValue("Blocked by question");
    await nonSubmittingKeys(textbox);
    await expect(page.locator(".question-card")).toHaveCount(1);
    if (kind === "input") await textbox.press("Enter");
    else
      await page
        .getByRole("button", { name: "Submit answer", exact: true })
        .click();
    await expect(page.locator(".question-card")).toHaveCount(0);
    await expect
      .poll(async () =>
        (await page.request.get(`/api/test/${id}/answer`)).json(),
      )
      .toEqual({ value: "First\nSecond", wasUndefined: false });
  }
});

test("Enter respects upload guards and failed sends retain the draft for keyboard retry", async ({
  page,
}) => {
  const id = await seed(page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${id}/attachments`, async (route) => {
    await hold;
    await route.continue();
  });
  let sends = 0;
  await page.route(`**/api/sessions/${id}/send`, async (route) => {
    sends++;
    if (sends === 1)
      await route.fulfill({ status: 503, json: { error: "Try again" } });
    else await route.continue();
  });
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("test"),
    });
  await message(page).fill("Keep my draft");
  await message(page).press("Enter");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  expect(sends).toBe(0);
  release();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await message(page).press("Enter");
  await expect(page.getByRole("alert")).toContainText("Try again");
  await expect(message(page)).toHaveValue("Keep my draft");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await message(page).press("Control+Enter");
  await expect
    .poll(
      async () =>
        (await state(page, id)).messages
          .filter((m: any) => m.role === "user")
          .at(-1).text,
    )
    .toBe("Keep my draft");
  expect(sends).toBe(2);
});

test("Help creates a source-workspace chat with an unsent editable prompt and preserves the previous draft", async ({
  page,
}) => {
  const id = await seed(page);
  await message(page).fill("Keep this existing draft");
  let sends = 0;
  page.on("request", (request) => {
    if (/\/send$/.test(request.url())) sends++;
  });
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(message(page)).toHaveValue(marginHelpPrompt);
  await expect(message(page)).toBeFocused();
  const helpId = page.url().split("/chats/")[1];
  expect(helpId).not.toBe(id);
  const help = await state(page, helpId);
  expect(help.session.projectId).toBe(bootstrap.marginProjectId);
  expect(help.messages).toHaveLength(0);
  expect(help.composer).toBe(marginHelpPrompt);
  expect(help.composer).not.toContain("README-FOR-AGENTS.md");
  expect(sends).toBe(0);
  await page.reload();
  await expect(message(page)).toHaveValue(marginHelpPrompt);
  expect((await state(page, id)).composer).toBe("Keep this existing draft");
});

test("Help with no AI opens issues without creating or sending a chat", async ({
  page,
}) => {
  const id = await seed(page);
  await page.route("**/api/bootstrap*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), models: [] } });
  });
  await page.reload();
  const help = page.getByRole("button", { name: "Help", exact: true });
  await expect(help).toBeEnabled();
  await expect(help).toHaveAttribute("title", /GitHub issues/);
  await page.evaluate(() => {
    (window as any).opened = [];
    window.open = (...args: any[]) => {
      (window as any).opened.push(args);
      return null;
    };
  });
  const before = (await (await page.request.get("/api/bootstrap")).json())
    .sessions.length;
  await help.click();
  expect(await page.evaluate(() => (window as any).opened)).toEqual([
    [marginIssuesUrl, "_blank", "noopener,noreferrer"],
  ]);
  await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
  expect(
    (await (await page.request.get("/api/bootstrap")).json()).sessions,
  ).toHaveLength(before);
});

test("Help creation failures expose issues without discarding the current draft; unfinished comments block navigation", async ({
  page,
}) => {
  const id = await seed(page);
  await message(page).fill("Keep this draft on failure");
  await page.route("**/api/sessions", (route) =>
    route.fulfill({ status: 503, json: { error: "Help unavailable" } }),
  );
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Help unavailable");
  await expect(
    page.getByRole("link", { name: "Get help on GitHub" }),
  ).toHaveAttribute("href", marginIssuesUrl);
  await expect(message(page)).toHaveValue("Keep this draft on failure");
  await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
  await page.unroute("**/api/sessions");
  await page.getByRole("button", { name: "Dismiss help error" }).click();
  await page
    .getByRole("button", { name: "Comment on reply", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Inline comment", { exact: true })
    .fill("Unfinished thought");
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Finish or cancel your draft comment",
  );
  await expect(page.getByLabel("Inline comment", { exact: true })).toHaveValue(
    "Unfinished thought",
  );
  await expect(page).toHaveURL(new RegExp(`/chats/${id}\\?panel=comments$`));
});
