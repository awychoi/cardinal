import { useEffect, useState, type ReactNode } from "react";
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
import { CardsView } from "../features/dashboard/CardsView";
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
import { formatMonthRange, monthLabel } from "../lib/formatting";
import type { Theme, ThemeMode } from "../theme/schema";

type View = "overview" | "cards" | "transactions" | "settings";

const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "cards", label: "Cards" },
  { id: "transactions", label: "Transactions" },
  { id: "settings", label: "Settings" },
];

const NAV_ICONS: Record<View, string> = {
  overview: "M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z",
  cards: "M1.5 3.5h13v9h-13zM1.5 6.5h13",
  transactions: "M2 4h12M2 8h12M2 12h7",
  settings: "M2 5.5h12M2 10.5h12",
};

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
  const demo = vault.mode === "demo";
  // There is no ledger beyond the current month; browsing into the future only
  // shows empty months that can never have data.
  const atCurrentMonth = dashboard ? dashboard.month >= dashboard.currentMonth : true;
  const navigationStyle = vault.settings?.navigation ?? "sidebar";
  const sidebar = navigationStyle === "sidebar";

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
      {demo ? <span className="status-pill status-warn">Demo</span> : null}
    </div>
  );

  const navigation = (
    <nav className={sidebar ? "side-nav" : "nav"} aria-label="Primary">
      {VIEWS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            sidebar
              ? `side-nav-item${view === item.id ? " side-nav-item-active" : ""}`
              : `nav-item${view === item.id ? " nav-item-active" : ""}`
          }
          aria-current={view === item.id ? "page" : undefined}
          onClick={() => {
            if (item.id === "settings") setSettingsTarget(null);
            setView(item.id);
          }}
        >
          {sidebar ? (
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d={NAV_ICONS[item.id]} />
            </svg>
          ) : null}
          {item.label}
        </button>
      ))}
    </nav>
  );

  const lockButton = (
    <Button variant="ghost" aria-label="Lock now" onClick={() => void onLock()}>
      {demo ? "Exit demo" : "Lock"}
    </Button>
  );

  return (
    <div className={`app ${sidebar ? "app-sidebar" : "app-topbar"}`} data-nav={navigationStyle}>
      {sidebar ? (
        <aside className="sidebar">
          {brand}
          {navigation}
          <div className="side-foot">
            {themeControl}
            {lockButton}
            <div className="side-meta">
              <div className="side-status">
                <span
                  className={connectionError && !demo ? "dot sync-dot-warn" : "dot dot-muted"}
                  aria-hidden="true"
                />
                <span className="side-status-label">
                  {demo ? "Demo ledger" : "Encrypted ledger"}
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

          <div className="month-nav" aria-label="Selected calendar month">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous month"
              disabled={!dashboard}
              onClick={() => dashboard && setMonth(dashboard.previousMonth)}
            >
              ‹
            </button>
            <div className="month-display">
              <span className="month-label">{dashboard ? monthLabel(dashboard.month) : "—"}</span>
              <span className="month-range">
                {dashboard ? formatMonthRange(dashboard.startDate, dashboard.endDateExclusive) : ""}
              </span>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next month"
              disabled={!dashboard || atCurrentMonth}
              onClick={() => dashboard && setMonth(dashboard.nextMonth)}
            >
              ›
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={!dashboard || dashboard.month === dashboard.currentMonth}
              onClick={() => setMonth(null)}
            >
              This month
            </button>
          </div>

          <div className="header-actions">
            <span
              className="sync-state"
              role={syncNote ? "status" : undefined}
              title={syncNote ?? undefined}
            >
              <span
                className={connectionError && !demo ? "dot sync-dot-warn" : "dot dot-muted"}
                aria-hidden="true"
              />
              {syncNote ?? syncLabel}
            </span>
            {!demo && connections.length > 0 ? (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => void runSyncNow()}
                disabled={syncing}
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            ) : (
              <button type="button" className="btn btn-secondary btn-small" disabled>
                Sync now
              </button>
            )}
            {sidebar ? null : themeControl}
            {sidebar ? null : lockButton}
          </div>
        </header>

        {demo ? (
          <div className="demo-banner demo-banner-strong" role="status">
            <strong>Demo mode — synthetic data.</strong>
            <span>
              {" "}
              Separate database. No real ledger, provider, Keychain, import, backup, or export.
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
        ) : null}

        {usingMock ? (
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

        <main className="content" id="main-content">
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
                onAddAccount={addAccount}
                onOpenCards={() => setView("cards")}
                onOpenSettings={() => openSettings("accounts", "connections")}
                onOpenTransactions={() => setView("transactions")}
              />
            ) : view === "cards" ? (
              <CardsView dashboard={dashboard} theme={theme} onFilterAccount={filterAccount} />
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
