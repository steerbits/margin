import { test, expect, type Page } from "@playwright/test";

test("thinking effort uses supported levels and survives reload", async ({
  page,
}) => {
  const id = await seed(page);
  const state = await (await page.request.get(`/api/sessions/${id}`)).json();
  const picker = page.getByRole("combobox", { name: "Thinking effort" });
  await expect(picker).toBeVisible();
  const level =
    state.thinking.available.find((x: string) => x === "high") ??
    state.thinking.available.at(-1);
  await picker.selectOption(level);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/sessions/${id}`)).json()).thinking
          .level,
    )
    .toBe(level);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Thinking effort" }),
  ).toHaveValue(level);
  const bad = await page.request.post(`/api/sessions/${id}/thinking`, {
    data: { level: "imaginary" },
  });
  expect(bad.status()).toBe(400);
});

async function seed(page: Page) {
  await page.goto("/");
  const r = await page.request.post("/api/test/seed", { data: {} });
  expect(r.ok()).toBeTruthy();
  const { id } = await r.json();
  await page.goto(`/chats/${id}`);
  await expect(
    page.getByRole("heading", { name: "A focused meeting-notes app" }),
  ).toBeAttached();
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  return id as string;
}
async function commentOn(page: Page, quote: string, text: string) {
  await page.locator("[data-annotation-root]").first().scrollIntoViewIfNeeded();
  await page.evaluate((quote) => {
    const root = document.querySelector<HTMLElement>("[data-annotation-root]")!;
    const str = root.textContent!;
    const start = str.indexOf(quote);
    if (start < 0) throw new Error("Fixture quote not found");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let at = 0,
      node: Node | null,
      a: Node | null = null,
      b: Node | null = null,
      ao = 0,
      bo = 0;
    while ((node = walker.nextNode())) {
      const n = node.textContent!.length;
      if (!a && start >= at && start < at + n) {
        a = node;
        ao = start - at;
      }
      if (start + quote.length > at && start + quote.length <= at + n) {
        b = node;
        bo = start + quote.length - at;
        break;
      }
      at += n;
    }
    const range = document.createRange();
    range.setStart(a!, ao);
    range.setEnd(b!, bo);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, quote);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByRole("textbox", { name: "Inline comment" }).fill(text);
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Inline comment" }),
  ).toHaveCount(0);
}
test("formatted selection, table and code comments survive reload, send one batch, and retain original anchors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const id = await seed(page);
  const q = "turn decisions into a short list of action items";
  await commentOn(page, q, "Make action items optional.");
  await commentOn(page, "Email and password sign-in", "Skip accounts in v1.");
  await commentOn(
    page,
    'const storage = "sqlite";',
    "Yes, use a local SQLite file.",
  );
  await page
    .getByRole("textbox", { name: "Message Pi" })
    .fill("Keep this personal and local.");
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator(".comment-card")).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveValue(
    "Keep this personal and local.",
  );
  const before = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(before.comments[0].anchor.quote).toBe(q);
  const originalId = before.comments[0].anchor.messageId;
  await page
    .getByRole("button", { name: "Send 3 comments", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revised direction" }),
  ).toBeVisible();
  const after = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(
    after.comments.every(
      (c: any) => c.status === "sent" && c.anchor.messageId === originalId,
    ),
  ).toBeTruthy();
  expect(after.messages.filter((m: any) => m.role === "user")).toHaveLength(2);
  await page
    .getByRole("textbox", { name: "Message Pi" })
    .fill("Another thought.");
  await page.waitForTimeout(400);
  expect(after.comments[0].text).toBe("Make action items optional.");
  expect(errors).toEqual([]);
  await page.screenshot({ path: ".margin-data/workflow.png", fullPage: true });
});
test("draft edit/delete and sent resolution preserve original reference", async ({
  page,
}) => {
  await seed(page);
  await commentOn(page, "Hosted database with offline cache", "Prefer SQLite.");
  await page.getByRole("button", { name: "Edit comment", exact: true }).click();
  await page.getByLabel("Inline comment").fill("Local SQLite only.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".comment-text")).toHaveText("Local SQLite only.");
  await page
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await expect(page.locator(".comment-card")).toHaveCount(0);
  await commentOn(page, "notes.db", "Keep this filename.");
  await page
    .getByRole("button", { name: "Send 1 comment", exact: true })
    .click();
  await expect(page.locator(".comment-state")).toHaveText("Sent");
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.locator(".comment-state")).toHaveText("Resolved");
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.locator(".comment-state")).toHaveText("Sent");
});
test("waiting dialog survives browser reload and returns typed answer exactly once", async ({
  page,
}) => {
  const id = await seed(page);
  await page.request.post(`/api/test/${id}/dialog`, {
    data: { kind: "select" },
  });
  await expect(
    page.getByRole("heading", { name: "Choose a storage approach" }),
  ).toBeVisible();
  const state = await (await page.request.get(`/api/sessions/${id}`)).json();
  const dialogId = state.dialogs[0].id;
  await page.reload();
  await page.getByRole("button", { name: "SQLite", exact: true }).click();
  await expect(page.locator(".question-card")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        await (await page.request.get(`/api/test/${id}/answer`)).json(),
    )
    .toEqual({ value: "SQLite", wasUndefined: false });
  const duplicate = await page.request.post(
    `/api/sessions/${id}/dialogs/${dialogId}`,
    { data: { value: "Hosted database" } },
  );
  expect(duplicate.status()).toBe(400);
  await page.request.post(`/api/test/${id}/dialog`, {
    data: { kind: "confirm", title: "Proceed with implementation?" },
  });
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect
    .poll(
      async () =>
        await (await page.request.get(`/api/test/${id}/answer`)).json(),
    )
    .toEqual({ value: false, wasUndefined: false });
});
test("unknown tool output and diffs remain readable; unsupported interactive UI is explicit", async ({
  page,
}) => {
  const id = await seed(page);
  await page.request.post(`/api/test/${id}/tools`, { data: {} });
  await page
    .locator(".tool-card")
    .filter({ hasText: "future_project_tool" })
    .locator("summary")
    .first()
    .click();
  await expect(
    page.getByText("An unfamiliar tool still has readable output.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .locator(".tool-card")
    .filter({ hasText: "notes.ts" })
    .locator("summary")
    .first()
    .click();
  await expect(page.getByLabel("File changes")).toContainText(
    '+const storage = "sqlite";',
  );
  await page.request.post(`/api/test/${id}/dialog`, {
    data: { kind: "unsupported", title: "Terminal-only interaction" },
  });
  await expect(
    page.getByRole("heading", { name: "Terminal-only interaction" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop this interaction" }).click();
  await expect(page.locator(".question-card")).toHaveCount(0);
  await expect
    .poll(async () =>
      Object.keys(
        await (await page.request.get(`/api/test/${id}/answer`)).json(),
      ),
    )
    .toContain("error");
});
test("narrow browser stays usable with inline comments", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 850 });
  await seed(page);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("button", { name: "Close sidebar" }).click();
  await commentOn(page, "notes.db", "Works on a narrow window.");
  await expect(page.locator(".comment-card")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: ".margin-data/narrow.png", fullPage: true });
});
test("unfinished editor cannot be hidden and narrow comments open and jump to the actual passage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await commentOn(page, "A focused meeting-notes app", "Title feedback.");
  await page.getByRole("button", { name: "Edit comment", exact: true }).click();
  await page.getByLabel("Inline comment").fill("Still editing.");
  await page
    .getByRole("button", { name: "Close comments", exact: true })
    .click();
  await expect(page.getByLabel("Inline comment")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Finish or cancel");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Close comments", exact: true })
    .click();
  await page.locator(".scroll-area").evaluate((e) => (e.scrollTop = 0));
  await page.getByRole("button", { name: /^Comments/ }).click();
  await expect(page.locator(".comment-rail")).toBeInViewport();
  await page.locator(".comment-quote").click();
  await expect(
    page.getByRole("heading", { name: "A focused meeting-notes app" }),
  ).toBeInViewport();
  await expect
    .poll(async () => {
      const a = await page
        .getByRole("heading", { name: "A focused meeting-notes app" })
        .boundingBox();
      const b = await page.locator(".scroll-area").boundingBox();
      return !!a && !!b && a.y >= b.y;
    })
    .toBeTruthy();
});
test("delayed submission preserves newer draft and prevents changing comments already being sent", async ({
  page,
}) => {
  const id = await seed(page);
  await commentOn(page, "notes.db", "Original submitted comment.");
  await page.request.post(`/api/test/${id}/delay-preflight`, { data: {} });
  await page.getByLabel("Message Pi").fill("Submitted note.");
  await page
    .getByRole("button", { name: "Send 1 comment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Accept this submission?" }),
  ).toBeVisible();
  await page.getByLabel("Message Pi").fill("A newer draft that must survive.");
  await page.waitForTimeout(350);
  const state = await (await page.request.get(`/api/sessions/${id}`)).json();
  const changed = await page.request.put(`/api/sessions/${id}/comments`, {
    data: state.comments.map((c: any) => ({
      ...c,
      text: "Mutated during submission",
    })),
  });
  expect(changed.status()).toBe(400);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Revised direction" }),
  ).toBeVisible();
  await expect(page.getByLabel("Message Pi")).toHaveValue(
    "A newer draft that must survive.",
  );
  const after = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(after.comments[0].text).toBe("Original submitted comment.");
  expect(after.comments[0].status).toBe("sent");
});
test("plugins persist project data, specialize messages, and fail without losing ordinary output", async ({
  page,
}) => {
  const id = await seed(page);
  await page.getByRole("button", { name: "Lab notes", exact: true }).click();
  await page
    .getByLabel("Project note")
    .fill("Remember this across conversations.");
  await page.getByRole("button", { name: "Save project note" }).click();
  await expect(page.getByTestId("plugin-note")).toHaveText(
    "Remember this across conversations.",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Lab notes", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("plugin-note")).toHaveText(
    "Remember this across conversations.",
  );
  const invalid = await page.request.post(
    `/api/sessions/${id}/plugins/lab/invalid`,
    { data: {} },
  );
  expect(invalid.status()).toBe(400);
  expect((await page.request.get("/api/bootstrap")).ok()).toBeTruthy();
  await page.request.post(`/api/test/${id}/plugin-output`, { data: {} });
  await expect(page.getByTestId("custom-renderer")).toHaveText(
    "Custom card: structured value",
  );
  await page
    .locator(".tool-card")
    .filter({ hasText: "broken_renderer" })
    .locator("summary")
    .first()
    .click();
  await expect(
    page.getByText("Readable output survives a broken renderer.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("could not render");
  const child = await page.request.post(
    `/api/sessions/${id}/plugins/lab/background`,
    { data: { provider: "openai-codex", model: "gpt-5.6-sol" } },
  );
  expect(child.ok()).toBeTruthy();
  expect((await child.json()).result).toMatchObject({
    created: true,
    disposed: true,
  });
});
test("a plugin can register another main runtime without changing the browser comment workflow", async ({
  page,
}) => {
  await page.goto("/");
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const model = bootstrap.models.find((m: any) => m.backend === "lab-virtual");
  expect(model).toBeTruthy();
  const s = await (
    await page.request.post("/api/sessions", {
      data: { projectId: bootstrap.projects[0].id, model },
    })
  ).json();
  await page.goto(`/chats/${s.session.id}`);
  await expect(
    page.getByRole("heading", { name: "Another runtime" }),
  ).toBeVisible();
  await commentOn(
    page,
    "same inline comments",
    "This works across runtime adapters.",
  );
  await page
    .getByRole("button", { name: "Send 1 comment", exact: true })
    .click();
  await expect(
    page.getByText("Feedback received by the alternate runtime.", {
      exact: true,
    }),
  ).toBeVisible();
});
