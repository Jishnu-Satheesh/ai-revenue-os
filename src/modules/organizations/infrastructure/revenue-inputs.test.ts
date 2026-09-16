import { describe, expect, it } from "vitest";

import type { ChannelBandRecord, ChannelFindingRecord } from "@/modules/analysis/application/ports";
import {
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
    expect(result.input.history[0]).toMatchObject({ label: "2026-08-04", minorUnits: 800_00 });
    expect(result.input.history[1]).toMatchObject({ label: "2026-08-11", minorUnits: 700_00 });
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

  it("keeps one grain and at most eight windows", () => {
    const windows = Array.from({ length: 10 }, (_, index) => {
      const day = String(30 - index * 7).padStart(2, "0");
      return weekWindow(`2026-05-${day}`, `2026-06-${day}`);
    });
    const bands = windows.map((window, index) =>
      index === 9
        ? [band("chan-a", [finding({ valueNumerator: 1_00 })])]
        : [band("chan-a", [finding({ valueNumerator: 10_00 })])],
    );
    const mixed = mapRevenueInputs({
      organizationId: ORG_ID,
      windows: [{ windowStart: "2026-08-01", windowEnd: "2026-08-31", grain: "month" }, ...windows],
      bands: [[band("chan-a", [finding({ valueNumerator: 999_00 })])], ...bands],
      recommendations: [],
      insights: [],
      proposals: [],
      today: "2026-09-02",
    });
    expect(mixed.status).toBe("ready");
    if (mixed.status !== "ready") return;
    expect(mixed.input.grain).toBe("month");
    expect(mixed.input.history).toHaveLength(1);
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
