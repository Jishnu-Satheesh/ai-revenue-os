// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import {
  ChannelComparisonTooltip,
  ChannelPortfolioChart,
  computeAmountScale,
  formatMajorTick,
} from "@/components/channels/channel-portfolio-chart";
import { buildChannelsPortfolioPresentation } from "@/components/channels/channels-presentation";
import type { ChannelsPortfolioPresentation } from "@/components/channels/channels-presentation";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewView,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";

const WINDOW_FEB: ChannelsOverviewWindow = {
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  grain: "month",
  label: "2026-02-01 to 2026-02-28",
  value: "2026-02-01..2026-02-28..month",
};

function row(
  channelId: string,
  displayName: string,
  band: ChannelsOverviewRow["band"],
): ChannelsOverviewRow {
  return { channelId, displayName, status: "active", assessed: band.state === "complete", band };
}

/** February §7 reference rows: A + B complete, Direct revenue-only, In-store refused. */
function februaryRows(): ChannelsOverviewRow[] {
  return [
    row("a", "Delivery A", {
      state: "complete",
      potential: { minorUnits: 8_000_000, currency: "AED" },
      lost: { minorUnits: 400_000, currency: "AED" },
      earned: { minorUnits: 7_600_000, currency: "AED" },
    }),
    row("b", "Delivery B", {
      state: "complete",
      potential: { minorUnits: 4_000_000, currency: "AED" },
      lost: { minorUnits: 200_000, currency: "AED" },
      earned: { minorUnits: 3_800_000, currency: "AED" },
    }),
    row("direct", "Direct", {
      state: "revenue_only",
      potential: { minorUnits: 1_800_000, currency: "AED" },
      lost: null,
      earned: null,
    }),
    row("instore", "In-store", { state: "refused", potential: null, lost: null, earned: null }),
  ];
}

function portfolioFor(rows: ChannelsOverviewRow[]): ChannelsPortfolioPresentation {
  const view: ChannelsOverviewView = {
    windows: [WINDOW_FEB],
    selectedWindow: WINDOW_FEB,
    total: {
      potential: { minorUnits: 12_000_000, currency: "AED" },
      lost: { minorUnits: 600_000, currency: "AED" },
      earned: { minorUnits: 11_400_000, currency: "AED" },
    },
    coverage: {
      assessedCount: 2,
      channelCount: 4,
      revenueOnlyNames: ["Direct"],
      unassessedNames: ["In-store"],
    },
    refusalReason: null,
    rows,
  };
  return buildChannelsPortfolioPresentation(view);
}

function renderChart(
  portfolio: ChannelsPortfolioPresentation = portfolioFor(februaryRows()),
  onInspectChannel: (channelId: string) => void = () => {},
) {
  return render(
    <ChannelPortfolioChart
      portfolio={portfolio}
      selectedWindow={WINDOW_FEB}
      onInspectChannel={onInspectChannel}
    />,
  );
}

