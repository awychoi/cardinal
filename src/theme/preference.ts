import { THEME_IDS } from "./index";

/**
 * The last selected theme id, kept outside the encrypted settings so the
 * bridge-opening and locked screens can render in the same visual language
 * before the vault is unlocked. A theme id is not financial data or a secret;
 * this is the only renderer storage the app writes.
 */
export const THEME_KEY = "cardinal.theme";

export function readRememberedThemeId(): string | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value && THEME_IDS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberThemeId(themeId: string): void {
  if (!THEME_IDS.includes(themeId)) return;
  try {
    window.localStorage.setItem(THEME_KEY, themeId);
  } catch {
    // Storage may be unavailable; the in-memory memo still covers this session.
  }
}
