/**
 * Coarse, human age for a timestamp — built for a header that has to stay short.
 *
 * Seconds until a minute is up, minutes until an hour, hours until a day, then a
 * local date and time. Whole elapsed units only, so the label never claims more
 * time has passed than it has. A future or unparseable value never invents an
 * age: the future reads as "just now" and `null` means "no label".
 */

const JUST_NOW_SECONDS = 5;

function absolute(then: number): string {
  return new Date(then).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeAge(at: string, now: number = Date.now()): string | null {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < JUST_NOW_SECONDS) return "just now";
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return absolute(then);
}

/** Exact local timestamp for a `title` tooltip. */
export function absoluteAge(at: string): string | null {
  const then = Date.parse(at);
  return Number.isFinite(then) ? absolute(then) : null;
}
