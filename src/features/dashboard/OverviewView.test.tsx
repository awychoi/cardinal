import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMockBridge, __setMockSettings, __setMockVaultState } from "../../mocks/bridge";
import { formatMoney } from "../../lib/formatting";
import { isDepositoryAccount } from "../../lib/bridge";
import { mockDashboard } from "../../mocks/data";
import { dashboardWithAccounts } from "../../test/wealthFixtures";
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
    expect(screen.getByText("Available credit · USD")).toBeInTheDocument();
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
    const mini = (label: string) =>
      Array.from(hero.querySelectorAll<HTMLElement>(".hero-mini")).find(
        (element) => element.querySelector(".hero-mini-label")?.textContent === label,
      ) as HTMLElement;
    expect(within(hero).getByText("Net position")).toBeInTheDocument();
    expect(mini("Cash on hand")).toBeInTheDocument();
    expect(mini("Card balances")).toBeInTheDocument();
    expect(mini("Available credit · USD")).toBeInTheDocument();
    expect(within(hero).getAllByText(cash).length).toBeGreaterThan(0);
    expect(within(hero).getAllByText(cards).length).toBeGreaterThan(0);
    // The quick read interprets the month instead of repeating the hero arithmetic.
    expect(
      within(screen.getByRole("complementary", { name: "A quick read" })).getByText("Top category"),
    ).toBeInTheDocument();
  });

  it("puts the bank account beside cards in the account preview", async () => {
    renderOverview();

    expect(screen.getByRole("heading", { name: "Your accounts" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open activity for Everyday Checking (demo)" }),
    ).toBeInTheDocument();
    const cashTile = screen.getByRole("button", {
      name: "Open activity for Everyday Checking (demo)",
    });
    expect(cashTile).toHaveAccessibleDescription(/\$5,123\.00 balance/);
    expect(cashTile).toHaveAccessibleDescription(/Connected/);
    expect(cashTile).toHaveAccessibleDescription(/included in totals/);
    const cardTile = screen.getByRole("button", {
      name: "Open activity for Sapphire Reserve (demo)",
    });
    expect(cardTile).toHaveAccessibleDescription(/next payment/);
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
    expect(within(unreported as HTMLElement).getByText("Not reported")).toBeInTheDocument();
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
      screen.getByText("$802.56 gross · $300.00 refunds → $502.56 net", { exact: false }),
    ).toBeInTheDocument();
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
    expect(screen.getByText("Eligible rows · USD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open connections" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Open ledger" }));
    expect(onOpenTransactions).toHaveBeenCalledOnce();
  });

  it("renders a missing balance as unknown, not $0.00", () => {
    const existing = mockDashboard("demo", "2026-10").overview.accounts;
    const checking = existing.find(
      (account) => isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    const card = existing.find(
      (account) => !isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    if (!checking || !card) throw new Error("fixture accounts missing");
    const dashboard = dashboardWithAccounts([
      {
        ...checking,
        accountId: "blank-cash",
        displayName: "Blank Checking",
        currentBalanceMinor: null,
      },
      { ...card, accountId: "blank-card", displayName: "Blank Card", currentBalanceMinor: null },
    ]);
    renderOverview("ledger", dashboard);

    const hero = screen.getByRole("region", { name: "Net position" });
    expect(hero.querySelector(".hero-value")).toHaveTextContent("Not reported");
    expect(hero.querySelector(".hero-value-unknown")).not.toBeNull();
    const mini = (label: string) =>
      Array.from(hero.querySelectorAll<HTMLElement>(".hero-mini")).find(
        (element) => element.querySelector(".hero-mini-label")?.textContent === label,
      ) as HTMLElement;
    const cashMini = mini("Cash on hand");
    const cardMini = mini("Card balances");
    expect(within(cashMini).getByText("Not reported")).toBeInTheDocument();
    expect(within(cashMini).getByText("0 of 1 reported")).toBeInTheDocument();
    expect(within(cardMini).getByText("Not reported")).toBeInTheDocument();
    expect(within(cardMini).getByText("0 of 1 USD cards reported")).toBeInTheDocument();
    expect(within(hero).queryByText("$0.00")).not.toBeInTheDocument();
    expect(
      screen.getByText("Cash is not reported yet. A missing balance stays unknown, never $0.00."),
    ).toBeInTheDocument();
  });

  it("counts a reported $0.00 as reported", () => {
    const existing = mockDashboard("demo", "2026-10").overview.accounts;
    const checking = existing.find(
      (account) => isDepositoryAccount(account.accountType) && account.currency === "USD",
    );
    if (!checking) throw new Error("fixture checking account missing");
    const dashboard = dashboardWithAccounts([
      { ...checking, accountId: "zero-cash", displayName: "Zero Checking", currentBalanceMinor: 0 },
    ]);
    renderOverview("ledger", dashboard);

    const hero = screen.getByRole("region", { name: "Net position" });
    const cashMini = within(hero).getByText("Cash on hand").closest(".hero-mini") as HTMLElement;
    expect(within(cashMini).getByText("$0.00")).toBeInTheDocument();
    expect(within(cashMini).getByText("1 of 1 reported")).toBeInTheDocument();
    expect(within(hero).getByText(/Complete · all 1 balance reported/)).toBeInTheDocument();
    expect(
      screen.getByText(/not enough posted activity yet to estimate a cushion/),
    ).toBeInTheDocument();
  });

  it("opens the deeper picture from the quick-read footer", async () => {
    const user = userEvent.setup();
    renderOverview();
    expect(screen.getByText("Limits, connection health, and currencies")).toBeInTheDocument();
    const details = document.querySelector(".wealth-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);

    await user.click(screen.getByRole("button", { name: "The numbers behind this →" }));
    expect(details.open).toBe(true);
  });

  it("lets every payment behind the due total be inspected", async () => {
    renderOverview();

    const dueList = screen.getByRole("list", { name: "Upcoming payments" });
    expect(within(dueList).getAllByRole("listitem")).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: "Show all 7 payments" }));
    expect(
      within(screen.getByRole("list", { name: "Upcoming payments" })).getAllByRole("listitem"),
    ).toHaveLength(7);

    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(
      within(screen.getByRole("list", { name: "Upcoming payments" })).getAllByRole("listitem"),
    ).toHaveLength(4);
  });

  it("says No USD cards when there are no USD cards", () => {
    const checking = mockDashboard("demo", "2026-10").overview.accounts.find((account) =>
      isDepositoryAccount(account.accountType),
    );
    if (!checking) throw new Error("fixture checking account missing");
    renderOverview("ledger", dashboardWithAccounts([checking]));

    expect(screen.getByText("No USD cards")).toBeInTheDocument();
    expect(screen.queryByText("No reported limits")).not.toBeInTheDocument();
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

  it("does not call a completed month 'so far'", async () => {
    renderOverview("ledger", mockDashboard("demo", "2026-09"));

    await screen.findByRole("img", { name: /Monthly net spending/i });
    const trendLead = document.querySelector(".trend-summary-lead") as HTMLElement;
    expect(trendLead).toHaveTextContent("September 2026");
    expect(trendLead).not.toHaveTextContent(/so far/i);
    expect(await screen.findByText(/September spending was/)).toBeInTheDocument();
    expect(screen.queryByText(/September spending so far/)).not.toBeInTheDocument();
  });

  it("keeps the current-month so-far label when viewing the current month", () => {
    renderOverview("ledger", mockDashboard("demo", "2026-10"));
    expect(screen.getByText("This month so far")).toBeInTheDocument();
  });

  it("does not turn a EUR-only card into a USD zero position", () => {
    const eurCard = mockDashboard("demo", "2026-10").overview.accounts.find(
      (account) => account.currency === "EUR" && !isDepositoryAccount(account.accountType),
    );
    if (!eurCard) throw new Error("EUR card fixture missing");
    renderOverview("ledger", dashboardWithAccounts([eurCard]));

    const hero = screen.getByRole("region", { name: "Net position" });
    expect(hero.querySelector(".hero-value")).toHaveTextContent("Not reported");
    expect(within(hero).getByText("Only other-currency cards")).toBeInTheDocument();
    expect(
      within(hero).getAllByText("—", { selector: ".hero-mini strong" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Only other-currency accounts")).toBeInTheDocument();
    expect(screen.getByText("No USD accounts in your net position")).toBeInTheDocument();
    expect(screen.queryByText(/Known balances total \$0\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText("Everything reported looks current")).not.toBeInTheDocument();
    const cardMini = Array.from(hero.querySelectorAll<HTMLElement>(".hero-mini")).find(
      (element) => element.querySelector(".hero-mini-label")?.textContent === "Card balances",
    );
    expect(cardMini?.querySelector("strong")).toHaveTextContent("—");
  });

  it("does not turn a EUR-only bank into a USD zero cash side", () => {
    const base = mockDashboard("demo", "2026-10").overview.accounts;
    const eurCard = base.find(
      (account) => account.currency === "EUR" && !isDepositoryAccount(account.accountType),
    );
    if (!eurCard) throw new Error("EUR fixture missing");
    const eurBank = {
      ...eurCard,
      accountId: "eur-only-bank",
      displayName: "Euro Checking",
      accountType: "checking",
      currentBalanceMinor: 125_000,
    };
    renderOverview("ledger", dashboardWithAccounts([eurBank]));

    const hero = screen.getByRole("region", { name: "Net position" });
    expect(within(hero).getByText("Only other-currency cash accounts")).toBeInTheDocument();
    expect(hero.querySelector(".hero-mini strong")).toHaveTextContent("—");
    expect(screen.queryByText("No cash accounts yet.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open activity for Euro Checking" }),
    ).toHaveAccessibleDescription(/outside USD totals/);
    expect(screen.queryByText("Everything reported looks current")).not.toBeInTheDocument();
  });

  it("separates all-excluded accounts from an empty ledger", () => {
    const base = mockDashboard("demo", "2026-10").overview.accounts;
    const checking = base.find((account) => isDepositoryAccount(account.accountType));
    const card = base.find((account) => !isDepositoryAccount(account.accountType));
    if (!checking || !card) throw new Error("fixture accounts missing");
    renderOverview(
      "ledger",
      dashboardWithAccounts([
        { ...checking, included: false },
        { ...card, included: false },
      ]),
    );

    expect(screen.getAllByText("All accounts are excluded from totals").length).toBeGreaterThan(0);
    expect(screen.queryByText("No accounts yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("Known balances total $0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("Everything reported looks current")).not.toBeInTheDocument();
    const hero = screen.getByRole("region", { name: "Net position" });
    expect(hero.querySelector(".hero-value")).toHaveTextContent("Not reported");
    expect(
      screen.getByRole("button", { name: /Open activity for Everyday Checking/ }),
    ).toHaveAccessibleDescription(/excluded from totals/);
    expect(screen.getAllByText(/not in totals/i).length).toBeGreaterThan(0);
  });
});
