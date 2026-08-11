// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { ChannelEconomicsClient } from "@/components/economics/channel-economics-client";
import type { ChannelRollup } from "@/domain/economics/rollup";
import type { EconomicsView } from "@/modules/economics/application/read-model";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => cleanup());

const window_ = {
  preset: "30d" as const,
  rangeStart: new Date("2026-06-30T20:00:00Z"),
  rangeEndExclusive: new Date("2026-07-30T20:00:00Z"),
  timeZone: "Asia/Dubai",
};

const derived: ChannelRollup = {
  channel: "talabat",
  currency: "AED",
  grossRevenueMinor: 17_752_700,
  transactionCount: 2_841,
  periodCount: 30,
  marginSource: "derived",
  grade: "partial",
  contributionMarginMinor: 3_603_400,
  marginRate: 0.203,
};

const indicative: ChannelRollup = {
  channel: "noon_food",
  currency: "AED",
  grossRevenueMinor: 5_746_700,
  transactionCount: 972,
  periodCount: 30,
  marginSource: "derived",
  grade: "indicative",
  atMostMinor: 1_381_600,
};

const reported: ChannelRollup = {
  channel: "deliveroo",
  currency: "AED",
  grossRevenueMinor: 13_108_400,
  transactionCount: 1_809,
  periodCount: 30,
  marginSource: "reported",
  grade: "complete",
  contributionMarginMinor: 2_495_600,
  marginRate: 0.19,
};

function view(overrides: Partial<EconomicsView> = {}): EconomicsView {
  return {
    window: window_,
    rollup: { channels: [derived, indicative], currency: "AED", hasAnyDerivedChannel: true },
    breakdown: {
      channel: "talabat",
      components: [
        {
          key: "commission",
          label: "Marketplace commission",
          amountMinor: 4_970_800,
          qualityTier: "measured",
        },
        {
          key: "delivery_cost",
          label: "Delivery cost",
          amountMinor: 0,
          qualityTier: "measured",
        },
      ],
    },
    gaps: [],
    coverage: { measured: 3, priced: 4, applicable: 6 },
    catalogAvailable: true,
    ...overrides,
  };
}

function renderView(overrides: Partial<EconomicsView> = {}) {
  render(
    <ChannelEconomicsClient
      view={view(overrides)}
      organizationName="Al Noor Kitchen"
      costStructureHref="/organizations/org-1/onboarding"
      onWindowChange={vi.fn()}
    />,
  );
}

describe("ChannelEconomicsClient", () => {
  it("shows a ceiling and no rate for an indicative channel", () => {
    renderView();

    const row = screen.getByText("noon_food").closest("tr");
    expect(row).not.toBeNull();
    // A ceiling must never be able to read as a figure at a glance.
    expect(within(row!).getByText(/At most AED 13,816\.00/)).toBeInTheDocument();
    expect(
      within(row!).getByLabelText(/No margin rate for an indicative margin/),
    ).toBeInTheDocument();
    expect(within(row!).getByText("Indicative")).toBeInTheDocument();
  });

  it("puts the grade on every row rather than behind a tooltip", () => {
    renderView();

    // specs/012 section 7: visible per row, never hidden. Scoped to the table
    // because the waterfall repeats the selected channel's grade on its total.
    const talabat = screen.getByText("talabat").closest("tr");
    const noonFood = screen.getByText("noon_food").closest("tr");

    expect(within(talabat!).getByText("Partial")).toBeInTheDocument();
    expect(within(noonFood!).getByText("Indicative")).toBeInTheDocument();
  });

  it("renders a priced zero as an amount rather than as unknown", () => {
    renderView();

    // Dine-in delivery genuinely costs nothing; that is an answer, not a gap.
    expect(screen.getByText("Delivery cost")).toBeInTheDocument();
    expect(screen.getByText(/−AED 0\.00/)).toBeInTheDocument();
  });

  it("offers no waterfall for a channel whose margin was reported", () => {
    renderView({
      rollup: { channels: [reported], currency: "AED", hasAnyDerivedChannel: false },
      breakdown: null,
    });

    // The components would not add up to a reported figure, so drawing them
    // together would be the silent reconciliation 4.4.1 forbids.
    expect(screen.getByText("No component breakdown yet")).toBeInTheDocument();
    expect(screen.getByText("Reported")).toBeInTheDocument();
  });

  it("leads with the task list when nothing can be derived", () => {
    renderView({
      rollup: { channels: [reported], currency: "AED", hasAnyDerivedChannel: false },
      breakdown: null,
      coverage: { measured: 0, priced: 0, applicable: 6 },
      gaps: [
        {
          key: "commission",
          label: "Marketplace commission",
          state: "unpriced",
          reason: "No rate recorded.",
        },
      ],
    });

    // specs/012 section 11: do not open with a table of ceilings the operator
    // cannot act on.
    const headings = screen.getAllByText(
      /What would I have to fix to trust this|Which channel actually makes money/,
    );
    expect(headings[0].textContent).toMatch(/What would I have to fix/);
    expect(screen.getByText(/These margins are your own reported figures/)).toBeInTheDocument();
  });

  it("keeps the fixed order once something is derived", () => {
    renderView();

    const headings = screen.getAllByText(
      /Which channel actually makes money|What is eating the margin|What would I have to fix/,
    );
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Which channel actually makes money",
      "What is eating the margin",
      "What would I have to fix to trust this",
    ]);
  });

  it("names a gap the operator cannot close without offering an action", () => {
    renderView({
      gaps: [
        {
          key: "packaging",
          label: "Packaging",
          state: "not_yet_possible",
          reason: "Charged per item, and no item count is being imported yet.",
        },
      ],
    });

    // An action nobody can complete is worse than no action at all.
    expect(screen.getByText("Packaging")).toBeInTheDocument();
    expect(screen.getByText("Not yet possible")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Price this" })).not.toBeInTheDocument();
  });

  it("reports an empty window rather than rendering zeros", () => {
    renderView({
      rollup: { channels: [], currency: null, hasAnyDerivedChannel: false },
      breakdown: null,
    });

    expect(screen.getByText("No trade recorded in this window")).toBeInTheDocument();
  });
});
