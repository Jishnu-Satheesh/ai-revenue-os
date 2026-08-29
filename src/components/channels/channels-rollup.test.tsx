// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelsRollup } from "@/components/channels/channels-rollup";
import type { ChannelsOverviewView } from "@/modules/analysis/application/channels-overview";

// The component reads and updates the `window` query param through the app
// router. Mocked the same way the sibling economics client test does it: a
// real `URLSearchParams` so `.toString()` behaves, and a spyable `push`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const WINDOW = {
  windowStart: "2026-01-01",
  windowEnd: "2026-02-28",
  grain: "day" as const,
  label: "2026-01-01 to 2026-02-28",
  value: "2026-01-01..2026-02-28..day",
};

function view(overrides: Partial<ChannelsOverviewView> = {}): ChannelsOverviewView {
  return {
    windows: [WINDOW],
    selectedWindow: WINDOW,
    total: {
      potential: { minorUnits: 55300, currency: "AED" },
      lost: { minorUnits: 35700, currency: "AED" },
      earned: { minorUnits: 19600, currency: "AED" },
    },
    coverage: {
      assessedCount: 1,
      channelCount: 4,
      revenueOnlyNames: [],
      unassessedNames: ["noon", "deliveroo"],
    },
    refusalReason: null,
    rows: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("ChannelsRollup", () => {
  it("states the earned figure and the window it answers for", () => {
    render(<ChannelsRollup view={view()} organizationId="org-1" />);

    expect(screen.getByText("AED 196.00")).toBeTruthy();
    expect(screen.getByText(/2026-01-01 to 2026-02-28/)).toBeTruthy();
  });

  it("names how many channels it covered and which it did not", () => {
    render(<ChannelsRollup view={view()} organizationId="org-1" />);

    const coverage = screen.getByText(/Across 1 of 4 channels/);
    expect(coverage.textContent).toContain("noon");
    expect(coverage.textContent).toContain("deliveroo");
  });

  it("separates a channel that reported revenue from the ones nobody has read", () => {
    // The two gaps need different next actions: Keeta needs a report that
    // records cancellations, while noon needs any report at all. One sentence
    // covering both would send the operator looking for the wrong file.
    render(
      <ChannelsRollup
        view={view({
          coverage: {
            assessedCount: 1,
            channelCount: 4,
            revenueOnlyNames: ["Keeta"],
            unassessedNames: ["noon"],
          },
        })}
        organizationId="org-1"
      />,
    );

    const coverage = screen.getByText(/Across 1 of 4 channels/);
    expect(coverage.textContent).toContain("Keeta reported revenue but no recorded loss");
    expect(coverage.textContent).toContain("noon has no analysis for this window");
  });

  it("says nothing about revenue-only channels when there are none", () => {
    render(<ChannelsRollup view={view()} organizationId="org-1" />);

    expect(screen.queryByText(/reported revenue but no recorded loss/)).toBeNull();
  });

  it("still names a revenue-only channel when the total itself refuses", () => {
    // Keeta on staging: revenue measured for 28 of 31 January days, no
    // cancellation data, and nothing else analysed in that window. The refusal
    // replaced the coverage line wholesale, so the one channel that did report
    // a figure vanished from the page that exists to show it.
    render(
      <ChannelsRollup
        view={view({
          total: { potential: null, lost: null, earned: null },
          coverage: {
            assessedCount: 0,
            channelCount: 4,
            revenueOnlyNames: ["Keeta"],
            unassessedNames: ["noon", "deliveroo", "talabat"],
          },
          refusalReason:
            "No channel has both a revenue figure and a recorded loss for this window, so no earned total can be stated.",
        })}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText(/no earned total can be stated/)).toBeTruthy();
    expect(screen.getByText(/Keeta reported revenue but no recorded loss/)).toBeTruthy();
  });

  it("shows the refusal reason instead of a zero when nothing was measured", () => {
    render(
      <ChannelsRollup
        view={view({
          total: { potential: null, lost: null, earned: null },
          coverage: {
            assessedCount: 0,
            channelCount: 4,
            revenueOnlyNames: [],
            unassessedNames: [],
          },
          refusalReason:
            "No channel has a completed analysis for this window, so nothing has been measured.",
        })}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText(/nothing has been measured/)).toBeTruthy();
    // A zero would read as "you earned nothing", which is a different claim.
    expect(screen.queryByText("AED 0.00")).toBeNull();
  });

  it("renders nothing measurable when the organization has imported no windows", () => {
    render(
      <ChannelsRollup
        view={view({
          windows: [],
          selectedWindow: null,
          total: { potential: null, lost: null, earned: null },
          coverage: {
            assessedCount: 0,
            channelCount: 4,
            revenueOnlyNames: [],
            unassessedNames: [],
          },
          refusalReason:
            "No channel has a completed analysis for this window, so nothing has been measured.",
        })}
        organizationId="org-1"
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
