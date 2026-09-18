import { test, expect, type Page } from "@playwright/test";
import { sourceSendConflict } from "../../shared/source-send.ts";
import { marginHelpPrompt } from "../../shared/help.ts";
import { releaseNotesUrl } from "../../shared/updates.ts";
import {
  availableVersion,
  installedVersion,
  scriptedNewChats,
  updateFixture,
} from "./update-helpers.ts";

const editor = (page: Page) => page.getByLabel("Message", { exact: true });
async function start(page: Page, highlighted = true) {
  await page.route("**/api/updates", (route) =>
    route.fulfill({ json: updateFixture(highlighted) }),
  );
  await scriptedNewChats(page);
  await page.goto("/");
  const { id } = await (
    await page.request.post("/api/test/seed", { data: {} })
  ).json();
  await page.goto(`/chats/${id}`);
  await expect(editor(page)).toBeVisible();
  return id;
}

test("highlighted update autosends a pinned review once, preserves previous draft and reopens the same target chat", async ({
  page,
}) => {
  const old = await start(page);
  await editor(page).fill("My earlier draft");
  const sends: any[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/send")) sends.push(r.postDataJSON());
  });
  await page
    .getByRole("button", { name: "Update available", exact: true })
    .dblclick();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].note).toContain("exact commit " + "a".repeat(40));
  expect(sends[0].note).toContain("Do not modify source");
  expect(sends[0].note).toContain("explicitly confirm");
  await expect(editor(page)).toHaveValue("");
  const target = page.url();
  const saved = await (await page.request.get(`/api/sessions/${old}`)).json();
  expect(saved.composer).toBe("My earlier draft");
  await page
    .getByRole("button", { name: "Update available", exact: true })
    .click();
  await expect(page).toHaveURL(target);
  expect(sends).toHaveLength(1);
  await page.reload();
  await expect(editor(page)).toHaveValue("");
  expect(sends).toHaveLength(1);
});

test("quiet update appears only in Settings and manual checking refreshes its status", async ({
  page,
}) => {
  await start(page, false);
  await expect(
    page.getByRole("button", { name: "Update available", exact: true }),
  ).toHaveCount(0);
  let checks = 0;
  await page.route("**/api/updates/check", (route) => {
    checks++;
    return route.fulfill({ json: updateFixture(false) });
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const section = page.locator(".update-settings");
  await expect(section).toContainText(`Running: ${installedVersion}`);
  await expect(section).toContainText(`Latest published: ${availableVersion}`);
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect.poll(() => checks).toBe(1);
  await expect(
    page.getByRole("link", { name: "Release notes", exact: true }),
  ).toHaveAttribute("href", releaseNotesUrl(updateFixture().manifest!.latest!));
  let sends = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/send")) sends++;
  });
  await page
    .getByRole("button", { name: "Review update", exact: true })
    .click();
  await expect.poll(() => sends).toBe(1);
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toHaveCount(0);
});

test("Update and Help preserve the existing busy guard and never queue a delayed auto-send", async ({
  page,
}) => {
  await start(page);
  let blocked = true,
    sends = 0;
  await page.route("**/api/sessions/*/send-availability", (route) =>
    route.fulfill({
      json: { block: blocked ? { reason: sourceSendConflict } : null },
    }),
  );
  page.on("request", (r) => {
    if (r.url().endsWith("/send")) sends++;
  });
  for (const label of ["Update available", "Help"]) {
    blocked = true;
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("#source-send-reason")).toContainText(
      sourceSendConflict,
    );
    await expect(editor(page)).toHaveValue(
      label === "Help" ? marginHelpPrompt : /Review updating Margin/,
    );
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    blocked = false;
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeEnabled();
    expect(sends).toBe(0);
  }
});

test("editing the prepared prompt while initial readiness is pending cancels autosend", async ({
  page,
}) => {
  await start(page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sessions/*/send-availability", async (route) => {
    await hold;
    await route.fulfill({ json: { block: null } });
  });
  let sends = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/send")) sends++;
  });
  try {
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await expect(editor(page)).toHaveValue(marginHelpPrompt);
    await editor(page).fill("I want to edit this question first");
    release();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeEnabled();
    await expect(editor(page)).toHaveValue(
      "I want to edit this question first",
    );
    expect(sends).toBe(0);
  } finally {
    release();
  }
});

test("failed autosend retains draft and explicit retry works without creating another chat", async ({
  page,
}) => {
  await start(page);
  let sends = 0;
  await page.route("**/api/sessions/*/send", async (route) => {
    sends++;
    if (sends === 1)
      await route.fulfill({
        status: 503,
        json: { error: "Test send unavailable" },
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Test send unavailable");
  await expect(editor(page)).toHaveValue(marginHelpPrompt);
  const target = page.url();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(editor(page)).toHaveValue("");
  await expect.poll(() => sends).toBe(2);
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(page).toHaveURL(target);
});

test("no AI opens official notes without creating a chat or sending; badge fits at 320px", async ({
  page,
}) => {
  await start(page);
  await page.route("**/api/bootstrap*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), models: [] } });
  });
  await page.reload();
  await page.evaluate(() => {
    (window as any).opened = [];
    window.open = (...args: any[]) => {
      (window as any).opened.push(args);
      return null;
    };
  });
  let creates = 0,
    sends = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/sessions") && r.method() === "POST") creates++;
    if (r.url().endsWith("/send")) sends++;
  });
  await page.setViewportSize({ width: 320, height: 800 });
  const button = page.getByRole("button", {
    name: "Update available",
    exact: true,
  });
  await expect(button).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".margin-data/temporary/update-mobile.png" });
  await button.click();
  expect(await page.evaluate(() => (window as any).opened)).toEqual([
    [
      releaseNotesUrl(updateFixture().manifest!.latest!),
      "_blank",
      "noopener,noreferrer",
    ],
  ]);
  expect(creates).toBe(0);
  expect(sends).toBe(0);
});

test("offline discovery retains cached badge and Settings does not claim a successful current check", async ({
  page,
}) => {
  const fixture = updateFixture();
  fixture.error =
    "Couldn't check for updates. Cached information may be out of date.";
  await page.route("**/api/updates", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Update available", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".update-settings")).toContainText(
    "Cached information may be out of date",
  );
  await expect(page.locator(".update-settings")).not.toContainText(
    "No newer published version",
  );
});

test("a newer browser bundle and old server mismatch does not claim an installed version", async ({
  page,
}) => {
  const fixture = updateFixture();
  fixture.runningVersion = "0.0.9";
  await page.route("**/api/updates", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".update-settings")).toContainText(
    "Browser and running server versions differ",
  );
  await expect(
    page.getByRole("button", { name: "Update available", exact: true }),
  ).toHaveCount(0);
});
