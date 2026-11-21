import { expect, test } from "@playwright/test";
import { openPrimaryView, openUnlocked } from "./helpers";

test.describe("wealth view (browser mock)", () => {
  test("treats bank accounts as peers of cards on the balance sheet", async ({ page }) => {
    await openUnlocked(page);
    await openPrimaryView(page, "Accounts");

    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
    const summary = page.getByRole("region", { name: "Balance sheet summary" });
    await expect(summary).toContainText("Cash you own");
    await expect(summary).toContainText("Card balances");
    await expect(summary).toContainText("Net position");

    const bankHeading = page.getByRole("heading", { name: "Bank accounts" });
    const cardHeading = page.getByRole("heading", { name: "Credit cards" });
    await expect(bankHeading).toBeVisible();
    await expect(cardHeading).toBeVisible();
    const bankBox = await bankHeading.boundingBox();
    const cardBox = await cardHeading.boundingBox();
    expect(bankBox?.y ?? 0).toBeLessThan(cardBox?.y ?? 0);

    await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();
    await page.locator(".account-details > summary").click();
    await expect(page.getByRole("heading", { name: "Cash accounts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Card accounts" })).toBeVisible();
  });

  test("deeper numbers stay one disclosure away", async ({ page }) => {
    await openUnlocked(page);
    const summary = page.locator(".wealth-details > summary");
    await expect(summary).toContainText("The deeper picture");
    await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
    await summary.click();
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.getByText("Last checked")).toBeVisible();
    await expect(page.getByText(/Supplier and category totals reconcile/)).toBeVisible();
  });

  test("keeps the balance sheet readable when the window is narrower", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 });
    await openUnlocked(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await openPrimaryView(page, "Accounts");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await expect(page.getByRole("heading", { name: "Bank accounts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Credit cards" })).toBeVisible();
  });
});
