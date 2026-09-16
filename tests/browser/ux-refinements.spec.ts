import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, options: Record<string, unknown> = {}) {
  const response = await page.request.post("/api/test/seed", {
    data: { empty: true, ...options },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).id as string;
}
async function open(page: Page, id: string) {
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
}

for (const width of [1440, 390, 320]) {
  test(`workspace-opening brand has a smaller byline without overflowing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".brand")).toHaveText("margin by Steerbits");
    await expect(page.getByRole("button", { name: "Open workspace from Margin", exact: true })).toBeVisible();
    const metrics = await page.locator(".brand").evaluate((brand) => {
      const title = brand.querySelector("span")!;
      const byline = brand.querySelector("small")!;
      const right = document.querySelector(".header-right")!;
      return {
        title: parseFloat(getComputedStyle(title).fontSize),
        byline: parseFloat(getComputedStyle(byline).fontSize),
        bylineSpacing: parseFloat(getComputedStyle(byline).marginLeft),
        overlap:
          brand.getBoundingClientRect().right >
          right.getBoundingClientRect().left,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(metrics.byline).toBeLessThan(metrics.title);
    expect(metrics.bylineSpacing).toBe(8);
    expect(metrics.overlap).toBe(false);
    expect(metrics.overflow).toBe(false);
    await expect(page.locator(".brand button, .brand a")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `.margin-data/brand-${width}.png` });
  });
}

test("browsing and reloading do not promote a chat; sending a message does", async ({
  page,
}) => {
  await page.goto("/");
  const older = await seed(page, { title: "Older stable chat" });
  const newer = await seed(page, { title: "Newer stable chat" });
  await open(page, newer);
  const rows = page.locator("#current-workspace-chats-list [data-session-id]");
  const order = () =>
    rows.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-session-id")),
    );
  expect((await order()).slice(0, 2)).toEqual([newer, older]);
  const before = await (
    await page.request.get(`/api/sessions/${older}`)
  ).json();
  await page.locator(`[data-session-id="${older}"]`).click();
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  expect((await order()).slice(0, 2)).toEqual([newer, older]);
  await page.reload();
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  expect((await order()).slice(0, 2)).toEqual([newer, older]);
  const after = await (await page.request.get(`/api/sessions/${older}`)).json();
  expect(after.session.updatedAt).toBe(before.session.updatedAt);
  await page.getByLabel("Message", { exact: true }).fill("Actual activity");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(async () => (await order())[0]).toBe(older);
  await expect(page.locator(".send-status")).toHaveCount(0);
});

for (const failure of [false, true]) {
  test(`typing during a delayed send survives ${failure ? "failure" : "acceptance"}`, async ({
    page,
  }) => {
    await page.goto("/");
    const id = await seed(page);
    await open(page, id);
    const composer = page.getByLabel("Message", { exact: true });
    await composer.fill("Original note");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/sessions/${id}/send`, async (route) => {
      await gate;
      if (failure)
        await route.fulfill({
          status: 503,
          json: { error: "Send unavailable" },
        });
      else await route.continue();
    });
    try {
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(composer).toHaveValue("");
      await expect(page.locator(".message.user")).toContainText(
        "Original note",
      );
      await composer.fill("Newer draft");
      // Force a snapshot while the POST is blocked: it must not resurrect the old note.
      await page.request.post(`/api/test/${id}/tools`, { data: {} });
      await expect(page.locator(".tool-card")).not.toHaveCount(0);
      await expect(composer).toHaveValue("Newer draft");
    } finally {
      release();
    }
    const expected = failure ? "Original note\n\nNewer draft" : "Newer draft";
    await expect(composer).toHaveValue(expected);
    await expect(page.locator(".send-status")).toHaveCount(0);
    await expect(page.locator(".message.user")).toHaveCount(failure ? 0 : 1);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/sessions/${id}`)).json())
            .composer,
      )
      .toBe(expected);
    await page.reload();
    await expect(composer).toHaveValue(expected);
  });
}

test("asynchronous preflight rejection restores the draft and retries with a fresh batch", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page, { rejectSend: true });
  await open(page, id);
  const composer = page.getByLabel("Message", { exact: true });
  await composer.fill("Rejected draft");
  const batches: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(`/sessions/${id}/send`))
      batches.push(request.postDataJSON().id);
  });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await send.click();
  await expect(page.getByRole("alert")).toContainText("draft is restored");
  await expect(composer).toHaveValue("Rejected draft");
  await expect(page.locator(".message.user")).toHaveCount(0);
  await expect(page.locator(".composer-inline")).toHaveCount(1);
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => batches.length).toBe(2);
  expect(batches[1]).not.toBe(batches[0]);
  await expect(composer).toHaveValue("Rejected draft");
});

test("a live confirmation replaces the bubble even if the HTTP response is lost", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page);
  await open(page, id);
  const composer = page.getByLabel("Message", { exact: true });
  await composer.fill("Send exactly once");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${id}/send`, async (route) => {
    await route.fetch();
    await gate;
    await route.abort("failed");
  });
  try {
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator(".message.assistant")).toHaveCount(1);
    await expect(page.locator(".send-status")).toHaveCount(0);
    await expect(page.locator(".message.user")).toHaveCount(1);
    await expect(composer).toHaveValue("");
  } finally {
    release();
  }
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(page.locator(".message.user")).toHaveCount(1);
});
