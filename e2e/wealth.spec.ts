import { expect, test } from "@playwright/test";
import { openPrimaryView, openSettingsSection, openUnlocked } from "./helpers";

test.describe("wealth view (browser mock)", () => {
  test("treats bank accounts as peers of cards on the balance sheet", async ({ page }) => {
    await openUnlocked(page);
    await openPrimaryView(page, "Accounts");

    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
    const summary = page.getByRole("region", { name: "Balance sheet summary" });
    await expect(summary).toContainText("Cash · USD");
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

  test("a missing-balance warning survives lock and navigation until restored", async ({
    page,
  }) => {
    await openUnlocked(page);
    await page.locator(".wealth-details > summary").click();
    const attention = page.locator(".overview-attention");
    await expect(attention.getByText("1 account is missing a balance")).toBeVisible();
    await attention.getByRole("button", { name: "Dismiss missing-balance warning" }).click();
    await expect(attention.getByText("1 account is missing a balance")).toHaveCount(0);
    await expect(attention.getByText(/Missing-balance warning dismissed/)).toBeVisible();

    await page.locator(".wealth-details > summary").click();
    await openPrimaryView(page, "Accounts");
    await openPrimaryView(page, "Overview");
    await page.locator(".wealth-details > summary").click();
    await expect(attention.getByText(/Missing-balance warning dismissed/)).toBeVisible();

    // The encrypted settings must keep the dismissal through a lock/unlock cycle.
    await page.getByRole("button", { name: "Lock now" }).click();
    await expect(page.getByText(/Your encrypted ledger is locked/)).toBeVisible();
    await page.getByRole("button", { name: "Unlock vault" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.locator(".wealth-details > summary").click();
    await expect(attention.getByText(/Missing-balance warning dismissed/)).toBeVisible();

    await attention.getByRole("button", { name: "Restore" }).click();
    await expect(attention.getByText("1 account is missing a balance")).toBeVisible();
  });

  test("deeper numbers stay one disclosure away", async ({ page }) => {
    await openUnlocked(page);
    const summary = page.locator(".wealth-details > summary");
    await expect(summary).toContainText("More details");
    await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
    await summary.click();
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.getByText("Last checked")).toBeVisible();
    await expect(page.getByText(/USD supplier and category totals reconcile/)).toBeVisible();
  });

  test("keeps status pills inside credit cards in the top-bar layout at 1100", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 });
    await openUnlocked(page);
    await openSettingsSection(page, "Appearance");
    await page
      .getByRole("group", { name: "Navigation layout" })
      .getByRole("button", { name: "Top bar" })
      .click();
    await expect(page.locator(".app")).toHaveAttribute("data-nav", "topbar");
    await openPrimaryView(page, "Accounts");
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();

    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".card-account"));
      const escapedPills = cards.reduce((count, card) => {
        const cardBox = card.getBoundingClientRect();
        return (
          count +
          Array.from(card.querySelectorAll<HTMLElement>(".status-pill")).filter((pill) => {
            const pillBox = pill.getBoundingClientRect();
            return pillBox.right > cardBox.right + 0.5 || pillBox.left < cardBox.left - 0.5;
          }).length
        );
      }, 0);
      const overflowingCards = cards.filter(
        (card) => card.scrollWidth > card.clientWidth + 1,
      ).length;
      return {
        pageOverflow: root.scrollWidth > root.clientWidth,
        escapedPills,
        overflowingCards,
        cardCount: cards.length,
      };
    });

    expect(layout.pageOverflow).toBe(false);
    expect(layout.escapedPills).toBe(0);
    expect(layout.overflowingCards).toBe(0);
    expect(layout.cardCount).toBeGreaterThan(0);
  });

  test("never turns a missing balance into $0.00", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/?mockOnboarding=1&mockAccounts=empty");
    await page.getByRole("button", { name: "Unlock vault" }).click();
    await expect(page.getByText("Connect your bank.")).toBeVisible();
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(page.getByText("Add your first account.")).toBeVisible();
    await page.getByRole("button", { name: "Add account" }).click();
    await page.getByRole("button", { name: "Add account manually" }).click();
    await page.getByLabel("Issuer").fill("Local Bank");
    await page.getByLabel("Display name").fill("Everyday Checking");
    await page.getByLabel("Account type").selectOption("checking");
    // Current balance is deliberately left blank.
    await page.getByRole("button", { name: "Add account" }).click();
    await expect(page.getByText("Everyday Checking", { exact: true }).first()).toBeVisible();
    await openPrimaryView(page, "Overview");

    const cashMini = page.locator(".hero-mini", { hasText: "Cash on hand" });
    await expect(cashMini).toContainText("Not reported");
    await expect(cashMini).toContainText("0 of 1 reported");
    await expect(cashMini).not.toContainText("$0.00");
    await expect(page.locator(".wealth-beam-labels")).toContainText("Cash Not reported");
    await expect(page.locator(".wealth-beam-labels")).not.toContainText("Cash $0.00");
    await expect(page.locator(".side-net-value")).toHaveText("—");
    await expect(page.locator(".side-net-split")).toContainText("Cash—");
    await expect(page.locator(".side-net-split")).not.toContainText("Cash$0.00");
    await expect(page.locator(".side-net-foot")).toContainText(/not reported/i);

    await openPrimaryView(page, "Accounts");
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
    const cashSide = page.locator(".sheet-side-cash");
    await expect(cashSide).toContainText("—");
    await expect(cashSide).toContainText("Not reported");
    await expect(cashSide).not.toContainText("$0.00");
    await expect(page.getByText(/No balance snapshot/).first()).toBeVisible();
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
