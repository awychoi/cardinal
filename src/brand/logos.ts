import dark from "../assets/brand/cardinal-mark-dark.svg";
import light from "../assets/brand/cardinal-mark.svg";
import type { ThemeMode } from "../theme/schema";

/**
 * The Cardinal mark: a geometric cardinal with a rounded credit-card corner.
 *
 * The primary mark is ink-on-light; the dark variant swaps only the beak to
 * cream so the bird survives on dark surfaces. The wordmark is drawn by
 * `BrandLogo` in the brand serif, so these assets are the symbol only.
 */
export const BRAND_MARKS: Record<ThemeMode, string> = { dark, light };

/** Resolve a resolved theme mode to the mark that reads against it. */
export function brandMarkFor(mode: ThemeMode | null | undefined): string {
  return mode === "light" ? BRAND_MARKS.light : BRAND_MARKS.dark;
}
