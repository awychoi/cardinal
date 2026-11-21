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
    expect(within(bankSection).getByText("In USD totals")).toBeInTheDocument();
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
      .getByText(/Cash you own/)
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
      .getByText(/Card balances/)
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

  it("keeps other-currency-only accounts outside the USD totals", () => {
    const base = mockDashboard("demo", "2026-10").overview.accounts;
    const eurCard = base.find(
      (account) => account.currency === "EUR" && !isDepositoryAccount(account.accountType),
    );
    if (!eurCard) throw new Error("EUR fixture missing");
    const eurBank = {
      ...eurCard,
      accountId: "eur-bank",
      displayName: "Euro Checking",
      accountType: "checking",
      currentBalanceMinor: 125_000,
    };
    render(
      <AccountsView
        dashboard={dashboardWithAccounts([eurBank, eurCard])}
        theme={getTheme("ledger")}
        onFilterAccount={vi.fn()}
        onAddAccount={vi.fn()}
      />,
    );

    const summary = screen.getByRole("region", { name: "Balance sheet summary" });
    expect(within(summary).getAllByText(/1 account · outside USD totals/)).toHaveLength(2);
    expect(within(summary).queryByText("$0.00")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filter transactions to Euro Checking" }),
    ).toHaveAccessibleDescription(/Other currency, outside USD totals/);
    expect(
      screen.getByRole("button", { name: "Filter transactions to Euro Travel (demo)" }),
    ).toHaveAccessibleDescription(/Other currency, outside USD totals/);
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

    const amazon = screen.getByRole("button", {
      name: "Filter transactions to Amazon Store Card (demo)",
    });
    expect(amazon.querySelector(".card-account-name")).toHaveAttribute(
      "title",
      "Amazon Store Card (demo)",
    );

    const card = screen.getByRole("button", {
      name: "Filter transactions to Sapphire Reserve (demo)",
    });
    expect(card).toHaveAccessibleDescription(/current balance/);
    expect(card).toHaveAccessibleDescription(/net spent this month/);
    expect(card).toHaveAccessibleDescription(/Connected/);
  });

  it("shows a known manual card limit instead of 'Limit not reported'", () => {
    const existing = mockDashboard("demo", "2026-10").overview.accounts;
    const card = existing.find(
      (account) => !isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    if (!card) throw new Error("fixture card missing");
    render(
      <AccountsView
        dashboard={dashboardWithAccounts([
          {
            ...card,
            accountId: "manual-limit-card",
            displayName: "Manual Limit Card",
            sourceKind: "manual",
            connectionStatus: null,
            currentBalanceMinor: null,
            availableCreditMinor: null,
            creditLimitMinor: 750_000,
          },
        ])}
        theme={getTheme("ledger")}
        onFilterAccount={vi.fn()}
        onAddAccount={vi.fn()}
      />,
    );

    const tile = screen.getByRole("button", {
      name: "Filter transactions to Manual Limit Card",
    });
    expect(tile).toHaveTextContent("$7,500.00 limit · balance not reported");
    expect(tile).not.toHaveTextContent("Limit not reported");
  });

  it("treats an account with no spend row as a known $0.00, not an unknown", async () => {
    const user = userEvent.setup();
    renderAccounts();

    const paypal = screen.getByRole("button", {
      name: "Filter transactions to PayPal Credit (demo)",
    });
    expect(paypal).toHaveAccessibleDescription(/\$0\.00 net spent this month/);
    expect(paypal).toHaveTextContent("$0.00");

    await user.click(screen.getByText("The full account table"));
    const paypalRow = Array.from(document.querySelectorAll(".detail-table tr")).find((row) =>
      row.textContent?.includes("PayPal Credit"),
    );
    expect(paypalRow).toHaveTextContent("$0.00");
  });
});
