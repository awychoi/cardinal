import { describe, expect, it } from "vitest";
import type { AccountCard } from "../../lib/bridge";
import { dueText } from "./cardsPresentation";

const BASE: AccountCard = {
  accountId: "aaaaaaaa-0000-4000-8000-000000000001",
  issuer: "Chase",
  displayName: "Prime Visa",
  lastFour: "2054",
  currency: "USD",
  included: true,
  sourceKind: "provider",
  connectionStatus: "healthy",
  currentBalanceMinor: 5_536,
  availableCreditMinor: 900_000,
  creditLimitMinor: 1_000_000,
  balanceRetrievedAt: "2026-11-01T21:43:00Z",
  balanceProvenance: "provider",
  balanceAgeDays: 0,
  balanceStale: false,
  payment: {
    nextDueDate: "2026-11-09",
    estimatedNextDueDate: null,
    dueAmountMinor: 0,
    dueAmountKind: "reported_zero",
    dueSource: "provider",
    statementBalanceMinor: 2_176,
    statementBalanceSource: "provider",
    statementIssueDate: "2026-10-12",
    nextClosingDate: null,
    validThroughDate: null,
    manualExpired: false,
    retrievedAt: "2026-11-01T21:43:00Z",
  },
};

describe("dueText", () => {
  it("renders a reported date with the reported amount kind", () => {
    expect(dueText(BASE)).toBe("Nov 9, 2026 · $0.00 reported");
    expect(dueText(BASE, true)).toBe("Nov 9 · $0.00 reported");
  });

  it("never invents a minimum", () => {
    const noAmount = {
      ...BASE,
      payment: { ...BASE.payment, dueAmountMinor: null, dueAmountKind: "not_reported" },
    };
    expect(dueText(noAmount)).toBe("Nov 9, 2026 · amount not reported");
  });

  it("labels a rolled-forward past due date as an estimate without its stale minimum", () => {
    const stale = {
      ...BASE,
      payment: {
        ...BASE.payment,
        nextDueDate: "2026-10-26",
        estimatedNextDueDate: "2026-11-26",
        dueAmountMinor: 2_500,
        dueAmountKind: "minimum_due",
      },
    };
    expect(dueText(stale)).toBe("Est. Nov 26, 2026 · amount not reported");
    expect(dueText(stale, true)).toBe("Est. Nov 26 · amount not reported");
  });

  it("falls back to the amount when no date is known at all", () => {
    const noDate = {
      ...BASE,
      payment: {
        ...BASE.payment,
        nextDueDate: null,
        estimatedNextDueDate: null,
        dueAmountMinor: null,
        dueAmountKind: "no_due_date",
      },
    };
    expect(dueText(noDate)).toBe("No due date reported");
  });
});
