// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Cell: () => null,
  Legend: () => null,
  Pie: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { ChannelPortfolioChart } from "@/components/channels/channel-portfolio-chart";
import type { ChannelsOverviewRow } from "@/modules/analysis/application/channels-overview";

const rows: ChannelsOverviewRow[] = [
  {
    channelId: "talabat",
    displayName: "Talabat",
    status: "active",
    assessed: true,
    band: {
      state: "complete",
      potential: { minorUnits: 55300, currency: "AED" },
      lost: { minorUnits: 35700, currency: "AED" },
      earned: { minorUnits: 19600, currency: "AED" },
    },
  },
  {
    channelId: "keeta",
    displayName: "Keeta",
    status: "active",
    assessed: false,
    band: {
      state: "revenue_only",
      potential: { minorUnits: 41000, currency: "AED" },
      lost: null,
      earned: null,
    },
  },
  {
    channelId: "noon",
    displayName: "Noon",
    status: "active",
    assessed: false,
    band: { state: "refused", potential: null, lost: null, earned: null },
  },
];

const total = {
  potential: { minorUnits: 55300, currency: "AED" },
  lost: { minorUnits: 35700, currency: "AED" },
  earned: { minorUnits: 19600, currency: "AED" },
};

const coverage = {
  assessedCount: 1,
  channelCount: 3,
  revenueOnlyNames: ["Keeta"],
  unassessedNames: ["Noon"],
};

function renderReport(reportRows: readonly ChannelsOverviewRow[] = rows) {
  return render(
    <ChannelPortfolioChart
      rows={reportRows}
      total={total}
      coverage={coverage}
      refusalReason={null}
    />,
  );
}

describe("ChannelPortfolioChart", () => {
  afterEach(cleanup);

  it("shows the selected window as a single decision-oriented report", () => {
    renderReport();

    const outcome = screen.getByRole("region", { name: "Revenue outcome" });
    expect(within(outcome).getByText("AED 553.00")).toBeInTheDocument();
    expect(within(outcome).getByText("AED 196.00")).toBeInTheDocument();
    expect(within(outcome).getByText("AED 357.00")).toBeInTheDocument();
    expect(screen.getByTestId("reported-revenue-mix-chart")).toBeInTheDocument();
    expect(screen.getByTestId("channel-performance-chart")).toBeInTheDocument();
    expect(screen.getByTestId("loss-contributor-talabat")).toHaveTextContent("AED 357.00");
    expect(screen.queryByText("Capture gap by channel")).not.toBeInTheDocument();
  });

  it("keeps revenue-only and unassessed channels explicit without inventing zeroes", () => {
    renderReport();

    expect(screen.getByRole("button", { name: /Keeta.*loss not recorded/i })).toHaveTextContent(
      "AED 410.00",
    );
    expect(screen.getByText("1 complete")).toBeInTheDocument();
    expect(screen.getByText("1 revenue-only")).toBeInTheDocument();
    expect(screen.getByText("1 awaiting analysis")).toBeInTheDocument();
    expect(screen.getByText(/Noon has no analysis for this window/)).toBeInTheDocument();
    expect(screen.queryByText("AED 0.00")).not.toBeInTheDocument();
  });

  it("uses one channel focus across the mix and performance views", () => {
    renderReport();

    const talabat = screen.getByRole("button", { name: /Focus Talabat/i });
    fireEvent.click(talabat);

    expect(talabat).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("channel-performance-report")).toHaveAttribute(
      "data-active-channel",
      "talabat",
    );
  });

  it("refuses cross-currency visuals while retaining exact channel summaries", () => {
    renderReport([
      rows[0],
      {
        ...rows[1],
        band: {
          state: "revenue_only",
          potential: { minorUnits: 41000, currency: "USD" },
          lost: null,
          earned: null,
        },
      },
    ]);

    expect(screen.queryByTestId("reported-revenue-mix-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("channel-performance-chart")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Channel performance chart" })).getByText(
        "Visual comparison is unavailable because channels reported different currencies.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Talabat: AED 553.00 potential/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Keeta: \$410.00 revenue reported/)).toBeInTheDocument();
  });

  it("preserves currencies without two-decimal minor units", () => {
    render(
      <ChannelPortfolioChart
        rows={[
          {
            ...rows[0],
            band: {
              state: "complete",
              potential: { minorUnits: 12_345, currency: "JPY" },
              lost: { minorUnits: 4_000, currency: "JPY" },
              earned: { minorUnits: 8_345, currency: "JPY" },
            },
          },
        ]}
        total={{
          potential: { minorUnits: 12_345, currency: "JPY" },
          lost: { minorUnits: 4_000, currency: "JPY" },
          earned: { minorUnits: 8_345, currency: "JPY" },
        }}
        coverage={{
          assessedCount: 1,
          channelCount: 1,
          revenueOnlyNames: [],
          unassessedNames: [],
        }}
        refusalReason={null}
      />,
    );

    expect(screen.getByRole("region", { name: "Revenue outcome" })).toHaveTextContent("¥12,345");
    expect(screen.getByTestId("loss-contributor-talabat")).toHaveTextContent("¥4,000");
  });
});
