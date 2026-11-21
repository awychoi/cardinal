import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockDashboard } from "../../mocks/data";
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

  it("filters the ledger from a bank account", async () => {
    const user = userEvent.setup();
    const { onFilterAccount } = renderAccounts();

    await user.click(
      screen.getByRole("button", { name: "Filter transactions to Everyday Checking (demo)" }),
    );
    expect(onFilterAccount).toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000009");
  });
});
