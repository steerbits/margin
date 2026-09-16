import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, title = "Attachment test") {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", {
    data: { empty: true, title },
  });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(
    page.getByRole("button", { name: "Attach files", exact: true }),
  ).toBeEnabled();
  // This browser fixture bypasses SDK expansion. Real SDK skill expansion is
  // exercised separately in attachments.test.ts without a provider request.
  await page.getByLabel("Starting skill").selectOption("");
  return id as string;
}
const md = {
  name: "brief.md",
  mimeType: "text/markdown",
  buffer: Buffer.from("# Brief\n\nPreserve this original.\n"),
};
const pdf = {
  name: "report.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\nfixture bytes\n%%EOF"),
};
const send = (page: Page) =>
  page.getByRole("button", { name: "Send message", exact: true });
const drafts = (page: Page) =>
  page.getByLabel("Draft attachments", { exact: true });
async function choose(page: Page, files = [md]) {
  await page
    .getByLabel("Choose attachments", { exact: true })
    .setInputFiles(files);
  await expect(drafts(page)).toContainText(files[0].name);
  await expect(drafts(page)).not.toContainText("Uploading…");
}

test("selecting files returns focus for typing, but finishing a late upload does not steal it", async ({
  page,
}) => {
  const id = await seed(page);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${id}/attachments`, async (route) => {
    await waiting;
    await route.continue().catch(() => {});
  });
  const composer = page.getByLabel("Message", { exact: true });
  const skill = page.getByLabel("Starting skill");
  try {
    const picker = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Attach files", exact: true })
      .click();
    await (await picker).setFiles([md, pdf]);
    await expect(drafts(page)).toContainText("Uploading…");
    await expect(composer).toBeFocused();
    await page.keyboard.type("Use these references");
    await expect(composer).toHaveValue("Use these references");
    await skill.focus();
  } finally {
    release();
  }
  await expect(drafts(page)).not.toContainText("Uploading…");
  await expect(skill).toBeFocused();
  await expect(composer).toHaveValue("Use these references");
});

test("a newly created chat accepts dropped files before its first live snapshot", async ({
  page,
}) => {
  await seed(page);
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await page.request.post("/api/test/seed", {
      data: { empty: true, title: "New attachment chat" },
    });
    expect(response.ok()).toBe(true);
    await route.fulfill({ json: (await response.json()).snapshot });
  });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sessions/*/events", async (route) => {
    await waiting;
    await route.continue().catch(() => {});
  });
  try {
    await page.getByRole("button", { name: /New conversation.*⌘/ }).click();
    await expect(page.locator(".conversation-title")).toContainText(
      "New attachment chat",
    );
    await expect(page.locator(".connection")).toHaveText("Reconnecting…");
    const id = page.url().match(/\/chats\/([^/?]+)/)![1];
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(
        new File(["# First attachment"], "first.md", { type: "text/markdown" }),
      );
      return data;
    });
    await page
      .locator(".main")
      .dispatchEvent("drop", { dataTransfer: transfer });
    await expect(drafts(page)).toContainText("first.md");
    await expect(drafts(page)).not.toContainText("Uploading…");
    await expect(
      page.getByRole("button", { name: "Attach files", exact: true }),
    ).toBeEnabled();
    await expect(send(page)).toBeDisabled();
    const state = await (await page.request.get(`/api/sessions/${id}`)).json();
    expect(
      state.composerAttachments.map((file: { name: string }) => file.name),
    ).toEqual(["first.md"]);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(send(page)).toBeEnabled();
});

test("returning from the file picker can reconnect the chat without rejecting the selected file", async ({
  page,
}) => {
  const id = await seed(page);
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  const chooser = await picker;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${id}/events`, async (route) => {
    await waiting;
    await route.continue().catch(() => {});
  });
  try {
    // Simulate the focus event from closing the OS picker and hold its resulting
    // SSE reconnect. FileChooser.setFiles alone does not reproduce OS focus.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".connection")).toHaveText("Reconnecting…");
    await chooser.setFiles([pdf]);
    await expect(drafts(page)).toContainText(pdf.name);
    await expect(drafts(page)).not.toContainText("Uploading…");
    await expect(send(page)).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    // Real HTTP failures still retain a retryable draft while SSE is unavailable.
    await page.route(`**/api/sessions/${id}/attachments`, (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Upload service unavailable" },
      }),
    );
    await choose(page, [md]);
    await expect(drafts(page)).toContainText("Upload service unavailable");
    await page.unroute(`**/api/sessions/${id}/attachments`);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(drafts(page)).not.toContainText("Uploading…");
    await expect(drafts(page)).not.toContainText("Upload service unavailable");
    await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  } finally {
    release();
  }
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(send(page)).toBeEnabled();
});

