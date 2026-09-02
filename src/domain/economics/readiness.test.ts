import { describe, expect, it } from "vitest";

import {
  EVIDENCE_READINESS_MODEL_VERSION,
  classifyEvidenceReadiness,
  type ReadinessCostComponent,
  type ReadinessCostCoverage,
  type ReadinessObservation,
} from "@/domain/economics/readiness";

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANNEL = "11111111-1111-4111-8111-1111111111ff";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const OTHER_BRANCH = "22222222-2222-4222-8222-2222222222ff";
const REVENUE_METRIC = "33333333-3333-4333-8333-333333333333";
const COUNT_METRIC = "44444444-4444-4444-8444-444444444444";

function observation(overrides: Partial<ReadinessObservation> = {}): ReadinessObservation {
  return {
    observationId: "obs-1",
    channelId: CHANNEL,
    branchId: BRANCH,
    metricDefinitionId: REVENUE_METRIC,
    economicsRole: "gross_revenue",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    periodTimezone: "Asia/Dubai",
    currency: "AED",
    qualityState: "complete",
    completenessState: "complete",
    reconciliationState: "current",
    reportPackageId: "pkg-1",
    packageState: "usable",
    ...overrides,
  };
}

/** A revenue and an order count for the same exact period, both current. */
function completePeriod(overrides: Partial<ReadinessObservation> = {}): ReadinessObservation[] {
  return [
    observation({ observationId: "obs-revenue", ...overrides }),
    observation({
      observationId: "obs-count",
      metricDefinitionId: COUNT_METRIC,
      economicsRole: "transaction_count",
      currency: null,
      ...overrides,
    }),
  ];
}

function component(overrides: Partial<ReadinessCostComponent> = {}): ReadinessCostComponent {
  return {
    key: "commission",
    label: "Commission",
    covered: true,
    tier: "measured",
    operatorCanResolve: true,
    ...overrides,
  };
}

const fullCoverage: ReadinessCostCoverage = {
  outcome: "checked",
  components: [
    component(),
    component({ key: "delivery_cost", label: "Delivery cost" }),
    component({ key: "food_cost", label: "Food cost" }),
  ],
};

function classify(
  observations: readonly ReadinessObservation[],
  costCoverage: ReadinessCostCoverage = fullCoverage,
) {
  return classifyEvidenceReadiness({ observations, costCoverage });
}

