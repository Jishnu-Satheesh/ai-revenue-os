// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { BusinessPerformanceCard } from "@/components/growth-intelligence/business-performance-card";
import type { BusinessPerformanceCardView } from "@/modules/analysis/application/channels-overview";

afterEach(cleanup);

function cardView(
  overrides: Partial<BusinessPerformanceCardView> = {},
): BusinessPerformanceCardView {
  return {
    month: { from: "2026-02-01", to: "2026-02-28" },
    previous: { from: "2026-01-01", to: "2026-01-31" },
    channelCount: 3,
    headline: "Sales are up. Cancellations still need attention.",
    tiles: {
      sales: {
        id: "sales",
        value: { kind: "money", money: { minorUnits: 12_000_000, currency: "AED" } },
        unavailableReason: null,
        deltaPercent: 20,
        deltaLabel: "vs January",
        deltaAbsentReason: null,
        footnote: "Costs are not yet included",
      },
      orders: {
        id: "orders",
        value: { kind: "count", value: 2400 },
        unavailableReason: null,
        deltaPercent: 20,
        deltaLabel: "vs January",
        deltaAbsentReason: null,
        footnote: "3 channels",
      },
      views: {
        id: "views",
        value: { kind: "count", value: 12000 },
        unavailableReason: null,
        deltaPercent: 20,
        deltaLabel: "vs January",
        deltaAbsentReason: null,
        footnote: "Delivery A only",
      },
      cancelled: {
        id: "cancelled",
        value: { kind: "count", value: 120 },
        unavailableReason: null,
        deltaPercent: 20,
        deltaLabel: "vs January",
        deltaAbsentReason: null,
        footnote: "Review the reasons",
      },
    },
    cancelledShare: { percent: 5, pointChange: 0 },
    trend: {
      state: "ready",
      buckets: [
        { label: "2–8 Feb", minorUnits: 2_400_000 },
        { label: "9–15 Feb", minorUnits: 3_600_000 },
      ],
      currency: "AED",
      coverageNote: "2 of 3 February weeks · 2 of 3 channels",
    },
    shares: {
      rows: [
        {
          channelId: "ch-a",
          displayName: "Delivery A",
          minorUnits: 6_000_000,
          currency: "AED",
          sharePercent: 50,
        },
        {
          channelId: "ch-b",
          displayName: "Delivery B",
          minorUnits: 4_000_000,
          currency: "AED",
          sharePercent: 33,
        },
        {
          channelId: "ch-c",
          displayName: "Direct",
          minorUnits: 2_000_000,
          currency: "AED",
          sharePercent: 17,
        },
      ],
      totalMinorUnits: 12_000_000,
      currency: "AED",
    },
    sharesAbsentReason: null,
    footer: "Sales and orders: 3 channels · 2 locations. Menu views: Delivery A only.",
    sources: {
      reportingPeriod: "2026-02-01 to 2026-02-28",
      scope: "all channels · all locations",
      salesOrdersNote: "Comparable channel reports for the selected period and locations.",
      menuViewsNote: "Delivery A listing report only.",
      costNote:
        "Cost reports are missing, so this screen shows reported sales without claiming profit.",
      reportFiles: [],
    },
    fulfillment: {
      ordersPlaced: 2400,
      ordersAbsentReason: null,
      cancelled: 120,
      cancelledAbsentReason: null,
    },
    ...overrides,
  };
}

describe("the business performance card", () => {
  it("reads the headline, the measured range, and the four tiles", () => {
    render(<BusinessPerformanceCard card={cardView()} />);

    expect(
      screen.getByRole("heading", { name: "Sales are up. Cancellations still need attention." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "1–28 Feb 2026 · compared with 1–31 Jan 2026 · all channels · all locations",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("AED 120,000")).toBeInTheDocument();
    expect(screen.getByText("2,400")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getAllByText("+20% vs January")).toHaveLength(3);
    expect(screen.getByText("5% of orders · unchanged")).toBeInTheDocument();
  });

  it("plots the weekly trend beside the channel shares", () => {
    render(<BusinessPerformanceCard card={cardView()} />);

    expect(screen.getByRole("img", { name: /Weekly reported sales/ })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Delivery A 50% of reported sales" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AED 60,000")).toBeInTheDocument();
    expect(
      screen.getByText("Cost data is needed to explain how much of these sales became profit."),
    ).toBeInTheDocument();
  });

  it("opens the data-sources modal with the dynamic details", async () => {
    const user = userEvent.setup();
    render(<BusinessPerformanceCard card={cardView()} />);

    await user.click(screen.getByRole("button", { name: /View data sources/ }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Where these figures come from")).toBeInTheDocument();
    expect(
      screen.getByText("Comparable channel reports for the selected period and locations."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cost reports are missing, so this screen shows reported sales without claiming profit.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the fulfillment modal from the footer link", async () => {
    const user = userEvent.setup();
    render(<BusinessPerformanceCard card={cardView()} />);

    await user.click(screen.getByRole("button", { name: /Order & fulfillment details/ }));

    expect(screen.getByText("Orders & fulfillment")).toBeInTheDocument();
    expect(screen.getByText("Delivery completion and delivery time")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Order totals and cancellations alone do not establish which orders were delivered.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps an empty trend framed with its reason instead of hiding it", () => {
    render(
      <BusinessPerformanceCard
        card={cardView({
          trend: {
            state: "empty",
            reason: "Fewer than two weeks of this month have a completed analysis.",
            weeks: ["2–8 Feb", "9–15 Feb", "16–22 Feb"],
          },
        })}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "Sales trend unavailable: Fewer than two weeks of this month have a completed analysis.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("2–8 Feb")).toBeInTheDocument();
  });

  it("states missing tiles as not reported, never zero", () => {
    render(
      <BusinessPerformanceCard
        card={cardView({
          headline: "Performance for February 2026.",
          tiles: {
            ...cardView().tiles,
            views: {
              id: "views",
              value: null,
              unavailableReason: "No approved report carried menu views for this month.",
              deltaPercent: null,
              deltaLabel: null,
              deltaAbsentReason: null,
              footnote: null,
            },
          },
        })}
      />,
    );

    expect(screen.getByText("Not reported")).toBeInTheDocument();
    expect(
      screen.getByText("No approved report carried menu views for this month."),
    ).toBeInTheDocument();
  });
});
