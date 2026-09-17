import type { Page } from "@playwright/test";
export async function selectWorkspace(page: Page, id: string) {
  if (!(await page.locator(".sidebar").isVisible()))
    await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
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