describe("evidence readiness", () => {
  it("reports current complete evidence with every cost priced as ready", () => {
    const model = classify(completePeriod());

    expect(model.readModelVersion).toBe(EVIDENCE_READINESS_MODEL_VERSION);
    expect(model.tuples).toHaveLength(1);
    expect(model.tuples[0]?.state).toBe("ready_for_economics");
    expect(model.tuples[0]?.reasons).toEqual([]);
    expect(model.tuples[0]?.rolesPresent).toEqual(["gross_revenue", "transaction_count"]);
  });

  it("retains the exact period, timezone, and currency as recorded", () => {
    const tuple = classify(completePeriod()).tuples[0];

    expect(tuple).toMatchObject({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      periodTimezone: "Asia/Dubai",
      currency: "AED",
    });
  });

  describe("partial evidence", () => {
    it("stays visibly partial when the supplying report carried warnings", () => {
      const model = classify([
        observation({ observationId: "obs-revenue", qualityState: "partial" }),
        observation({
          observationId: "obs-count",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
        }),
      ]);

      expect(model.tuples[0]?.state).toBe("partial_evidence");
      expect(model.tuples[0]?.reasons).toContain("evidence_quality_partial");
    });

    it("stays visibly partial when only part of the report was read", () => {
      const model = classify([
        observation({ observationId: "obs-revenue", completenessState: "partial" }),
        observation({
          observationId: "obs-count",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
        }),
      ]);

      expect(model.tuples[0]?.state).toBe("partial_evidence");
      expect(model.tuples[0]?.reasons).toContain("evidence_completeness_partial");
    });

    it("is partial when some costs are priced and some are not", () => {
      const model = classify(completePeriod(), {
        outcome: "checked",
        components: [component(), component({ key: "food_cost", covered: false, tier: null })],
      });

      expect(model.tuples[0]?.state).toBe("partial_evidence");
      expect(model.tuples[0]?.reasons).toContain("cost_coverage_incomplete");
    });

    it("never hides a warning behind the headline state", () => {
      // Two independent problems at once. The worse one decides the state, but
      // a warning that stopped being visible would defeat the point of grading.
      const model = classify(
        [
          observation({ observationId: "obs-revenue", qualityState: "partial" }),
          observation({
            observationId: "obs-count",
            metricDefinitionId: COUNT_METRIC,
            economicsRole: "transaction_count",
            currency: null,
          }),
        ],
        { outcome: "checked", components: [component({ covered: false, tier: null })] },
      );

      expect(model.tuples[0]?.state).toBe("needs_data");
      expect(model.tuples[0]?.reasons).toContain("evidence_quality_partial");
    });
  });

  describe("evidence that may not be used", () => {
    it("cannot become ready while an overlap is held for reconciliation", () => {
      const model = classify([
        ...completePeriod(),
        observation({ observationId: "obs-held", reconciliationState: "blocked_overlap" }),
      ]);

      expect(model.tuples[0]?.state).toBe("blocked");
      expect(model.tuples[0]?.reasons).toContain("overlap_awaiting_reconciliation");
    });

    it("cannot become ready when the source package awaits reconciliation", () => {
      const model = classify(
        completePeriod({ packageState: "reconciliation_required" }),
      );

      expect(model.tuples[0]?.state).toBe("blocked");
    });

    it("cannot become ready when the source package failed", () => {
      const model = classify(completePeriod({ packageState: "failed" }));

      expect(model.tuples[0]?.state).toBe("blocked");
      expect(model.tuples[0]?.reasons).toContain("source_package_failed");
    });

    it("reports a superseded observation with no replacement as blocked", () => {
      const model = classify([
        observation({ observationId: "obs-old", reconciliationState: "superseded" }),
      ]);

      expect(model.tuples[0]?.state).toBe("blocked");
      expect(model.tuples[0]?.reasons).toContain("evidence_superseded_without_replacement");
      expect(model.tuples[0]?.observationIds).toEqual([]);
    });

    it("reports an excluded observation as blocked rather than absent", () => {
      const model = classify([
        observation({ observationId: "obs-set-aside", reconciliationState: "excluded" }),
      ]);

      expect(model.tuples[0]?.state).toBe("blocked");
      expect(model.tuples[0]?.reasons).toContain("evidence_excluded");
    });

    it("does not count a superseded observation as supplying a role", () => {
      // The replacement covers a different range, so this period keeps only the
      // retired row. Reading it as revenue would resurrect withdrawn evidence.
      const model = classify([
        observation({ observationId: "obs-old", reconciliationState: "superseded" }),
        observation({
          observationId: "obs-count",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
          reconciliationState: "superseded",
        }),
      ]);

      expect(model.tuples[0]?.rolesPresent).toEqual([]);
    });
  });

  describe("missing required roles", () => {
    it("needs data when no sales total has arrived", () => {
      const model = classify([
        observation({
          observationId: "obs-count",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
        }),
      ]);

      expect(model.tuples[0]?.state).toBe("needs_data");
      expect(model.tuples[0]?.reasons).toContain("revenue_role_absent");
    });

    it("needs data when no order count has arrived", () => {
      const model = classify([observation()]);

      expect(model.tuples[0]?.state).toBe("needs_data");
      expect(model.tuples[0]?.reasons).toContain("transaction_count_role_absent");
    });

    it("ignores a metric bound to no economics input", () => {
      const model = classify([...completePeriod(), observation({
        observationId: "obs-ratings",
        metricDefinitionId: "55555555-5555-4555-8555-555555555555",
        economicsRole: null,
        currency: null,
      })]);

      expect(model.tuples[0]?.state).toBe("ready_for_economics");
      expect(model.tuples[0]?.rolesPresent).toEqual(["gross_revenue", "transaction_count"]);
    });
  });

  describe("inputs that cannot be combined", () => {
    it("refuses two currencies in one period rather than converting", () => {
      const model = classify([
        ...completePeriod(),
        observation({ observationId: "obs-second-currency", currency: "USD" }),
      ]);

      expect(model.tuples[0]?.state).toBe("not_comparable");
      expect(model.tuples[0]?.reasons).toContain("currency_conflict_within_period");
    });

    it("refuses one role claimed by two different measures", () => {
      const model = classify([
        ...completePeriod(),
        observation({
          observationId: "obs-rival-revenue",
          metricDefinitionId: "66666666-6666-4666-8666-666666666666",
        }),
      ]);

      expect(model.tuples[0]?.state).toBe("not_comparable");
      expect(model.tuples[0]?.reasons).toContain("role_bound_to_conflicting_metrics");
    });

    it("separates an input that exists under overlapping but different dates", () => {
      const model = classify([
        observation(),
        observation({
          observationId: "obs-count-elsewhere",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
          periodStart: "2026-08-15",
          periodEnd: "2026-09-14",
        }),
      ]);

      const august = model.tuples.find((tuple) => tuple.periodEnd === "2026-08-31");
      expect(august?.state).toBe("not_comparable");
      expect(august?.reasons).toContain("role_supplied_by_different_period");
    });

    it("separates an input recorded against a different timezone", () => {
      const model = classify([
        observation(),
        observation({
          observationId: "obs-count-elsewhere",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
          periodTimezone: "Asia/Kolkata",
        }),
      ]);

      const dubai = model.tuples.find((tuple) => tuple.periodTimezone === "Asia/Dubai");
      expect(dubai?.state).toBe("not_comparable");
      expect(dubai?.reasons).toContain("role_supplied_by_different_timezone");
    });

    it("separates an input recorded against a different outlet", () => {
      const model = classify([
        observation(),
        observation({
          observationId: "obs-count-elsewhere",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
          branchId: OTHER_BRANCH,
        }),
      ]);

      const tuple = model.tuples.find((candidate) => candidate.branchId === BRANCH);
      expect(tuple?.state).toBe("not_comparable");
      expect(tuple?.reasons).toContain("role_supplied_by_different_branch_or_channel");
    });

    it("separates an input recorded against a different channel", () => {
      const model = classify([
        observation(),
        observation({
          observationId: "obs-count-elsewhere",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
          channelId: OTHER_CHANNEL,
        }),
      ]);

      const tuple = model.tuples.find((candidate) => candidate.channelId === CHANNEL);
      expect(tuple?.state).toBe("not_comparable");
      expect(tuple?.reasons).toContain("role_supplied_by_different_branch_or_channel");
    });

    it("still names the plain gap when a sibling channel holds the same input", () => {
      // A genuinely multi-channel organization where each channel has its own
      // gaps trips the same rule as a misfiled report, because nothing in the
      // evidence distinguishes the two. The headline takes the more specific
      // finding, and the missing-input line stays on the row beside it so the
      // upload step is never hidden behind a check that turns out to be fine.
      const model = classify([
        observation(),
        observation({
          observationId: "obs-count-other-channel",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
          channelId: OTHER_CHANNEL,
        }),
      ]);

      const tuple = model.tuples.find((candidate) => candidate.channelId === CHANNEL);
      expect(tuple?.state).toBe("not_comparable");
      expect(tuple?.reasons).toContain("transaction_count_role_absent");
      expect(tuple?.reasons).toContain("role_supplied_by_different_branch_or_channel");
    });

    it("reports plain missing data when nothing supplies the role anywhere", () => {
      // The distinction that matters: "you have not uploaded it" sends the user
      // to upload, "it is filed under the wrong outlet" sends them to correct.
      const model = classify([observation()]);

      expect(model.tuples[0]?.reasons).toContain("transaction_count_role_absent");
      expect(model.tuples[0]?.reasons).not.toContain(
        "role_supplied_by_different_branch_or_channel",
      );
    });
  });

  describe("cost coverage", () => {
    it("treats an unavailable coverage read as unchecked, never as all clear", () => {
      const model = classify(completePeriod(), { outcome: "unchecked" });

      expect(model.tuples[0]?.state).toBe("needs_data");
      expect(model.tuples[0]?.reasons).toContain("cost_coverage_unchecked");
    });

    it("treats an empty catalog as nothing checked rather than nothing owed", () => {
      const model = classify(completePeriod(), { outcome: "checked", components: [] });

      expect(model.tuples[0]?.state).toBe("needs_data");
      expect(model.tuples[0]?.reasons).toContain("cost_coverage_absent");
    });

    it("needs data when no cost at all has been priced", () => {
      const model = classify(completePeriod(), {
        outcome: "checked",
        components: [component({ covered: false, tier: null })],
      });

      expect(model.tuples[0]?.state).toBe("needs_data");
      expect(model.tuples[0]?.reasons).toContain("cost_coverage_absent");
    });

    it("carries availability and tier through without an amount anywhere", () => {
      const model = classify(completePeriod());

      expect(JSON.stringify(model)).not.toMatch(/amount|minor|rate_of_revenue|percent/i);
      expect(model.costCoverage).toEqual(fullCoverage);
    });
  });

  describe("determinism", () => {
    it("orders tuples the same way whatever order the evidence arrives in", () => {
      const rows = [
        ...completePeriod(),
        ...completePeriod({ periodStart: "2026-07-01", periodEnd: "2026-07-31" }).map(
          (row, index) => ({ ...row, observationId: `july-${index}` }),
        ),
        ...completePeriod({ channelId: OTHER_CHANNEL }).map((row, index) => ({
          ...row,
          observationId: `other-${index}`,
        })),
      ];

      const forwards = classify(rows);
      const backwards = classify([...rows].reverse());

      expect(backwards.tuples.map((tuple) => `${tuple.channelId}:${tuple.periodStart}`)).toEqual(
        forwards.tuples.map((tuple) => `${tuple.channelId}:${tuple.periodStart}`),
      );
      expect(backwards.digest).toBe(forwards.digest);
    });

    it("changes the digest when a verdict changes", () => {
      const ready = classify(completePeriod());
      const partial = classify([
        observation({ observationId: "obs-revenue", qualityState: "partial" }),
        observation({
          observationId: "obs-count",
          metricDefinitionId: COUNT_METRIC,
          economicsRole: "transaction_count",
          currency: null,
        }),
      ]);

      expect(partial.digest).not.toBe(ready.digest);
    });

    it("returns an empty, stable model when there is no evidence at all", () => {
      const model = classify([]);

      expect(model.tuples).toEqual([]);
      expect(model.digest).toBe(classify([]).digest);
    });
  });
});
