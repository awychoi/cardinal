import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  command,
  type AppInfo,
  type Dashboard,
  type Settings,
  type SyncStatus,
  type VaultState,
} from "../lib/bridge";
import { friendlyError } from "../lib/bridge/errors";
import { OverviewView } from "../features/dashboard/OverviewView";
import { OverviewSkeleton } from "../features/dashboard/OverviewSkeleton";
import { AccountsView } from "../features/dashboard/AccountsView";
import { LedgerView } from "../features/dashboard/LedgerView";
import {
  SettingsView,
  type AccountsTabId,
  type SettingsSectionId,
} from "../features/settings/SettingsView";
import { BrandLogo } from "../components/BrandLogo";
import { RelativeAge } from "../components/RelativeAge";
import { MakerLink } from "../components/MadeBy";
import { Button } from "../components/Button";
import { formatMoney, formatMonthRange, formatSignedMoney, monthLabel } from "../lib/formatting";
import { buildWealthModel, totalReported } from "../features/dashboard/wealthModel";
import type { Theme, ThemeMode } from "../theme/schema";

type View = "overview" | "accounts" | "transactions" | "settings";

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "overview", label: "Overview", hint: "The big picture" },
  { id: "accounts", label: "Accounts", hint: "What you own and owe" },
  { id: "transactions", label: "Transactions", hint: "Every movement" },
  { id: "settings", label: "Settings", hint: "Make it yours" },
];

const VIEW_GROUPS: { id: string; label: string; views: View[] }[] = [
  { id: "money", label: "Your money", views: ["overview", "accounts", "transactions"] },
  { id: "vault", label: "The vault", views: ["settings"] },
];

function NavIcon({ view }: { view: View }) {
  switch (view) {
    case "overview":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M2.25 8 8 2.75 13.75 8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3.6 6.9v6.35h8.8V6.9" strokeLinejoin="round" />
          <path d="M6.4 13.25v-3.6h3.2v3.6" strokeLinejoin="round" />
        </svg>
      );
    case "accounts":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M8 2.2v11.6M3.1 4.1h9.8" strokeLinecap="round" />
          <path
            d="m4.5 4.1-2.2 4.4h4.4L4.5 4.1ZM11.5 4.1l-2.2 4.4h4.4L11.5 4.1Z"
            strokeLinejoin="round"
          />
          <path d="M5.4 13.8h5.2" strokeLinecap="round" />
        </svg>
      );
    case "transactions":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path
            d="M2.6 5.1h10.1M10.2 2.6l2.5 2.5-2.5 2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13.4 10.9H3.3M5.8 8.4l-2.5 2.5 2.5 2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h10.8" strokeLinecap="round" />
          <circle cx="5.2" cy="4.4" r="1.5" fill="var(--sidebar)" />
          <circle cx="10.4" cy="8" r="1.5" fill="var(--sidebar)" />
          <circle cx="6.8" cy="11.6" r="1.5" fill="var(--sidebar)" />
        </svg>
      );
  }
}

