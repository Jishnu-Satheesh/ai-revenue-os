// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { OverviewReport } from "@/components/organizations/overview-report";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import {
  buildDigitalTwinReadiness,
  getOverviewPermissions,
  type OverviewActionItem,
  type OverviewComparison,
  type OverviewEconomics,
  type OverviewMoneyScale,
} from "@/modules/organizations/application/overview";

afterEach(() => cleanup());

/** Intl separates a currency code from its amount with a non-breaking space. */
function text(element: { textContent: string | null }): string {
  return (element.textContent ?? "").replace(/\u00a0/g, " ");
}

let geometry: ReturnType<typeof vi.spyOn> | undefined;

beforeAll(() => {
  // Recharts measures its container before drawing; jsdom reports zero.
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

const organizationId = "11111111-1111-4111-8111-111111111111";

const snapshot: DigitalTwinSnapshot = {
  organization: {
    id: organizationId,
    name: "Al Noor Kitchen",
    slug: "al-noor-kitchen",
    industry: "restaurant",
    country_code: "AE",
    base_currency: "AED",
    default_timezone: "Asia/Dubai",
    industry_pack_slug: "restaurant",
    branchless_confirmed: false,
    status: "active",
    account_id: "33333333-3333-4333-8333-333333333333",
    created_by: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
    archived_at: null,
  },
  branches: [],
  profile: null,
  facts: [],
  goals: [],
  constraints: [],
  policies: [],
  auditEvents: [],
};

const reportingWindow: OverviewEconomics["window"] = {
  rangeStart: "2026-08-02T20:00:00.000Z",
  rangeEndExclusive: "2026-09-01T20:00:00.000Z",
  timeZone: "Asia/Dubai",
};

function economics(overrides: Partial<OverviewEconomics> = {}): OverviewEconomics {
  return {
    state: "ready",
    currency: "AED",
    window: reportingWindow,
    trend: [
      {
        periodStart: "2026-08-02T20:00:00.000Z",
        grossRevenueMinor: 10_000,
        contributionMarginMinor: 3_000,
        atMostMinor: null,
        grade: "complete",
      },
      {
        periodStart: "2026-08-03T20:00:00.000Z",
        grossRevenueMinor: 8_000,
        contributionMarginMinor: null,
        atMostMinor: 2_500,
        grade: "indicative",
      },
    ],
    channels: [
      {
        channel: "talabat",
        grossRevenueMinor: 12_000,
        contributionMarginMinor: 3_000,
        atMostMinor: null,
        grade: "complete",
      },
      {
        channel: "own_website",
        grossRevenueMinor: 6_000,
        contributionMarginMinor: null,
        atMostMinor: 2_500,
        grade: "indicative",
      },
    ],
    gradeCounts: { complete: 1, partial: 0, indicative: 1 },
    coverage: { measured: 2, priced: 3, applicable: 5 },
    catalogAvailable: true,
    gaps: [],
    takeaway: "1 of 2 recorded days can only support a margin ceiling, not a profit conclusion.",
    ...overrides,
  };
}

const scaleWithBand: OverviewMoneyScale = {
  currency: "AED",
  salesMinor: 18_000,
  costsRecordedMinor: 7_000,
  keptFloorMinor: 3_000,
  keptCeilingMinor: 5_500,
  hasUnprovenBand: true,
};

const closedScale: OverviewMoneyScale = {
  currency: "AED",
  salesMinor: 10_000,
  costsRecordedMinor: 7_000,
  keptFloorMinor: 3_000,
  keptCeilingMinor: 3_000,
  hasUnprovenBand: false,
};

function renderReport(
  overrides: Partial<React.ComponentProps<typeof OverviewReport>> = {},
) {
  return render(
    <OverviewReport
      snapshot={snapshot}
      readiness={buildDigitalTwinReadiness(snapshot)}
      permissions={getOverviewPermissions("viewer")}
      reportingWindow={reportingWindow}
      economics={{ status: "ready", data: economics() }}
      integration={{ status: "disabled" }}
      scale={scaleWithBand}
      comparison={null}
      actions={[]}
      {...overrides}
    />,
  );
}

describe("OverviewReport", () => {
  it("leads with a floor and a range while any day is missing costs", () => {
    renderReport();

    const band = screen.getByLabelText("Where you stand");
    expect(text(band)).toContain("kept at least");
    expect(text(band)).toContain("AED 30.00");
    expect(text(band)).toContain("AED 55.00");
    expect(text(band)).toMatch(/1 of the 2 days is missing cost figures/);
  });

  it("drops the hedge once every recorded day can state a margin", () => {
    renderReport({
      scale: closedScale,
      economics: {
        status: "ready",
        data: economics({ gradeCounts: { complete: 2, partial: 0, indicative: 0 } }),
      },
    });

    const band = screen.getByLabelText("Where you stand");
    expect(text(band)).toContain("and kept");
    expect(text(band)).not.toContain("kept at least");
    expect(text(band)).toMatch(/exact figure rather than a range/);
  });

  it("refuses a money sentence rather than substituting one when the read fails", () => {
    renderReport({ economics: { status: "failed" }, scale: null });

    const band = screen.getByLabelText("Where you stand");
    expect(text(band)).toContain("could not read your figures");
    expect(text(band)).not.toMatch(/AED/);
    expect(screen.getAllByText(/no figure has been substituted/i).length).toBeGreaterThan(0);
  });

  it("draws no chart at all for a window with no recorded trade", () => {
    renderReport({
      economics: { status: "ready", data: economics({ state: "empty", trend: [], channels: [] }) },
      scale: null,
    });

    expect(screen.queryByTestId("overview-trend-chart")).toBeNull();
    expect(screen.getByText(/an empty one would mislead/i)).toBeTruthy();
    // No "which places" or "how solid" chapter either: there is nothing to grade.
    expect(screen.queryByLabelText("Which places brought it in chapter")).toBeNull();
    expect(screen.queryByLabelText("How solid these numbers are chapter")).toBeNull();
  });

  it("states no change when there is no earlier window to compare against", () => {
    renderReport({ comparison: null });

    const chapter = screen.getByLabelText("What came in, day by day figures");
    expect(text(chapter)).toMatch(/no earlier window with recorded trade/i);
    expect(text(chapter)).not.toContain("%");
  });

  it("shows the comparison as a share of the prior window it names", () => {
    const comparison: OverviewComparison = {
      currency: "AED",
      currentMinor: 18_000,
      priorMinor: 12_000,
      deltaMinor: 6_000,
    };
    renderReport({ comparison });

    const chapter = screen.getByLabelText("What came in, day by day figures");
    expect(text(chapter)).toContain("+50%");
    expect(text(chapter)).toContain("AED 120.00");
  });

  it("does not offer a viewer a mutation they cannot complete", () => {
    const actions: OverviewActionItem[] = [
      {
        kind: "foundation",
        title: "Nobody is named as the approver yet",
        impact: "Nothing this platform suggests can be acted on until a real person has to say yes.",
      },
    ];
    renderReport({ actions });

    expect(screen.getByText("Nobody is named as the approver yet")).toBeTruthy();
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /name an approver/i })).toBeNull();
    // A viewer never reaches the management surface either.
    expect(screen.queryByRole("link", { name: /manage organization/i })).toBeNull();
  });

  it("keeps the management surface reachable for a role that may edit", () => {
    render(
      <OverviewReport
        snapshot={snapshot}
        readiness={buildDigitalTwinReadiness(snapshot)}
        permissions={getOverviewPermissions("admin")}
        reportingWindow={reportingWindow}
        economics={{ status: "ready", data: economics() }}
        integration={{ status: "disabled" }}
        scale={scaleWithBand}
        comparison={null}
        actions={[]}
      />,
    );

    expect(screen.getByRole("link", { name: /manage organization/i })).toBeTruthy();
  });

  it("omits connection health entirely when the rollout is disabled", () => {
    renderReport({ integration: { status: "disabled" } });
    expect(screen.queryByText(/connections working/i)).toBeNull();
  });

  it("says connection health could not be checked rather than reporting zero", () => {
    renderReport({ integration: { status: "failed" } });
    expect(screen.getByText(/could not be checked/i)).toBeTruthy();
    expect(screen.queryByText(/0 of 0 connections/i)).toBeNull();
  });

  it("names what each pending answer waits on instead of promising a date", () => {
    renderReport();

    const shelf = screen.getByLabelText("Not ready yet");
    expect(text(shelf)).toMatch(/Waits on/);
    expect(text(shelf)).not.toMatch(/soon|shortly|coming/i);
  });

  it("keeps platform copy industry-neutral", () => {
    // Rendered for an organization with no restaurant vocabulary of its own, so
    // anything matching below would have come from the platform, not the tenant.
    const neutral: DigitalTwinSnapshot = {
      ...snapshot,
      organization: {
        ...snapshot.organization,
        name: "Northwind Trading",
        slug: "northwind-trading",
        industry: "retail",
        industry_pack_slug: "retail",
      },
    };
    const { container } = renderReport({
      snapshot: neutral,
      readiness: buildDigitalTwinReadiness(neutral),
    });

    // Whole words only: "profitable" and "coverage" are not restaurant nouns.
    expect(text(container)).not.toMatch(/\b(dish|dishes|menu|menus|restaurant|kitchen)\b/i);
  });
});
