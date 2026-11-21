import { useEffect, useMemo, useRef, useState } from "react";
import {
  command,
  isDepositoryAccount,
  type AccountCard,
  type Dashboard,
  type SpendHistory,
} from "../../lib/bridge";
import { friendlyError } from "../../lib/bridge/errors";
import {
  connectionLabel,
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
import { buildWealthModel, quickRead, topCategorySignal, totalReported } from "./wealthModel";
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

/** A short AT description for a glance tile: the visible numbers and state,
 * never a paragraph. The button name stays "Open activity for …". */
function inclusionLabel(account: AccountCard): string {
  if (account.currency !== "USD") {
    return account.included
      ? "other currency, outside USD totals"
      : "other currency, excluded from USD totals";
  }
  return account.included ? "included in totals" : "excluded from totals";
}

function glanceDescription(account: AccountCard, due: UpcomingEntry | undefined): string {
  const parts = [
    account.currentBalanceMinor === null
      ? "Balance not reported"
      : `${formatMoney(account.currentBalanceMinor, account.currency)} balance reported${
          account.balanceStale ? ", may be stale" : ""
        }`,
  ];
  if (due) parts.push(`next payment ${formatDateShort(due.dueDate)}`);
  else if (!isDepositoryAccount(account.accountType)) parts.push("no due date reported");
  parts.push(connectionLabel(account.connectionStatus, account.sourceKind));
  parts.push(inclusionLabel(account));
  return `${parts.join(". ")}.`;
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
  dismissedMissingBalance = false,
  onDismissMissingBalance,
  onRestoreMissingBalance,
}: {
  dashboard: Dashboard;
  theme: Theme;
  mode?: ThemeMode;
  onAddAccount: () => void;
  onOpenAccounts: () => void;
  onOpenSettings: () => void;
  onOpenTransactions: () => void;
  onOpenAccount?: (accountId: string) => void;
  dismissedMissingBalance?: boolean;
  onDismissMissingBalance?: () => void;
  onRestoreMissingBalance?: () => void;
}) {
  const { summary, overview } = dashboard;
  const [history, setHistory] = useState<SpendHistory | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [deeperOpen, setDeeperOpen] = useState(false);
  const [dueExpanded, setDueExpanded] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const revealRequested = useRef(false);

  const trendEnabled = theme.options.overview.trend !== "hidden";
  const showComposition = theme.options.overview.composition !== "hidden";
  const composition = useMemo(
    () => toChartData(buildComposition(summary.categories, theme.options.overview.topCategories)),
    [summary.categories, theme.options.overview.topCategories],
  );
  const model = useMemo(() => buildWealthModel(dashboard, history), [dashboard, history]);
  const readItems = useMemo(() => quickRead(model, dashboard), [model, dashboard]);
  const topSignal = useMemo(() => topCategorySignal(summary.categories), [summary.categories]);

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
  const allCashAccounts = overview.accounts.filter((account) =>
    isDepositoryAccount(account.accountType),
  );
  const allCardAccounts = overview.accounts.filter(
    (account) => !isDepositoryAccount(account.accountType),
  );
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
      title: `${errorConnections} account${errorConnections === 1 ? "" : "s"} need attention`,
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
  if (model.missingBalances > 0 && !dismissedMissingBalance) {
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

  function focusDetails() {
    const details = detailsRef.current;
    if (!details) return;
    const summary = details.querySelector<HTMLElement>("summary");
    summary?.focus({ preventScroll: true });
    const calm =
      document.documentElement.dataset.motion === "calm" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    details.scrollIntoView?.({ behavior: calm ? "auto" : "smooth", block: "start" });
  }

  function revealDetails() {
    setDeeperOpen(true);
    revealRequested.current = true;
    // Already open: the state will not change, so reveal now rather than wait
    // for an effect that will not run.
    if (deeperOpen) {
      revealRequested.current = false;
      focusDetails();
    }
  }

  useEffect(() => {
    if (!deeperOpen || !revealRequested.current) return;
    revealRequested.current = false;
    focusDetails();
  }, [deeperOpen]);

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
  const usdScope = model.usdScope;
  const cashScope = model.cashScope;
  const cardScope = model.cardScope;
  const cashKnown = totalReported(model.cashStatus);
  const cardKnown = totalReported(model.cardStatus);
  const cashEmpty = model.cashStatus === "empty";
  const cardEmpty = model.cardStatus === "empty";
  // A side covered only by excluded or other-currency accounts is not a known
  // USD zero: show a dash and a scope note instead.
  const cashCountable =
    usdScope === "usd" &&
    cashKnown &&
    cashScope !== "all_excluded" &&
    cashScope !== "other_currency_only";
  const cardCountable =
    usdScope === "usd" &&
    cardKnown &&
    cardScope !== "all_excluded" &&
    cardScope !== "other_currency_only";
  const cashText =
    cashScope === "all_excluded" || cashScope === "other_currency_only"
      ? "—"
      : cashEmpty
        ? "No cash accounts"
        : cashKnown
          ? formatMoney(overview.balances.cashKnownTotalMinor)
          : "Not reported";
  const cardText =
    cardScope === "all_excluded" || cardScope === "other_currency_only"
      ? "—"
      : cardEmpty
        ? "No cards tracked"
        : cardKnown
          ? formatMoney(overview.balances.cardKnownTotalMinor)
          : "Not reported";
  const creditText =
    model.availableCreditMinor === null ? "Not reported" : formatMoney(model.availableCreditMinor);
  const usdAccountCount = model.usdCashCount + model.usdCardCount;
  const completeness =
    usdScope === "all_excluded"
      ? "All accounts are excluded from totals"
      : usdScope === "other_currency_only"
        ? "No USD accounts in your net position"
        : model.netStatus === "complete"
          ? `Complete · all ${usdAccountCount} balance${usdAccountCount === 1 ? "" : "s"} reported`
          : model.netStatus === "partial"
            ? `Partial · ${model.usdMissingBalances} of ${usdAccountCount} balances not reported`
            : `Not reported · ${usdAccountCount} of ${usdAccountCount} balances missing`;
  const cashShare = model.cashShare;
  const debtShare = cashShare === null ? null : 100 - cashShare;
  const beamAria = [
    cashCountable
      ? `Known cash ${formatMoney(overview.balances.cashKnownTotalMinor)}${
          cashShare === null ? "" : `, ${cashShare}% of known balances`
        }`
      : cashScope === "other_currency_only"
        ? "Cash in other currencies, outside USD totals"
        : cashScope === "all_excluded"
          ? "Cash excluded from totals"
          : "Cash not reported",
    cardCountable
      ? `card balances ${formatMoney(overview.balances.cardKnownTotalMinor)}${
          debtShare === null ? "" : `, ${debtShare}% of known balances`
        }`
      : cardScope === "other_currency_only"
        ? "card balances in other currencies, outside USD totals"
        : cardScope === "all_excluded"
          ? "card balances excluded from totals"
          : "card balances not reported",
  ].join(" and ");
  const beamNote =
    usdScope === "all_excluded"
      ? "All accounts are excluded from totals"
      : usdScope === "other_currency_only"
        ? "Only other-currency accounts"
        : model.cashStatus === "not_reported" && model.cardStatus === "not_reported"
          ? "Split needs reported balances"
          : model.cashStatus === "not_reported"
            ? "Split needs a cash balance"
            : "Split needs card balances";
  const beamTotalKnownZero =
    usdScope === "usd" &&
    cashCountable &&
    cardCountable &&
    overview.balances.cashKnownTotalMinor + overview.balances.cardKnownTotalMinor === 0;
  const asOf = formatDateOnly(overview.upcoming.asOfDate);
  const excludedCashCount = allCashAccounts.filter((account) => !account.included).length;
  const excludedCardCount = allCardAccounts.filter((account) => !account.included).length;
  const nonUsdCashCount = allCashAccounts.filter(
    (account) => account.included && account.currency !== "USD",
  ).length;
  const nonUsdCardCount = allCardAccounts.filter(
    (account) => account.included && account.currency !== "USD",
  ).length;
  const glanceCash = [...allCashAccounts].sort(
    (a, b) => (b.currentBalanceMinor ?? -1) - (a.currentBalanceMinor ?? -1),
  );
  const glanceCards = [...allCardAccounts].sort(
    (a, b) => (b.currentBalanceMinor ?? -1) - (a.currentBalanceMinor ?? -1),
  );
  const cashPreview = glanceCash.slice(0, 2);
  const cardPreview = glanceCards.slice(0, 3);
  const hiddenCash = glanceCash.length - cashPreview.length;
  const hiddenCards = glanceCards.length - cardPreview.length;
  const paceCopy =
    summary.eligibleCount === 0
      ? dashboard.month === dashboard.currentMonth
        ? "No posted spending this month."
        : `No posted spending in ${monthLabel(dashboard.month)}.`
      : model.pacePercent === null
        ? "Not enough posted activity for a typical month yet."
        : model.pacePercent === 0
          ? "Right on your typical full active month."
          : `${Math.abs(model.pacePercent)}% ${
              model.pacePercent < 0 ? "below" : "above"
            } your typical full active month.`;

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
        <div className="attention-strip">
          <button type="button" className="attention-strip-main" onClick={revealDetails}>
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
          {visibleAttention[0].id === "missing" && onDismissMissingBalance ? (
            <button
              type="button"
              className="attention-strip-dismiss"
              aria-label="Dismiss missing-balance warning"
              title="Dismiss this warning"
              onClick={onDismissMissingBalance}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="wealth-grid">
        <section className="wealth-hero" aria-labelledby="hero-title">
          <div className="wealth-hero-top">
            <div>
              <h2 id="hero-title" className="eyebrow">
                Net position
              </h2>
              <p className="hero-asof">
                Cash minus card balances · <span className="hero-asof-status">{completeness}</span>
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
          <p
            className={`hero-value${
              !hasKnownBalance ? " hero-value-unknown" : net < 0 ? " hero-value-negative" : ""
            }`}
          >
            {hasKnownBalance ? formatSignedMoney(net) : "Not reported"}
          </p>
          <p className="hero-story">
            {!hasKnownBalance
              ? usdScope === "all_excluded"
                ? "All accounts are excluded from totals. Include an account to see a net position."
                : usdScope === "other_currency_only"
                  ? "Only other-currency accounts are included. USD totals need an account in USD."
                  : "No USD balances reported yet. Add an account or sync a bank to complete the picture."
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
                title={
                  cashCountable
                    ? undefined
                    : cashScope === "all_excluded"
                      ? "Cash accounts are excluded from totals"
                      : cashScope === "other_currency_only"
                        ? "Cash is outside the USD totals"
                        : "Cash balance not reported"
                }
              >
                <span className="beam-dot" aria-hidden="true" />
                Cash <strong>{cashText}</strong>
              </span>
              <span
                className="beam-label beam-label-debt"
                title={
                  cardCountable
                    ? undefined
                    : cardScope === "all_excluded"
                      ? "Card balances are excluded from totals"
                      : cardScope === "other_currency_only"
                        ? "Card balances are outside the USD totals"
                        : "Card balances not reported"
                }
              >
                Card balances <strong>{cardText}</strong>
                <span className="beam-dot" aria-hidden="true" />
              </span>
            </div>
            <div
              className={`wealth-beam-track${cashShare === null ? " wealth-beam-unknown" : ""}`}
              role="img"
              aria-label={beamAria}
            >
              {cashShare === null || debtShare === null || usdScope !== "usd" ? (
                <span className="wealth-beam-note">{beamNote}</span>
              ) : beamTotalKnownZero ? (
                <span className="wealth-beam-note">Known balances total $0.00</span>
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
              <strong className={cashEmpty || !cashKnown ? "is-unknown" : undefined}>
                {cashText}
              </strong>
              <span className="hero-mini-note">
                {cashScope === "all_excluded"
                  ? "All cash accounts excluded from totals"
                  : cashScope === "other_currency_only"
                    ? "Only other-currency cash accounts"
                    : cashEmpty
                      ? "Add a bank account"
                      : `${model.usdCashReportedCount} of ${model.usdCashCount} reported${
                          excludedCashCount > 0 ? ` · ${excludedCashCount} not in totals` : ""
                        }${nonUsdCashCount > 0 ? ` · ${nonUsdCashCount} other currency` : ""}`}
              </span>
            </div>
            <div className="hero-mini">
              <span className="hero-mini-label">Card balances</span>
              <strong className={cardEmpty || !cardKnown ? "is-unknown" : undefined}>
                {cardText}
              </strong>
              <span className="hero-mini-note">
                {cardScope === "all_excluded"
                  ? "All cards excluded from totals"
                  : cardScope === "other_currency_only"
                    ? "Only other-currency cards"
                    : cardEmpty
                      ? "Add a card to track borrowing"
                      : `${model.usdCardReportedCount} of ${model.usdCardCount} USD cards reported${
                          excludedCardCount > 0 ? ` · ${excludedCardCount} not in totals` : ""
                        }${nonUsdCardCount > 0 ? ` · ${nonUsdCardCount} other currency` : ""}`}
              </span>
            </div>
            <div className="hero-mini">
              <span className="hero-mini-label">Available credit · USD</span>
              <strong className={model.availableCreditMinor === null ? "is-unknown" : undefined}>
                {creditText}
              </strong>
              <span className="hero-mini-note">
                {model.availableCreditMinor === null
                  ? model.usdCardCount === 0
                    ? "No USD cards"
                    : model.usdCardReportedCount === 0 && model.usdCardCount > 0
                      ? "No card balances reported"
                      : "No reported limits"
                  : `${model.utilizationPercent ?? 0}% used${
                      model.availableCreditPartial ? " · reported limits only" : ""
                    }`}
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
          <div className="quick-read-signal">
            <div className="quick-read-signal-head">
              <span>{topSignal ? "Top category" : "Month signal"}</span>
              <span>
                {topSignal ? `${topSignal.share}% of gross spending` : "No posted spending"}
              </span>
            </div>
            {topSignal ? (
              <>
                <strong>{topSignal.key}</strong>
                <span className="quick-read-signal-amount">
                  {formatMoney(topSignal.grossMinor)}
                </span>
                <span className="quick-read-meter" aria-hidden="true">
                  <span style={{ width: `${topSignal.share}%` }} />
                </span>
              </>
            ) : (
              <span className="quick-read-signal-quiet">
                Nothing posted this month yet. The ledger fills as activity arrives.
              </span>
            )}
          </div>
          {!topSignal ? (
            <img
              className="quick-read-watermark"
              src={brandMarkFor(mode)}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          ) : null}
          <div className="quick-read-foot">
            <p className="fine-print">Estimates use posted activity only. Not financial advice.</p>
            <div className="quick-read-foot-actions">
              <button type="button" className="link-button" onClick={revealDetails}>
                The numbers behind this →
              </button>
              {attention.length === 0 && hasKnownBalance && !dismissedMissingBalance ? (
                <span className="quiet-status">
                  <span className="dot dot-success" aria-hidden="true" /> Everything reported looks
                  current
                </span>
              ) : null}
            </div>
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
                  {glanceCash.length} account{glanceCash.length === 1 ? "" : "s"}
                  {excludedCashCount > 0 ? ` · ${excludedCashCount} not in totals` : ""}
                  {nonUsdCashCount > 0 ? ` · ${nonUsdCashCount} other currency` : ""}
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
                        aria-describedby={`glance-cash-desc-${account.accountId}`}
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
                          {account.currentBalanceMinor === null ? (
                            <span className="is-unknown">Not reported</span>
                          ) : (
                            formatMoney(account.currentBalanceMinor, account.currency)
                          )}
                          {account.balanceStale ? <small>stale</small> : null}
                          {!account.included ? (
                            <small>not in totals</small>
                          ) : account.currency !== "USD" ? (
                            <small>outside USD totals</small>
                          ) : null}
                        </span>
                        <span className="sr-only" id={`glance-cash-desc-${account.accountId}`}>
                          {glanceDescription(account, undefined)}
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
                  {glanceCards.length} account{glanceCards.length === 1 ? "" : "s"}
                  {excludedCardCount > 0 ? ` · ${excludedCardCount} not in totals` : ""}
                  {nonUsdCardCount > 0 ? ` · ${nonUsdCardCount} other currency` : ""}
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
                          aria-describedby={`glance-card-desc-${account.accountId}`}
                        >
                          <span className="glance-avatar glance-avatar-card" aria-hidden="true">
                            <AccountKindIcon kind="card" />
                          </span>
                          <span className="glance-copy">
                            <span className="glance-name">{account.displayName}</span>
                            <span className="glance-meta">
                              {due
                                ? `Due ${formatDateShort(due.dueDate)}${
                                    account.lastFour ? ` · •••• ${account.lastFour}` : ""
                                  }`
                                : account.lastFour
                                  ? `•••• ${account.lastFour}`
                                  : "No due date"}
                            </span>
                          </span>
                          <span className="glance-money">
                            {account.currentBalanceMinor === null ? (
                              <span className="is-unknown">Not reported</span>
                            ) : (
                              formatMoney(account.currentBalanceMinor, account.currency)
                            )}
                            {account.balanceStale ? <small>stale</small> : null}
                            {!account.included ? (
                              <small>not in totals</small>
                            ) : account.currency !== "USD" ? (
                              <small>outside USD totals</small>
                            ) : null}
                          </span>
                          <span className="sr-only" id={`glance-card-desc-${account.accountId}`}>
                            {glanceDescription(account, due)}
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
              {entries.length === 0 ? (
                <p className="fine-print due-subtitle">
                  <span>No payments reported · next {overview.upcoming.windowDays} days</span>
                </p>
              ) : (
                <p className="fine-print due-subtitle">
                  <span>Reported card payments · next {overview.upcoming.windowDays} days ·</span>
                  <span className="due-subtitle-status">
                    {overview.upcoming.unknownAmountCount > 0
                      ? `${overview.upcoming.unknownAmountCount} amount${
                          overview.upcoming.unknownAmountCount === 1 ? "" : "s"
                        } not reported`
                      : "all reported amounts known"}
                  </span>
                </p>
              )}
            </div>
            {entries.length === 0 ? (
              <strong className="due-total due-total-empty">No payments</strong>
            ) : (
              <strong className="due-total">
                {formatMoney(overview.upcoming.knownTotalMinor)}
                <span className="due-total-currency">USD known minimums</span>
              </strong>
            )}
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
                <span>Min due</span>
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
                          ? "Not reported"
                          : formatMoney(balance, account?.currency ?? entry.currency)}
                      </span>
                      <span
                        className={`due-item-amount${entry.amountMinor === null ? " due-unknown" : ""}`}
                      >
                        <span className="sr-only">minimum due </span>
                        {entry.amountMinor === null ? (
                          "Not reported"
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
                : `${
                    model.cashStatus === "partial" ? "Known cash" : "Cash"
                  } after these USD known minimums: ${formatMoney(model.cashAfterUpcomingMinor)}`}
            </span>
            {entries.length > 0 ? (
              <span className="fine-print">
                Only USD amounts with a known minimum reduce the cash-after estimate; unknown,
                excluded, and other-currency values do not.
              </span>
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
              <RankedBars
                data={composition}
                totalMinor={summary.grossPurchasesMinor + summary.feesInterestMinor}
                refundsMinor={summary.refundsMinor}
                netMinor={summary.netSpendingMinor}
              />
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
                <span>
                  {dashboard.month === dashboard.currentMonth
                    ? "This month so far"
                    : monthLabel(dashboard.month)}
                </span>
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
                  {model.typicalMonthMinor === null ? (
                    <>
                      —<span className="sr-only"> Not reported</span>
                    </>
                  ) : (
                    formatMoney(model.typicalMonthMinor)
                  )}
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
              <strong>Limits, connection health, and currencies</strong>
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
                      <div className="attention-actions">
                        {item.actionLabel && item.onAction ? (
                          <Button variant="ghost" className="btn-small" onClick={item.onAction}>
                            {item.actionLabel}
                          </Button>
                        ) : null}
                        {item.id === "missing" && onDismissMissingBalance ? (
                          <button
                            type="button"
                            className="attention-dismiss"
                            aria-label="Dismiss missing-balance warning"
                            title="Dismiss this warning"
                            onClick={onDismissMissingBalance}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quiet-status">
                  <span className="dot dot-success" aria-hidden="true" />{" "}
                  {dismissedMissingBalance
                    ? "Nothing else needs attention."
                    : "Nothing needs attention."}
                </p>
              )}
              {dismissedMissingBalance ? (
                <p className="attention-dismissed">
                  Missing-balance warning dismissed.
                  {onRestoreMissingBalance ? (
                    <button type="button" className="link-button" onClick={onRestoreMissingBalance}>
                      Restore
                    </button>
                  ) : null}
                </p>
              ) : null}
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
                  <dt>Eligible rows · USD</dt>
                  <dd>{summary.eligibleCount}</dd>
                </div>
                <div>
                  <dt>Pending rows · all currencies</dt>
                  <dd>{summary.pendingCount}</dd>
                </div>
                <div>
                  <dt>All rows · all currencies</dt>
                  <dd>{summary.rowCount}</dd>
                </div>
              </dl>
              <p className="fine-print month-reconcile">
                {summary.reconciliation.exact
                  ? "USD supplier and category totals reconcile exactly to eligible spending."
                  : "USD supplier and category totals do not reconcile to eligible spending; review the ledger."}
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
