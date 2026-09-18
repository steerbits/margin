import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("older real build shows a highlighted update; a matching newer startup clears it, not a source edit", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Update available", exact: true }),
  ).toBeVisible();
  const old = await (await page.request.get("/api/updates")).json();
  expect(old.runningVersion).toBe("1.0.0");
  expect(old.manifest.latest.version).toBe("1.1.0");
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const root = boot.projects.find(
    (p: any) => p.id === boot.marginProjectId,
  ).path;
  expect(root).toContain(".margin-data/temporary/browser-tests/app-");
  const packageFile = join(root, "package.json");
  const saved = readFileSync(packageFile, "utf8");
  try {
    writeFileSync(
      packageFile,
      JSON.stringify({ ...JSON.parse(saved), version: "1.1.0" }),
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Update available", exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get("/api/updates")).json()).runningVersion,
    ).toBe("1.0.0");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator(".update-settings")).toContainText(
      "Running: 1.0.0",
    );
    await page.locator(".settings-accounts > summary").click();
    await page.locator(".update-settings").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".margin-data/temporary/update-validation/older-installation.png",
    });
    await page.goto("http://127.0.0.1:4352/");
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    const newer = await (
      await page.request.get("http://127.0.0.1:4352/api/updates")
    ).json();
    expect(newer.runningVersion).toBe("1.1.0");
    await expect(
      page.getByRole("button", { name: "Update available", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator(".update-settings")).toContainText(
      "Running: 1.1.0",
    );
    await expect(page.locator(".update-settings")).toContainText(
      "No newer published version.",
    );
    await page.locator(".settings-accounts > summary").click();
    await page.locator(".update-settings").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".margin-data/temporary/update-validation/newer-installation.png",
    });
  } finally {
    writeFileSync(packageFile, saved);
  }
});