for (const mobile of [false, true]) {
  test(`attachment chips are aligned and single-line with size tooltips on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    const long = { ...md, name: `${"long-filename-".repeat(10)}.md` };
    await choose(page, [md, long]);
    const chip = drafts(page).locator(".attachment-chip").first();
    await expect(chip).toHaveText(md.name);
    await expect(chip).toHaveAttribute("title", `${md.name} · 33 B`);
    const textLeft = await page
      .getByLabel("Message", { exact: true })
      .evaluate((input) => {
        const style = getComputedStyle(input);
        return (
          input.getBoundingClientRect().left +
          parseFloat(style.paddingLeft) +
          parseFloat(style.borderLeftWidth)
        );
      });
    expect(
      Math.abs((await chip.boundingBox())!.x - textLeft),
    ).toBeLessThanOrEqual(1);
    const longName = drafts(page).locator(".attachment-name").last();
    await expect(longName).toHaveCSS("white-space", "nowrap");
    await expect(longName).toHaveCSS("text-overflow", "ellipsis");
    await expect(
      drafts(page).locator(".attachment-chip").last(),
    ).toHaveAttribute("title", `${long.name} · 33 B`);
    expect(
      await longName.evaluate((name) => name.scrollWidth > name.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.margin-data/attachments-compact-draft-${mobile ? "mobile" : "desktop"}.png`,
    });
    await send(page).click();
    const sent = page.getByLabel("Sent attachments", { exact: true });
    const download = sent.getByRole("link", {
      name: `Download ${md.name}`,
      exact: true,
    });
    await expect(download).toHaveText(md.name);
    await expect(download).toHaveAttribute(
      "title",
      `Download ${md.name} · 33 B`,
    );
    await expect(sent.locator(".attachment-name").last()).toHaveCSS(
      "white-space",
      "nowrap",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.margin-data/attachments-compact-sent-${mobile ? "mobile" : "desktop"}.png`,
    });
  });

  test(`any-file attachment-only send, download, and persisted history on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const id = await seed(page);
    await choose(page, [md, pdf]);
    await expect(drafts(page)).toContainText(pdf.name);
    await expect(send(page)).toBeEnabled();
    await page.reload();
    await expect(drafts(page)).toContainText(md.name);
    await expect(drafts(page)).toContainText(pdf.name);
    await page.getByLabel("Starting skill").selectOption("");
    const request = page.waitForRequest((request) =>
      request.url().endsWith(`/sessions/${id}/send`),
    );
    await send(page).click();
    expect((await request).postDataJSON().attachmentIds).toHaveLength(2);
    await expect(
      page.getByLabel("Sent attachments", { exact: true }),
    ).toContainText(md.name);
    await expect(drafts(page)).toHaveCount(0);
    await expect(page.locator(".message.user")).not.toContainText("JSON below");
    const link = page.getByRole("link", { name: /report.pdf/ });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      link.click(),
    ]);
    expect(download.suggestedFilename()).toBe(pdf.name);
    await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));
    const response = await page.request.get((await link.getAttribute("href"))!);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain(
      "application/octet-stream",
    );
    expect(response.headers()["content-disposition"]).toContain("attachment;");
    expect(response.headers()["content-security-policy"]).toContain("sandbox");
    expect(await response.body()).toEqual(pdf.buffer);
    await page.reload();
    await expect(
      page.getByLabel("Sent attachments", { exact: true }),
    ).toContainText(pdf.name);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.margin-data/attachments-sent-${mobile ? "mobile" : "desktop"}.png`,
    });
  });
}

test("drop on chat history and paste an image; ordinary text dragging does not attach files", async ({
  page,
}) => {
  await seed(page);
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["# Dropped Markdown"], "dropped.md", { type: "text/markdown" }),
    );
    return data;
  });
  await page
    .locator(".empty-conversation")
    .dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(
    page.getByText("Attach to this conversation", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".margin-data/attachments-drop.png" });
  await page
    .locator(".empty-conversation")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByText("Attach to this conversation", { exact: true }),
  ).toHaveCount(0);
  await expect(drafts(page)).toContainText("dropped.md");
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  await page.getByLabel("Message", { exact: true }).evaluate((input) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", {
        type: "image/png",
      }),
    );
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(drafts(page)).toContainText("clipboard.png");
  await expect(drafts(page)).not.toContainText("Uploading…");
  const text = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "ordinary text");
    return data;
  });
  await page
    .locator(".main")
    .dispatchEvent("dragenter", { dataTransfer: text });
  await expect(
    page.getByText("Attach to this conversation", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove dropped.md", exact: true })
    .click();
  await expect(drafts(page)).not.toContainText("dropped.md");
  await expect(drafts(page)).toContainText("clipboard.png");
  await page.screenshot({ path: ".margin-data/attachments-draft.png" });
});

test("failed upload can retry; failed send retains its files and retry reuses the batch ID", async ({
  page,
}) => {
  const id = await seed(page);
  await page.route(`**/api/sessions/${id}/attachments`, (route) =>
    route.fulfill({ status: 503, json: { error: "Simulated upload failure" } }),
  );
  await choose(page);
  await expect(drafts(page)).toContainText("Simulated upload failure");
  await expect(send(page)).toBeDisabled();
  await page.unroute(`**/api/sessions/${id}/attachments`);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(drafts(page)).not.toContainText("Uploading…");
  await expect(send(page)).toBeEnabled();
  await page.getByLabel("Message", { exact: true }).fill("Read this brief");
  const ids: string[] = [];
  await page.route(`**/api/sessions/${id}/send`, (route) => {
    ids.push(route.request().postDataJSON().id);
    return route.fulfill({
      status: 503,
      json: { error: "Simulated send failure" },
    });
  });
  await send(page).click();
  await expect(page.getByRole("alert")).toContainText("Simulated send failure");
  await expect(drafts(page)).toContainText(md.name);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Read this brief",
  );
  await page.unroute(`**/api/sessions/${id}/send`);
  const request = page.waitForRequest((request) =>
    request.url().endsWith(`/sessions/${id}/send`),
  );
  await send(page).click();
  expect((await request).postDataJSON().id).toBe(ids[0]);
  await expect(
    page.getByLabel("Sent attachments", { exact: true }),
  ).toContainText(md.name);
  await expect(page.locator(".message.user")).toHaveCount(1);
});

test("late uploads stay in their original chat and other chats cannot download or send their IDs", async ({
  page,
}) => {
  const first = await seed(page, "First attachment chat");
  const second = await seed(page, "Second attachment chat");
  await page.goto(`/chats/${first}`);
  await expect(
    page.getByRole("button", { name: "Attach files", exact: true }),
  ).toBeEnabled();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${first}/attachments`, async (route) => {
    await wait;
    await route.continue();
  });
  await page
    .getByLabel("Choose attachments", { exact: true })
    .setInputFiles([md]);
  await expect(drafts(page)).toContainText("Uploading…");
  await expect(send(page)).toBeDisabled();
  // SPA navigation, preserving the in-flight request and its captured destination.
  await page.locator(`[data-session-id="${second}"]`).click();
  await expect(drafts(page)).toHaveCount(0);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  await page.getByLabel("Starting skill").focus();
  await expect(page.getByLabel("Starting skill")).toBeFocused();
  release();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/sessions/${first}`)).json())
          .composerAttachments.length,
    )
    .toBe(1);
  await expect(drafts(page)).toHaveCount(0);
  await expect(page.getByLabel("Starting skill")).toBeFocused();
  const state = await (await page.request.get(`/api/sessions/${first}`)).json();
  const attachmentId = state.composerAttachments[0].id;
  expect(
    (
      await page.request.get(
        `/api/sessions/${second}/attachments/${attachmentId}/download`,
      )
    ).ok(),
  ).toBe(false);
  expect(
    (
      await page.request.post(`/api/sessions/${second}/send`, {
        data: {
          id: crypto.randomUUID(),
          note: "Read",
          commentIds: [],
          attachmentIds: [attachmentId],
        },
      })
    ).ok(),
  ).toBe(false);
  await page.locator(`[data-session-id="${first}"]`).click();
  await expect(drafts(page)).toContainText(md.name);
  await expect(drafts(page)).not.toContainText("Uploading…");
});

test("files larger than the ordinary JSON limit upload, dangerous formats download only, and deletion cleans storage", async ({
  page,
}) => {
  const id = await seed(page);
  const large = {
    name: "large.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(3 * 1024 * 1024, 127),
  };
  await choose(page, [large]);
  await choose(page, [
    {
      name: "unsafe.html",
      mimeType: "text/html",
      buffer: Buffer.from("<script>window.pwned=true</script>"),
    },
  ]);
  const snapshot = await (await page.request.get(`/api/sessions/${id}`)).json();
  const unsafe = snapshot.composerAttachments.find(
    (file: { name: string }) => file.name === "unsafe.html",
  );
  const response = await page.request.get(
    `/api/sessions/${id}/attachments/${unsafe.id}/download`,
  );
  expect(response.headers()["content-type"]).toContain(
    "application/octet-stream",
  );
  const deletion = await page.request.delete(`/api/sessions/${id}`, {
    data: {},
  });
  expect(deletion.ok()).toBe(true);
  expect(
    (
      await page.request.get(
        `/api/sessions/${id}/attachments/${unsafe.id}/download`,
      )
    ).ok(),
  ).toBe(false);
});
