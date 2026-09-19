// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  BusinessPerformanceCard,
  trendYAxisTicks,
  visibleBarLabelIndexes,
  visibleTickIndexes,
} from "@/components/growth-intelligence/business-performance-card";
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
      screen.getByRole("img", { name: /Channel shares: Delivery A 50%/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("AED 60,000")).toBeInTheDocument();
    expect(
      screen.getByText("Cost data is needed to explain how much of these sales became profit."),
    ).toBeInTheDocument();
  });

  it("renders the pie even when a single channel owns every sale", () => {
    render(
      <BusinessPerformanceCard
        card={cardView({
          shares: {
            rows: [
              {
                channelId: "ch-a",
                displayName: "Delivery A",
                minorUnits: 6_000_000,
                currency: "AED",
                sharePercent: 100,
              },
            ],
            totalMinorUnits: 6_000_000,
            currency: "AED",
          },
        })}
      />,
    );

    expect(
      screen.getByRole("img", { name: /Channel shares: Delivery A 100%/ }),
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

  it("thins a crowded empty trend to readable labels, always keeping the latest", () => {
    const weeks = [
      "5–11 Jan",
      "12–18 Jan",
      "19–25 Jan",
      "26 Jan–1 Feb",
      "2–8 Feb",
      "9–15 Feb",
      "16–22 Feb",
      "23 Feb–1 Mar",
      "2–8 Mar",
      "9–15 Mar",
      "16–22 Mar",
      "23–29 Mar",
    ];
    render(
      <BusinessPerformanceCard
        card={cardView({
          trend: {
            state: "empty",
            reason: "Fewer than two weeks of the selected period have a completed analysis.",
            weeks,
          },
        })}
      />,
    );

    expect(screen.getByText("5–11 Jan")).toBeInTheDocument();
    expect(screen.queryByText("12–18 Jan")).toBeNull();
    expect(screen.getByText("23–29 Mar")).toBeInTheDocument();
  });
});

describe("visibleTickIndexes", () => {
  it("keeps every label at six or fewer and the latest past that", () => {
    expect(visibleTickIndexes(3)).toEqual([true, true, true]);
    expect(visibleTickIndexes(12)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
    ]);
  });
});

describe("trend value labels", () => {
  it("labels every bar at thirty-one or fewer", () => {
    expect(visibleBarLabelIndexes(2)).toEqual([true, true]);
    expect(visibleBarLabelIndexes(31)).toEqual(Array.from({ length: 31 }, () => true));
  });

  it("thins crowded bars to every nth plus the latest", () => {
    const thinned = visibleBarLabelIndexes(32);
    expect(thinned).toHaveLength(32);
    expect(thinned[0]).toBe(true);
    expect(thinned[1]).toBe(false);
    expect(thinned[30]).toBe(true);
    expect(thinned[31]).toBe(true);
  });

  it("names every bucket for assistive tech even when labels thin", () => {
    const buckets = Array.from({ length: 35 }, (_, index) => ({
      label: `Day ${index + 1}`,
      minorUnits: (index + 1) * 100_000,
    }));
    render(<BusinessPerformanceCard card={cardView({ trend: { state: "ready", buckets, currency: "AED", coverageNote: "35 days" } })} />);

    const trend = screen.getByRole("img", { name: /Weekly reported sales/ });
    const label = trend.getAttribute("aria-label") ?? "";
    expect(label).toContain("Day 1");
    expect(label).toContain("Day 35");
    expect(label).toContain("Day 17");
  });

  it("invents no zero-fill for missing days", () => {
    render(
      <BusinessPerformanceCard
        card={cardView({
          trend: {
            state: "ready",
            buckets: [
              { label: "2–8 Feb", minorUnits: 2_400_000 },
              { label: "16–22 Feb", minorUnits: 3_600_000 },
            ],
            currency: "AED",
            coverageNote: "2 days with data",
          },
        })}
      />,
    );

    const trend = screen.getByRole("img", { name: /Weekly reported sales/ });
    const label = trend.getAttribute("aria-label") ?? "";
    expect(label).toContain("2–8 Feb");
    expect(label).toContain("16–22 Feb");
    expect(label).not.toContain("9–15 Feb");
  });
});

describe("trend plot shape", () => {
  it("matches the pie visual height so both sections end level", () => {
    render(<BusinessPerformanceCard card={cardView()} />);

    const trend = screen.getByRole("img", { name: /Weekly reported sales/ });
    expect(trend).toHaveClass("h-55");
    expect(trend).not.toHaveClass("h-52");
  });

  it("grows the y-axis to five round ticks", () => {
    expect(trendYAxisTicks(36_000)).toEqual([0, 10_000, 20_000, 30_000, 40_000]);
    expect(trendYAxisTicks(1)).toEqual([0, 0.5, 1, 1.5, 2]);
  });
});
