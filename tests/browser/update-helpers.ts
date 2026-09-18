import { expect, type Page } from "@playwright/test";
import type { UpdateStatus } from "../../shared/updates.ts";
import pkg from "../../package.json" with { type: "json" };
export const installedVersion = pkg.version;
const major = Number(installedVersion.split(".")[0]) + 1;
export const availableVersion = `${major}.2.1`;
export function updateFixture(highlighted = true): UpdateStatus {
  return {
    runningVersion: installedVersion,
    runningCommit: null,
    checkedAt: Date.now(),
    manifest: {
      schemaVersion: 1,
      lastHighlightedVersion: highlighted ? `${major}.2.0` : null,
      latest: {
        version: availableVersion,
        commit: "a".repeat(40),
        tag: `v${availableVersion}`,
        highlighted: false,
        security: false,
        publishedAt: "2026-09-18T00:00:00Z",
        tests: { status: "passed" },
      },
    },
  };
}
/** Use real chat/send machinery, but only scripted fixture inference. */
export async function scriptedNewChats(page: Page) {
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const { projectId } = route.request().postDataJSON();
    const response = await page.request.post("/api/test/seed", {
      data: { projectId, empty: true, responseDelay: 500 },
    });
    expect(response.ok()).toBe(true);
    const { snapshot } = await response.json();
    await route.fulfill({ json: snapshot });
  });
}
