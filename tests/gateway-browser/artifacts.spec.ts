import { test, expect } from "@playwright/test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("artifact review works through a workspace gateway and delivers feedback to that workspace's conversation", async ({
  page,
}) => {
  const link = JSON.parse(
    readFileSync(".margin-data/gateway-test-link.json", "utf8"),
  );
  const root = mkdtempSync(join(tmpdir(), "margin-gateway-artifact-"));
  writeFileSync(
    join(root, "review.md"),
    "# Gateway artifact\n\nKeep workspace feedback here.\n",
  );
  try {
    await page.goto(link.url);
    const project = await (
      await page.request.post("/api/projects", { data: { path: root } })
    ).json();
    const response = await page.request.post("/api/sessions", {
      data: {
        projectId: project.id,
        model: {
          id: "fixture",
          provider: "fixture",
          name: "Compatibility fixture",
          subscription: false,
          backend: "lab-virtual",
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const { session } = await response.json();
    const registration = await page.request.post(
      `/api/sessions/${session.id}/artifacts`,
      { data: { location: "review.md" } },
    );
    expect(registration.ok(), await registration.text()).toBe(true);
    const artifact = await registration.json();
    await page.goto(`/review/${session.id}?artifact=${artifact.id}`);
    await expect(
      page
        .frameLocator("iframe")
        .getByRole("heading", { name: "Gateway artifact" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Comment on this page", exact: true })
      .click();
    await page
      .getByLabel("Feedback 1", { exact: true })
      .fill("This belongs to the external workspace.");
    await page
      .locator(".artifact-comment")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(page.locator(".artifact-send")).toContainText(
      "Saved in this conversation",
    );
    await page
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/chats/${session.id}$`));
    await expect(page.locator(".artifact-window")).toHaveCount(0);
    await expect(page.locator(".sent-batch")).toBeVisible();
    const state = await (
      await page.request.get(`/api/sessions/${session.id}`)
    ).json();
    expect(state.session.projectId).toBe(project.id);
    expect(
      state.messages.some(
        (m: { role: string; text: string }) =>
          m.role === "user" &&
          m.text.includes("This belongs to the external workspace."),
      ),
    ).toBe(true);
    expect(readFileSync(join(root, "review.md"), "utf8")).toBe(
      "# Gateway artifact\n\nKeep workspace feedback here.\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
