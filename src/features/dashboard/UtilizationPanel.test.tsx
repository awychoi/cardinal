import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AccountCard } from "../../lib/bridge";
import { mockDashboard } from "../../mocks/data";
import { UtilizationPanel } from "./UtilizationPanel";

function withLimit(
  index: number,
  balanceMinor: number | null,
  limitMinor: number | null,
): AccountCard {
  const template = mockDashboard("demo", "2026-10").overview.accounts[0];
  return {
    ...template,
    accountId: `aaaaaaaa-0000-4000-8000-00000000000${index}`,
    displayName: `Card ${index}`,
    currentBalanceMinor: balanceMinor,
    creditLimitMinor: limitMinor,
  };
}

function totalLabel(): string {
  const head = screen.getByRole("heading", { name: "Credit utilization" }).closest("header");
  return within(head as HTMLElement).getByText(/%|—/).textContent ?? "";
}

describe("UtilizationPanel", () => {
  it("reports the aggregate share of reported limits", () => {
    render(
      <UtilizationPanel
        accounts={[withLimit(1, 250_000, 1_000_000), withLimit(2, 50_000, 500_000)]}
      />,
    );

    // ($2,500 + $500) / ($10,000 + $5,000) = 20%
    expect(totalLabel()).toBe("20% used");
    expect(screen.getByText(/\$15,000\.00 reported/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("excludes cards without a limit and says so", () => {
    render(
      <UtilizationPanel
        accounts={[withLimit(1, 250_000, 1_000_000), withLimit(2, 90_000, null)]}
      />,
    );

    expect(totalLabel()).toBe("25% used");
    expect(screen.getByText(/1 card without a reported limit is not counted/)).toBeInTheDocument();
  });

  it("counts only included USD accounts", () => {
    render(
      <UtilizationPanel
        accounts={[
          withLimit(1, 250_000, 1_000_000),
          { ...withLimit(2, 800_000, 1_000_000), included: false },
          { ...withLimit(3, 900_000, 1_000_000), currency: "EUR" },
        ]}
      />,
    );

    expect(totalLabel()).toBe("25% used");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("explains itself when nothing reports a limit", () => {
    render(<UtilizationPanel accounts={[withLimit(1, 250_000, null)]} />);

    expect(totalLabel()).toBe("— used");
    expect(screen.getByText(/No credit limits reported yet/)).toBeInTheDocument();
  });
});
