import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import pkg from "../../package.json" with { type: "json" };

test("update status and refresh are gateway-owned, authenticated, and reject hostile origins", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/updates")).status()).toBe(401);
  expect(
    (await request.post("/api/updates/check", { data: {} })).status(),
  ).toBe(401);
  const { url } = JSON.parse(
    readFileSync(".margin-data/gateway-test-link.json", "utf8"),
  );
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  const response = await page.request.get("/api/updates");
  expect(response.headers()["x-margin-host"]).toBe("gateway");
  const status = await response.json();
  expect(status.runningVersion).toBe(pkg.version);
  expect(status.manifest).toBeNull(); // Fixture mode never contacts GitHub.
  const repeated = await Promise.all(
    Array.from({ length: 3 }, () =>
      page.request.post("/api/updates/check", { data: {} }),
    ),
  );
  for (const result of repeated) {
    expect(result.ok()).toBe(true);
    expect(await result.json()).toEqual(status);
  }
  expect(
    (
      await page.request.post("/api/updates/check", {
        data: {},
        headers: { Origin: "https://evil.invalid" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/updates/check", {
        data: "plain",
        headers: { "Content-Type": "text/plain" },
      })
    ).status(),
  ).toBe(415);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".update-settings")).toContainText(
    `Running: ${pkg.version}`,
  );
});
