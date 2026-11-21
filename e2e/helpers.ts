import { expect, type Page } from "@playwright/test";

export async function openLocked(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByText(/Your encrypted ledger is locked/)).toBeVisible();
}

export async function openUnlocked(page: Page): Promise<void> {
  await openLocked(page);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

/** Click a view in the primary sidebar/tab bar, even when a settings section
 * has a control with the same label. */
export async function openPrimaryView(page: Page, name: string): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name, exact: true }).click();
}

/**
 * Settings renders one section at a time. Tests must navigate to the section
 * that owns a control before interacting with it.
 */
export async function openSettingsSection(page: Page, section: string): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsNav = page.getByRole("navigation", { name: "Settings sections" });
  const item = settingsNav.getByRole("button", { name: section, exact: true });
  await item.click();
  await expect(item).toHaveAttribute("aria-current", "page");
}

/**
 * Accounts groups cards, bank accounts, connections, and CSV imports into one section
 * with sub-tabs.
 */
export async function openAccountsTab(
  page: Page,
  tab: "All accounts" | "Bank connections" | "CSV import",
): Promise<void> {
  await openSettingsSection(page, "Accounts");
  const item = page.getByRole("tab", { name: tab, exact: true });
  await item.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
}
