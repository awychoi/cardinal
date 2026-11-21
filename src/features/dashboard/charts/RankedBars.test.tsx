import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Breakdown } from "../../../lib/bridge";
import { RankedBars } from "./RankedBars";
import { buildComposition, toChartData } from "./chartMath";

function category(key: string, grossMinor: number): Breakdown {
  return { key, grossMinor, refundsMinor: 0, netMinor: grossMinor, count: 1 };
}

describe("RankedBars", () => {
  it("renders every segment with a label, amount, share, and hidden table", () => {
    const data = toChartData(
      buildComposition(
        [category("Dining", 60_000), category("Travel", 40_000), category("Fees", 10_000)],
        2,
      ),
    );
    render(
      <RankedBars data={data} totalMinor={110_000} refundsMinor={-2_500} netMinor={107_500} />,
    );

    const list = screen.getByRole("list", { name: "Spending by category" });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByText("Dining").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Other").length).toBeGreaterThan(0);
    expect(screen.getAllByText("9%").length).toBeGreaterThan(0);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Travel" })).toBeInTheDocument();
    expect(
      screen.getByText("$1,100.00 gross · $25.00 refunds → $1,075.00 net"),
    ).toBeInTheDocument();
  });

  it("renders the empty state and keeps the table for assistive tech", () => {
    render(<RankedBars data={[]} totalMinor={0} refundsMinor={0} netMinor={0} />);
    expect(screen.getByText("No posted spending this month.")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
