import { useEffect, useMemo, useRef, useState } from "react";
import { command, type Dashboard, type SpendHistory } from "../../lib/bridge";
import { friendlyError } from "../../lib/bridge/errors";
import {
  formatDateOnly,
  formatDateShort,
  formatMoney,
  formatMonthRange,
  formatSignedMoney,
  monthLabel,
  parseDateOnly,
} from "../../lib/formatting";
import { Button } from "../../components/Button";
import { AccountKindIcon } from "../../components/AccountKindIcon";
import { brandMarkFor } from "../../brand/logos";
import type { Theme, ThemeMode } from "../../theme/schema";
import { buildComposition, CategoryRing, RankedBars, toChartData, TrendBars } from "./charts";
import { UtilizationPanel } from "./UtilizationPanel";
import { buildWealthModel, quickRead, totalReported } from "./wealthModel";
import "./overview.css";

type UpcomingEntry = Dashboard["overview"]["upcoming"]["entries"][number];

function addDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  parsed.setDate(parsed.getDate() + days);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
    parsed.getDate(),
  ).padStart(2, "0")}`;
}

function dayNumber(date: string): string {
  return String(Number(date.slice(8)));
}

function accountTypeLabel(value: string): string {
  switch (value) {
    case "checking":
      return "checking";
    case "savings":
      return "savings";
    case "depository":
      return "bank account";
    case "credit_card":
      return "credit card";
    case "charge_card":
      return "charge card";
    case "line_of_credit":
      return "line of credit";
    default:
      return "account";
  }
}

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function OverviewView({
  dashboard,
  theme,
  mode = "light",
  onAddAccount,
  onOpenAccounts,
  onOpenSettings,
  onOpenTransactions,
  onOpenAccount,
}: {
  dashboard: Dashboard;
  theme: Theme;
  mode?: ThemeMode;
  onAddAccount: () => void;
  onOpenAccounts: () => void;
  onOpenSettings: () => void;
  onOpenTransactions: () => void;
  onOpenAccount?: (accountId: string) => void;
}) {
  const { summary, overview } = dashboard;
  const [history, setHistory] = useState<SpendHistory | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [deeperOpen, setDeeperOpen] = useState(false);
  const [dueExpanded, setDueExpanded] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const trendEnabled = theme.options.overview.trend !== "hidden";
  const showComposition = theme.options.overview.composition !== "hidden";
  const composition = useMemo(
    () => toChartData(buildComposition(summary.categories, theme.options.overview.topCategories)),
    [summary.categories, theme.options.overview.topCategories],
  );
  const model = useMemo(() => buildWealthModel(dashboard, history), [dashboard, history]);
  const readItems = useMemo(() => quickRead(model, dashboard), [model, dashboard]);

  useEffect(() => {
    if (!trendEnabled) {
      setHistory(null);
      setTrendError(null);
      setTrendLoading(false);
      return;
    }
    let cancelled = false;
    setTrendLoading(true);
    setTrendError(null);
    (async () => {
      try {
        const result = await command("spend_history", {
          months: theme.options.overview.trendMonths,
          endMonth: dashboard.month,
        });
        if (!cancelled) setHistory(result);
      } catch (error) {
        if (!cancelled) {
          setTrendError(friendlyError(error));
          setHistory(null);
        }
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboard.month, summary, trendEnabled, theme.options.overview.trendMonths]);

  const includedAccounts = overview.accounts.filter((account) => account.included);
  const staleCount = includedAccounts.filter((account) => account.balanceStale).length;
  const errorConnections = includedAccounts.filter(
    (account) =>
      account.connectionStatus === "error" || account.connectionStatus === "reconnect_required",
  ).length;
  const pendingOnly = summary.netSpendingMinor === 0 && summary.pendingSubtotalMinor !== 0;

  const accountById = new Map(overview.accounts.map((account) => [account.accountId, account]));
  const entries = [...overview.upcoming.entries].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.displayName.localeCompare(b.displayName),
  );
  const nearestEntries = entries.slice(0, 4);
  const visibleEntries = dueExpanded ? entries : nearestEntries;
  const dueDays = Array.from({ length: overview.upcoming.windowDays }, (_, index) =>
    addDays(overview.upcoming.asOfDate, index),
  );
  const dueCounts = new Map<string, { count: number; unknown: boolean }>();
  for (const entry of entries) {
    const current = dueCounts.get(entry.dueDate) ?? { count: 0, unknown: false };
    current.count += 1;
    current.unknown = current.unknown || entry.amountMinor === null;
    dueCounts.set(entry.dueDate, current);
  }

  const attention: AttentionItem[] = [];
  if (errorConnections > 0) {
    attention.push({
      id: "connections",
      title: `${errorConnections} connection${errorConnections === 1 ? "" : "s"} need attention`,
      detail: "Balances may be stale until the connection is repaired.",
      actionLabel: "Open connections",
      onAction: onOpenSettings,
    });
  }
  if (staleCount > 0) {
    attention.push({
      id: "stale",
      title: `${staleCount} balance${staleCount === 1 ? " is" : "s are"} stale`,
      detail: "Last-known values are preserved and labeled, never treated as current.",
      actionLabel: "Review balances",
      onAction: onOpenAccounts,
    });
  }
  if (model.missingBalances > 0) {
    attention.push({
      id: "missing",
      title: `${model.missingBalances} account${model.missingBalances === 1 ? " is" : "s are"} missing a balance`,
      detail: "A missing balance is not the same as $0.00.",
      actionLabel: "Review balances",
      onAction: onOpenAccounts,
    });
  }
  if (overview.upcoming.unknownAmountCount > 0) {
    attention.push({
      id: "unknown-due",
      title: `${overview.upcoming.unknownAmountCount} payment amount${
        overview.upcoming.unknownAmountCount === 1 ? " is" : "s are"
      } not reported`,
      detail: "The due date is known; the amount is not.",
      actionLabel: "Review balances",
      onAction: onOpenAccounts,
    });
  }
  if (pendingOnly) {
    attention.push({
      id: "pending-only",
      title: "Pending activity only",
      detail: "Nothing is counted as posted spending yet.",
    });
  }
  const visibleAttention = attention.slice(0, 3);

  function revealDetails() {
    setDeeperOpen(true);
    window.setTimeout(() => {
      detailsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 0);
  }

  if (overview.accounts.length === 0) {
    return (
      <section className="empty-state" aria-labelledby="overview-title">
        <p className="eyebrow">A clean slate</p>
        <h1 id="overview-title">Your accounts, in one quiet place.</h1>
        <p className="muted">
          No accounts yet. Start with a bank account or a card — cash and card balances will sit
          side by side here.
        </p>
        <Button variant="primary" onClick={onAddAccount}>
          Add account
        </Button>
      </section>
    );
  }

  const net = overview.balances.netPositionMinor;
  const hasKnownBalance = model.usdReportedCount > 0;
  const cashKnown = totalReported(model.cashStatus);
  const cardKnown = totalReported(model.cardStatus);
  const cashDisplay = cashKnown ? formatMoney(overview.balances.cashKnownTotalMinor) : "—";
  const cardDisplay = cardKnown ? formatMoney(overview.balances.cardKnownTotalMinor) : "—";
  const beamAria = [
    cashKnown
      ? `Known cash ${formatMoney(overview.balances.cashKnownTotalMinor)}`
      : "Cash not reported",
    cardKnown
      ? `card balances ${formatMoney(overview.balances.cardKnownTotalMinor)}`
      : "card balances not reported",
  ].join(" and ");
  const beamNote =
    model.cashStatus === "not_reported" && model.cardStatus === "not_reported"
      ? "No balances reported yet"
      : model.cashStatus === "not_reported"
        ? "Cash not reported yet"
        : "Card balances not reported yet";
  const cashShare = model.cashShare;
  const debtShare = cashShare === null ? null : 100 - cashShare;
  const beamTotalKnownZero =
    cashKnown &&
    cardKnown &&
    overview.balances.cashKnownTotalMinor + overview.balances.cardKnownTotalMinor === 0;
  const asOf = formatDateOnly(overview.upcoming.asOfDate);
  const glanceCash = [...model.cashAccounts].sort(
    (a, b) => (b.currentBalanceMinor ?? -1) - (a.currentBalanceMinor ?? -1),
  );
  const glanceCards = [...model.cardAccounts].sort(
    (a, b) => (b.currentBalanceMinor ?? -1) - (a.currentBalanceMinor ?? -1),
  );
  const cashPreview = glanceCash.slice(0, 2);
  const cardPreview = glanceCards.slice(0, 3);
  const hiddenCash = glanceCash.length - cashPreview.length;
  const hiddenCards = glanceCards.length - cardPreview.length;
  const paceCopy =
    model.pacePercent === null
      ? "Not enough posted activity for a typical month yet."
      : model.pacePercent === 0
        ? "Right on your typical active month."
        : `${Math.abs(model.pacePercent)}% ${
            model.pacePercent < 0 ? "below" : "above"
          } your typical active month.`;

  return (
    <section className="dashboard overview wealth-overview" aria-labelledby="overview-title">
      <header className="page-heading overview-heading">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" />
            Your wealth, at a glance
          </p>
          <h1 id="overview-title">Overview</h1>
          <p className="muted">
            {monthLabel(dashboard.month)} activity ·{" "}
            {formatMonthRange(dashboard.startDate, dashboard.endDateExclusive)}
          </p>
        </div>
        <div className="heading-actions overview-heading-actions">
          <span className="asof-chip" title="Current balances do not change with the month.">
            Balances as of {asOf}
          </span>
          <Button variant="secondary" onClick={onAddAccount}>
            Add account
          </Button>
        </div>
      </header>

      {visibleAttention.length > 0 ? (
        <button type="button" className="attention-strip" onClick={revealDetails}>
          <span className="attention-strip-mark" aria-hidden="true">
            !
          </span>
          <span className="attention-strip-copy">
            <strong>{visibleAttention[0].title}</strong>
            <span>
              {visibleAttention.length > 1
                ? `${attention.length - 1} more item${
                    attention.length - 1 === 1 ? "" : "s"
                  } worth a look.`
                : "One small thing worth a look."}
            </span>
          </span>
          <span className="attention-strip-cta">Review →</span>
        </button>
      ) : null}

      <div className="wealth-grid">
        <section className="wealth-hero" aria-labelledby="hero-title">
          <div className="wealth-hero-top">
            <div>
              <h2 id="hero-title" className="eyebrow">
                Net position
              </h2>
              <p className="hero-asof">
                Cash minus card balances ·{" "}
                {model.netStatus === "complete"
                  ? "complete"
                  : model.netStatus === "partial"
                    ? "partial"
                    : "Not reported"}
              </p>
            </div>
            <span className="hero-spark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path
                  d="M12 2.8v18.4M6.4 7.2c1.3-2 3.1-3 5.6-3s4.3 1 5.6 3"
                  strokeLinecap="round"
                />
                <path d="M4.2 19.2h15.6" strokeLinecap="round" />
                <circle cx="12" cy="12" r="2.4" />
              </svg>
            </span>
          </div>
          <p className={`hero-value${hasKnownBalance && net < 0 ? " hero-value-negative" : ""}`}>
            {hasKnownBalance ? formatSignedMoney(net) : "—"}
          </p>
          <p className="hero-story">
            {!hasKnownBalance
              ? "No balances reported yet. Add an account or sync a bank to complete the picture."
              : model.cashStatus === "not_reported"
                ? `${formatMoney(
                    overview.balances.cardKnownTotalMinor,
                  )} in known card balances; cash is not reported yet.`
                : model.cardStatus === "not_reported"
                  ? `${formatMoney(
                      overview.balances.cashKnownTotalMinor,
                    )} of known cash; card balances are not reported yet.`
                  : net < 0
                    ? `${formatMoney(overview.balances.cardKnownTotalMinor)} in card balances against ${formatMoney(
                        overview.balances.cashKnownTotalMinor,
                      )} of cash.`
                    : `${formatMoney(overview.balances.cashKnownTotalMinor)} of cash against ${formatMoney(
                        overview.balances.cardKnownTotalMinor,
                      )} in card balances.`}
          </p>

          <div className="wealth-beam">
            <div className="wealth-beam-labels">
              <span
                className="beam-label beam-label-cash"
                title={cashKnown ? undefined : "Cash balance not reported"}
              >
                <span className="beam-dot" aria-hidden="true" />
                Cash <strong>{cashDisplay}</strong>
              </span>
              <span
                className="beam-label beam-label-debt"
                title={cardKnown ? undefined : "Card balances not reported"}
              >
                <strong>{cardDisplay}</strong> card balances
                <span className="beam-dot" aria-hidden="true" />
              </span>
            </div>
            <div
              className={`wealth-beam-track${cashShare === null ? " wealth-beam-unknown" : ""}`}
              role="img"
              aria-label={beamAria}
            >
              {cashShare === null || debtShare === null ? (
                <span className="wealth-beam-note">{beamNote}</span>
              ) : beamTotalKnownZero ? (
                <span className="wealth-beam-note">Both sides reported $0.00</span>
              ) : (
                <>
                  <span className="wealth-beam-cash" style={{ width: `${cashShare}%` }} />
                  <span className="wealth-beam-debt" style={{ width: `${debtShare}%` }} />
                </>
              )}
            </div>
            <div className="wealth-beam-legend">
              <span>
                {model.usdCashCount} cash account{model.usdCashCount === 1 ? "" : "s"}
                {model.usdCashCount === 0 ? " · add a bank account" : ""}
              </span>
              <span>
                {model.usdCardCount} USD card{model.usdCardCount === 1 ? "" : "s"}
                {model.utilizationPercent === null
                  ? ""
                  : ` · ${model.utilizationPercent}% of limit used`}
              </span>
            </div>
          </div>

          <div className="hero-mini-stats">
            <div className="hero-mini">
              <span className="hero-mini-label">Cash on hand</span>
              <strong>{cashDisplay}</strong>
              <span className="hero-mini-note">
                {model.cashStatus === "not_reported"
                  ? "Not reported"
                  : model.usdCashCount === 0
                    ? "No cash account yet"
                    : `${model.usdCashReportedCount} of ${model.usdCashCount} reported`}
              </span>
            </div>
            <div className="hero-mini">
              <span className="hero-mini-label">Card balances</span>
              <strong>{cardDisplay}</strong>
              <span className="hero-mini-note">
                {model.cardStatus === "not_reported"
                  ? "Not reported"
                  : model.usdCardCount === 0
                    ? "No cards tracked"
                    : `${model.usdCardReportedCount} of ${model.usdCardCount} USD cards reported`}
              </span>
            </div>
            <div className="hero-mini">
              <span className="hero-mini-label">Available credit</span>
              <strong>
                {model.availableCreditMinor === null
                  ? "—"
                  : formatMoney(model.availableCreditMinor)}
              </strong>
              <span className="hero-mini-note">
                {model.utilizationPercent === null
                  ? "No reported limits"
                  : `${model.utilizationPercent}% used`}
              </span>
            </div>
          </div>

          <div className="hero-actions">
            <Button variant="primary" onClick={onOpenAccounts}>
              See the balance sheet
            </Button>
            <Button variant="ghost" onClick={onOpenTransactions}>
              Open ledger
            </Button>
          </div>
        </section>

        <aside className="quick-read" aria-labelledby="quick-read-title">
          <div className="quick-read-head">
            <span className="quick-read-mark" aria-hidden="true">
              <img src={brandMarkFor(mode)} alt="" draggable={false} />
            </span>
            <div>
              <h2 id="quick-read-title">A quick read</h2>
              <p>From balances and posted activity</p>
            </div>
          </div>
          <ol className="quick-read-list">
            {readItems.map((item, index) => (
              <li key={`${index}-${item.slice(0, 12)}`}>
                <span className="quick-read-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
          <div className="quick-read-foot">
            <p className="fine-print">Estimates use posted activity only. Not financial advice.</p>
            {attention.length > 0 ? (
              <button type="button" className="link-button" onClick={revealDetails}>
                See what needs attention
              </button>
            ) : (
              <span className="quiet-status">
                <span className="dot dot-success" aria-hidden="true" /> Everything reported looks
                current
              </span>
            )}
          </div>
        </aside>

        <section className="accounts-glance" aria-labelledby="glance-title">
          <header className="panel-head">
            <div>
              <p className="eyebrow">One wallet, two sides</p>
              <h2 id="glance-title">Your accounts</h2>
            </div>
            <button type="button" className="link-button" onClick={onOpenAccounts}>
              Balance sheet →
            </button>
          </header>

          <div className="glance-columns">
            <div className="glance-column">
              <div className="glance-column-head">
                <h3>
                  <AccountKindIcon kind="cash" className="glance-kind-icon" />
                  Cash
                </h3>
                <span>
                  {model.cashAccountCount} account{model.cashAccountCount === 1 ? "" : "s"}
                </span>
              </div>
              {cashPreview.length > 0 ? (
                <ul className="glance-list">
                  {cashPreview.map((account) => (
                    <li key={account.accountId}>
                      <button
                        type="button"
                        className="glance-account"
                        onClick={() => onOpenAccount?.(account.accountId)}
                        aria-label={`Open activity for ${account.displayName}`}
                      >
                        <span className="glance-avatar glance-avatar-cash" aria-hidden="true">
                          <AccountKindIcon kind="cash" />
                        </span>
                        <span className="glance-copy">
                          <span className="glance-name">{account.displayName}</span>
                          <span className="glance-meta">
                            {accountTypeLabel(account.accountType)}
                            {account.lastFour ? ` · •••• ${account.lastFour}` : ""}
                          </span>
                        </span>
                        <span className="glance-money">
                          {account.currentBalanceMinor === null
                            ? "Unknown"
                            : formatMoney(account.currentBalanceMinor, account.currency)}
                          {account.balanceStale ? <small>stale</small> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="glance-empty">
                  <p>No cash accounts yet.</p>
                  <button type="button" className="link-button" onClick={onAddAccount}>
                    Add a bank account →
                  </button>
                </div>
              )}
              {hiddenCash > 0 ? (
                <button type="button" className="glance-more" onClick={onOpenAccounts}>
                  +{hiddenCash} more cash account{hiddenCash === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>

            <div className="glance-column">
              <div className="glance-column-head">
                <h3>
                  <AccountKindIcon kind="card" className="glance-kind-icon" />
                  Cards
                </h3>
                <span>
                  {model.cardAccountCount} account{model.cardAccountCount === 1 ? "" : "s"}
                </span>
              </div>
              {cardPreview.length > 0 ? (
                <ul className="glance-list">
                  {cardPreview.map((account) => {
                    const due = entries.find((entry) => entry.accountId === account.accountId);
                    return (
                      <li key={account.accountId}>
                        <button
                          type="button"
                          className="glance-account"
                          onClick={() => onOpenAccount?.(account.accountId)}
                          aria-label={`Open activity for ${account.displayName}`}
                        >
                          <span className="glance-avatar glance-avatar-card" aria-hidden="true">
                            <AccountKindIcon kind="card" />
                          </span>
                          <span className="glance-copy">
                            <span className="glance-name">{account.displayName}</span>
                            <span className="glance-meta">
                              {due
                                ? `Due ${formatDateShort(due.dueDate)}`
                                : account.lastFour
                                  ? `•••• ${account.lastFour}`
                                  : "No due date"}
                            </span>
                          </span>
                          <span className="glance-money">
                            {account.currentBalanceMinor === null
                              ? "Unknown"
                              : formatMoney(account.currentBalanceMinor, account.currency)}
                            {account.balanceStale ? <small>stale</small> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="glance-empty">
                  <p>No cards tracked.</p>
                  <button type="button" className="link-button" onClick={onAddAccount}>
                    Add a card →
                  </button>
                </div>
              )}
              {hiddenCards > 0 ? (
                <button type="button" className="glance-more" onClick={onOpenAccounts}>
                  +{hiddenCards} more card{hiddenCards === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="overview-due wealth-panel" aria-labelledby="due-title">
          <header className="overview-panel-head">
            <div>
              <p className="eyebrow">Cash timing</p>
              <h2 id="due-title">Coming up</h2>
              <p className="fine-print">
                Reported card payments · next {overview.upcoming.windowDays} days ·{" "}
                {overview.upcoming.unknownAmountCount > 0
                  ? `${overview.upcoming.unknownAmountCount} amount${
                      overview.upcoming.unknownAmountCount === 1 ? "" : "s"
                    } not reported`
                  : "all reported amounts known"}
              </p>
            </div>
            <strong className="due-total">
              {formatMoney(overview.upcoming.knownTotalMinor)}
              <span className="due-total-currency"> known</span>
            </strong>
          </header>

          <ol className="due-strip" aria-hidden="true">
            {dueDays.map((day) => {
              const count = dueCounts.get(day);
              return (
                <li
                  className={`due-day${count ? " due-day-active" : ""}${
                    day === overview.upcoming.asOfDate ? " due-day-today" : ""
                  }`}
                  key={day}
                >
                  <span className="due-day-number">{dayNumber(day)}</span>
                  {count ? (
                    <span
                      className={`due-pip${count.unknown ? " due-pip-unknown" : ""}`}
                      title={`${count.count} payment${count.count === 1 ? "" : "s"}`}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {visibleEntries.length > 0 ? (
            <>
              <p className="due-columns" aria-hidden="true">
                <span>Due</span>
                <span>Account</span>
                <span>Balance</span>
                <span>Min</span>
              </p>
              <ul className="due-list" id="upcoming-payment-list" aria-label="Upcoming payments">
                {visibleEntries.map((entry: UpcomingEntry, index) => {
                  const account = accountById.get(entry.accountId);
                  const balance = account?.currentBalanceMinor ?? null;
                  return (
                    <li className="due-item" key={`${entry.accountId}-${entry.dueDate}-${index}`}>
                      <span className="due-item-date">{formatDateShort(entry.dueDate)}</span>
                      <span className="due-item-name">
                        {entry.displayName}
                        {entry.lastFour ? ` · •••• ${entry.lastFour}` : ""}
                      </span>
                      <span className={`due-item-balance${balance === null ? " due-unknown" : ""}`}>
                        <span className="sr-only">current balance </span>
                        {balance === null
                          ? "—"
                          : formatMoney(balance, account?.currency ?? entry.currency)}
                      </span>
                      <span
                        className={`due-item-amount${entry.amountMinor === null ? " due-unknown" : ""}`}
                      >
                        <span className="sr-only">minimum due </span>
                        {entry.amountMinor === null ? (
                          "not reported"
                        ) : (
                          <>
                            {formatMoney(entry.amountMinor, entry.currency)}
                            {entry.currency !== "USD" ? ` ${entry.currency}` : ""}
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {entries.length > nearestEntries.length ? (
                <button
                  type="button"
                  className="link-button due-disclosure"
                  aria-expanded={dueExpanded}
                  aria-controls="upcoming-payment-list"
                  onClick={() => setDueExpanded((value) => !value)}
                >
                  {dueExpanded ? "Show fewer" : `Show all ${entries.length} payments`}
                </button>
              ) : null}
            </>
          ) : (
            <p className="chart-empty">
              No payments reported in the next {overview.upcoming.windowDays} days.
            </p>
          )}
          <div className="due-foot">
            <span>
              {model.cashAfterUpcomingMinor === null
                ? "Cash after payments needs a reported cash balance."
                : `Cash after these known amounts: ${formatMoney(model.cashAfterUpcomingMinor)}`}
            </span>
            {overview.upcoming.nonUsdEntryCount > 0 ? (
              <span className="fine-print">Other currencies listed separately.</span>
            ) : null}
          </div>
        </section>

        {showComposition ? (
          <section
            className={`overview-panel wealth-panel overview-composition${
              trendEnabled ? "" : " overview-span-12"
            }`}
            aria-label="Spending composition"
          >
            {theme.options.overview.composition === "ring" ? (
              <CategoryRing
                data={composition}
                totalMinor={summary.grossPurchasesMinor + summary.feesInterestMinor}
                refundsMinor={summary.refundsMinor}
                netMinor={summary.netSpendingMinor}
              />
            ) : (
              <RankedBars data={composition} />
            )}
          </section>
        ) : null}

        {trendEnabled ? (
          <section
            className={`overview-panel wealth-panel overview-trend${
              showComposition ? "" : " overview-span-12"
            }`}
            aria-label="Spending trend"
          >
            <div className="trend-summary">
              <div className="trend-summary-lead">
                <span>This month so far</span>
                <strong>{formatMoney(summary.netSpendingMinor)}</strong>
                <small>{paceCopy}</small>
              </div>
              <div className="trend-summary-side">
                <span>
                  <small>Pending</small>
                  {formatMoney(summary.pendingSubtotalMinor)}
                </span>
                <span>
                  <small>Typical month</small>
                  {model.typicalMonthMinor === null ? "—" : formatMoney(model.typicalMonthMinor)}
                </span>
              </div>
            </div>
            {trendLoading && !history ? (
              <div className="chart-skeleton" role="status" aria-label="Loading spending trend">
                <span className="sr-only">Loading spending trend…</span>
                <span
                  className="skeleton-block skeleton-line skeleton-line-short"
                  aria-hidden="true"
                />
                <span className="chart-skeleton-bars" aria-hidden="true">
                  {[35, 55, 42, 68, 50, 72, 60, 80, 66, 90, 74, 95].map((height, index) => (
                    <span className="skeleton-block" key={index} style={{ height: `${height}%` }} />
                  ))}
                </span>
              </div>
            ) : trendError ? (
              <p className="inline-error" role="alert">
                Trend unavailable: {trendError}
              </p>
            ) : history ? (
              <TrendBars
                months={history.months}
                selectedMonth={dashboard.month}
                currentMonth={dashboard.currentMonth}
                currency={history.currency}
              />
            ) : null}
          </section>
        ) : null}

        <details
          className="wealth-details"
          ref={detailsRef}
          open={deeperOpen}
          onToggle={(event) => setDeeperOpen(event.currentTarget.open)}
        >
          <summary>
            <span className="wealth-details-copy">
              <span className="eyebrow">The deeper picture</span>
              <strong>Limits, row counts, health, and currencies</strong>
            </span>
            <span className="wealth-details-open">Open</span>
            <span className="wealth-details-close">Close</span>
          </summary>
          <div className="wealth-details-body">
            <section className="overview-attention" aria-labelledby="attention-title">
              <header className="attention-head">
                <h2 id="attention-title">Needs attention</h2>
                <span className="fine-print">Last checked {asOf}</span>
              </header>
              {attention.length > 0 ? (
                <ul className="attention-list">
                  {attention.map((item) => (
                    <li className="attention-item" key={item.id}>
                      <div>
                        <span className="attention-title">{item.title}</span>
                        <span className="attention-detail">{item.detail}</span>
                      </div>
                      {item.actionLabel && item.onAction ? (
                        <Button variant="ghost" className="btn-small" onClick={item.onAction}>
                          {item.actionLabel}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quiet-status">
                  <span className="dot dot-success" aria-hidden="true" /> Nothing needs attention.
                </p>
              )}
            </section>

            <UtilizationPanel
              accounts={overview.accounts}
              className="wealth-panel overview-utilization"
            />

            <section className="month-details wealth-panel" aria-labelledby="month-details-title">
              <div className="month-details-head">
                <div>
                  <p className="eyebrow">The month, exactly</p>
                  <h2 id="month-details-title">{monthLabel(dashboard.month)} in numbers</h2>
                </div>
                <span className="fine-print">Calendar month · {dashboard.currency}</span>
              </div>
              <dl className="month-details-stats">
                <div>
                  <dt>Purchases</dt>
                  <dd>{formatMoney(summary.grossPurchasesMinor)}</dd>
                </div>
                <div>
                  <dt>Refunds</dt>
                  <dd>{formatMoney(summary.refundsMinor)}</dd>
                </div>
                <div>
                  <dt>Fees &amp; interest</dt>
                  <dd>{formatMoney(summary.feesInterestMinor)}</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>{formatMoney(summary.pendingSubtotalMinor)}</dd>
                </div>
                <div>
                  <dt>Eligible rows</dt>
                  <dd>{summary.eligibleCount}</dd>
                </div>
                <div>
                  <dt>Pending rows</dt>
                  <dd>{summary.pendingCount}</dd>
                </div>
                <div>
                  <dt>All rows</dt>
                  <dd>{summary.rowCount}</dd>
                </div>
              </dl>
              <p className="fine-print month-reconcile">
                {summary.reconciliation.exact
                  ? "Supplier and category totals reconcile exactly to eligible spending."
                  : "Supplier and category totals do not reconcile to eligible spending; review the ledger."}
              </p>
            </section>
          </div>
        </details>
      </div>

      <footer className="overview-footnote">
        <p className="fine-print">
          Balances and upcoming payments as of {formatDateOnly(overview.upcoming.asOfDate)}; the
          selected month does not change them.
        </p>
        {overview.balances.otherCurrency.length > 0 ? (
          <p className="fine-print overview-currency-note">
            Other currencies are shown separately and never summed with USD:{" "}
            {overview.balances.otherCurrency
              .map(([currency, value]) => `${formatMoney(value, currency)} ${currency}`)
              .join(", ")}
            .
          </p>
        ) : null}
      </footer>
    </section>
  );
}
