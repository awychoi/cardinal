import { describe, expect, it } from "vitest";
import { absoluteAge, relativeAge } from "./relativeTime";

const NOW = Date.parse("2026-11-01T21:43:00Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

describe("relativeAge", () => {
  it("counts seconds first, without ever rounding up", () => {
    expect(relativeAge(at(0), NOW)).toBe("just now");
    expect(relativeAge(at(4), NOW)).toBe("just now");
    expect(relativeAge(at(5), NOW)).toBe("5 seconds ago");
    expect(relativeAge(at(59.9), NOW)).toBe("59 seconds ago");
  });

  it("switches to whole minutes, then hours", () => {
    expect(relativeAge(at(60), NOW)).toBe("1 minute ago");
    expect(relativeAge(at(119), NOW)).toBe("1 minute ago");
    expect(relativeAge(at(120), NOW)).toBe("2 minutes ago");
    expect(relativeAge(at(3600), NOW)).toBe("1 hour ago");
    expect(relativeAge(at(3600 * 5.5), NOW)).toBe("5 hours ago");
  });

  it("falls back to a local timestamp after a day", () => {
    const old = relativeAge(at(3600 * 30), NOW);
    expect(old).not.toBeNull();
    expect(old).not.toMatch(/ago/);
    expect(old).toMatch(/\d/);
  });

  it("treats clock skew as just now instead of a negative age", () => {
    expect(relativeAge(new Date(NOW + 30_000).toISOString(), NOW)).toBe("just now");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(relativeAge("not-a-date", NOW)).toBeNull();
    expect(absoluteAge("not-a-date")).toBeNull();
  });

  it("exposes an absolute label for the tooltip", () => {
    expect(absoluteAge(at(0))).toMatch(/\d/);
  });
});
