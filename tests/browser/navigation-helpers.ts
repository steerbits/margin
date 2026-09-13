import type { Page } from "@playwright/test";
export async function selectWorkspace(page: Page, id: string) {
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption("__all__");
  await page.locator(`[data-project-id="${id}"]`).click();
}
