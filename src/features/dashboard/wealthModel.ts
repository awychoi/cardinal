import {
  isDepositoryAccount,
  type AccountCard,
  type Dashboard,
  type MonthTotal,
  type SpendHistory,
} from "../../lib/bridge";
import { formatMoney } from "../../lib/formatting";

/**
 * Pure, presentation-level arithmetic for the wealth overview.
 *
 * The backend owns every financial total. This module only derives optional
 * context from figures that are already true in the dashboard response, and it
 * keeps "unknown" separate from zero: an account without a balance never
 * becomes a $0.00 input to a ratio.
 */

export interface WealthModel {
  included: AccountCard[];
  cashAccounts: AccountCard[];
  cardAccounts: AccountCard[];
  /** Share of known cash + card debt that is cash, 0–100. Null when neither side is known. */
  cashShare: number | null;
  /** The average net spend of complete months that actually had activity. */
  typicalMonthMinor: number | null;
  /** Signed percentage difference between the selected month and the typical month. */
  pacePercent: number | null;
  /** How many typical months the known cash could cover. */
  cushionMonths: number | null;
  cashAfterUpcomingMinor: number | null;
  availableCreditMinor: number | null;
  creditLimitMinor: number | null;
  utilizationPercent: number | null;
  missingBalances: number;
  staleBalances: number;
  cashAccountCount: number;
  cardAccountCount: number;
  /** Counts aligned with the USD totals: other currencies are never summed in. */
  usdCashCount: number;
  usdCardCount: number;
  otherCurrencyCount: number;
}

export function typicalMonthMinor(months: MonthTotal[]): number | null {
  const active = months.filter((month) => month.complete && month.count > 0);
  if (active.length === 0) return null;
  return Math.round(active.reduce((sum, month) => sum + month.netMinor, 0) / active.length);
}

export function buildWealthModel(dashboard: Dashboard, history: SpendHistory | null): WealthModel {
  const { summary, overview } = dashboard;
  const included = overview.accounts.filter((account) => account.included);
  const cashAccounts = included.filter((account) => isDepositoryAccount(account.accountType));
  const cardAccounts = included.filter((account) => !isDepositoryAccount(account.accountType));
  const usdCashCount = cashAccounts.filter((account) => account.currency === "USD").length;
  const usdCardCount = cardAccounts.filter((account) => account.currency === "USD").length;
  const { balances } = overview;

  const knownTotal = balances.cashKnownTotalMinor + balances.cardKnownTotalMinor;
  const cashShare =
    knownTotal > 0 ? Math.round((balances.cashKnownTotalMinor / knownTotal) * 100) : null;

  const typical = history ? typicalMonthMinor(history.months) : null;
  const pacePercent =
    typical && typical > 0 && summary.eligibleCount > 0
      ? Math.round(((summary.netSpendingMinor - typical) / typical) * 100)
      : null;

  const cushionMonths =
    typical && typical > 0 && balances.cashKnownTotalMinor > 0
      ? balances.cashKnownTotalMinor / typical
      : null;

  const cashAfterUpcomingMinor =
    balances.cashKnownTotalMinor > 0
      ? balances.cashKnownTotalMinor - overview.upcoming.knownTotalMinor
      : null;

  const limited = cardAccounts.filter(
    (account) =>
      account.currency === "USD" &&
      account.currentBalanceMinor !== null &&
      account.creditLimitMinor !== null &&
      account.creditLimitMinor > 0,
  );
  const creditLimitMinor =
    limited.length > 0
      ? limited.reduce((sum, account) => sum + (account.creditLimitMinor ?? 0), 0)
      : null;
  const usedCreditMinor =
    limited.length > 0
      ? limited.reduce((sum, account) => sum + (account.currentBalanceMinor ?? 0), 0)
      : 0;
  const availableCreditMinor =
    limited.length > 0
      ? limited.reduce(
          (sum, account) =>
            sum +
            (account.availableCreditMinor ??
              Math.max((account.creditLimitMinor ?? 0) - (account.currentBalanceMinor ?? 0), 0)),
          0,
        )
      : null;
  const utilizationPercent =
    creditLimitMinor && creditLimitMinor > 0
      ? Math.round((usedCreditMinor / creditLimitMinor) * 100)
      : null;

  return {
    included,
    cashAccounts,
    cardAccounts,
    cashShare,
    typicalMonthMinor: typical,
    pacePercent,
    cushionMonths,
    cashAfterUpcomingMinor,
    availableCreditMinor,
    creditLimitMinor,
    utilizationPercent,
    missingBalances: balances.cardAccountsMissingBalance + balances.cashAccountsMissingBalance,
    staleBalances: included.filter((account) => account.balanceStale).length,
    cashAccountCount: cashAccounts.length,
    cardAccountCount: cardAccounts.length,
    usdCashCount,
    usdCardCount,
    otherCurrencyCount: balances.otherCurrency.length,
  };
}

export function quickRead(model: WealthModel, dashboard: Dashboard): string[] {
  const { overview, summary } = dashboard;
  const { balances } = overview;
  const items: string[] = [];
  const hasCash = model.cashAccountCount > 0;

  if (!hasCash) {
    items.push("No cash accounts yet. Add a bank account to see both sides of your net position.");
  } else if (model.cushionMonths !== null) {
    const months = model.cushionMonths;
    const phrase =
      months >= 10
        ? "more than 9 months"
        : months >= 1
          ? `about ${months.toFixed(1)} months`
          : "less than a month";
    items.push(`Cash covers ${phrase} of typical spending at your recent pace.`);
  } else if (balances.cashKnownTotalMinor > 0) {
    items.push(
      "Your cash is counted, but there is not enough posted activity yet to estimate a cushion.",
    );
  } else {
    items.push("Cash is not reported yet. A missing balance stays unknown, never $0.00.");
  }

  if (model.cardAccountCount > 0) {
    if (balances.cardKnownTotalMinor > balances.cashKnownTotalMinor) {
      items.push(
        `Card balances sit ${formatMoney(
          balances.cardKnownTotalMinor - balances.cashKnownTotalMinor,
        )} above known cash.`,
      );
    } else if (balances.cardKnownTotalMinor === 0) {
      items.push("No card debt reported. Your whole net position is cash.");
    }
  }

  if (overview.upcoming.entries.length > 0) {
    const count = overview.upcoming.entries.length;
    const unknown = overview.upcoming.unknownAmountCount;
    items.push(
      unknown > 0
        ? `${count} payment${count === 1 ? " is" : "s are"} due in the next ${
            overview.upcoming.windowDays
          } days; ${unknown} amount${unknown === 1 ? " is" : "s are"} not reported.`
        : `${count} payment${count === 1 ? " is" : "s are"} due in the next ${
            overview.upcoming.windowDays
          } days.`,
    );
  }

  if (model.pacePercent !== null) {
    const direction = model.pacePercent > 0 ? "above" : "below";
    const amount = Math.abs(model.pacePercent);
    items.push(
      `${monthLabelSafe(dashboard.month)} spending so far is ${amount}% ${direction} your typical active month.`,
    );
  }

  if (model.missingBalances > 0) {
    items.push(
      `${model.missingBalances} account${model.missingBalances === 1 ? " has" : "s have"} no balance snapshot, so the net position is partial.`,
    );
  } else if (summary.pendingSubtotalMinor > 0) {
    items.push(
      "Pending activity is shown apart from posted spending and never counted as ready to spend.",
    );
  }

  return items.slice(0, 3);
}

function monthLabelSafe(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString(undefined, {
    month: "long",
  });
}
