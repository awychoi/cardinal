import { afterEach, describe, expect, it } from "vitest";
import {
  createMockAccount,
  mockAccounts,
  mockDashboard,
  mockLedger,
  mockSpendHistory,
  resetMockData,
  updateMockAccount,
} from "./data";

const OCTOBER = { startDate: "2026-10-01", endDateExclusive: "2026-11-01" };
const EUR_ACCOUNT = "aaaaaaaa-0000-4000-8000-000000000007";

afterEach(() => {
  resetMockData();
});

describe("mock ledger subtotals", () => {
  it("keeps currencies separate and puts USD first", () => {
    const page = mockLedger({ ...OCTOBER, pageSize: 200 });
    expect(page.subtotals.map((item) => item.currency)).toEqual(["USD", "EUR"]);

    const eur = page.subtotals.find((item) => item.currency === "EUR");
    expect(eur).toMatchObject({
      eligibleMinor: 13_800,
      pendingMinor: 0,
      eligibleCount: 4,
      pendingCount: 0,
    });
    expect(page.rowCount).toBeGreaterThan(0);
  });

  it("keeps a foreign-currency account's subtotal when filtered", () => {
    const page = mockLedger({
      ...OCTOBER,
      accountIds: [EUR_ACCOUNT],
      pageSize: 200,
    });
    expect(page.subtotals).toHaveLength(1);
    expect(page.subtotals[0]).toMatchObject({
      currency: "EUR",
      eligibleMinor: 13_800,
      eligibleCount: 4,
    });
  });
});

describe("mock demo balances", () => {
  it("keeps available credit consistent with each card's limit and balance", () => {
    const dashboard = mockDashboard("demo", "2026-10");
    const cards = dashboard.overview.accounts.filter(
      (account) => account.availableCreditMinor !== null,
    );
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.availableCreditMinor).toBe(
        (card.creditLimitMinor ?? 0) - (card.currentBalanceMinor ?? 0),
      );
    }
    const usdCards = cards.filter(
      (card) => card.currency === "USD" && card.currentBalanceMinor !== null,
    );
    expect(usdCards.reduce((sum, card) => sum + (card.availableCreditMinor ?? 0), 0)).toBe(
      5_050_200,
    );
  });
});

describe("mock spend history", () => {
  it("ends at the current month and reconciles with the dashboard", () => {
    const history = mockSpendHistory();
    expect(history.currency).toBe("USD");
    expect(history.startMonth).toBe("2025-11");
    expect(history.endMonth).toBe("2026-10");
    expect(history.months).toHaveLength(12);

    const last = history.months[11];
    expect(last.month).toBe("2026-10");
    expect(last.complete).toBe(false);
    expect(last.netMinor).toBe(mockDashboard("demo", "2026-10").summary.netSpendingMinor);
    expect(last.grossMinor - last.refundsMinor).toBe(last.netMinor);

    expect(history.months[0]).toMatchObject({
      month: "2025-11",
      grossMinor: 0,
      refundsMinor: 0,
      netMinor: 0,
      count: 0,
      complete: true,
    });
  });

  it("moves the window with the selected end month", () => {
    const history = mockSpendHistory(6, "2026-09");
    expect(history.startMonth).toBe("2026-04");
    expect(history.endMonth).toBe("2026-09");
    expect(history.months).toHaveLength(6);
    expect(history.months[5].netMinor).toBe(
      mockDashboard("demo", "2026-09").summary.netSpendingMinor,
    );
    expect(history.months[5].complete).toBe(true);
  });

  it("rejects an out-of-range window", () => {
    expect(() => mockSpendHistory(0)).toThrowError(/invalid|months/i);
    expect(() => mockSpendHistory(25)).toThrowError(/invalid|months/i);
  });
});