describe("ChannelPortfolioChart", () => {
  afterEach(cleanup);

  it("shows February reference rows in descending order with whole-unit end values", () => {
    renderChart();

    expect(screen.getByText("Revenue by channel")).toBeInTheDocument();
    expect(
      screen.getByText("A shared scale. A clearer view of your channel mix."),
    ).toBeInTheDocument();

    const region = screen.getByRole("region", { name: "Revenue comparison" });
    const names = within(region)
      .getAllByRole("button", { name: /Show band details/ })
      .map((button) => button.textContent);
    expect(names).toEqual(["Delivery A", "Delivery B", "Direct", "In-store"]);

    expect(screen.getByText("80,000")).toBeInTheDocument();
    expect(screen.getByText("40,000")).toBeInTheDocument();
    expect(screen.getByText("18,000")).toBeInTheDocument();
    // Refused rows keep the label, neutral in-track text and an em-dash value.
    expect(screen.getByText("No comparable figure")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Earned = reported revenue minus provider-reported loss. These figures are not profit.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Earned")).toBeInTheDocument();
    expect(screen.getByText("Reported loss")).toBeInTheDocument();
    expect(screen.getByText("Revenue only")).toBeInTheDocument();
  });

  it("computes the reference 0–80k amount domain with 20k ticks", () => {
    const scale = computeAmountScale(1_800_000, 8_000_000, "AED");

    expect(scale.domain).toEqual([0, 8_000_000]);
    expect(scale.ticks).toEqual([0, 2_000_000, 4_000_000, 6_000_000, 8_000_000]);
    expect(scale.ticks.map((tick) => formatMajorTick(tick / 100))).toEqual([
      "0",
      "20k",
      "40k",
      "60k",
      "80k",
    ]);
  });

  it("switches to one-decimal shares and never clears the active choice", () => {
    renderChart();

    fireEvent.click(screen.getByRole("radio", { name: "Show shares" }));
    expect(screen.getByText("58.0%")).toBeInTheDocument();
    expect(screen.getByText("29.0%")).toBeInTheDocument();
    expect(screen.getByText("13.0%")).toBeInTheDocument();

    // Clicking the active choice must not clear the selected value.
    fireEvent.click(screen.getByRole("radio", { name: "Show shares" }));
    expect(screen.getByText("58.0%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Show amounts" }));
    expect(screen.getByText("80,000")).toBeInTheDocument();
    expect(screen.queryByText("58.0%")).toBeNull();
  });

  it("emits the inspected channel for keyboard and touch detail without a second model", () => {
    const onInspectChannel = vi.fn();
    renderChart(portfolioFor(februaryRows()), onInspectChannel);

    const detail = screen.getByRole("button", { name: /Delivery A:.*Show band details/ });
    // Intl separates the currency code with a non-breaking space, so assert
    // the code and the figures as separate fragments.
    const label = detail.getAttribute("aria-label") ?? "";
    expect(label).toContain("reported revenue AED");
    expect(label).toContain("80,000.00");
    expect(label).toContain("76,000.00");
    expect(label).toContain("4,000.00");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(detail);
    expect(onInspectChannel).toHaveBeenCalledTimes(1);
    expect(onInspectChannel).toHaveBeenCalledWith("a");
  });

  it("refuses mixed-currency visuals while keeping original-currency values", () => {
    const mixed = februaryRows();
    mixed[1] = row("b", "Delivery B", {
      state: "complete",
      potential: { minorUnits: 4_000_000, currency: "USD" },
      lost: { minorUnits: 200_000, currency: "USD" },
      earned: { minorUnits: 3_800_000, currency: "USD" },
    });
    renderChart(portfolioFor(mixed));

    expect(screen.getByText("Revenue cannot be compared across currencies.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Show shares" })).toBeDisabled();
    // Exact per-channel figures stay inspectable, so nothing is lost.
    const deliveryA =
      screen.getByRole("button", { name: /Delivery A:/ }).getAttribute("aria-label") ?? "";
    expect(deliveryA).toContain("AED");
    expect(deliveryA).toContain("80,000.00");
    const deliveryB =
      screen.getByRole("button", { name: /Delivery B:/ }).getAttribute("aria-label") ?? "";
    expect(deliveryB).toContain("40,000.00");
    expect(screen.getByText("80,000")).toBeInTheDocument();
    expect(screen.getByText("40,000")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Revenue comparison" })).toBeInTheDocument();
  });

  it("keeps signed adjustments out of Share while Amount stays signed", () => {
    const rows = [
      row("a", "Delivery A", {
        state: "complete",
        potential: { minorUnits: 8_000_000, currency: "AED" },
        lost: { minorUnits: 400_000, currency: "AED" },
        earned: { minorUnits: 7_600_000, currency: "AED" },
      }),
      row("direct", "Direct", {
        state: "revenue_only",
        potential: { minorUnits: -500_000, currency: "AED" },
        lost: null,
        earned: null,
      }),
    ];
    renderChart(portfolioFor(rows));

    // Amount keeps the signed figure (−500,000 minor = −5,000 major);
    // nothing is clamped to a positive bar.
    expect(screen.getByText("-5,000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Show shares" }));
    expect(
      screen.getByText("Share comparison is unavailable for signed adjustments."),
    ).toBeInTheDocument();
  });

  it("calls an all-zero total what it is and refuses only the proportional view", () => {
    const rows = [
      row("a", "Delivery A", {
        state: "complete",
        potential: { minorUnits: 0, currency: "AED" },
        lost: { minorUnits: 0, currency: "AED" },
        earned: { minorUnits: 0, currency: "AED" },
      }),
    ];
    renderChart(portfolioFor(rows));

    // Zero stays zero: no nonzero minimum bar, no invented nonzero domain.
    expect(screen.getByText("0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Show shares" }));
    expect(
      screen.getByText("No proportional comparison is available for zero reported revenue."),
    ).toBeInTheDocument();
  });

  it("renders the exact tooltip with channel, period and recorded figures", () => {
    render(
      <ChannelComparisonTooltip
        active
        payload={[
          {
            payload: {
              channelId: "a",
              name: "Delivery A",
              state: "complete",
              reportedMinor: 8_000_000,
              earnedMinor: 7_600_000,
              lostMinor: 400_000,
              currency: "AED",
            },
          },
        ]}
        period="1 February 2026 – 28 February 2026"
      />,
    );

    expect(screen.getByText("Delivery A")).toBeInTheDocument();
    expect(screen.getByText("1 February 2026 – 28 February 2026")).toBeInTheDocument();
    expect(screen.getByText("AED 80,000.00")).toBeInTheDocument();
    expect(screen.getByText("AED 76,000.00")).toBeInTheDocument();
    expect(screen.getByText("AED 4,000.00")).toBeInTheDocument();
  });

  it("says Not recorded for revenue-only tooltips instead of inventing zeroes", () => {
    render(
      <ChannelComparisonTooltip
        active
        payload={[
          {
            payload: {
              channelId: "direct",
              name: "Direct",
              state: "revenue_only",
              reportedMinor: 1_800_000,
              earnedMinor: null,
              lostMinor: null,
              currency: "AED",
            },
          },
        ]}
        period="1 February 2026 – 28 February 2026"
      />,
    );

    expect(screen.getByText("AED 18,000.00")).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.queryByText("AED 0.00")).toBeNull();
  });

  it("preserves currencies without two-decimal minor units in tooltips", () => {
    const { unmount } = render(
      <ChannelComparisonTooltip
        active
        payload={[
          {
            payload: {
              channelId: "tokyo",
              name: "Tokyo",
              state: "complete",
              reportedMinor: 12_345,
              earnedMinor: 8_345,
              lostMinor: 4_000,
              currency: "JPY",
            },
          },
        ]}
        period="1 February 2026 – 28 February 2026"
      />,
    );
    expect(screen.getByText("¥12,345")).toBeInTheDocument();
    expect(screen.getByText("¥4,000")).toBeInTheDocument();
    unmount();

    render(
      <ChannelComparisonTooltip
        active
        payload={[
          {
            payload: {
              channelId: "manama",
              name: "Manama",
              state: "complete",
              reportedMinor: 12_345,
              earnedMinor: 12_000,
              lostMinor: 345,
              currency: "BHD",
            },
          },
        ]}
        period="1 February 2026 – 28 February 2026"
      />,
    );
    expect(document.body.textContent).toContain("12.345");
  });

  it("orders unknown amounts last with deterministic ID ties", () => {
    const onInspectChannel = vi.fn();
    const rows = [
      row("zeta", "Same", {
        state: "revenue_only",
        potential: { minorUnits: 1_000_000, currency: "AED" },
        lost: null,
        earned: null,
      }),
      row("instore", "In-store", { state: "refused", potential: null, lost: null, earned: null }),
      row("alpha", "Same", {
        state: "revenue_only",
        potential: { minorUnits: 1_000_000, currency: "AED" },
        lost: null,
        earned: null,
      }),
    ];
    renderChart(portfolioFor(rows), onInspectChannel);

    const names = screen.getAllByRole("button", { name: /Show band details/ });
    // Equal amounts sort by display name, then channel ID; unknowns last.
    expect(names.map((button) => button.textContent)).toEqual(["Same", "Same", "In-store"]);
    // The first tied row is the lower channel ID: inspection proves the order.
    fireEvent.click(names[0] as HTMLElement);
    expect(onInspectChannel).toHaveBeenCalledWith("alpha");
  });
});
