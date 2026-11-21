import { describe, expect, it } from "vitest";
import { isDepositoryAccount } from "../../lib/bridge";
import { mockDashboard } from "../../mocks/data";
import { dashboardWithAccounts } from "../../test/wealthFixtures";
import { balanceStatus, buildWealthModel, quickRead } from "./wealthModel";

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
});
