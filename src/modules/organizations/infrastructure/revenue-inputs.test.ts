import { describe, expect, it } from "vitest";

import type { ChannelBandRecord, ChannelFindingRecord } from "@/modules/analysis/application/ports";
import {
  filterRevenueInputForViewer,
  mapRevenueInputs,
  REVENUE_HISTORY_WINDOWS,
} from "@/modules/organizations/infrastructure/revenue-inputs";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const LOSS_ID = "22222222-2222-4222-8222-222222222221";

function finding(overrides: Partial<ChannelFindingRecord> = {}): ChannelFindingRecord {
  return {
    id: "33333333-3333-4333-8333-333333333331",
    analysisRunId: "44444444-4444-4444-8444-444444444441",
    channelId: "chan-a",
    branchId: null,
    detectorKey: "revenue.window",
    detectorVersion: 1,
    kind: "observation",
    code: "WINDOW_GROSS_REVENUE",
    severity: null,
    priority: null,
    metricKey: null,
    periodStart: "2026-08-04",
    periodEnd: "2026-08-10",
    valueKind: "money",
    valueNumerator: 500_00,
    valueDenominator: null,
    currency: "AED",
    monetaryImpactMinorUnits: null,
    expectedPeriodCount: null,
    observedPeriodCount: null,
    absentPeriodCount: null,
    qualityState: "complete",
    needsDataReason: null,
    limitations: [],
    calculationDigest: "digest",
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function band(channelId: string, findings: readonly ChannelFindingRecord[]): ChannelBandRecord {
  return { channelId, analysisRunId: "44444444-4444-4444-8444-444444444441", findings };
}

function weekWindow(start: string, end: string) {
  return { windowStart: start, windowEnd: end, grain: "week" };
}

describe("mapRevenueInputs", () => {
  it("maps reported gross into grain-scoped history with notes", () => {
    const result = mapRevenueInputs({
      organizationId: ORG_ID,
      windows: [weekWindow("2026-08-11", "2026-08-17"), weekWindow("2026-08-04", "2026-08-10")],
      bands: [
        [band("chan-a", [finding({ valueNumerator: 700_00 })])],
        [
          band("chan-a", [finding({ valueNumerator: 500_00 })]),
          band("chan-b", [finding({ valueNumerator: 300_00 })]),
        ],
      ],
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-08-20",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.input.grain).toBe("week");
    expect(result.input.history).toHaveLength(2);
    expect(result.input.history[0]).toMatchObject({ label: "4–10 Aug", minorUnits: 800_00 });
    expect(result.input.history[1]).toMatchObject({ label: "11–17 Aug", minorUnits: 700_00 });
    expect(result.input.lastObservationDate).toBe("2026-08-17");
    expect(result.input.cutoffNote).toBe("Reports through 2026-08-17.");
    expect(result.input.coverageNote).toMatch(/2 reporting channels/);
  });

  it("collects observed losses and binds cited recommendations to them", () => {
    const result = mapRevenueInputs({
      organizationId: ORG_ID,
      windows: [weekWindow("2026-08-04", "2026-08-10")],
      bands: [
        [
          band("chan-a", [
            finding({ valueNumerator: 500_00 }),
            finding({
              id: LOSS_ID,
              code: "ORDER_CANCELLATION_LOSS",
              valueKind: "count",
              valueNumerator: 12,
              currency: "AED",
              monetaryImpactMinorUnits: 200_00,
            }),
          ]),
        ],
      ],
      recommendations: [
        {
          id: "rec-1",
          headline: "Recover avoidable cancellations",
          decision: { decision: "planned" },
          citationFindingIds: [LOSS_ID],
        },
        {
          id: "rec-2",
          headline: "Untriaged idea",
          decision: null,
          citationFindingIds: ["55555555-5555-4555-8555-555555555555"],
        },
      ],
      insights: [
        { id: "ins-1", narrative: "Weekend demand is climbing.", decision: "acknowledged" },
      ],
      proposals: [
        {
          proposalId: "66666666-6666-4666-8666-666666666666",
          title: "Ramadan set menu",
          state: "awaiting_research",
          lastDecision: null,
        },
      ],
      today: "2026-08-20",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.input.losses).toHaveLength(1);
    expect(result.input.losses[0]).toMatchObject({
      findingId: LOSS_ID,
      minorUnits: 200_00,
      currency: "AED",
    });
    const [first, second, proposal, insight] = result.input.actions;
    expect(first).toMatchObject({
      kind: "recommendation",
      status: "planned",
      citedFindingId: LOSS_ID,
      citedBasisMinorUnits: 200_00,
      assumptionLow: null,
      assumptionHigh: null,
    });
    expect(first?.href).toContain(ORG_ID);
    expect(second?.status).toBe("New");
    expect(second?.citedFindingId).toBeNull();
    expect(proposal).toMatchObject({ kind: "proposal", status: "awaiting_research" });
    expect(proposal?.href).toContain("campaign-proposals");
    expect(insight).toMatchObject({ kind: "insight", status: "acknowledged" });
  });

  it("omits empty and mixed-currency buckets instead of zero-filling", () => {
    const result = mapRevenueInputs({
      organizationId: ORG_ID,
      windows: [
        weekWindow("2026-08-18", "2026-08-24"),
        weekWindow("2026-08-11", "2026-08-17"),
        weekWindow("2026-08-04", "2026-08-10"),
      ],
      bands: [
        [band("chan-a", [])],
        [band("chan-a", [finding({ valueNumerator: 100_00, currency: "AED" })])],
        [
          band("chan-a", [finding({ valueNumerator: 100_00, currency: "AED" })]),
          band("chan-b", [finding({ valueNumerator: 100_00, currency: "USD" })]),
        ],
      ],
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-08-26",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.input.history).toHaveLength(1);
    expect(result.input.history[0]?.minorUnits).toBe(100_00);
  });

  it("picks maximum coverage without overlap, preferring more windows on ties", () => {
    const result = mapRevenueInputs({
      organizationId: ORG_ID,
      windows: [
        weekWindow("2026-01-01", "2026-02-28"),
        weekWindow("2026-02-01", "2026-02-28"),
        weekWindow("2026-01-01", "2026-01-31"),
      ],
      bands: [
        [band("chan-a", [finding({ valueNumerator: 150_00 })])],
        [band("chan-a", [finding({ valueNumerator: 200_00 })])],
        [band("chan-a", [finding({ valueNumerator: 100_00 })])],
      ],
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-03-05",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // Jan–Feb (59 days) ties Jan + Feb (59 days): two windows win.
    expect(result.input.history).toHaveLength(2);
    expect(result.input.history[0]).toMatchObject({ label: "2026-01", minorUnits: 100_00 });
    expect(result.input.history[1]).toMatchObject({ label: "2026-02", minorUnits: 200_00 });
    expect(result.input.grain).toBe("month");
  });

  it("lets grains mix and reads the shape, never the analysis grain", () => {
    const result = mapRevenueInputs({
      organizationId: ORG_ID,
      windows: [weekWindow("2026-09-01", "2026-09-07"), weekWindow("2026-08-01", "2026-08-31")],
      bands: [
        [band("chan-a", [finding({ valueNumerator: 70_00 })])],
        [band("chan-a", [finding({ valueNumerator: 300_00 })])],
      ],
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-09-02",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.input.grain).toBe("period");
    expect(result.input.history).toHaveLength(2);
    expect(result.input.coverageNote).toMatch(/period buckets/);
  });

  it("keeps overlong windows out of history but keeps their losses citable", () => {
    const result = mapRevenueInputs({
      organizationId: ORG_ID,
      windows: [weekWindow("2025-08-23", "2026-08-22"), weekWindow("2026-01-01", "2026-01-31")],
      bands: [
        [
          band("chan-a", [
            finding({ valueNumerator: 9999_00 }),
            finding({
              id: LOSS_ID,
              code: "ORDER_CANCELLATION_LOSS",
              valueKind: "count",
              valueNumerator: 12,
              currency: "AED",
              monetaryImpactMinorUnits: 200_00,
            }),
          ]),
        ],
        [band("chan-a", [finding({ valueNumerator: 100_00 })])],
      ],
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-09-02",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.input.history).toHaveLength(1);
    expect(result.input.history[0]).toMatchObject({ label: "2026-01" });
    expect(result.input.losses).toHaveLength(1);
    expect(result.input.losses[0]?.findingId).toBe(LOSS_ID);
  });

  it("caps the plotted series at eight windows", () => {
    const iso = (base: string, offsetDays: number) => {
      const instant = new Date(`${base}T00:00:00.000Z`).getTime() + offsetDays * 86_400_000;
      return new Date(instant).toISOString().slice(0, 10);
    };
    const windows = Array.from({ length: 10 }, (_, index) => {
      const start = iso("2026-01-05", index * 7);
      return weekWindow(start, iso(start, 6));
    });
    const bands = windows.map(() => [band("chan-a", [finding({ valueNumerator: 10_00 })])]);
    const result = mapRevenueInputs({
      organizationId: ORG_ID,
      windows,
      bands,
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-09-02",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.input.history).toHaveLength(8);
    expect(REVENUE_HISTORY_WINDOWS).toBe(8);
  });

  it("refuses honestly with no analysed windows instead of failing", () => {
    const result = mapRevenueInputs({
      organizationId: ORG_ID,
      windows: [],
      bands: [],
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-08-20",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.input.history).toHaveLength(0);
  });

  it("fails closed on bad identity, misaligned reads, or a failed window", () => {
    const base = {
      organizationId: ORG_ID,
      windows: [weekWindow("2026-08-04", "2026-08-10")],
      bands: [[band("chan-a", [finding()])]] as (readonly ChannelBandRecord[] | null)[],
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-08-20",
    };
    expect(mapRevenueInputs({ ...base, organizationId: "not-a-uuid" }).status).toBe("failed");
    expect(mapRevenueInputs({ ...base, today: "20-08-2026" }).status).toBe("failed");
    expect(mapRevenueInputs({ ...base, bands: [] }).status).toBe("failed");
    expect(mapRevenueInputs({ ...base, bands: [null] }).status).toBe("failed");
  });
});

describe("filterRevenueInputForViewer", () => {
  function filteredInput() {
    return {
      organizationId: ORG_ID,
      grain: "month" as const,
      history: [{ label: "2026-08", minorUnits: 800_00, currency: "AED" }],
      losses: [],
      actions: [
        {
          id: "rec-1",
          title: "Recommendation",
          kind: "recommendation" as const,
          status: "Planned",
          href: null,
          citedFindingId: null,
          citedBasisMinorUnits: null,
          citedCurrency: null,
          assumptionLow: null,
          assumptionHigh: null,
        },
        {
          id: "proposal:1",
          title: "Proposal",
          kind: "proposal" as const,
          status: "Ready",
          href: null,
          citedFindingId: null,
          citedBasisMinorUnits: null,
          citedCurrency: null,
          assumptionLow: null,
          assumptionHigh: null,
        },
        {
          id: "insight:1",
          title: "Insight",
          kind: "insight" as const,
          status: "New",
          href: null,
          citedFindingId: null,
          citedBasisMinorUnits: null,
          citedCurrency: null,
          assumptionLow: null,
          assumptionHigh: null,
        },
      ],
      lastObservationDate: "2026-08-31",
      today: "2026-09-16",
      cutoffNote: "Reports through 2026-08-31.",
      coverageNote: "All reporting channels.",
    };
  }

  it("keeps everything when both gates pass", () => {
    const result = filterRevenueInputForViewer(filteredInput(), {
      includeProposals: true,
      includeActions: true,
    });
    expect(result.actions).toHaveLength(3);
  });

  it("drops proposals without campaign access and actions without growth access", () => {
    const noProposals = filterRevenueInputForViewer(filteredInput(), {
      includeProposals: false,
      includeActions: true,
    });
    expect(noProposals.actions.map((action) => action.kind)).toEqual(["recommendation", "insight"]);
    const noActions = filterRevenueInputForViewer(filteredInput(), {
      includeProposals: true,
      includeActions: false,
    });
    expect(noActions.actions.map((action) => action.kind)).toEqual(["proposal"]);
    expect(noActions.history).toHaveLength(1);
  });
});
