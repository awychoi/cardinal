import { useEffect, useState } from "react";
import { absoluteAge, relativeAge } from "../lib/relativeTime";

/**
 * A self-updating "3 seconds ago" label.
 *
 * The tick is isolated to this component so a header label never re-renders the
 * shell: seconds while the first minute runs, then every 30 seconds, then every
 * 5 minutes. The exact local time is the tooltip, so the coarse label never
 * hides the fact.
 */
export function RelativeAge({ at, className }: { at: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const then = Date.parse(at);
      const age = Number.isFinite(then) ? Date.now() - then : Number.POSITIVE_INFINITY;
      const delay = age < 60_000 ? 1_000 : age < 3_600_000 ? 30_000 : 300_000;
      timer = window.setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [at]);

  const label = relativeAge(at, now);
  if (label === null) return null;
  const title = absoluteAge(at);
  return (
    <time className={className} dateTime={at} title={title ?? undefined}>
      {label}
    </time>
  );
}
