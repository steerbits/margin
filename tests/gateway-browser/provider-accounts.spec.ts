import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("gateway account API requires browser authentication, rejects cross-origin writes, and honors read-only mode", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/provider-accounts")).status()).toBe(401);
  expect((await request.get("/api/custom-connections")).status()).toBe(401);
  expect(
    (await request.post("/api/custom-connections/save", { data: {} })).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/provider-accounts/login", {
        data: { providerId: "xai", method: "oauth" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.delete("/api/provider-accounts/anthropic", { data: {} })
    ).status(),
  ).toBe(401);
  const { url } = JSON.parse(
    readFileSync(".margin-data/gateway-test-link.json", "utf8"),
  );
  await page.goto(url);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByLabel("Default model")).toBeEnabled();
  await dialog.locator(".settings-accounts > summary").click();
  await expect(
    dialog.getByText(/Account changes are disabled by MARGIN_AUTH_READ_ONLY/),
  ).toBeVisible();
  const response = await page.request.get("/api/provider-accounts");
  expect(response.ok()).toBe(true);
  expect(response.headers()["x-margin-host"]).toBe("gateway");
  expect(response.headers()["cache-control"]).toBe("no-store");
  const custom = await page.request.get("/api/custom-connections");
  expect(custom.headers()["x-margin-host"]).toBe("gateway");
  expect(custom.headers()["cache-control"]).toBe("no-store");
  expect((await custom.json()).readOnly).toBe(true);
  expect(
    (
      await page.request.post("/api/custom-connections/save", {
        data: {},
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/custom-connections/save", { data: {} })
    ).status(),
  ).toBe(400);
  const accounts = await response.json();
  expect(accounts.providers.some((p: { id: string }) => p.id === "xai")).toBe(
    true,
  );
  expect(
    accounts.providers.some((p: { id: string }) => p.id === "anthropic"),
  ).toBe(true);
  expect(
    accounts.providers.every(
      (p: object) =>
        !["access", "refresh", "key", "credential", "source"].some(
          (key) => key in p,
        ),
    ),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/provider-accounts/login", {
        data: { providerId: "xai", method: "oauth" },
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/provider-accounts/login", {
        data: "not-json",
        headers: { "Content-Type": "text/plain" },
      })
    ).status(),
  ).toBe(415);
  for (const path of [
    "/api/provider-accounts/anthropic",
    "/api/provider-accounts/xai",
  ])
    expect((await page.request.delete(path, { data: {} })).status()).toBe(400);
  expect(
    (
      await page.request.post("/api/provider-accounts/login", {
        data: { providerId: "xai", method: "oauth" },
      })
    ).status(),
  ).toBe(400);
});
