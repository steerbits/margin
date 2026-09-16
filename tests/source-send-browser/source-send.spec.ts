import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sourceSendConflict } from "../../shared/source-send.ts";

async function seed(page: Page, options: Record<string, unknown> = {}) {
  const response = await page.request.post("/api/test/seed", {
    data: { empty: true, ...options },
  });
  expect(response.ok()).toBe(true);
  return await response.json();
}
async function running(page: Page) {
  const { id, snapshot } = await seed(page, { title: "Running task A" });
  await page.request.post(`/api/test/${id}/delay-preflight`, { data: {} });
  const batch = { id: randomUUID(), note: "Task A", commentIds: [] };
  const response = await page.request.post(`/api/sessions/${id}/send`, {
    data: batch,
  });
  expect(response.ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/sessions/${id}`)).json()).busy,
    )
    .toBe(true);
  return { id, batch, projectId: snapshot.session.projectId };
}
async function stop(page: Page, id: string) {
  await page.request.post(`/api/sessions/${id}/stop`, { data: {} });
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/sessions/${id}/send-availability`)
          ).json()
        ).block,
    )
    .toBeNull();
}

for (const width of [1440, 390]) {
  test(`new chats and drafting remain available; the conflict explanation and running-chat link work at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 650 ? 844 : 1000 });
    await page.goto("/");
    const active = await running(page);
    let nextId = "";
    try {
      const created = await page.request.post("/api/sessions", {
        data: { projectId: active.projectId },
      });
      expect(created.ok()).toBe(true); // Server creation is not guarded.
      const first = await created.json();
      await page.goto(`/chats/${first.session.id}`);
      await expect(page.locator(".source-send-notice")).toContainText(
        sourceSendConflict,
      );
      // New via UI uses a scripted inference boundary, never a real provider.
      await page.route("**/api/sessions", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const next = await seed(page, { title: "Draft task B" });
        nextId = next.id;
        await route.fulfill({ json: next.snapshot });
      });
      if (width < 650)
        await page
          .getByRole("button", { name: "Show sidebar", exact: true })
          .click();
      const newChat = page.getByRole("button", { name: /New conversation.*⌘/ });
      await expect(newChat).toBeEnabled();
      await newChat.click();
      await expect.poll(() => nextId).not.toBe("");
      await expect(page).toHaveURL(new RegExp(`/chats/${nextId}$`));
      const composer = page.getByLabel("Message Pi", { exact: true });
      await composer.fill("Keep this draft while A works");
      const send = page.getByRole("button", {
        name: "Send message",
        exact: true,
      });
      await expect(send).toBeDisabled();
      await expect(send).toHaveAttribute(
        "aria-describedby",
        "source-send-reason",
      );
      await expect(page.locator(".source-send-notice")).toContainText(
        sourceSendConflict,
      );
      await expect(page.locator(".source-send-notice")).toBeInViewport({
        ratio: 1,
      });
      let sends = 0;
      page.on("request", (request) => {
        if (request.url().endsWith(`/sessions/${nextId}/send`)) sends++;
      });
      await composer.press("Control+Enter");
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`/api/sessions/${nextId}`)).json())
              .composer,
        )
        .toBe("Keep this draft while A works");
      expect(sends).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: `.margin-data/source-send-${width}.png` });
      await page
        .getByRole("link", { name: "View running conversation" })
        .click();
      await expect(page).toHaveURL(new RegExp(`/chats/${active.id}$`));
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await stop(page, active.id);
      await page.goto(`/chats/${nextId}`);
      await expect(composer).toHaveValue("Keep this draft while A works");
      await expect(send).toBeEnabled();
      await expect(page.locator(".message.user")).toHaveCount(0); // Not queued/auto-sent.
      await send.click();
      await expect(page.locator(".message.assistant")).toHaveCount(1);
      await expect(page.locator(".send-status")).toHaveCount(0);
    } finally {
      await stop(page, active.id);
    }
  });
}

test("stale pages and direct sends receive the same explanation; accepted batch retries remain idempotent", async ({
  page,
}) => {
  await page.goto("/");
  const active = await running(page);
  const next = await seed(page);
  try {
    const duplicate = await page.request.post(
      `/api/sessions/${active.id}/send`,
      { data: active.batch },
    );
    expect(duplicate.ok()).toBe(true);
    expect((await duplicate.json()).status).toBe("submitting");
    const response = await page.request.post(`/api/sessions/${next.id}/send`, {
      data: {
        id: randomUUID(),
        note: "Conflicting direct request",
        commentIds: [],
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe(sourceSendConflict);
    await page.route(`**/api/sessions/${next.id}/send-availability`, (route) =>
      route.fulfill({ json: { block: null } }),
    );
    await page.goto(`/chats/${next.id}`);
    const composer = page.getByLabel("Message Pi", { exact: true });
    await composer.fill("Draft from a stale tab");
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByRole("alert")).toContainText(sourceSendConflict);
    await expect(composer).toHaveValue("Draft from a stale tab");
    await expect(page.locator(".message.user")).toHaveCount(0);
    const review = await (
      await page.request.get(`/api/sessions/${next.id}/artifacts`)
    ).json();
    expect(review.busy).toBe(true);
    expect(review.sendBlockReason).toBe(sourceSendConflict);
  } finally {
    await stop(page, active.id);
  }
});

test("a completed run unlocks sending automatically, without sending the saved draft", async ({
  page,
}) => {
  await page.goto("/");
  const active = await running(page);
  const next = await seed(page);
  try {
    await page.goto(`/chats/${next.id}`);
    const composer = page.getByLabel("Message Pi", { exact: true });
    await composer.fill("Wait for completion");
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    await expect(send).toBeDisabled();
    const state = await (
      await page.request.get(`/api/sessions/${active.id}`)
    ).json();
    await page.request.post(
      `/api/sessions/${active.id}/dialogs/${state.dialogs[0].id}`,
      { data: { value: true } },
    );
    await expect(send).toBeEnabled();
    await expect(page.locator(".source-send-notice")).toHaveCount(0);
    await expect(composer).toHaveValue("Wait for completion");
    await expect(page.locator(".message.user")).toHaveCount(0);
  } finally {
    await stop(page, active.id);
  }
});

test("ordinary workspaces can still send while Margin is busy", async ({
  page,
}) => {
  await page.goto("/");
  const active = await running(page);
  try {
    const response = await page.request.post("/api/workspaces", {
      data: { name: `Unrelated ${randomUUID().slice(0, 8)}` },
    });
    expect(response.ok()).toBe(true);
    const project = await response.json();
    const next = await seed(page, { projectId: project.id });
    await page.goto(`/chats/${next.id}`);
    const composer = page.getByLabel("Message Pi", { exact: true });
    await composer.fill("Independent work");
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    await expect(send).toBeEnabled();
    await expect(page.locator(".source-send-notice")).toHaveCount(0);
    await send.click();
    await expect(page.locator(".message.assistant")).toHaveCount(1);
    await expect(page.locator(".send-status")).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/sessions/${active.id}`)).json())
        .busy,
    ).toBe(true);
  } finally {
    await stop(page, active.id);
  }
});

test("availability failures keep drafts and offer a retry instead of silently enabling Send", async ({
  page,
}) => {
  await page.goto("/");
  const next = await seed(page);
  await page.route(`**/api/sessions/${next.id}/send-availability`, (route) =>
    route.fulfill({ status: 503, json: { error: "Offline check" } }),
  );
  await page.goto(`/chats/${next.id}`);
  const composer = page.getByLabel("Message Pi", { exact: true });
  await composer.fill("Saved while checking fails");
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await expect(send).toBeDisabled();
  await expect(page.locator(".source-send-notice")).toContainText(
    "Could not check running tasks",
  );
  await page.unroute(`**/api/sessions/${next.id}/send-availability`);
  await page
    .locator(".source-send-notice")
    .getByRole("button", { name: "Retry" })
    .click();
  await expect(send).toBeEnabled();
  await expect(composer).toHaveValue("Saved while checking fails");
});