describe("mock month row counts", () => {
  it("counts all visible rows while keeping other currencies as a subset", () => {
    const dashboard = mockDashboard("demo", "2026-10");
    const page = mockLedger({ ...OCTOBER, pageSize: 200 });

    expect(dashboard.summary.rowCount).toBe(30);
    expect(dashboard.summary.otherCurrencyRowCount).toBe(4);
    // rowCount is the whole month, not USD + other currency added twice.
    expect(page.rowCount).toBe(dashboard.summary.rowCount);
    expect(dashboard.summary.rowCount).toBeGreaterThan(dashboard.summary.otherCurrencyRowCount);
    // Pending rows are all currencies, matching the Rust summary query.
    expect(dashboard.summary.pendingCount).toBe(2);
  });
});

describe("mock account edits", () => {
  it("keeps a non-USD account in its currency and preserves USD totals", () => {
    const before = mockDashboard("demo", "2026-10");
    const eur = mockAccounts().find((account) => account.id === EUR_ACCOUNT);
    if (!eur) throw new Error("EUR fixture missing");
    const availableBefore = before.overview.accounts.reduce(
      (sum, account) => sum + (account.availableCreditMinor ?? 0),
      0,
    );

    const updated = updateMockAccount(eur.id, {
      issuer: eur.issuer,
      displayName: eur.displayName,
      lastFour: eur.lastFour,
      accountType: eur.accountType,
      currency: eur.currency,
      creditLimit: eur.creditLimitMinor !== null ? (eur.creditLimitMinor / 100).toFixed(2) : null,
      currentBalance: null,
      includeInOverview: eur.includeInOverview,
    });
    expect(updated.currency).toBe("EUR");

    const after = mockDashboard("demo", "2026-10");
    expect(after.overview.balances.cardKnownTotalMinor).toBe(
      before.overview.balances.cardKnownTotalMinor,
    );
    expect(after.overview.balances.netPositionMinor).toBe(
      before.overview.balances.netPositionMinor,
    );
    expect(after.overview.balances.otherCurrency).toEqual(before.overview.balances.otherCurrency);
    expect(
      after.overview.accounts.reduce(
        (sum, account) => sum + (account.availableCreditMinor ?? 0),
        0,
      ),
    ).toBe(availableBefore);
  });

  it("shows a manual card limit and derives available credit from it", () => {
    const created = createMockAccount({
      issuer: "Local Credit Union",
      displayName: "Travel Card",
      lastFour: "9999",
      accountType: "credit_card",
      currency: "USD",
      creditLimit: "7,500.00",
      currentBalance: null,
      includeInOverview: true,
    });
    expect(created.creditLimitMinor).toBe(750_000);

    const card = mockDashboard("demo", "2026-10").overview.accounts.find(
      (account) => account.accountId === created.id,
    );
    expect(card?.creditLimitMinor).toBe(750_000);
    // No balance snapshot: available credit stays unknown rather than zero.
    expect(card?.availableCreditMinor).toBeNull();

    updateMockAccount(created.id, {
      issuer: created.issuer,
      displayName: created.displayName,
      lastFour: created.lastFour,
      accountType: created.accountType,
      currency: created.currency,
      creditLimit: "9000.00",
      currentBalance: null,
      includeInOverview: true,
    });
    const edited = mockDashboard("demo", "2026-10").overview.accounts.find(
      (account) => account.accountId === created.id,
    );
    expect(edited?.creditLimitMinor).toBe(900_000);
  });

  it("rejects malformed amounts instead of storing NaN", () => {
    const payload = {
      issuer: "Chase",
      displayName: "Bad Amount",
      lastFour: null,
      accountType: "credit_card" as const,
      currency: "USD",
      creditLimit: "1,2,3",
      currentBalance: null,
      includeInOverview: true,
    };
    expect(() => createMockAccount(payload)).toThrowError(/invalid amount/i);
    expect(() =>
      createMockAccount({ ...payload, creditLimit: "1000", currentBalance: "NaN" }),
    ).toThrowError(/invalid amount/i);
    expect(() =>
      createMockAccount({ ...payload, creditLimit: "0", currentBalance: null }),
    ).toThrowError(/invalid credit limit/i);
  });
});
