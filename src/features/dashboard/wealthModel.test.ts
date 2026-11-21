import { describe, expect, it } from "vitest";
import { isDepositoryAccount } from "../../lib/bridge";
import { mockDashboard, mockSpendHistory } from "../../mocks/data";
import { dashboardWithAccounts } from "../../test/wealthFixtures";
import {
  balanceStatus,
  buildWealthModel,
  quickRead,
  topCategorySignal,
  typicalMonthMinor,
} from "./wealthModel";

function accountCards(dashboard = mockDashboard("demo", "2026-10")) {
  return dashboard.overview.accounts;
}

function checkingCard(overrides: Partial<ReturnType<typeof accountCards>[number]> = {}) {
  const checking = accountCards().find(
    (account) => isDepositoryAccount(account.accountType) && account.currency === "USD",
  );
  if (!checking) throw new Error("fixture checking account missing");
  return { ...checking, accountId: "test-checking", displayName: "Local Checking", ...overrides };
}

function creditCard(overrides: Partial<ReturnType<typeof accountCards>[number]> = {}) {
  const card = accountCards().find(
    (account) => !isDepositoryAccount(account.accountType) && account.currency === "USD",
  );
  if (!card) throw new Error("fixture card missing");
  return { ...card, accountId: "test-card", displayName: "Local Card", ...overrides };
}

describe("balanceStatus", () => {
  it("separates an unreported side from a reported zero", () => {
    expect(balanceStatus(0, 0)).toBe("empty");
    expect(balanceStatus(1, 0)).toBe("not_reported");
    expect(balanceStatus(2, 1)).toBe("partial");
    expect(balanceStatus(2, 2)).toBe("complete");
    expect(balanceStatus(1, 1)).toBe("complete");
  });
});

describe("topCategorySignal", () => {
  it("ranks the largest gross category and reports its share", () => {
    const categories = mockDashboard("demo", "2026-10").summary.categories;
    const ranked = [...categories]
      .filter((category) => category.grossMinor > 0)
      .sort((a, b) => b.grossMinor - a.grossMinor || a.key.localeCompare(b.key));
    const signal = topCategorySignal(categories);

    expect(signal).not.toBeNull();
    expect(signal?.key).toBe(ranked[0].key);
    expect(signal?.grossMinor).toBe(ranked[0].grossMinor);
    expect(signal?.share).toBeGreaterThan(0);
    expect(signal?.share).toBeLessThanOrEqual(100);
  });

  it("returns null when nothing was spent", () => {
    expect(topCategorySignal([])).toBeNull();
    expect(
      topCategorySignal([{ key: "Dining", grossMinor: 0, refundsMinor: 0, netMinor: 0, count: 0 }]),
    ).toBeNull();
  });
});

describe("buildWealthModel", () => {
  it("keeps a missing balance unknown", () => {
    const dashboard = dashboardWithAccounts([checkingCard({ currentBalanceMinor: null })]);
    const model = buildWealthModel(dashboard, null);

    expect(model.cashStatus).toBe("not_reported");
    expect(model.usdCashReportedCount).toBe(0);
    expect(model.cashShare).toBeNull();
    expect(model.cashAfterUpcomingMinor).toBeNull();
  });

  it("treats a reported $0.00 as known", () => {
    const dashboard = dashboardWithAccounts([checkingCard({ currentBalanceMinor: 0 })]);
    const model = buildWealthModel(dashboard, null);

    expect(model.cashStatus).toBe("complete");
    expect(model.netStatus).toBe("complete");
    expect(model.usdCashReportedCount).toBe(1);
    expect(model.cashShare).toBe(50);
    expect(model.cashAfterUpcomingMinor).toBe(0);
  });

  it("calls a one-sided position complete when every existing balance reported", () => {
    const dashboard = dashboardWithAccounts([
      checkingCard({ currentBalanceMinor: 125_000 }),
      creditCard({ currentBalanceMinor: null, included: false }),
    ]);
    const model = buildWealthModel(dashboard, null);

    expect(model.cardStatus).toBe("empty");
    expect(model.netStatus).toBe("complete");
    expect(quickRead(model, dashboard).join(" ")).not.toMatch(/partial|some missing/);
  });

  it("does not call unreported card balances zero debt", () => {
    const dashboard = dashboardWithAccounts([
      checkingCard({ currentBalanceMinor: 50_000 }),
      creditCard({ currentBalanceMinor: null }),
    ]);
    const model = buildWealthModel(dashboard, null);

    expect(model.cardStatus).toBe("not_reported");
    expect(model.netStatus).toBe("partial");
    expect(quickRead(model, dashboard).join(" ")).not.toMatch(/No card debt reported/);
  });

  it("sums backend-provided available credit without recomputing it", () => {
    const model = buildWealthModel(mockDashboard("demo", "2026-10"), null);

    expect(model.availableCreditMinor).toBe(5_050_200);
  });

  it("keeps zero-filled months out of the typical-month average", () => {
    const typical = typicalMonthMinor([
      { month: "2026-07", grossMinor: 0, refundsMinor: 0, netMinor: 0, count: 0, complete: true },
      {
        month: "2026-08",
        grossMinor: 10_000,
        refundsMinor: 0,
        netMinor: 10_000,
        count: 2,
        complete: true,
      },
      {
        month: "2026-09",
        grossMinor: 30_000,
        refundsMinor: 0,
        netMinor: 30_000,
        count: 4,
        complete: true,
      },
    ]);
    expect(typical).toBe(20_000);
  });

  it("distinguishes all-excluded and other-currency-only scopes", () => {
    const base = accountCards();
    const checking = base.find(
      (account) => isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    const card = base.find(
      (account) => !isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    const eur = base.find((account) => account.currency === "EUR");
    if (!checking || !card || !eur) throw new Error("fixture accounts missing");

    expect(buildWealthModel(dashboardWithAccounts([eur]), null).usdScope).toBe(
      "other_currency_only",
    );
    expect(
      buildWealthModel(
        dashboardWithAccounts([
          { ...checking, included: false },
          { ...card, included: false },
        ]),
        null,
      ).usdScope,
    ).toBe("all_excluded");
  });

  it("labels a partial cushion as known cash and a partial limit aggregate", () => {
    const base = accountCards();
    const checking = base.find(
      (account) => isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    const card = base.find(
      (account) => !isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    if (!checking || !card) throw new Error("fixture accounts missing");
    const dashboard = dashboardWithAccounts([
      checking,
      {
        ...checking,
        accountId: "second-cash",
        displayName: "Second Cash",
        currentBalanceMinor: null,
      },
      card,
      {
        ...card,
        accountId: "no-limit-card",
        displayName: "No Limit Card",
        creditLimitMinor: null,
        availableCreditMinor: null,
      },
    ]);
    const history = { ...mockSpendHistory(12, "2026-10") };
    const model = buildWealthModel(dashboard, history);

    expect(model.cashStatus).toBe("partial");
    expect(quickRead(model, dashboard).join(" ")).toMatch(/Known cash covers/);
    expect(model.availableCreditPartial).toBe(true);
  });
});
