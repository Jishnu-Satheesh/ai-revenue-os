// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChannelEconomicsOverview } from "@/components/organizations/channel-economics-overview";
import type { OverviewEconomics } from "@/modules/organizations/application/overview";

afterEach(() => cleanup());

let geometry: ReturnType<typeof vi.spyOn> | undefined;

beforeAll(() => {
  geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 640,
    height: 288,
    top: 0,
    right: 640,
    bottom: 288,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterAll(() => geometry?.mockRestore());

const economics: OverviewEconomics = {
  state: "ready",
  currency: "AED",
  window: {
    rangeStart: "2026-07-13T20:00:00.000Z",
    rangeEndExclusive: "2026-08-12T20:00:00.000Z",
    timeZone: "Asia/Dubai",
  },
  trend: [
    {
      periodStart: "2026-08-10T20:00:00.000Z",
      grossRevenueMinor: 15_000,
      contributionMarginMinor: null,
      atMostMinor: 5_000,
      grade: "indicative",
    },
    {
      periodStart: "2026-08-11T20:00:00.000Z",
      grossRevenueMinor: 20_000,
      contributionMarginMinor: 7_000,
      atMostMinor: null,
      grade: "complete",
    },
  ],
  channels: [
    {
      channel: "Direct",
      grossRevenueMinor: 25_000,
      contributionMarginMinor: 9_000,
      atMostMinor: null,
      grade: "complete",
    },
    {
      channel: "Marketplace",
      grossRevenueMinor: 10_000,
      contributionMarginMinor: null,
      atMostMinor: 3_000,
      grade: "indicative",
    },
  ],
  gradeCounts: { complete: 1, partial: 0, indicative: 1 },
  coverage: { measured: 2, priced: 3, applicable: 5 },
  catalogAvailable: true,
  gaps: [
    {
      key: "packaging",
      label: "Packaging",
      state: "not_yet_possible",
      reason: "No item count is being imported yet.",
    },
  ],
  takeaway: "1 of 2 recorded days can only support a margin ceiling, not a profit conclusion.",
};

describe("ChannelEconomicsOverview", () => {
  it("uses three readable chart tabs and keeps indicative margin visibly bounded", () => {
    render(
      <ChannelEconomicsOverview
        organizationId="11111111-1111-4111-8111-111111111111"
        result={{ status: "ready", data: economics }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Trend" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Gross revenue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Contribution margin").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/upper bound/i).length).toBeGreaterThan(0);
    expect(screen.getByText(economics.takeaway)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Channel comparison" }), { button: 0 });
    expect(screen.getAllByText("Direct").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Marketplace").length).toBeGreaterThan(0);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Data trust" }), { button: 0 });
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
    expect(screen.getByText("Packaging")).toBeInTheDocument();
  });

  it("renders no all-zero chart when the ledger window is empty", () => {
    render(
      <ChannelEconomicsOverview
        organizationId="11111111-1111-4111-8111-111111111111"
        result={{
          status: "ready",
          data: {
            ...economics,
            state: "empty",
            currency: null,
            trend: [],
            channels: [],
            gradeCounts: { complete: 0, partial: 0, indicative: 0 },
          },
        }}
      />,
    );

    expect(screen.getByText("No trade recorded in this window")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Trend" })).not.toBeInTheDocument();
  });

  it("contains an economics read failure without removing the card", () => {
    render(
      <ChannelEconomicsOverview
        organizationId="11111111-1111-4111-8111-111111111111"
        result={{ status: "failed" }}
      />,
    );

    expect(screen.getByText("Channel economics are temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open channel economics" })).toHaveAttribute(
      "href",
      "/organizations/11111111-1111-4111-8111-111111111111/economics",
    );
  });
});
