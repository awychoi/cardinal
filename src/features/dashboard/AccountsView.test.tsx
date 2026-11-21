import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { isDepositoryAccount } from "../../lib/bridge";
import { mockDashboard } from "../../mocks/data";
import { dashboardWithAccounts } from "../../test/wealthFixtures";
import { getTheme } from "../../theme";
import { AccountsView } from "./AccountsView";

function renderAccounts() {
  const onFilterAccount = vi.fn();
  render(
    <AccountsView
      dashboard={mockDashboard("demo", "2026-10")}
      theme={getTheme("ledger")}
      onFilterAccount={onFilterAccount}
      onAddAccount={vi.fn()}
    />,
  );
  return { onFilterAccount };
}

describe("AccountsView", () => {
  it("separates credit cards from bank accounts", () => {
    renderAccounts();

    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Credit cards" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bank accounts" })).toBeInTheDocument();
    expect(screen.getAllByText("Everyday Checking (demo)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$5,123.00").length).toBeGreaterThan(0);
  });

  it("gives bank accounts cash treatment instead of payment fields", () => {
    renderAccounts();

    const bankSection = screen
      .getByRole("heading", { name: "Bank accounts" })
      .closest("section") as HTMLElement;
    expect(within(bankSection).getByText(/Cash, not an amount due/)).toBeInTheDocument();
    expect(within(bankSection).queryByText(/Last statement/)).not.toBeInTheDocument();
    expect(within(bankSection).queryByText(/Next payment/)).not.toBeInTheDocument();
    expect(within(bankSection).getAllByText("checking").length).toBeGreaterThan(0);
    expect(within(bankSection).getByText("In net position")).toBeInTheDocument();
  });

  it("offers a way to add a bank account", async () => {
    const user = userEvent.setup();
    const onAddAccount = vi.fn();
    render(
      <AccountsView
        dashboard={mockDashboard("demo", "2026-10")}
        theme={getTheme("ledger")}
        onFilterAccount={vi.fn()}
        onAddAccount={onAddAccount}
      />,
    );
    await user.click(screen.getAllByRole("button", { name: "Add account" })[0]);
    expect(onAddAccount).toHaveBeenCalledOnce();
  });

  it("renders a missing balance as unknown in the balance-sheet summary", () => {
    const existing = mockDashboard("demo", "2026-10").overview.accounts;
    const checking = existing.find(
      (account) => isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    if (!checking) throw new Error("fixture checking account missing");
    const dashboard = dashboardWithAccounts([
      {
        ...checking,
        accountId: "blank-cash",
        displayName: "Blank Checking",
        currentBalanceMinor: null,
      },
    ]);
    render(
      <AccountsView
        dashboard={dashboard}
        theme={getTheme("ledger")}
        onFilterAccount={vi.fn()}
        onAddAccount={vi.fn()}
      />,
    );

    const summary = screen.getByRole("region", { name: "Balance sheet summary" });
    const cashSide = within(summary)
      .getByText("Cash you own")
      .closest(".sheet-side") as HTMLElement;
    expect(within(cashSide).getByText("—")).toBeInTheDocument();
    expect(
      within(cashSide).getByText(/Not reported/, { selector: ".sheet-side-note" }),
    ).toBeInTheDocument();
    expect(within(cashSide).queryByText("$0.00")).not.toBeInTheDocument();
    expect(
      within(summary).getByText(/^Not reported · 1 of 1 balances missing$/),
    ).toBeInTheDocument();
  });

  it("marks excluded accounts instead of folding them into a zero total", () => {
    const existing = mockDashboard("demo", "2026-10").overview.accounts;
    const checking = existing.find(
      (account) => isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    const card = existing.find(
      (account) => !isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    if (!checking || !card) throw new Error("fixture accounts missing");
    const dashboard = dashboardWithAccounts([
      checking,
      { ...card, accountId: "excluded-card", displayName: "Excluded Card", included: false },
      {
        ...checking,
        accountId: "excluded-bank",
        displayName: "Excluded Checking",
        included: false,
      },
    ]);
    render(
      <AccountsView
        dashboard={dashboard}
        theme={getTheme("ledger")}
        onFilterAccount={vi.fn()}
        onAddAccount={vi.fn()}
      />,
    );

    const summary = screen.getByRole("region", { name: "Balance sheet summary" });
    const cardSide = within(summary)
      .getByText("Card balances")
      .closest(".sheet-side") as HTMLElement;
    expect(within(cardSide).getByText("—")).toBeInTheDocument();
    expect(within(cardSide).getByText(/not in totals/)).toBeInTheDocument();

    const cardSection = screen
      .getByRole("heading", { name: "Credit cards" })
      .closest("section") as HTMLElement;
    expect(within(cardSection).getByText("Not in totals")).toBeInTheDocument();

    const bankSection = screen
      .getByRole("heading", { name: "Bank accounts" })
      .closest("section") as HTMLElement;
    expect(within(bankSection).getAllByText("Not in totals").length).toBeGreaterThan(0);
    expect(within(bankSection).getByText("Excluded")).toBeInTheDocument();
  });

  it("filters the ledger from a bank account", async () => {
    const user = userEvent.setup();
    const { onFilterAccount } = renderAccounts();

    await user.click(
      screen.getByRole("button", { name: "Filter transactions to Everyday Checking (demo)" }),
    );
    expect(onFilterAccount).toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000009");
  });

  it("keeps short names but describes each tile's balance, status, and inclusion", () => {
    renderAccounts();

    const bank = screen.getByRole("button", {
      name: "Filter transactions to Everyday Checking (demo)",
    });
    expect(bank).toHaveAccessibleDescription(/\$5,123\.00 current balance/);
    expect(bank).toHaveAccessibleDescription(/Connected/);
    expect(bank).toHaveAccessibleDescription(/Included in totals/);

    const card = screen.getByRole("button", {
      name: "Filter transactions to Sapphire Reserve (demo)",
    });
    expect(card).toHaveAccessibleDescription(/current balance/);
    expect(card).toHaveAccessibleDescription(/spent this month/);
    expect(card).toHaveAccessibleDescription(/Connected/);
  });
});
