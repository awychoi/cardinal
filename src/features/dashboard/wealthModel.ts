import {
  isDepositoryAccount,
  type AccountCard,
  type Breakdown,
  type Dashboard,
  type MonthTotal,
  type SpendHistory,
} from "../../lib/bridge";

/**
 * Pure, presentation-level arithmetic for the wealth overview.
 *
 * The backend owns every financial total. This module only derives optional
 * context from figures that are already true in the dashboard response, and it
 * keeps "unknown" separate from zero: an account without a balance never
 * becomes a $0.00 input to a ratio.
 */

export type BalanceStatus = "empty" | "not_reported" | "partial" | "complete";

/**
 * What the USD net position can actually see. These are deliberately separate:
 * "no accounts at all" is onboarding, "all excluded" is a settings choice, and
 * "other currency only" is a currency-scope fact. Only the last one is a
 * foreign-currency story; none of them is a $0.00 position.
 */
export type UsdScope = "no_accounts" | "all_excluded" | "other_currency_only" | "usd";

/** The scope of one side of the balance sheet, independent of its USD totals. */
export type SideScope = "empty" | "all_excluded" | "other_currency_only" | "usd";

function sideScopeFor(accounts: AccountCard[]): SideScope {
  if (accounts.length === 0) return "empty";
  const included = accounts.filter((account) => account.included);
  if (included.length === 0) return "all_excluded";
  if (!included.some((account) => account.currency === "USD")) return "other_currency_only";
  return "usd";
}

/**
 * How complete a USD side of the balance sheet is. "not_reported" means the
 * accounts exist but none has a balance snapshot; a reported $0.00 is known
 * and therefore "complete".
 */
export function balanceStatus(accountCount: number, reportedCount: number): BalanceStatus {
  if (accountCount === 0) return "empty";
  if (reportedCount === 0) return "not_reported";
  return reportedCount < accountCount ? "partial" : "complete";
}

/** A total may be displayed whenever at least one account on the side reported. */
export function totalReported(status: BalanceStatus): boolean {
  return status !== "not_reported";
}

export interface WealthModel {
  included: AccountCard[];
  cashAccounts: AccountCard[];
  cardAccounts: AccountCard[];
  /** Share of known cash + card debt that is cash, 0–100. Null when a side is unreported. */
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
  /** True when the aggregate available credit omits cards without a known limit/balance. */
  availableCreditPartial: boolean;
  missingBalances: number;
  /** Included USD accounts without a balance snapshot; the net position's own gap. */
  usdMissingBalances: number;
  staleBalances: number;
  cashAccountCount: number;
  cardAccountCount: number;
  /** Counts aligned with the USD totals: other currencies are never summed in. */
  usdCashCount: number;
  usdCardCount: number;
  /** USD accounts that reported a balance, including a reported $0.00. */
  usdCashReportedCount: number;
  usdCardReportedCount: number;
  usdReportedCount: number;
  cashStatus: BalanceStatus;
  cardStatus: BalanceStatus;
  netStatus: BalanceStatus;
  usdScope: UsdScope;
  cashScope: SideScope;
  cardScope: SideScope;
  otherCurrencyCount: number;
}

export function typicalMonthMinor(months: MonthTotal[]): number | null {
  const active = months.filter((month) => month.complete && month.count > 0);
  if (active.length === 0) return null;
  return Math.round(active.reduce((sum, month) => sum + month.netMinor, 0) / active.length);
}

export interface TopCategorySignal {
  key: string;
  /** Gross posted spending in the category, excluding refunds. */
  grossMinor: number;
  /** Share of all gross category spending, rounded to a whole percent. */
  share: number;
  count: number;
}

/**
 * The category that took the largest share of posted gross spending this month.
 * The ranking mirrors the composition chart: gross spend, never refunds, and a
 * stable key tie-break so the card does not reshuffle between renders.
 */
export function topCategorySignal(categories: Breakdown[]): TopCategorySignal | null {
  const ranked = categories
    .filter((category) => category.grossMinor > 0)
    .sort((a, b) => b.grossMinor - a.grossMinor || a.key.localeCompare(b.key));
  if (ranked.length === 0) return null;
  const total = ranked.reduce((sum, category) => sum + category.grossMinor, 0);
  if (total <= 0) return null;
  const top = ranked[0];
  return {
    key: top.key,
    grossMinor: top.grossMinor,
    share: Math.round((top.grossMinor / total) * 100),
    count: top.count,
  };
}

