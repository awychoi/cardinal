import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMockBridge, __setMockSettings, __setMockVaultState } from "../../mocks/bridge";
import { formatMoney } from "../../lib/formatting";
import { mockDashboard } from "../../mocks/data";
import { getTheme } from "../../theme";
import { OverviewView } from "./OverviewView";

function renderOverview(themeId = "ledger", dashboard = mockDashboard("demo", "2026-10")) {
  const callbacks = {
    onAddAccount: vi.fn(),
    onOpenAccounts: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenTransactions: vi.fn(),
  };
  const view = render(
    <OverviewView
      dashboard={dashboard}
      theme={getTheme(themeId)}
      onAddAccount={callbacks.onAddAccount}
      onOpenAccounts={callbacks.onOpenAccounts}
      onOpenSettings={callbacks.onOpenSettings}
      onOpenTransactions={callbacks.onOpenTransactions}
    />,
  );
  return { ...callbacks, ...view };
}

beforeEach(() => {
  __resetMockBridge();
  __setMockSettings({ onboardingCompleted: true });
  __setMockVaultState({ vaultExists: true, unlocked: true });
});

describe("OverviewView", () => {
  it("renders the wealth hero, quick read, due rail, charts, and deeper details", async () => {
    renderOverview();

    expect(screen.getByText("$502.56")).toBeInTheDocument();
    expect(screen.getByText("Cash on hand")).toBeInTheDocument();
    expect(screen.getByText("Available credit")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coming up" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A quick read" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Gross spending by category/i })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /Monthly net spending/i })).toBeInTheDocument();
    expect(screen.getByText(/Balances and upcoming payments as of/i)).toBeInTheDocument();
    expect(screen.getByText(/Other currencies are shown separately/i)).toBeInTheDocument();
  });

  it("leads with net position and gives cash and card balances equal billing", () => {
    const dashboard = mockDashboard("demo", "2026-10");
    renderOverview("ledger", dashboard);

    const hero = screen.getByRole("region", { name: "Net position" });
    const cash = formatMoney(dashboard.overview.balances.cashKnownTotalMinor);
    const cards = formatMoney(dashboard.overview.balances.cardKnownTotalMinor);
    expect(within(hero).getByText("Net position")).toBeInTheDocument();
    expect(within(hero).getByText("Cash on hand")).toBeInTheDocument();
    expect(within(hero).getByText("Card balances")).toBeInTheDocument();
    expect(within(hero).getByText("Available credit")).toBeInTheDocument();
    expect(within(hero).getAllByText(cash).length).toBeGreaterThan(0);
    expect(within(hero).getAllByText(cards).length).toBeGreaterThan(0);
    expect(screen.getByText(/Card balances sit/)).toBeInTheDocument();
  });

  it("puts the bank account beside cards in the account preview", async () => {
    renderOverview();

    expect(screen.getByRole("heading", { name: "Your accounts" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open activity for Everyday Checking (demo)" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Cash covers/)).toBeInTheDocument();
  });

  it("replaces the per-card balance list with a utilization graphic", () => {
    renderOverview();

    expect(screen.getByRole("heading", { name: "Credit utilization" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Utilization by card" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(within(list).getAllByText(/%/).length).toBeGreaterThan(0);
    // The aggregate balance moved to the hero; the old per-card list is gone.
    expect(
      screen.queryByRole("region", { name: "Individual card balances" }),
    ).not.toBeInTheDocument();
  });

  it("shows each card's current balance and minimum due in upcoming payments", () => {
    renderOverview();

    const dueList = screen.getByRole("list", { name: "Upcoming payments" });

    const reported = within(dueList)
      .getByText(/Sapphire Reserve \(demo\)/)
      .closest("li");
    expect(reported).not.toBeNull();
    expect(within(reported as HTMLElement).getByText("$4,321.00")).toBeInTheDocument();
    expect(within(reported as HTMLElement).getByText("$350.00")).toBeInTheDocument();

    // A payment with no reported minimum still shows the card's own balance.
    const unreported = within(dueList)
      .getByText(/Amazon Store Card \(demo\)/)
      .closest("li");
    expect(within(unreported as HTMLElement).getByText("$543.00")).toBeInTheDocument();
    expect(within(unreported as HTMLElement).getByText("not reported")).toBeInTheDocument();
  });

  it("switches composition to ranked bars with the theme", () => {
    const { rerender } = renderOverview();
    rerender(
      <OverviewView
        dashboard={mockDashboard("demo", "2026-10")}
        theme={getTheme("graphite")}
        onAddAccount={vi.fn()}
        onOpenAccounts={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenTransactions={vi.fn()}
      />,
    );
    expect(screen.getByRole("list", { name: "Spending by category" })).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Gross spending by category/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the composition when the theme says so", () => {
    const theme = getTheme("ledger");
    const hidden = {
      ...theme,
      options: {
        ...theme.options,
        overview: { ...theme.options.overview, composition: "hidden" as const },
      },
    };
    render(
      <OverviewView
        dashboard={mockDashboard("demo", "2026-10")}
        theme={hidden}
        onAddAccount={vi.fn()}
        onOpenAccounts={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenTransactions={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("img", { name: /Gross spending by category/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Spending by category" })).not.toBeInTheDocument();
  });

  it("routes hero and attention actions to the shell", async () => {
    const user = userEvent.setup();
    const { onOpenSettings, onOpenTransactions } = renderOverview();
    expect(screen.getByText("Eligible rows")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open connections" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Open ledger" }));
    expect(onOpenTransactions).toHaveBeenCalledOnce();
  });

  it("offers Add account when the ledger has no accounts", () => {
    const dashboard = mockDashboard("demo", "2026-10");
    const empty = { ...dashboard, overview: { ...dashboard.overview, accounts: [] } };
    const { onAddAccount } = renderOverview("ledger", empty);
    expect(
      screen.getByRole("heading", { name: /Your accounts, in one quiet place/ }),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Add account" }).click();
    expect(onAddAccount).toHaveBeenCalledOnce();
  });
});
