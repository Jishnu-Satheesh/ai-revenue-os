import { describe, expect, it } from "vitest";

import {
  applyProposedRanges,
  buildRevenueScenario,
  MIXED_CURRENCY_REASON,
  NO_HISTORY_REASON,
  revenueAssumptionRangeSchema,
  type RevenueScenarioInput,
} from "@/domain/organizations/revenue-scenario";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const FINDING_A = "22222222-2222-4222-8222-222222222221";
const FINDING_B = "22222222-2222-4222-8222-222222222222";

function baseInput(overrides: Partial<RevenueScenarioInput> = {}): RevenueScenarioInput {
  return {
    organizationId: ORG_ID,
    grain: "period",
    history: [
      { label: "Jan", minorUnits: 1_000_00, currency: "AED" },
      { label: "Feb", minorUnits: 1_200_00, currency: "AED" },
    ],
    losses: [{ findingId: FINDING_A, minorUnits: 200_00, currency: "AED" }],
    actions: [],
    lastObservationDate: "2026-08-31",
    today: "2026-09-16",
    cutoffNote: "Reports through 2026-08-31.",
    coverageNote: "All reporting channels.",
    ...overrides,
  };
}

describe("buildRevenueScenario", () => {
  it("holds the current level flat and labels the next month", () => {
    const scenario = buildRevenueScenario(baseInput());
    expect(scenario.state).toBe("ready");
    if (scenario.state !== "ready") return;
    expect(scenario.baselineMinorUnits).toBe(1_200_00);
    expect(scenario.baselineMethod).toBe("hold-current-level");
    expect(scenario.horizonLabel).toBe("Next month (≈30 days)");
    expect(scenario.currentCourseMinorUnits).toBe(1_200_00);
    expect(scenario.lastObservationBoundary).toBe(1);
    expect(scenario.roughEstimate).toBe(true);
  });

  it("computes the with-actions range deterministically from listed inputs", () => {
    const input = baseInput({
      actions: [
        {
          id: "rec-1",
          title: "Recover avoidable cancellations",
          kind: "recommendation",
          status: "Planned",
          href: null,
          citedFindingId: FINDING_A,
          citedBasisMinorUnits: 200_00,
          citedCurrency: "AED",
          assumptionLow: 0.1,
          assumptionHigh: 0.3,
        },
      ],
    });
    const first = buildRevenueScenario(input);
    const second = buildRevenueScenario(input);
    expect(first).toEqual(second);
    if (first.state !== "ready") return;
    expect(first.combinedLowMinorUnits).toBe(20_00);
    expect(first.combinedHighMinorUnits).toBe(60_00);
    expect(first.withActionsLowMinorUnits).toBe(1_220_00);
    expect(first.withActionsHighMinorUnits).toBe(1_260_00);
    expect(first.shares).toHaveLength(1);
    expect(first.shares[0]?.shareLow).toBe(33.3);
    expect(first.shares[0]?.shareHigh).toBe(100);
  });

  it("never double-counts two actions citing the same finding", () => {
    const scenario = buildRevenueScenario(
      baseInput({
        losses: [{ findingId: FINDING_A, minorUnits: 200_00, currency: "AED" }],
        actions: [
          {
            id: "rec-1",
            title: "First",
            kind: "recommendation",
            status: "Planned",
            href: null,
            citedFindingId: FINDING_A,
            citedBasisMinorUnits: 200_00,
            citedCurrency: "AED",
            assumptionLow: 0.1,
            assumptionHigh: 0.3,
          },
          {
            id: "rec-2",
            title: "Second",
            kind: "proposal",
            status: "Ready for review",
            href: null,
            citedFindingId: FINDING_A,
            citedBasisMinorUnits: 200_00,
            citedCurrency: "AED",
            assumptionLow: 0.2,
            assumptionHigh: 0.25,
          },
        ],
      }),
    );
    if (scenario.state !== "ready") throw new Error("expected ready");
    // Joint group: one shared figure (max), not the sum.
    expect(scenario.combinedLowMinorUnits).toBe(40_00);
    expect(scenario.combinedHighMinorUnits).toBe(60_00);
    expect(scenario.shares.every((share) => share.jointGroup)).toBe(true);
  });

  it("keeps uncited actions visible as not yet quantified, never zeroed", () => {
    const scenario = buildRevenueScenario(
      baseInput({
        actions: [
          {
            id: "rec-9",
            title: "Unpriced idea",
            kind: "insight",
            status: "Acknowledged",
            href: null,
            citedFindingId: null,
            citedBasisMinorUnits: null,
            citedCurrency: null,
            assumptionLow: null,
            assumptionHigh: null,
          },
        ],
      }),
    );
    if (scenario.state !== "ready") throw new Error("expected ready");
    expect(scenario.combinedLowMinorUnits).toBe(0);
    expect(scenario.unquantified).toHaveLength(1);
    expect(scenario.unquantified[0]?.reason).toMatch(/Not yet quantified/);
    expect(scenario.shares).toHaveLength(0);
  });

  it("rejects a range bound to an input outside the scenario", () => {
    const scenario = buildRevenueScenario(
      baseInput({
        actions: [
          {
            id: "rec-1",
            title: "Outside citation",
            kind: "recommendation",
            status: "Planned",
            href: null,
            citedFindingId: FINDING_B,
            citedBasisMinorUnits: 100_00,
            citedCurrency: "AED",
            assumptionLow: 0.1,
            assumptionHigh: 0.5,
          },
        ],
      }),
    );
    if (scenario.state !== "ready") throw new Error("expected ready");
    expect(scenario.combinedHighMinorUnits).toBe(0);
    expect(scenario.unquantified).toHaveLength(1);
  });

  it("caps recovery at past loss and refuses mixed currencies", () => {
    const capped = buildRevenueScenario(
      baseInput({
        actions: [
          {
            id: "rec-1",
            title: "Full recovery claim",
            kind: "recommendation",
            status: "Planned",
            href: null,
            citedFindingId: FINDING_A,
            citedBasisMinorUnits: 200_00,
            citedCurrency: "AED",
            assumptionLow: 0,
            assumptionHigh: 1,
          },
        ],
      }),
    );
    if (capped.state !== "ready") throw new Error("expected ready");
    expect(capped.combinedHighMinorUnits).toBe(200_00);

    const mixed = buildRevenueScenario(
      baseInput({
        history: [
          { label: "Jan", minorUnits: 100_00, currency: "AED" },
          { label: "Feb", minorUnits: 100_00, currency: "USD" },
        ],
      }),
    );
    expect(mixed.state).toBe("refused");
    if (mixed.state !== "refused") return;
    expect(mixed.reason).toBe(MIXED_CURRENCY_REASON);
  });

  it("states no percentage from a zero baseline and marks staleness as a gap", () => {
    const scenario = buildRevenueScenario(
      baseInput({
        history: [{ label: "Jan", minorUnits: 0, currency: "AED" }],
        lastObservationDate: "2026-09-01",
        today: "2026-09-16",
      }),
    );
    if (scenario.state !== "ready") throw new Error("expected ready");
    expect(scenario.upliftLowPercent).toBeNull();
    expect(scenario.upliftHighPercent).toBeNull();
    expect(scenario.stalenessGap).toBe(true);
    expect(scenario.gapNote).toMatch(/gap/i);
  });

  it("refuses with no history", () => {
    const scenario = buildRevenueScenario(baseInput({ history: [] }));
    expect(scenario.state).toBe("refused");
    if (scenario.state !== "refused") return;
    expect(scenario.reason).toBe(NO_HISTORY_REASON);
  });

  it("rejects assumption ranges that cite nothing or invert low and high", () => {
    expect(
      revenueAssumptionRangeSchema.safeParse({
        actionId: "rec-1",
        citedFindingId: FINDING_A,
        citedBasisMinorUnits: 100,
        currency: "AED",
        low: 0.6,
        high: 0.2,
      }).success,
    ).toBe(false);
  });

  it("attaches only cited ranges and leaves the rest unquantified", () => {
    const uncited = baseInput({
      actions: [
        {
          id: "rec-1",
          title: "Recover avoidable cancellations",
          kind: "recommendation",
          status: "Planned",
          href: null,
          citedFindingId: null,
          citedBasisMinorUnits: null,
          citedCurrency: null,
          assumptionLow: null,
          assumptionHigh: null,
        },
      ],
    });
    const known = new Set([FINDING_A]);
    const applied = applyProposedRanges(
      uncited.actions,
      [
        {
          actionId: "rec-1",
          citedFindingId: FINDING_A,
          citedBasisMinorUnits: 200_00,
          currency: "AED",
          low: 0.1,
          high: 0.3,
        },
        {
          actionId: "rec-1",
          citedFindingId: FINDING_B,
          citedBasisMinorUnits: 100_00,
          currency: "AED",
          low: 0.1,
          high: 0.5,
        },
        {
          actionId: "ghost",
          citedFindingId: FINDING_A,
          citedBasisMinorUnits: 50_00,
          currency: "AED",
          low: 0.1,
          high: 0.2,
        },
      ],
      known,
    );
    expect(applied.rejected).toHaveLength(2);
    const scenario = buildRevenueScenario({ ...uncited, actions: applied.actions });
    if (scenario.state !== "ready") throw new Error("expected ready");
    expect(scenario.combinedLowMinorUnits).toBe(20_00);
    expect(scenario.combinedHighMinorUnits).toBe(60_00);
    expect(scenario.unquantified).toHaveLength(0);
  });

  it("keeps rejected ranges from zeroing or blocking the action", () => {
    const uncited = baseInput({
      actions: [
        {
          id: "rec-9",
          title: "Unpriced idea",
          kind: "insight",
          status: "Acknowledged",
          href: null,
          citedFindingId: null,
          citedBasisMinorUnits: null,
          citedCurrency: null,
          assumptionLow: null,
          assumptionHigh: null,
        },
      ],
    });
    const applied = applyProposedRanges(
      uncited.actions,
      [
        {
          actionId: "rec-9",
          citedFindingId: FINDING_B,
          citedBasisMinorUnits: 100_00,
          currency: "AED",
          low: 0.1,
          high: 0.5,
        },
      ],
      new Set([FINDING_A]),
    );
    expect(applied.rejected).toHaveLength(1);
    const scenario = buildRevenueScenario({ ...uncited, actions: applied.actions });
    if (scenario.state !== "ready") throw new Error("expected ready");
    expect(scenario.combinedHighMinorUnits).toBe(0);
    expect(scenario.unquantified).toHaveLength(1);
    expect(scenario.unquantified[0]?.reason).toMatch(/Not yet quantified/);
  });
});
