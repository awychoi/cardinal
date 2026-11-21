import type { CSSProperties } from "react";
import {
  accountTypeLabel,
  isDepositoryAccount,
  type AccountCard,
  type Dashboard,
} from "../../lib/bridge";
import {
  connectionLabel,
  formatDateOnly,
  formatMoney,
  formatSignedMoney,
  monthLabel,
} from "../../lib/formatting";
import { issuerVariables } from "../../theme/tokens";
import type { Theme } from "../../theme/schema";
import { AccountKindIcon } from "../../components/AccountKindIcon";
import { Button } from "../../components/Button";
import { dueText } from "./cardsPresentation";
import "./accounts.css";

type CardStatus = "ok" | "warn" | "fail" | "info";

function statusFor(account: AccountCard): CardStatus {
  if (account.sourceKind === "manual") return "info";
  if (account.connectionStatus === "healthy") return "ok";
  if (account.connectionStatus === "error") return "fail";
  return "warn";
}

function modelUsdCardCount(accounts: AccountCard[]): number {
  return accounts.filter((account) => account.currency === "USD").length;
}

function statusClass(status: CardStatus): string {
  return `status-pill status-${status === "ok" ? "ok" : status === "fail" ? "fail" : status === "info" ? "info" : "warn"}`;
}

function balanceText(account: AccountCard): string {
  return account.currentBalanceMinor === null
    ? "Unknown"
    : formatMoney(account.currentBalanceMinor, account.currency);
}

function balanceAsOf(account: AccountCard): string {
  if (account.currentBalanceMinor === null) return "No balance snapshot — unknown, not $0.00";
  return `as of ${
    account.balanceRetrievedAt ? formatDateOnly(account.balanceRetrievedAt.slice(0, 10)) : "unknown"
  }${account.balanceStale ? " · stale" : ""}`;
}

