import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelativeAge } from "./RelativeAge";

const NOW = Date.parse("2026-11-01T21:43:00Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RelativeAge", () => {
  it("counts up on its own without a parent re-render", () => {
    render(<RelativeAge at={at(10)} />);
    expect(screen.getByText("10 seconds ago")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("13 seconds ago")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("1 minute ago")).toBeInTheDocument();
  });

  it("keeps the exact timestamp available as a tooltip and datetime attribute", () => {
    const timestamp = at(30);
    render(<RelativeAge at={timestamp} className="sync-age" />);

    const element = screen.getByText("30 seconds ago");
    expect(element.tagName).toBe("TIME");
    expect(element).toHaveAttribute("datetime", timestamp);
    expect(element).toHaveAttribute("title");
    expect(element.className).toBe("sync-age");
  });

  it("renders nothing for a timestamp it cannot read", () => {
    const { container } = render(<RelativeAge at="not-a-date" />);
    expect(container).toBeEmptyDOMElement();
  });
});