export function AppShell({
  info,
  vault,
  theme,
  mode,
  usingMock,
  notice,
  onDismissNotice,
  onLock,
  onSettingsChanged,
  onExitDemo,
  onResetDemo,
  onOpenDemo,
  onVaultChanged,
  themeControl,
  sessionNonce,
}: {
  info: AppInfo;
  vault: VaultState;
  theme: Theme;
  mode: ThemeMode;
  usingMock: boolean;
  notice: string | null;
  onDismissNotice: () => void;
  onLock: () => Promise<void>;
  onSettingsChanged: (settings: Settings) => void;
  onExitDemo: () => Promise<void>;
  onResetDemo: () => Promise<void>;
  onOpenDemo: () => Promise<void>;
  onVaultChanged: (vault: VaultState) => void;
  themeControl: ReactNode;
  sessionNonce: number;
}) {
  const [view, setView] = useState<View>("overview");
  const [month, setMonth] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [preset, setPreset] = useState<{
    accountId: string | null;
    search: string | null;
    nonce: number;
  }>({
    accountId: null,
    search: null,
    nonce: 0,
  });
  const [resetConfirm, setResetConfirm] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<{
    section: SettingsSectionId;
    accountsTab?: AccountsTabId;
  } | null>(null);
  const [dismissedMissingCount, setDismissedMissingCount] = useState<number | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const previousView = useRef<View | null>(null);
  const previousMonth = useRef<string | null>(null);
  const demo = vault.mode === "demo";
  // There is no ledger beyond the current month; browsing into the future only
  // shows empty months that can never have data.
  const atCurrentMonth = dashboard ? dashboard.month >= dashboard.currentMonth : true;
  const navigationStyle = vault.settings?.navigation ?? "sidebar";
  const sidebar = navigationStyle === "sidebar";

  // A view switch is a page change: move focus into the new content rather
  // than leaving it on a button and letting the next Tab start from the top.
  // The first render is deliberately skipped so loading the app never steals
  // focus from the opening screen.
  useEffect(() => {
    if (previousView.current === null) {
      previousView.current = view;
      return;
    }
    if (previousView.current === view) return;
    previousView.current = view;
    setLiveMessage(VIEWS.find((item) => item.id === view)?.label ?? view);
    const focusMain = () => {
      mainRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    if (typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(focusMain);
      return () => window.cancelAnimationFrame(frame);
    }
    const timeout = window.setTimeout(focusMain, 0);
    return () => window.clearTimeout(timeout);
  }, [view]);

  useEffect(() => {
    const nextMonth = dashboard?.month;
    if (!nextMonth) return;
    if (previousMonth.current === null) {
      previousMonth.current = nextMonth;
      return;
    }
    if (previousMonth.current === nextMonth) return;
    previousMonth.current = nextMonth;
    setLiveMessage(
      `${monthLabel(nextMonth)}${nextMonth === dashboard?.currentMonth ? ", current month" : ""}`,
    );
  }, [dashboard?.month, dashboard?.currentMonth]);

  useEffect(() => {
    if (demo) {
      setSyncStatus(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await command("sync_status", {});
        if (!cancelled) setSyncStatus(result);
      } catch {
        // Dashboard remains usable if status cannot be loaded; the panel shows details.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, refresh, sessionNonce]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const result = await command("dashboard_get", { month });
        if (!cancelled) setDashboard(result);
      } catch (caught) {
        if (!cancelled) setError(friendlyError(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, refresh, sessionNonce]);

  function filterAccount(accountId: string) {
    setPreset({ accountId, search: null, nonce: Date.now() });
    setView("transactions");
  }

  function openSettings(section: SettingsSectionId, accountsTab?: AccountsTabId) {
    setSettingsTarget({ section, ...(accountsTab ? { accountsTab } : {}) });
    setView("settings");
  }

  function addAccount() {
    openSettings("accounts", "accounts");
  }

  const connections = syncStatus?.connections ?? [];
  const connectionError = connections.some((connection) => connection.status !== "healthy");
  const latestSuccess = connections
    .map((connection) => connection.lastSuccessAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  // A live age ("12 seconds ago"), not a UTC date slice: the slice could land on
  // the wrong local day and never said how fresh the sync actually was.
  const syncLabel: ReactNode = demo ? (
    "Synthetic demo data"
  ) : connections.length === 0 ? (
    "No provider connected"
  ) : connectionError ? (
    "Provider needs attention"
  ) : (
    <>
      {connections.length} connection{connections.length === 1 ? "" : "s"} ·{" "}
      {latestSuccess ? (
        <>
          synced <RelativeAge at={latestSuccess} />
        </>
      ) : (
        "not synced yet"
      )}
    </>
  );

  async function runSyncNow() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const summary = await command("sync_now", {});
      if (!summary.accepted) {
        setSyncNote(
          summary.skipReason === "no_connections"
            ? "No provider connected."
            : `Sync skipped: ${summary.skipReason?.replaceAll("_", " ") ?? "unknown"}.`,
        );
      } else {
        const added = summary.results.reduce((sum, result) => sum + result.transactionsAdded, 0);
        const failed = summary.results.filter((result) => result.status === "failed").length;
        setSyncNote(
          `Sync complete: ${added} new transaction(s)${failed ? `, ${failed} failed` : ""}.`,
        );
      }
      setRefresh((value) => value + 1);
    } catch (caught) {
      setSyncNote(friendlyError(caught));
    } finally {
      setSyncing(false);
    }
  }

  const brand = (
    <div className="brand">
      <BrandLogo mode={mode} />
      {demo ? <span className="status-pill status-warn demo-pill">Demo</span> : null}
    </div>
  );

  const navCounts: Partial<Record<View, number>> = dashboard
    ? {
        accounts: dashboard.overview.accounts.filter((account) => account.included).length,
        // Row count already includes every visible row in the month, all
        // currencies. Other-currency rows are a subset, not an addition.
        transactions: dashboard.summary.rowCount,
      }
    : {};

  const navigation = (
    <nav className={sidebar ? "side-nav" : "nav"} aria-label="Primary">
      {VIEW_GROUPS.map((group) => (
        <div className="nav-group" key={group.id}>
          <span className="nav-eyebrow" aria-hidden="true">
            {group.label}
          </span>
          {group.views.map((viewId) => {
            const item = VIEWS.find((candidate) => candidate.id === viewId);
            if (!item) return null;
            const count = navCounts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className={
                  sidebar
                    ? `side-nav-item${view === item.id ? " side-nav-item-active" : ""}`
                    : `nav-item${view === item.id ? " nav-item-active" : ""}`
                }
                aria-current={view === item.id ? "page" : undefined}
                aria-label={item.label}
                title={item.hint}
                onClick={() => {
                  if (item.id === "settings") setSettingsTarget(null);
                  setView(item.id);
                }}
              >
                <span className="nav-icon" aria-hidden="true">
                  <NavIcon view={item.id} />
                </span>
                <span className="nav-copy">
                  <span className="nav-label">{item.label}</span>
                  {!sidebar ? <span className="nav-hint">{item.hint}</span> : null}
                </span>
                {count && count > 0 ? (
                  <span className="nav-count" aria-hidden="true">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const lockButton = (
    <Button
      variant="ghost"
      aria-label={demo ? "Exit demo" : "Lock now"}
      className="lock-button"
      onClick={() => void (demo ? onExitDemo() : onLock())}
    >
      {demo ? "Exit demo" : "Lock"}
    </Button>
  );

  const balances = dashboard?.overview.balances;
  const allAccounts = dashboard?.overview.accounts ?? [];
  const wealth = dashboard ? buildWealthModel(dashboard, null) : null;
  const noAccounts = allAccounts.length === 0;
  const allExcluded = wealth?.usdScope === "all_excluded";
  const otherCurrencyOnly = wealth?.usdScope === "other_currency_only";
  const usdPosition = wealth?.usdScope === "usd";
  const missingBalanceCount = wealth?.usdMissingBalances ?? 0;
  const missingBalanceDismissed =
    dismissedMissingCount !== null &&
    missingBalanceCount > 0 &&
    missingBalanceCount <= dismissedMissingCount;

  useEffect(() => {
    if (missingBalanceCount === 0) setDismissedMissingCount(null);
  }, [missingBalanceCount]);

  function dismissMissingBalance() {
    if (missingBalanceCount > 0) setDismissedMissingCount(missingBalanceCount);
  }

  function restoreMissingBalance() {
    setDismissedMissingCount(null);
  }

  const cashKnown = wealth ? totalReported(wealth.cashStatus) : false;
  const cardKnown = wealth ? totalReported(wealth.cardStatus) : false;
  // A side covered only by excluded or other-currency accounts is not a known
  // USD zero: show a dash and explain the scope instead.
  const cashCountable =
    usdPosition &&
    cashKnown &&
    wealth?.cashScope !== "all_excluded" &&
    wealth?.cashScope !== "other_currency_only";
  const cardCountable =
    usdPosition &&
    cardKnown &&
    wealth?.cardScope !== "all_excluded" &&
    wealth?.cardScope !== "other_currency_only";
  const netKnown =
    usdPosition &&
    wealth !== null &&
    wealth.netStatus !== "not_reported" &&
    wealth.netStatus !== "empty";
  const usdAccountCount = wealth ? wealth.usdCashCount + wealth.usdCardCount : 0;
  const completeness =
    wealth === null
      ? ""
      : noAccounts
        ? "No accounts yet"
        : allExcluded
          ? "All accounts are excluded from totals"
          : otherCurrencyOnly
            ? "No USD accounts in your net position"
            : wealth.netStatus === "complete"
              ? `Complete · all ${usdAccountCount} balance${usdAccountCount === 1 ? "" : "s"} reported`
              : wealth.netStatus === "partial"
                ? `Partial · ${wealth.usdMissingBalances} of ${usdAccountCount} balances not reported`
                : `Not reported · ${usdAccountCount} of ${usdAccountCount} balances missing`;
  const sideNote = (
    countable: boolean,
    scope: string | undefined,
    emptyLabel: string,
  ): string | null => {
    if (countable) return null;
    if (scope === "empty") return emptyLabel;
    if (scope === "all_excluded") return "Excluded from totals";
    if (scope === "other_currency_only") return "Only other currency";
    return "Not reported";
  };
  const cashSide =
    balances && !noAccounts && cashCountable ? formatMoney(balances.cashKnownTotalMinor) : "—";
  const cardSide =
    balances && !noAccounts && cardCountable ? formatMoney(balances.cardKnownTotalMinor) : "—";
  const netSide =
    balances && !noAccounts && netKnown ? formatSignedMoney(balances.netPositionMinor) : "—";

  const sideNet = dashboard ? (
    <div className="side-net" aria-label="Current net position">
      <div className="side-net-head">
        <span className="side-net-label">Net position</span>
        <span className="side-net-asof">current</span>
      </div>
      <strong
        className={`side-net-value${!netKnown ? " is-unknown" : ""}${
          netKnown && balances && balances.netPositionMinor < 0 ? " is-negative" : ""
        }`}
      >
        {netSide}
      </strong>
      {!netKnown && !noAccounts ? (
        <span className="side-net-value-note">
          {allExcluded
            ? "All accounts are excluded from totals"
            : otherCurrencyOnly
              ? "No USD accounts in your net position"
              : "Not reported"}
        </span>
      ) : null}
      <div className="side-net-split">
        <span>
          <span className="side-net-key">Cash</span>
          <span className={cashCountable ? undefined : "side-net-unknown"}>
            {cashSide}
            {cashCountable ? null : (
              <span className="sr-only">
                {" "}
                {sideNote(false, wealth?.cashScope, "No cash accounts")}
              </span>
            )}
          </span>
        </span>
        <span>
          <span className="side-net-key">Owed</span>
          <span className={cardCountable ? undefined : "side-net-unknown"}>
            {cardSide}
            {cardCountable ? null : (
              <span className="sr-only">
                {" "}
                {sideNote(false, wealth?.cardScope, "No cards tracked")}
              </span>
            )}
          </span>
        </span>
      </div>
      <div className="side-net-foot">
        {noAccounts ? (
          <span>{completeness}</span>
        ) : (
          <>
            <span>
              {wealth?.usdCashCount ?? 0} USD cash · {wealth?.usdCardCount ?? 0} USD card
              {(wealth?.usdCardCount ?? 0) === 1 ? "" : "s"}
            </span>
            <span className="side-net-completeness">{completeness}</span>
          </>
        )}
      </div>
      <button type="button" className="side-add" onClick={addAccount}>
        <span aria-hidden="true">+</span> Add an account
      </button>
    </div>
  ) : (
    <div className="side-net side-net-loading" aria-hidden="true">
      <span className="skeleton-block skeleton-line skeleton-line-short" />
      <span className="skeleton-block skeleton-line" />
      <span className="skeleton-block skeleton-line skeleton-line-mid" />
    </div>
  );

  return (
    <div className={`app ${sidebar ? "app-sidebar" : "app-topbar"}`} data-nav={navigationStyle}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus({ preventScroll: true });
          window.scrollTo({ top: 0, behavior: "auto" });
        }}
      >
        Skip to content
      </a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>
      {sidebar ? (
        <aside className="sidebar" aria-label="Wealth sidebar">
          <div className="sidebar-head">{brand}</div>
          {sideNet}
          {navigation}
          <div className="side-foot">
            <div className="side-controls">
              {themeControl}
              {lockButton}
            </div>
            <div className="side-meta">
              <div className="side-status">
                <span
                  className={connectionError && !demo ? "dot sync-dot-warn" : "dot dot-success"}
                  aria-hidden="true"
                />
                <span className="side-status-label">
                  {demo
                    ? "Synthetic demo ledger"
                    : connectionError
                      ? "Encrypted ledger · attention needed"
                      : "Encrypted ledger"}
                </span>
              </div>
              <span className="side-version">
                v{info.version} · by awychoi · <MakerLink />
              </span>
            </div>
          </div>
        </aside>
      ) : null}

      <div className="app-main">
        <header className="header">
          {sidebar ? null : brand}

          {view === "settings" ? (
            <div className="header-context">
              <span className="header-context-mark" aria-hidden="true" />
              <span>
                <span className="header-context-kicker">Encrypted preferences</span>
                <span className="header-context-title">Kept on this Mac</span>
              </span>
            </div>
          ) : (
            <div className="month-nav" aria-label="Selected calendar month">
              <span className="month-nav-caption" aria-hidden="true">
                Spending month
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Previous month"
                title={!dashboard ? "The dashboard is still loading" : undefined}
                disabled={!dashboard}
                onClick={() => dashboard && setMonth(dashboard.previousMonth)}
              >
                ‹
              </button>
              <div className="month-display">
                <span className="month-label">{dashboard ? monthLabel(dashboard.month) : "—"}</span>
                <span className="month-range">
                  {dashboard
                    ? formatMonthRange(dashboard.startDate, dashboard.endDateExclusive)
                    : ""}
                </span>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Next month"
                title={
                  !dashboard
                    ? "The dashboard is still loading"
                    : atCurrentMonth
                      ? "You’re viewing the current month"
                      : undefined
                }
                disabled={!dashboard || atCurrentMonth}
                onClick={() => dashboard && setMonth(dashboard.nextMonth)}
              >
                ›
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small this-month"
                title={
                  !dashboard
                    ? "The dashboard is still loading"
                    : dashboard.month === dashboard.currentMonth
                      ? "You’re viewing the current month"
                      : undefined
                }
                disabled={!dashboard || dashboard.month === dashboard.currentMonth}
                onClick={() => setMonth(null)}
              >
                This month
              </button>
            </div>
          )}

          <div className="header-actions">
            <span
              className="sync-state"
              role={syncNote ? "status" : undefined}
              title={syncNote ?? "Balances and the ledger sync from the encrypted store."}
            >
              <span
                className={connectionError && !demo ? "dot sync-dot-warn" : "dot dot-success"}
                aria-hidden="true"
              />
              {syncNote ?? syncLabel}
            </span>
            {!demo && connections.length > 0 ? (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                title={syncing ? "A sync is already running" : undefined}
                onClick={() => void runSyncNow()}
                disabled={syncing}
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                title={demo ? "Demo mode has no provider to sync" : "No provider connected"}
                disabled
              >
                Sync now
              </button>
            )}
            {sidebar ? null : themeControl}
            {sidebar ? null : lockButton}
          </div>
        </header>

        {demo ? (
          <div className="demo-banner demo-banner-demo" role="status">
            <span className="demo-banner-copy">
              <strong>Demo mode — synthetic data.</strong>
              {usingMock ? " Mock desktop bridge — browser test mode." : ""} Separate database. No
              real ledger, provider, Keychain, import, backup, or export.
            </span>
            <span className="banner-actions">
              {resetConfirm ? (
                <>
                  <span>Reset demo data?</span>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => {
                      setResetConfirm(false);
                      void onResetDemo();
                    }}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    onClick={() => setResetConfirm(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    onClick={() => setResetConfirm(true)}
                  >
                    Reset demo
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    onClick={() => void onExitDemo()}
                  >
                    Exit demo
                  </button>
                </>
              )}
            </span>
          </div>
        ) : usingMock ? (
          <div className="demo-banner" role="status">
            Mock desktop bridge — browser test mode. No real ledger is open.
          </div>
        ) : null}

        {notice ? (
          <div className="notice-bar" role="status">
            <span>{notice}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss notice"
              onClick={onDismissNotice}
            >
              ×
            </button>
          </div>
        ) : null}

        {sidebar ? null : navigation}

        <main className="content" id="main-content" ref={mainRef} tabIndex={-1}>
          {error ? (
            <section className="empty-state" role="alert">
              <h1>Dashboard unavailable</h1>
              <p className="error-text">{error}</p>
              <Button variant="primary" onClick={() => setRefresh((value) => value + 1)}>
                Retry
              </Button>
            </section>
          ) : loading && !dashboard ? (
            <OverviewSkeleton />
          ) : dashboard ? (
            view === "overview" ? (
              <OverviewView
                dashboard={dashboard}
                theme={theme}
                mode={mode}
                onAddAccount={addAccount}
                onOpenAccounts={() => setView("accounts")}
                onOpenSettings={() => openSettings("accounts", "connections")}
                onOpenTransactions={() => setView("transactions")}
                onOpenAccount={filterAccount}
                dismissedMissingBalance={missingBalanceDismissed}
                onDismissMissingBalance={dismissMissingBalance}
                onRestoreMissingBalance={restoreMissingBalance}
              />
            ) : view === "accounts" ? (
              <AccountsView
                dashboard={dashboard}
                theme={theme}
                onFilterAccount={filterAccount}
                onAddAccount={addAccount}
              />
            ) : view === "transactions" ? (
              <LedgerView
                dashboard={dashboard}
                presetAccountId={preset.accountId}
                presetSearch={preset.search}
                presetNonce={preset.nonce}
                onClearPreset={() => setPreset({ accountId: null, search: null, nonce: 0 })}
                onChanged={() => setRefresh((value) => value + 1)}
                onChangeMonth={(next) => setMonth(next)}
                readOnly={demo}
              />
            ) : (
              <SettingsView
                key={`${vault.mode}-${sessionNonce}`}
                vault={vault}
                onSettingsChanged={onSettingsChanged}
                onLock={onLock}
                onAccountsChanged={() => setRefresh((value) => value + 1)}
                onDataChanged={() => setRefresh((value) => value + 1)}
                onVaultChanged={onVaultChanged}
                demo={demo}
                onOpenDemo={onOpenDemo}
                onResetDemo={onResetDemo}
                initialSection={settingsTarget?.section}
                initialAccountsTab={settingsTarget?.accountsTab}
              />
            )
          ) : (
            <p className="muted">No dashboard data available.</p>
          )}
        </main>
      </div>
    </div>
  );
}
