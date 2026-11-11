import type { AccountCard } from "../../lib/bridge";
import { formatMoney } from "../../lib/formatting";
import "./overview.css";

interface UtilizationRow {
  accountId: string;
  name: string;
  lastFour: string | null;
  balanceMinor: number;
  limitMinor: number;
  share: number;
}

/**
 * Balance against reported credit limit, per card, with the aggregate share of
 * all reported limits on top. Cards without a reported limit are excluded from
 * the aggregate (a missing limit is not zero) and counted separately.
 */
export function UtilizationPanel({
  accounts,
  className = "",
}: {
  accounts: AccountCard[];
  className?: string;
}) {
  const counted = accounts.filter(
    (account) =>
      account.included &&
      account.currency === "USD" &&
      account.currentBalanceMinor !== null &&
      account.creditLimitMinor !== null &&
      account.creditLimitMinor > 0,
  );
  const rows: UtilizationRow[] = counted
    .map((account) => {
      const balanceMinor = account.currentBalanceMinor ?? 0;
      const limitMinor = account.creditLimitMinor ?? 0;
      const share = limitMinor > 0 ? Math.round((balanceMinor / limitMinor) * 100) : 0;
      return {
        accountId: account.accountId,
        name: account.displayName,
        lastFour: account.lastFour,
        balanceMinor,
        limitMinor,
        share: Math.min(100, Math.max(0, share)),
      };
    })
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));

  const totalBalance = rows.reduce((sum, row) => sum + row.balanceMinor, 0);
  const totalLimit = rows.reduce((sum, row) => sum + row.limitMinor, 0);
  const totalShare = totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : null;
  // A card with no reported limit cannot be measured. One that also has no
  // balance is simply not reported yet, so it is not worth calling out.
  const missingLimit = accounts.filter(
    (account) =>
      account.included &&
      account.currency === "USD" &&
      account.currentBalanceMinor !== null &&
      (account.creditLimitMinor === null || account.creditLimitMinor <= 0),
  ).length;

  return (
    <section
      className={`overview-panel overview-utilization ${className}`.trim()}
      aria-labelledby="utilization-title"
    >
      <header className="utilization-head">
        <div>
          <h2 id="utilization-title">Credit utilization</h2>
          <p className="fine-print">
            Balance against the reported limit
            {rows.length > 0 ? ` · ${formatMoney(totalLimit)} reported` : ""}
          </p>
        </div>
        <strong className="utilization-total">
          {totalShare === null ? "—" : `${totalShare}%`}
          <span className="utilization-total-suffix"> used</span>
        </strong>
      </header>

      {rows.length === 0 ? (
        <p className="chart-empty">
          No credit limits reported yet. Utilization appears once a card reports a limit.
        </p>
      ) : (
        <ol className="utilization-list" aria-label="Utilization by card">
          {rows.map((row) => (
            <li className="utilization-row" key={row.accountId}>
              <span className="utilization-label">
                {row.name}
                {row.lastFour ? ` · •••• ${row.lastFour}` : ""}
              </span>
              <span className="utilization-track" aria-hidden="true">
                <span
                  className="utilization-fill"
                  style={{ width: `${Math.max(row.share, 1)}%` }}
                />
              </span>
              <span className="utilization-value">
                {formatMoney(row.balanceMinor)}
                <span className="utilization-limit"> / {formatMoney(row.limitMinor)}</span>
              </span>
              <span className="utilization-share">{row.share}%</span>
            </li>
          ))}
        </ol>
      )}

      {missingLimit > 0 ? (
        <p className="fine-print">
          {missingLimit} card{missingLimit === 1 ? "" : "s"} without a reported limit{" "}
          {missingLimit === 1 ? "is" : "are"} not counted — a missing limit is not zero.
        </p>
      ) : null}
    </section>
  );
}
