import { render, screen } from "@testing-library/react";
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

  it("says nothing has synced when the whole ledger is empty", async () => {
    const empty = mockDashboard("real", "2026-11");
    renderLedger({ ...empty, latestActivity: null });

    expect(await screen.findByText(/Nothing has been synced or imported yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^View / })).not.toBeInTheDocument();
  });
});