/** A single compact row for the full details disclosure. */
function DetailRows({
  accounts,
  kind,
  spendFor,
}: {
  accounts: AccountCard[];
  kind: "cash" | "card";
  spendFor: (account: AccountCard) => number | null;
}) {
  return (
    <table className="detail-table">
      <thead>
        <tr>
          <th scope="col">{kind === "cash" ? "Account" : "Card"}</th>
          <th scope="col">Month spend</th>
          <th scope="col">Current balance</th>
          <th scope="col">As of</th>
          <th scope="col">Source</th>
          <th scope="col">{kind === "cash" ? "Type" : "Next due"}</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => (
          <tr key={account.accountId}>
            <th scope="row" className="detail-card">
              {account.displayName}
              <span className="fine-print"> · •••• {account.lastFour ?? "----"}</span>
            </th>
            <td>
              {spendFor(account) === null
                ? "—"
                : formatMoney(spendFor(account) ?? 0, account.currency)}
            </td>
            <td>{balanceText(account)}</td>
            <td>
              {account.balanceRetrievedAt
                ? formatDateOnly(account.balanceRetrievedAt.slice(0, 10))
                : "Unknown"}
              {account.balanceStale ? " · stale" : ""}
            </td>
            <td>{connectionLabel(account.connectionStatus, account.sourceKind)}</td>
            <td>{kind === "cash" ? accountTypeLabel(account.accountType) : dueText(account)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AccountsView({
  dashboard,
  theme,
  onFilterAccount,
  onAddAccount,
}: {
  dashboard: Dashboard;
  theme: Theme;
  onFilterAccount: (accountId: string) => void;
  onAddAccount: () => void;
}) {
  const accounts = dashboard.overview.accounts;
  const included = accounts.filter((account) => account.included);
  const cashAccounts = accounts.filter((account) => isDepositoryAccount(account.accountType));
  const cardAccounts = accounts.filter((account) => !isDepositoryAccount(account.accountType));
  const includedCash = included.filter((account) => isDepositoryAccount(account.accountType));
  const includedCards = included.filter((account) => !isDepositoryAccount(account.accountType));
  const { balances } = dashboard.overview;
  const faces = theme.options.cardArt === "faces";
  const spendByAccount = new Map<string, number>(
    dashboard.accountSpend.map(
      (row) => [`${row.accountId}|${row.currency}`, row.netMinor] as const,
    ),
  );
  const spendFor = (account: AccountCard): number | null =>
    spendByAccount.get(`${account.accountId}|${account.currency}`) ?? null;

  if (accounts.length === 0) {
    return (
      <section className="dashboard accounts-view" aria-labelledby="accounts-title">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Balance sheet</p>
            <h1 id="accounts-title">Accounts</h1>
            <p className="muted">Cash and card debt, side by side.</p>
          </div>
        </header>
        <div className="accounts-empty">
          <h2>No accounts yet.</h2>
          <p className="muted">
            Add a bank account to track cash, or a card to track what you borrow.
          </p>
          <Button variant="primary" onClick={onAddAccount}>
            Add account
          </Button>
        </div>
      </section>
    );
  }

  const net = balances.netPositionMinor;
  const known = balances.cashKnownTotalMinor + balances.cardKnownTotalMinor;
  const cashShare = known > 0 ? Math.round((balances.cashKnownTotalMinor / known) * 100) : 50;

  return (
    <section className="dashboard accounts-view" aria-labelledby="accounts-title">
      <header className="page-heading accounts-heading">
        <div>
          <p className="eyebrow">Balance sheet</p>
          <h1 id="accounts-title">Accounts</h1>
          <p className="muted">
            Everything you own and owe. {monthLabel(dashboard.month)} spending is shown next to each
            account.
          </p>
        </div>
        <div className="heading-actions">
          <Button variant="primary" onClick={onAddAccount}>
            Add account
          </Button>
        </div>
      </header>

      <section className="sheet-summary" aria-label="Balance sheet summary">
        <div className="sheet-side sheet-side-cash">
          <span className="sheet-side-label">
            <AccountKindIcon kind="cash" /> Cash you own
          </span>
          <strong className="sheet-side-value">{formatMoney(balances.cashKnownTotalMinor)}</strong>
          <span className="sheet-side-note">
            {includedCash.length} account{includedCash.length === 1 ? "" : "s"}
            {balances.cashComplete ? " · all reported" : " · some missing"}
          </span>
        </div>

        <div className="sheet-net">
          <span className="eyebrow">Net position</span>
          <strong className={`sheet-net-value${net < 0 ? " is-negative" : ""}`}>
            {formatSignedMoney(net)}
          </strong>
          <div
            className="sheet-net-bar"
            role="img"
            aria-label={`Cash ${formatMoney(
              balances.cashKnownTotalMinor,
            )} and card balances ${formatMoney(balances.cardKnownTotalMinor)}`}
          >
            <span style={{ width: `${cashShare}%` }} />
            <span style={{ width: `${100 - cashShare}%` }} />
          </div>
          <span className="sheet-side-note">
            {balances.netPositionComplete
              ? "Cash minus card balances"
              : "Known balances only — some are missing"}
          </span>
        </div>

        <div className="sheet-side sheet-side-debt">
          <span className="sheet-side-label">
            <AccountKindIcon kind="card" /> Card balances
          </span>
          <strong className="sheet-side-value">{formatMoney(balances.cardKnownTotalMinor)}</strong>
          <span className="sheet-side-note">
            {includedCards.length} card{includedCards.length === 1 ? "" : "s"} tracked ·{" "}
            {balances.cardAccountsWithBalance}/{modelUsdCardCount(includedCards)} USD reported
          </span>
        </div>
      </section>

      <section className="account-group" aria-labelledby="bank-accounts-title">
        <header className="account-group-head">
          <div>
            <p className="eyebrow">The cash side</p>
            <h2 id="bank-accounts-title" className="account-group-title">
              Bank accounts
            </h2>
          </div>
          <strong className="account-group-total">
            {formatMoney(balances.cashKnownTotalMinor)}
          </strong>
        </header>

        {cashAccounts.length > 0 ? (
          <div className="bank-grid">
            {cashAccounts.map((account) => {
              const spend = spendFor(account);
              return (
                <button
                  type="button"
                  key={account.accountId}
                  className="bank-card"
                  onClick={() => onFilterAccount(account.accountId)}
                  aria-label={`Filter transactions to ${account.displayName}`}
                >
                  <span className="bank-card-top">
                    <span className="bank-kind">
                      <AccountKindIcon kind="cash" />
                      {accountTypeLabel(account.accountType)}
                    </span>
                    <span className={statusClass(statusFor(account))}>
                      <span className="status-dot" aria-hidden="true" />
                      {connectionLabel(account.connectionStatus, account.sourceKind)}
                    </span>
                  </span>
                  <span className="bank-card-name">{account.displayName}</span>
                  <span className="bank-card-mask">
                    {account.issuer}
                    {account.lastFour ? ` · •••• ${account.lastFour}` : ""}
                  </span>
                  <span className="bank-card-balance">{balanceText(account)}</span>
                  <span className="bank-card-asof">{balanceAsOf(account)}</span>
                  <span className="bank-card-rule" aria-hidden="true" />
                  <span className="bank-card-stats">
                    <span>
                      <small>Spent this month</small>
                      {spend === null ? "—" : formatMoney(spend, account.currency)}
                    </span>
                    <span>
                      <small>In net position</small>
                      {account.included ? "Yes" : "No"}
                    </span>
                  </span>
                  <span className="bank-card-note">
                    Cash, not an amount due. Transfers, payments, and income are excluded from
                    spending.
                  </span>
                  <span className="bank-card-cta">View activity →</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="account-empty-card">
            <div>
              <strong>Add your cash side.</strong>
              <p>
                A checking or savings account makes your net position complete — and gives the
                spending numbers a place to land.
              </p>
            </div>
            <Button variant="secondary" onClick={onAddAccount}>
              Add a bank account
            </Button>
          </div>
        )}

        <p className="fine-print account-group-note">
          Bank balances are cash. A missing balance is unknown, never $0.00. Debit purchases count
          toward the month&apos;s spending; transfers, card payments, and income do not.
        </p>
      </section>

      <section className="account-group" aria-labelledby="credit-accounts-title">
        <header className="account-group-head">
          <div>
            <p className="eyebrow">The borrowed side</p>
            <h2 id="credit-accounts-title" className="account-group-title">
              Credit cards
            </h2>
          </div>
          <strong className="account-group-total">
            {formatMoney(balances.cardKnownTotalMinor)}
          </strong>
        </header>

        {cardAccounts.length > 0 ? (
          <div
            className={`card-accounts${faces ? " card-accounts-faces" : " card-accounts-tiles"}`}
          >
            {cardAccounts.map((account) => {
              const spend = spendFor(account);
              const limit = account.creditLimitMinor;
              const balance = account.currentBalanceMinor;
              const used =
                limit && limit > 0 && balance !== null
                  ? Math.min(100, Math.max(0, Math.round((balance / limit) * 100)))
                  : null;
              return (
                <button
                  type="button"
                  key={account.accountId}
                  className="card-account"
                  style={issuerVariables(theme, account.issuer) as CSSProperties}
                  onClick={() => onFilterAccount(account.accountId)}
                  aria-label={`Filter transactions to ${account.displayName}`}
                >
                  <span className="card-account-chip" aria-hidden="true">
                    <span className="card-account-chip-mark" />
                    <span className="card-account-chip-issuer">{account.issuer}</span>
                    <span className="card-account-chip-last">
                      •••• {account.lastFour ?? "----"}
                    </span>
                  </span>
                  <span className="card-account-body">
                    <span className="card-account-head">
                      <span>
                        <span className="card-account-name">{account.displayName}</span>
                        <span className="card-account-issuer">
                          {account.issuer}
                          {account.lastFour ? ` · •••• ${account.lastFour}` : ""}
                        </span>
                      </span>
                      <span className={statusClass(statusFor(account))}>
                        <span className="status-dot" aria-hidden="true" />
                        {connectionLabel(account.connectionStatus, account.sourceKind)}
                      </span>
                    </span>

                    <span className="card-account-balance-row">
                      <span>
                        <small>Current balance</small>
                        <strong>{balanceText(account)}</strong>
                      </span>
                      <span>
                        <small>Spent this month</small>
                        <strong>
                          {spend === null ? "—" : formatMoney(spend, account.currency)}
                        </strong>
                      </span>
                    </span>

                    <span className="card-account-util">
                      <span className="card-account-util-head">
                        <small>
                          {used === null
                            ? "Limit not reported"
                            : `${used}% of ${formatMoney(limit ?? 0, account.currency)} limit`}
                        </small>
                        {account.availableCreditMinor !== null ? (
                          <small>
                            {formatMoney(account.availableCreditMinor, account.currency)} available
                          </small>
                        ) : null}
                      </span>
                      <span className="card-account-track" aria-hidden="true">
                        <span style={{ width: `${used ?? 0}%` }} />
                      </span>
                    </span>

                    <span className="card-account-foot">
                      <span>{dueText(account, true)}</span>
                      {account.payment.dueSource === "manual" ? (
                        <span className="fine-print card-manual-source">
                          Due source: manual
                          {account.payment.manualExpired ? " · expired" : ""}
                        </span>
                      ) : (
                        <span
                          className={account.balanceStale ? "fine-print card-stale" : "fine-print"}
                        >
                          {account.balanceStale ? "Balance may be stale" : balanceAsOf(account)}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="account-empty-card">
            <div>
              <strong>No cards tracked.</strong>
              <p>Add one if you want to see borrowing beside your cash.</p>
            </div>
            <Button variant="secondary" onClick={onAddAccount}>
              Add a card
            </Button>
          </div>
        )}
        <p className="fine-print account-group-note">
          A statement balance is not the remaining amount due. Missing values are never shown as
          $0.00. A due date that has already passed is rolled forward a month and marked{" "}
          <strong>Est.</strong> — its reported minimum belongs to the earlier cycle, so it is not
          carried over.
        </p>
      </section>

      <details className="account-details">
        <summary>
          <span>
            <span className="eyebrow">For the spreadsheet brain</span>
            <strong>The full account table</strong>
          </span>
          <span className="account-details-open">Open tables</span>
          <span className="account-details-close">Close</span>
        </summary>
        <div className="account-details-body">
          <div className="table-wrap">
            <h3>Cash accounts</h3>
            <DetailRows accounts={cashAccounts} kind="cash" spendFor={spendFor} />
          </div>
          <div className="table-wrap">
            <h3>Card accounts</h3>
            <DetailRows accounts={cardAccounts} kind="card" spendFor={spendFor} />
          </div>
        </div>
      </details>
    </section>
  );
}
