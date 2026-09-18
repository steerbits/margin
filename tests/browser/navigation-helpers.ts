import { expect, type Page } from "@playwright/test";
export async function showSidebar(page: Page) {
  // Bootstrap can reveal saved chats and open the sidebar. Wait until that
  // initial state has settled before deciding whether a toggle is necessary.
  await expect(page.getByRole("button", { name: "Help", exact: true })).toBeEnabled();
  const show = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await show.isVisible()) await show.click();
  await expect(page.getByRole("button", { name: "Hide sidebar", exact: true })).toBeVisible();
}
export async function selectWorkspace(page: Page, id: string) {
  await showSidebar(page);
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption("__all__");
  await page.getByRole("dialog", { name: "All workspaces", exact: true }).locator(`[data-project-id="${id}"]`).click();
}

export async function openDefaultWorkspace(page: Page, newConversation = false) {
  await page.goto("/");
  const boot = await (await page.request.get("/api/bootstrap")).json();
  await page.goto(`/workspaces/${boot.marginProjectId ?? boot.projects[0].id}`);
  if (newConversation)
    await page.locator(".workspace-home").getByRole("button", { name: "New conversation", exact: true }).click();
}
