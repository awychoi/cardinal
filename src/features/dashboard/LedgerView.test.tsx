import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMockBridge, __setMockSettings, __setMockVaultState } from "../../mocks/bridge";
import { mockDashboard } from "../../mocks/data";
import { LedgerView } from "./LedgerView";

type LedgerProps = Parameters<typeof LedgerView>[0];

function renderLedger(
  dashboard: LedgerProps["dashboard"] = mockDashboard("real", "2026-10"),
  overrides: Partial<LedgerProps> = {},
) {
  const callbacks = {
    onClearPreset: vi.fn(),
    onChanged: vi.fn(),
    onChangeMonth: vi.fn(),
  };
  const view = render(
    <LedgerView
      dashboard={dashboard}
      presetAccountId={null}
      presetSearch={null}
      presetNonce={0}
      readOnly={false}
      {...callbacks}
      {...overrides}
    />,
  );
  return { ...callbacks, ...view };
}

beforeEach(() => {
  __resetMockBridge();
  __setMockSettings({ onboardingCompleted: true });
  __setMockVaultState({ vaultExists: true, unlocked: true });
});

describe("LedgerView", () => {
  it("lists the selected month's rows", async () => {
    renderLedger(mockDashboard("real", "2026-10"));

    expect((await screen.findAllByText("Whole Foods Market")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Latest activity is/)).not.toBeInTheDocument();
  });

  // Regression: a connection synced on the first days of a month shows an empty
  // current month while the Overview trend has bars from earlier months. The
  // ledger used to end at "no transactions match these filters" with no path to
  // the rows that had actually been imported.
  it("points an empty month at the newest month that has rows", async () => {
    const { onChangeMonth } = renderLedger(mockDashboard("real", "2026-11"));

    expect(await screen.findByText("No transactions in November 2026.")).toBeInTheDocument();
    expect(screen.getByText(/Latest activity is October 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/No transactions match these filters/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "View October 2026" }));
    expect(onChangeMonth).toHaveBeenCalledWith("2026-10");
  });

  it("keeps the filter message when the month has rows but they are filtered out", async () => {
    renderLedger(mockDashboard("real", "2026-10"), {
      presetSearch: "no-such-merchant",
      presetNonce: 1,
    });

    expect(await screen.findByText(/No transactions match these filters/)).toBeInTheDocument();
    expect(screen.queryByText(/Latest activity is/)).not.toBeInTheDocument();
  });

  it("resets pagination and closes details when the month bounds change", async () => {
    const october = mockDashboard("real", "2026-10");
    const september = mockDashboard("real", "2026-09");
    const callbacks = {
      onClearPreset: vi.fn(),
      onChanged: vi.fn(),
      onChangeMonth: vi.fn(),
    };
    const view = render(
      <LedgerView
        dashboard={october}
        presetAccountId={null}
        presetSearch={null}
        presetNonce={0}
        readOnly={false}
        {...callbacks}
      />,
    );

    expect((await screen.findAllByText("Whole Foods Market")).length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "25");
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();

    const firstRow = view.container.querySelector<HTMLElement>(
      ".ledger-day-group tr:not(.ledger-day-row)",
    );
    expect(firstRow).not.toBeNull();
    await userEvent.click(firstRow as HTMLElement);
    expect(document.getElementById("detail-title")).toBeInTheDocument();

    view.rerender(
      <LedgerView
        dashboard={september}
        presetAccountId={null}
        presetSearch={null}
        presetNonce={0}
        readOnly={false}
        {...callbacks}
      />,
    );

    await waitFor(() => expect(screen.getByText("Page 1 of 1")).toBeInTheDocument());
    expect(document.getElementById("detail-title")).not.toBeInTheDocument();
    expect(
      view.container.querySelectorAll(".ledger-day-group tr:not(.ledger-day-row)").length,
    ).toBeGreaterThan(0);
  });

  it("says nothing has synced when the whole ledger is empty", async () => {
    const empty = mockDashboard("real", "2026-11");
    renderLedger({ ...empty, latestActivity: null });

    expect(await screen.findByText(/Nothing has been synced or imported yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^View / })).not.toBeInTheDocument();
  });

  it("opens details from one row control, announces the panel, and restores focus on Escape", async () => {
    renderLedger();
    const buttons = await screen.findAllByRole("button", { name: /^View details for / });
    const trigger = buttons[0];
    expect(trigger).toHaveAccessibleName(/^View details for Blue Bottle Coffee/);
    expect(trigger.closest("tr")).not.toHaveAttribute("tabindex");

    await userEvent.click(trigger);

    const panel = await screen.findByRole("region", { name: /Blue Bottle Coffee/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "ledger-detail-panel");
    expect(panel).toHaveAttribute("id", "ledger-detail-panel");
    await waitFor(() => expect(document.getElementById("detail-title")).toHaveFocus());
    expect(screen.getByText(/Details opened for Blue Bottle Coffee/)).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /Blue Bottle Coffee/ })).toBeNull(),
    );
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("returns focus to the row control when the detail close button is used", async () => {
    renderLedger();
    const trigger = (await screen.findAllByRole("button", { name: /^View details for / }))[0];
    await userEvent.click(trigger);
    await screen.findByRole("region", { name: /Blue Bottle Coffee/ });

    await userEvent.click(screen.getByRole("button", { name: "Close transaction details" }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
