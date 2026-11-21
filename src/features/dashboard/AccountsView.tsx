import type { CSSProperties } from "react";
import {
  accountTypeLabel,
  isDepositoryAccount,
  type Dashboard,
  type AccountCard,
} from "../../lib/bridge";
import { connectionLabel, formatDateOnly, formatMoney, monthLabel } from "../../lib/formatting";
import { issuerVariables } from "../../theme/tokens";
import type { Theme } from "../../theme/schema";
import { dueText } from "./cardsPresentation";

type CardStatus = "ok" | "warn" | "fail" | "info";

function statusFor(account: AccountCard): CardStatus {
  if (account.sourceKind === "manual") return "info";
  if (account.connectionStatus === "healthy") return "ok";
  if (account.connectionStatus === "error") return "fail";
  return "warn";
}

export function AccountsView({
  dashboard,
  theme,
  onFilterAccount,
}: {
  dashboard: Dashboard;
  theme: Theme;
  onFilterAccount: (accountId: string) => void;
}) {
  const accounts = dashboard.overview.accounts;
  const creditAccounts = accounts.filter((account) => !isDepositoryAccount(account.accountType));
  const bankAccounts = accounts.filter((account) => isDepositoryAccount(account.accountType));
  const spendFor = (accountId: string, currency: string) =>
    dashboard.accountSpend.find((row) => row.accountId === accountId && row.currency === currency);

  const balanceText = (account: AccountCard): string =>
    account.currentBalanceMinor === null
      ? "Balance unknown"
      : formatMoney(account.currentBalanceMinor, account.currency);

  const balanceAsOf = (account: AccountCard): string =>
    account.currentBalanceMinor === null
      ? "No balance snapshot — not shown as $0.00"
      : `as of ${
          account.balanceRetrievedAt
            ? formatDateOnly(account.balanceRetrievedAt.slice(0, 10))
            : "unknown"
        }${account.balanceStale ? " · stale" : ""}`;

  const statementText = (account: AccountCard): string => {
    const payment = account.payment;
    if (payment.statementBalanceMinor === null) return "Not reported";
    return `${formatMoney(payment.statementBalanceMinor, account.currency)}${
      payment.statementIssueDate ? ` · ${formatDateOnly(payment.statementIssueDate)}` : ""
    }`;
  };

  const faces = theme.options.cardArt === "faces";

  if (accounts.length === 0) {
    return (
      <section className="dashboard" aria-labelledby="accounts-title">
        <header className="page-heading">
          <div>
            <h1 id="accounts-title">Accounts</h1>
          </div>
        </header>
        <p className="muted">No accounts yet.</p>
      </section>
    );
  }

  return (
    <section className="dashboard" aria-labelledby="accounts-title">
      <header className="page-heading">
        <div>
          <h1 id="accounts-title">Accounts</h1>
          <p className="muted">
            {monthLabel(dashboard.month)} · monthly spending plus card balances, cash, and reported
            payment metadata
          </p>
        </div>
      </header>

      {creditAccounts.length > 0 ? (
        <section className="account-group" aria-labelledby="credit-accounts-title">
          <h2 id="credit-accounts-title" className="account-group-title">
            Credit cards
          </h2>
          {faces ? (
            <div className="cards-grid cards-grid-faces">
              {creditAccounts.map((account) => {
                const payment = account.payment;
                const missing = account.currentBalanceMinor === null;
                const status = statusFor(account);
                return (
                  <button
                    type="button"
                    key={account.accountId}
                    className={[
                      "cardface",
                      account.balanceStale ? "cardface-stale" : "",
                      missing ? "cardface-missing" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={issuerVariables(theme, account.issuer) as CSSProperties}
                    onClick={() => onFilterAccount(account.accountId)}
                    aria-label={`Filter transactions to ${account.displayName}`}
                  >
                    <span className="cf-top">
                      <span className="cf-issuer">{account.issuer}</span>
                      <span className="cf-last">•••• {account.lastFour ?? "----"}</span>
                    </span>
                    <span className="cf-mid">
                      <span className="cf-label">Current balance</span>
                      <span className={`cf-bal${missing ? " cf-bal-unknown" : ""}`}>
                        {missing ? "Unknown" : balanceText(account)}
                      </span>
                      <span className="cf-note">
                        {missing
                          ? "No snapshot — never shown as $0.00"
                          : `as of ${
                              account.balanceRetrievedAt
                                ? formatDateOnly(account.balanceRetrievedAt.slice(0, 10))
                                : "unknown"
                            }${account.balanceStale ? " · stale" : ""}`}
                      </span>
                    </span>
                    <span className="cf-foot">
                      <span className="cf-next">
                        {payment.dueAmountKind === "no_due_date" ? "" : "Next "}
                        {dueText(account, true)}
                      </span>
                      <span className={`cf-chip cf-chip-${status}`}>
                        <span className="cf-dot" aria-hidden="true" />
                        {connectionLabel(account.connectionStatus, account.sourceKind)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="cards-grid">
              {creditAccounts.map((account) => {
                const spend = spendFor(account.accountId, account.currency);
                const payment = account.payment;
                const dueLabel = dueText(account, true);
                return (
                  <button
                    type="button"
                    key={account.accountId}
                    className="card-tile"
                    onClick={() => onFilterAccount(account.accountId)}
                    aria-label={`Filter transactions to ${account.displayName}`}
                  >
                    <span className="card-head">
                      <span>
                        <span className="card-issuer">{account.issuer}</span>
                        <span className="card-name">{account.displayName}</span>
                      </span>
                      <span className="card-mask">•••• {account.lastFour ?? "----"}</span>
                    </span>

                    <span className="card-balance">{balanceText(account)}</span>
                    <span className="fine-print">{balanceAsOf(account)}</span>

                    <span className="card-row">
                      <span className="card-label">Month spend</span>
                      <span>{spend ? formatMoney(spend.netMinor, account.currency) : "—"}</span>
                    </span>
                    <span className="card-row">
                      <span className="card-label">Payment</span>
                      <span>{dueLabel}</span>
                    </span>
                    {payment.dueSource ? (
                      <span className="fine-print">
                        Due source: {payment.dueSource}
                        {payment.dueSource === "manual" ? " (dated manual entry)" : ""}
                        {payment.manualExpired ? " · manual entry expired" : ""}
                      </span>
                    ) : null}
                    <span className="card-row">
                      <span className="card-label">Last statement</span>
                      <span>{statementText(account)}</span>
                    </span>
                    <span className="fine-print">
                      A statement balance is not the remaining amount due.
                    </span>
                    {payment.nextClosingDate ? (
                      <span className="card-row">
                        <span className="card-label">Next closing</span>
                        <span>{formatDateOnly(payment.nextClosingDate)}</span>
                      </span>
                    ) : null}
                    {account.connectionStatus === "error" ||
                    account.connectionStatus === "reconnect_required" ? (
                      <span className="fine-print">
                        Statement details may be unavailable until this connection is repaired;
                        missing values are never shown as $0.00.
                      </span>
                    ) : null}
                    <span className="card-foot">
                      <span
                        className={`status-pill ${
                          account.sourceKind === "manual"
                            ? "status-info"
                            : account.connectionStatus === "healthy"
                              ? "status-ok"
                              : account.connectionStatus === "error"
                                ? "status-fail"
                                : "status-warn"
                        }`}
                      >
                        {connectionLabel(account.connectionStatus, account.sourceKind)}
                      </span>
                      <span className="fine-print">Click to filter the ledger</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="card-details">
            <h3 className="card-details-title">Card details</h3>
            <div className="table-wrap">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th scope="col">Card</th>
                    <th scope="col">Month spend</th>
                    <th scope="col">Next payment</th>
                    <th scope="col">Statement</th>
                    <th scope="col">Due source</th>
                    <th scope="col">Balance as of</th>
                  </tr>
                </thead>
                <tbody>
                  {creditAccounts.map((account) => {
                    const spend = spendFor(account.accountId, account.currency);
                    return (
                      <tr key={account.accountId}>
                        <th scope="row" className="detail-card">
                          {account.displayName}
                          <span className="fine-print"> ···· {account.lastFour ?? "----"}</span>
                        </th>
                        <td>{spend ? formatMoney(spend.netMinor, account.currency) : "—"}</td>
                        <td>{dueText(account)}</td>
                        <td>{statementText(account)}</td>
                        <td>
                          {account.payment.dueSource
                            ? `Due source: ${account.payment.dueSource}${
                                account.payment.manualExpired ? " · expired" : ""
                              }`
                            : "—"}
                        </td>
                        <td>
                          {account.balanceRetrievedAt
                            ? formatDateOnly(account.balanceRetrievedAt.slice(0, 10))
                            : "Unknown"}
                          {account.balanceStale ? " · stale" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="fine-print">
              A statement balance is not the remaining amount due. Missing values are never shown as
              $0.00. A due date that has already passed is rolled forward a month and marked{" "}
              <strong>Est.</strong> — its reported minimum belongs to the earlier cycle, so it is
              not carried over.
            </p>
          </div>
        </section>
      ) : null}

      {bankAccounts.length > 0 ? (
        <section className="account-group" aria-labelledby="bank-accounts-title">
          <h2 id="bank-accounts-title" className="account-group-title">
            Bank accounts
          </h2>
          <div className="cards-grid bank-accounts-grid">
            {bankAccounts.map((account) => {
              const spend = spendFor(account.accountId, account.currency);
              return (
                <button
                  type="button"
                  key={account.accountId}
                  className="card-tile"
                  onClick={() => onFilterAccount(account.accountId)}
                  aria-label={`Filter transactions to ${account.displayName}`}
                >
                  <span className="card-head">
                    <span>
                      <span className="card-issuer">{account.issuer}</span>
                      <span className="card-name">{account.displayName}</span>
                    </span>
                    <span className="card-mask">•••• {account.lastFour ?? "----"}</span>
                  </span>

                  <span className="card-balance">{balanceText(account)}</span>
                  <span className="fine-print">{balanceAsOf(account)}</span>

                  <span className="card-row">
                    <span className="card-label">Month spend</span>
                    <span>{spend ? formatMoney(spend.netMinor, account.currency) : "—"}</span>
                  </span>
                  <span className="card-row">
                    <span className="card-label">Account type</span>
                    <span>{accountTypeLabel(account.accountType)}</span>
                  </span>
                  <span className="fine-print">
                    Cash, not an amount due. Transfers, payments, and income are excluded from
                    spending.
                  </span>
                  <span className="card-foot">
                    <span
                      className={`status-pill ${
                        account.sourceKind === "manual"
                          ? "status-info"
                          : account.connectionStatus === "healthy"
                            ? "status-ok"
                            : account.connectionStatus === "error"
                              ? "status-fail"
                              : "status-warn"
                      }`}
                    >
                      {connectionLabel(account.connectionStatus, account.sourceKind)}
                    </span>
                    <span className="fine-print">Click to filter the ledger</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="card-details">
            <h3 className="card-details-title">Bank details</h3>
            <div className="table-wrap">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Month spend</th>
                    <th scope="col">Current balance</th>
                    <th scope="col">Balance as of</th>
                    <th scope="col">Type</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAccounts.map((account) => {
                    const spend = spendFor(account.accountId, account.currency);
                    return (
                      <tr key={account.accountId}>
                        <th scope="row" className="detail-card">
                          {account.displayName}
                          <span className="fine-print"> ···· {account.lastFour ?? "----"}</span>
                        </th>
                        <td>{spend ? formatMoney(spend.netMinor, account.currency) : "—"}</td>
                        <td>{balanceText(account)}</td>
                        <td>
                          {account.balanceRetrievedAt
                            ? formatDateOnly(account.balanceRetrievedAt.slice(0, 10))
                            : "Unknown"}
                          {account.balanceStale ? " · stale" : ""}
                        </td>
                        <td>{accountTypeLabel(account.accountType)}</td>
                        <td>{connectionLabel(account.connectionStatus, account.sourceKind)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="fine-print">
              Bank balances are cash. A missing balance is unknown, never $0.00. Debit purchases
              count toward the month&apos;s spending; transfers, card payments, and income do not.
            </p>
          </div>
        </section>
      ) : null}
    </section>
  );
}
