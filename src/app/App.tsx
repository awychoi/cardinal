import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AppShell } from "./AppShell";
import { ThemeToggle } from "../components/ThemeToggle";
import { VaultGate } from "../features/vault/VaultGate";
import { OnboardingWizard } from "../features/onboarding/OnboardingWizard";
import {
  command,
  usingMockBridge,
  type AppInfo,
  type Settings,
  type VaultState,
} from "../lib/bridge";
import { friendlyError } from "../lib/bridge/errors";
import { logEvent } from "../lib/logging";
import { applyTheme } from "../theme/apply";
import { DEFAULT_THEME_ID, getTheme, resolveMode } from "../theme";
import { readRememberedThemeId, rememberThemeId } from "../theme/preference";

type Boot =
  | { kind: "loading" }
  | { kind: "ready"; info: AppInfo; vault: VaultState }
  | { kind: "error"; message: string };

const THEME_MEDIA = "(prefers-color-scheme: dark)";

/** Track the OS appearance so the lockup can follow a "system" preference. */
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia?.(THEME_MEDIA).matches ?? false,
  );

  useEffect(() => {
    const media = window.matchMedia?.(THEME_MEDIA);
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  return prefersDark;
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionNonce, setSessionNonce] = useState(0);
  // Theme ids are not sensitive. The last one is persisted separately so the
  // opening and locked screens keep the same visual language after relaunch.
  const [rememberedThemeId, setRememberedThemeId] = useState(
    () => readRememberedThemeId() ?? DEFAULT_THEME_ID,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [info, health, vault] = await Promise.all([
          command("app_info", {}),
          command("health_check", {}),
          command("vault_status", {}),
        ]);
        if (!cancelled && health.ok) setBoot({ kind: "ready", info, vault });
      } catch (error) {
        if (cancelled) return;
        setBoot({ kind: "error", message: friendlyError(error) });
        logEvent("bridge_error", { ok: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const themePreference: Settings["theme"] =
    boot.kind === "ready" ? (boot.vault.settings?.theme ?? "system") : "system";
  const bootThemeId = boot.kind === "ready" ? boot.vault.settings?.themeId : undefined;
  const theme = getTheme(bootThemeId ?? rememberedThemeId);
  const prefersDark = useSystemPrefersDark();
  const mode = resolveMode(themePreference, prefersDark);

  useEffect(() => {
    if (bootThemeId) {
      setRememberedThemeId(bootThemeId);
      rememberThemeId(bootThemeId);
    }
  }, [bootThemeId]);

  // Apply before paint so the opening and locked screens never flash the
  // fallback Blueprint styling when a rounded theme is remembered.
  useLayoutEffect(() => {
    applyTheme(theme, mode);
  }, [theme, mode]);

  // The Rust side enforces the lock; this listener only clears the renderer.
  useEffect(() => {
    if (usingMockBridge) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stop = await listen("vault:locked", () => {
          setNotice("The vault was locked.");
          setBoot((current) =>
            current.kind === "ready"
              ? {
                  ...current,
                  vault: { ...current.vault, unlocked: false, settings: null, security: null },
                }
              : current,
          );
        });
        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        // If event subscription fails the UI still cannot read the ledger: the
        // Rust session is already closed and commands fail with vault_locked.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleOpened = useCallback((vault: VaultState) => {
    setNotice(null);
    setBoot((current) => (current.kind === "ready" ? { ...current, vault } : current));
  }, []);

  const handleLock = useCallback(async () => {
    try {
      const vault = await command("vault_lock", {});
      setNotice("The vault is locked.");
      setBoot((current) => (current.kind === "ready" ? { ...current, vault } : current));
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }, []);

  const handleSettingsChanged = useCallback((settings: Settings) => {
    setBoot((current) =>
      current.kind === "ready" ? { ...current, vault: { ...current.vault, settings } } : current,
    );
  }, []);

  const handleTheme = useCallback(
    async (next: Settings["theme"]) => {
      if (boot.kind !== "ready" || !boot.vault.unlocked) {
        applyTheme(theme, resolveMode(next, prefersDark));
        return;
      }
      try {
        const result = await command("settings_update", { theme: next });
        handleSettingsChanged(result.settings);
      } catch (error) {
        setNotice(friendlyError(error));
      }
    },
    [boot, handleSettingsChanged, prefersDark, theme],
  );

  const handleDemoOpen = useCallback(async () => {
    try {
      const vault = await command("demo_open", {});
      setNotice("Demo mode opened with synthetic data.");
      setBoot((current) => (current.kind === "ready" ? { ...current, vault } : current));
      setSessionNonce((value) => value + 1);
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }, []);

  const handleDemoExit = useCallback(async () => {
    try {
      const vault = await command("demo_close", {});
      setNotice("Demo mode closed. The real vault is still locked.");
      setBoot((current) => (current.kind === "ready" ? { ...current, vault } : current));
      setSessionNonce((value) => value + 1);
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }, []);

  const handleDemoReset = useCallback(async () => {
    try {
      const vault = await command("demo_reset", {});
      setNotice("Demo data was recreated.");
      setBoot((current) => (current.kind === "ready" ? { ...current, vault } : current));
      setSessionNonce((value) => value + 1);
    } catch (error) {
      setNotice(friendlyError(error));
    }
  }, []);

  if (boot.kind === "loading") {
    return (
      <main className="boot-screen" aria-labelledby="app-title" aria-busy="true">
        <div className="boot-card">
          <h1 id="app-title">
            <BrandLogo className="boot-logo" mode={mode} />
          </h1>
          <p className="muted">Local-first, encrypted personal card ledger.</p>
          <p className="status" role="status">
            Opening the secure bridge…
          </p>
          <p className="fine-print">
            Your ledger password is collected by a native macOS sheet and never enters this window.
          </p>
        </div>
      </main>
    );
  }

  if (boot.kind === "error") {
    return (
      <main className="boot-screen" role="alert">
        <div className="boot-card">
          <h1>
            <BrandLogo className="boot-logo" mode={mode} />
          </h1>
          <p className="error-text">{boot.message}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
          <p className="fine-print">
            No ledger data is displayed while the secure bridge is unavailable.
          </p>
        </div>
      </main>
    );
  }

  if (!boot.vault.unlocked) {
    return (
      <>
        <VaultGate exists={boot.vault.exists} mode={mode} onOpened={handleOpened} />
        <div className="gate-banner" role="status">
          {usingMockBridge ? "Mock desktop bridge — browser test mode." : ""}
        </div>
      </>
    );
  }

  if (boot.vault.settings && !boot.vault.settings.onboardingCompleted) {
    return (
      <OnboardingWizard
        mode={mode}
        settings={boot.vault.settings}
        onSettingsChanged={handleSettingsChanged}
        onFinished={handleSettingsChanged}
      />
    );
  }

  return (
    <ErrorBoundary mode={mode}>
      <AppShell
        info={boot.info}
        vault={boot.vault}
        theme={theme}
        mode={mode}
        usingMock={usingMockBridge}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onLock={handleLock}
        onSettingsChanged={handleSettingsChanged}
        onExitDemo={handleDemoExit}
        onResetDemo={handleDemoReset}
        onOpenDemo={handleDemoOpen}
        onVaultChanged={handleOpened}
        themeControl={<ThemeToggle theme={themePreference} onChange={handleTheme} />}
        sessionNonce={sessionNonce}
      />
    </ErrorBoundary>
  );
}