export function buildWealthModel(dashboard: Dashboard, history: SpendHistory | null): WealthModel {
  const { summary, overview } = dashboard;
  const allCash = overview.accounts.filter((account) => isDepositoryAccount(account.accountType));
  const allCards = overview.accounts.filter((account) => !isDepositoryAccount(account.accountType));
  const included = overview.accounts.filter((account) => account.included);
  const cashAccounts = included.filter((account) => isDepositoryAccount(account.accountType));
  const cardAccounts = included.filter((account) => !isDepositoryAccount(account.accountType));
  const usdIncluded = included.filter((account) => account.currency === "USD");
  const usdCash = usdIncluded.filter((account) => isDepositoryAccount(account.accountType));
  const usdCards = usdIncluded.filter((account) => !isDepositoryAccount(account.accountType));
  const usdCashReportedCount = usdCash.filter(
    (account) => account.currentBalanceMinor !== null,
  ).length;
  const usdCardReportedCount = usdCards.filter(
    (account) => account.currentBalanceMinor !== null,
  ).length;
  const usdReportedCount = usdCashReportedCount + usdCardReportedCount;
  const usdMissingBalances = usdIncluded.length - usdReportedCount;
  const cashStatus = balanceStatus(usdCash.length, usdCashReportedCount);
  const cardStatus = balanceStatus(usdCards.length, usdCardReportedCount);
  const netStatus = balanceStatus(usdIncluded.length, usdReportedCount);
  const usdScope: UsdScope =
    overview.accounts.length === 0
      ? "no_accounts"
      : included.length === 0
        ? "all_excluded"
        : usdIncluded.length === 0
          ? "other_currency_only"
          : "usd";
  const { balances } = overview;

  // A side with no accounts is known to be $0.00. A side with accounts but no
  // balance snapshot is unknown, never a zero. The split only makes sense when
  // both sides are known; when the known total is zero, show an even split.
  const knownTotal = balances.cashKnownTotalMinor + balances.cardKnownTotalMinor;
  const cashShare =
    cashStatus === "not_reported" || cardStatus === "not_reported"
      ? null
      : knownTotal > 0
        ? Math.round((balances.cashKnownTotalMinor / knownTotal) * 100)
        : 50;

  const typical = history ? typicalMonthMinor(history.months) : null;
  const pacePercent =
    typical && typical > 0 && summary.eligibleCount > 0
      ? Math.round(((summary.netSpendingMinor - typical) / typical) * 100)
      : null;

  const cushionMonths =
    typical && typical > 0 && usdCashReportedCount > 0
      ? balances.cashKnownTotalMinor / typical
      : null;

  const cashAfterUpcomingMinor =
    usdCashReportedCount > 0
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
  // The aggregate covers only cards with both a known balance and a known
  // limit. Say so rather than presenting a partial subtotal as the whole.
  const limitedIds = new Set(limited.map((account) => account.accountId));
  const availableCreditPartial =
    usdCards.length > 0 && usdCards.some((account) => !limitedIds.has(account.accountId));

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
    availableCreditPartial,
    missingBalances: balances.cardAccountsMissingBalance + balances.cashAccountsMissingBalance,
    usdMissingBalances,
    staleBalances: included.filter((account) => account.balanceStale).length,
    cashAccountCount: cashAccounts.length,
    cardAccountCount: cardAccounts.length,
    usdCashCount: usdCash.length,
    usdCardCount: usdCards.length,
    usdCashReportedCount,
    usdCardReportedCount,
    usdReportedCount,
    cashStatus,
    cardStatus,
    netStatus,
    usdScope,
    cashScope: sideScopeFor(allCash),
    cardScope: sideScopeFor(allCards),
    otherCurrencyCount: balances.otherCurrency.length,
  };
}

export function quickRead(model: WealthModel, dashboard: Dashboard): string[] {
  const { overview, summary } = dashboard;
  const items: string[] = [];

  if (model.usdScope === "all_excluded") {
    items.push("All accounts are excluded from totals. Include one to see a net position.");
  } else if (model.usdScope === "other_currency_only") {
    items.push(
      "Only other-currency accounts are included; the USD net position has no accounts yet.",
    );
  } else if (model.cashScope === "empty") {
    items.push("No cash accounts yet. Add a bank account to see both sides of your net position.");
  } else if (model.cashScope === "all_excluded") {
    items.push("Cash accounts are excluded from totals. Include one to count it.");
  } else if (model.cashScope === "other_currency_only" || model.usdCashCount === 0) {
    items.push("Cash is only reported in other currencies and stays outside the USD net position.");
  } else if (model.cushionMonths !== null) {
    const months = model.cushionMonths;
    const phrase =
      months >= 10
        ? "more than 9 months"
        : months >= 1
          ? `about ${months.toFixed(1)} months`
          : "less than a month";
    items.push(
      `${model.cashStatus === "partial" ? "Known cash" : "Cash"} covers ${phrase} of typical spending at your recent pace.`,
    );
  } else if (model.usdCashReportedCount > 0) {
    items.push(
      "Your cash is counted, but there is not enough posted activity yet to estimate a cushion.",
    );
  } else {
    items.push("Cash is not reported yet. A missing balance stays unknown, never $0.00.");
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
    const current = dashboard.month === dashboard.currentMonth;
    items.push(
      `${monthLabelSafe(dashboard.month)} spending ${
        current ? "so far is" : "was"
      } ${amount}% ${direction} your typical full active month.`,
    );
  }

  if (summary.pendingSubtotalMinor > 0) {
    items.push(
      "Pending activity is shown apart from posted spending and never counted as ready to spend.",
    );
  }

  // Completeness and the cash-versus-card arithmetic live once, in the hero and
  // the balance sheet. The quick read adds interpretation, not a second count.
  return items.slice(0, 3);
}

function monthLabelSafe(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString(undefined, {
    month: "long",
  });
}
