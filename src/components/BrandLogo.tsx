import { brandMarkFor } from "../brand/logos";
import type { ThemeMode } from "../theme/schema";

/**
 * The Cardinal lockup: the cardinal/card symbol, the serif wordmark and the
 * "Local-first Card Ledger" subtext.
 *
 * The wordmark is live text rather than an image so it stays crisp and
 * selectable at every size. The wrapper is exposed as a single image named
 * "Cardinal"; the visual wordmark and subtext are hidden from assistive
 * technology to avoid repeating the name. `data-brand-mode` lets tests assert
 * the light/dark mark choice.
 */
export function BrandLogo({
  mode,
  className = "brand-logo",
  alt = "Cardinal",
}: {
  mode: ThemeMode;
  className?: string;
  alt?: string;
}) {
  return (
    <span
      className={className}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      data-brand-mode={mode}
    >
      <img className="brand-symbol" src={brandMarkFor(mode)} alt="" draggable={false} />
      <span className="brand-copy" aria-hidden="true">
        <span className="brand-word">
          card<span className="brand-word-i">i</span>nal
        </span>
        <span className="brand-sub">Local-first Card Ledger</span>
      </span>
    </span>
  );
}
