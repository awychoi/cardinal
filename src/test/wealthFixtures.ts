import { isDepositoryAccount, type AccountCard, type Dashboard } from "../lib/bridge";
import { mockDashboard } from "../mocks/data";

/**
 * A dashboard for presentation tests whose account cards and USD totals agree.
 *
 * `mockDashboard` owns the shipped fixture arithmetic; this helper only swaps
 * the account list and recomputes the same USD-only totals so tests can model
 * missing, zero, and excluded balances without touching production code.
 */
export function dashboardWithAccounts(accounts: AccountCard[]): Dashboard {
  const base = mockDashboard("real", "2026-10");
  const included = accounts.filter((account) => account.included);
  const usd = included.filter((account) => account.currency === "USD");
  const cash = usd.filter((account) => isDepositoryAccount(account.accountType));
  const cards = usd.filter((account) => !isDepositoryAccount(account.accountType));
  const cashReported = cash.filter((account) => account.currentBalanceMinor !== null);
  const cardReported = cards.filter((account) => account.currentBalanceMinor !== null);
  const cashTotal = cashReported.reduce(
    (sum, account) => sum + (account.currentBalanceMinor ?? 0),
    0,
  );
  const cardTotal = cardReported.reduce(
    (sum, account) => sum + (account.currentBalanceMinor ?? 0),
    0,
  );
  const upcoming: Dashboard["overview"]["upcoming"] = {
    ...base.overview.upcoming,
    entries: [],
    knownTotalMinor: 0,
    unknownAmountCount: 0,
    nonUsdEntryCount: 0,
    complete: true,
  };

  return {
    ...base,
    overview: {
      accounts,
      balances: {
        cardKnownTotalMinor: cardTotal,
        cardAccountsWithBalance: cardReported.length,
        cardAccountsMissingBalance: cards.length - cardReported.length,
        cardComplete: cards.length > 0 && cardReported.length === cards.length,
        cashKnownTotalMinor: cashTotal,
        cashAccountsWithBalance: cashReported.length,
        cashAccountsMissingBalance: cash.length - cashReported.length,
        cashComplete: cash.length > 0 && cashReported.length === cash.length,
        netPositionMinor: cashTotal - cardTotal,
        netPositionComplete:
          cards.length + cash.length > 0 &&
          cardReported.length === cards.length &&
          cashReported.length === cash.length,
        otherCurrency: [],
      },
      upcoming,
    },
  };
}
