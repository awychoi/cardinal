import { expect, test } from "@playwright/test";
import { openAccountsTab, openPrimaryView, openSettingsSection, openUnlocked } from "./helpers";

test.describe("accessibility interactions (browser mock)", () => {
  test("opens a ledger detail from one row control and restores focus on Escape", async ({
    page,
  }) => {
    await openUnlocked(page);
    await openPrimaryView(page, "Transactions");

    const trigger = page
      .getByRole("button", { name: /^View details for Blue Bottle Coffee/ })
      .first();
    await trigger.focus();
    await page.keyboard.press("Enter");

    const panel = page.getByRole("region", { name: /Blue Bottle Coffee/ });
    await expect(panel).toBeVisible();
    await expect(page.locator("#detail-title")).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAttribute("aria-controls", "ledger-detail-panel");
    await expect(trigger.locator("xpath=ancestor::tr")).not.toHaveAttribute("tabindex");

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("skip link moves focus to main and view changes keep focus in content", async ({ page }) => {
    await openUnlocked(page);

    const skip = page.getByRole("link", { name: "Skip to content" });
    // Unlocking intentionally lands focus on main, so focus the bypass link
    // directly here; the real check is that focusing reveals it and Enter moves
    // focus to main.
    expect(await skip.evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(0);
    await skip.focus();
    await expect(skip).toBeFocused();
    await expect
      .poll(async () => skip.evaluate((element) => element.getBoundingClientRect().top))
      .toBeGreaterThanOrEqual(0);
    await skip.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await openPrimaryView(page, "Accounts");
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("announces the selected month and view in one polite live region", async ({ page }) => {
    await openUnlocked(page);
    const live = page.locator('.app > .sr-only[role="status"]');
    await expect(live).toHaveAttribute("aria-live", "polite");

    await openPrimaryView(page, "Accounts");
    await expect(live).toHaveText("Accounts");

    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(live).toHaveText("September 2026");
  });

  test("AccountForm surfaces field errors in an alert and focuses the first invalid field", async ({
    page,
  }) => {
    await openUnlocked(page);
    await openAccountsTab(page, "All accounts");
    await page.getByRole("button", { name: "Add account manually" }).click();
    await expect(page.locator("#accounts-title")).toHaveText("Add an account");
    await expect(page.locator("#accounts-title")).toBeFocused();
    await page.getByRole("button", { name: "Add account", exact: true }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Check these 2 fields before saving.");
    await expect(alert).toContainText("Enter the issuer, for example Chase.");
    await expect(alert).not.toContainText(/Too small|expected string/);

    const issuer = page.getByLabel("Issuer");
    await expect(issuer).toBeFocused();
    await expect(issuer).toHaveAttribute("aria-invalid", "true");
    await expect(issuer).toHaveAttribute("aria-describedby", "account-issuer-error");
    await expect(page.locator("#account-issuer-error")).toHaveText(
      "Enter the issuer, for example Chase.",
    );
    await expect(issuer).toHaveAttribute("required");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#accounts-title")).toHaveText("All accounts");
    await expect(page.locator("#accounts-title")).toBeFocused();
  });

  test("opens the deeper details with reduced motion and focus on the summary", async ({
    page,
  }) => {
    await openUnlocked(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      // Capture the scroll behavior the app requests without waiting for the
      // smooth animation (the mock browser has no real compositor here).
      const original = Element.prototype.scrollIntoView;
      (window as unknown as { __scrollCalls: unknown[] }).__scrollCalls = [];
      Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
        (window as unknown as { __scrollCalls: unknown[] }).__scrollCalls.push(options);
        return original?.call(this, options);
      };
    });
    await page.reload();
    await page.getByRole("button", { name: "Unlock vault" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    await page.getByRole("button", { name: "The numbers behind this →" }).click();
    const summary = page.locator(".wealth-details > summary");
    await expect(summary).toBeFocused();
    const calls = await page.evaluate(
      () => (window as unknown as { __scrollCalls: unknown[] }).__scrollCalls,
    );
    expect(calls).toContainEqual({ behavior: "auto", block: "start" });
  });

  test("keeps the filter bar from sliding under the wrapped topbar at 900", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 760 });
    await openUnlocked(page);
    await openSettingsSection(page, "Appearance");
    await page
      .getByRole("group", { name: "Navigation layout" })
      .getByRole("button", { name: "Top bar" })
      .click();
    await expect(page.locator(".app")).toHaveAttribute("data-nav", "topbar");
    await openPrimaryView(page, "Transactions");
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

    await page.locator(".ledger-table-wrap").evaluate((element) => {
      element.scrollTop = 320;
      element.dispatchEvent(new Event("scroll"));
    });
    const layout = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".header");
      const filter = document.querySelector<HTMLElement>(".filter-bar-sticky");
      if (!header || !filter) return null;
      const headerBox = header.getBoundingClientRect();
      const filterBox = filter.getBoundingClientRect();
      return {
        headerHeight: headerBox.height,
        filterTop: filterBox.top,
        position: getComputedStyle(filter).position,
        overlap: filterBox.top < headerBox.bottom,
      };
    });
    expect(layout).not.toBeNull();
    expect(layout!.headerHeight).toBeGreaterThan(70);
    expect(layout!.position).toBe("static");
    expect(layout!.overlap).toBe(false);
  });
});
