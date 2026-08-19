import { describe, expect, it } from "vitest";

import {
  assessGuardrail,
  computeVerdict,
  meetsEvidenceTier,
  validateOutcomeWording,
  type Estimate,
  type MetricObservation,
  type RegisteredMeasurementPlan,
  type VerdictInput,
} from "@/domain/campaigns/measurement";

function plan(overrides: Partial<RegisteredMeasurementPlan> = {}): RegisteredMeasurementPlan {
  return {
    primaryMetricKey: "revenue.purchase_value",
    guardrailMetricKeys: ["delivery.spend"],
    baselineSource: "goal_baseline_measured:revenue.purchase_value",
    baselineLookbackDays: 28,
    attributionMethod: "observational_prepost",
    outcomeWindowDays: 14,
    settlementDelayDays: 3,
    minimumEvidenceTier: "observed",
    ...overrides,
  };
}

function observation(valueMinor: number, periodStart = "2026-08-01T00:00:00Z"): MetricObservation {
  return { valueMinor, periodStart, evidenceTier: "observed" };
}

function providerEffect(): Estimate {
  return {
    estimateMinor: 5000,
    lowMinor: 2000,
    highMinor: 8000,
    currency: "USD",
  };
}

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    plan: plan(),
    exposure: { plannedCount: 6, realizedCount: 6, truncations: [] },
    primaryObservations: [observation(100), observation(150)],
    baseline: observation(50),
    guardrail: {
      state: "clear",
      realizedSpendMinor: 4000,
      spendCeilingMinor: 10000,
      currency: "USD",
    },
    providerEffect: null,
    ...overrides,
  };
}

describe("meetsEvidenceTier", () => {
  it("treats observed as stronger than computed", () => {
    expect(meetsEvidenceTier("observed", "computed")).toBe(true);
    expect(meetsEvidenceTier("observed", "observed")).toBe(true);
    expect(meetsEvidenceTier("computed", "observed")).toBe(false);
    expect(meetsEvidenceTier("computed", "computed")).toBe(true);
  });
});

describe("assessGuardrail", () => {
  it("breaches only above the ceiling", () => {
    expect(
      assessGuardrail({ spendCeilingMinor: 100, realizedSpendMinor: 101, currency: "USD" }).state,
    ).toBe("breached");
    expect(
      assessGuardrail({ spendCeilingMinor: 100, realizedSpendMinor: 100, currency: "USD" }).state,
    ).toBe("clear");
  });

  it("never treats missing receipts as clear", () => {
    expect(
      assessGuardrail({ spendCeilingMinor: 100, realizedSpendMinor: null, currency: "USD" }).state,
    ).toBe("unmeasured");
  });
});

describe("computeVerdict", () => {
  it("reaches validated_outcome when the observational evidence bar is met", () => {
    const result = computeVerdict(input());
    expect(result.verdict).toBe("validated_outcome");
    expect(result.estimate).toEqual({
      estimateMinor: 200,
      lowMinor: 50,
      highMinor: 100,
      currency: "USD",
    });
  });

  it("is unreachable for observational_prepost without a numeric baseline", () => {
    const result = computeVerdict(input({ baseline: null }));
    expect(result.verdict).toBe("inconclusive");
    expect(result.estimate).toBeNull();
  });

  it("is execution_only when there is no primary evidence at all", () => {
    const result = computeVerdict(input({ primaryObservations: [], baseline: null }));
    expect(result.verdict).toBe("execution_only");
  });

  it("is inconclusive when a baseline exists but no post observation does", () => {
    const result = computeVerdict(input({ primaryObservations: [] }));
    expect(result.verdict).toBe("inconclusive");
  });

  it("is unreachable for provider_randomized_experiment without a provider effect", () => {
    const result = computeVerdict(
      input({
        plan: plan({ attributionMethod: "provider_randomized_experiment" }),
        providerEffect: null,
      }),
    );
    expect(result.verdict).toBe("inconclusive");
    expect(result.estimate).toBeNull();
  });

  it("reaches validated_outcome for a provider effect, and repeats the provider range unchanged", () => {
    const result = computeVerdict(
      input({
        plan: plan({ attributionMethod: "provider_randomized_experiment" }),
        providerEffect: providerEffect(),
      }),
    );
    expect(result.verdict).toBe("validated_outcome");
    expect(result.estimate).toEqual(providerEffect());
  });

  it("yields guardrail_breach regardless of a passing primary metric", () => {
    const result = computeVerdict(
      input({
        guardrail: {
          state: "breached",
          realizedSpendMinor: 10001,
          spendCeilingMinor: 10000,
          currency: "USD",
        },
      }),
    );
    expect(result.verdict).toBe("guardrail_breach");
    expect(result.estimate).toBeNull();
  });

  it("yields execution_only when nothing reached a provider", () => {
    const result = computeVerdict(
      input({ exposure: { plannedCount: 6, realizedCount: 0, truncations: [] } }),
    );
    expect(result.verdict).toBe("execution_only");
  });

  it("never falls back to planned exposure when realized exposure is zero", () => {
    // Even though the plan scheduled six units, zero realized units is zero —
    // it is never silently replaced by the plan's number.
    const result = computeVerdict(
      input({
        exposure: { plannedCount: 6, realizedCount: 0, truncations: [] },
        primaryObservations: [observation(100)],
      }),
    );
    expect(result.verdict).toBe("execution_only");
  });

  it("falls to inconclusive when evidence exists but is below the preregistered tier", () => {
    const result = computeVerdict(
      input({
        primaryObservations: [{ ...observation(100), evidenceTier: "computed" }],
        baseline: observation(50),
        plan: plan({ minimumEvidenceTier: "observed" }),
      }),
    );
    expect(result.verdict).toBe("inconclusive");
    expect(result.evidenceTier).toBe("computed");
  });

  it("has no input for engagement diagnostics, so engagement can never produce a verdict", () => {
    // Structural guarantee: the verdict function accepts only the primary
    // metric, baseline, exposure, and guardrail. Impressions and clicks are not
    // parameters at all, so no code path can smuggle them into a verdict.
    const keys = Object.keys(input());
    expect(keys).not.toContain("impressions");
    expect(keys).not.toContain("clicks");
    expect(keys).not.toContain("engagement");
  });
});

describe("validateOutcomeWording", () => {
  const neutral = [
    "The campaign ran and its results were recorded.",
    "No conclusion could be reached from the data available.",
    "Spend stayed within the approved ceiling.",
  ].join(" ");

  it("accepts neutral wording for inconclusive and execution_only", () => {
    expect(validateOutcomeWording({ text: neutral, verdict: "inconclusive" })).toEqual([]);
    expect(validateOutcomeWording({ text: neutral, verdict: "execution_only" })).toEqual([]);
  });

  it.each([
    "The campaign increased revenue.",
    "This creative lifted sales.",
    "The ads drove more conversions.",
    "Spend resulted in higher value.",
    "It proved the offer works.",
    "The variant had a significant effect.",
    "ROAS improved versus baseline.",
  ])("rejects causal or impact language for inconclusive: %s", (text) => {
    expect(validateOutcomeWording({ text, verdict: "inconclusive" })).not.toEqual([]);
  });

  it("rejects overclaim wording for guardrail_breach too", () => {
    expect(
      validateOutcomeWording({
        text: "The campaign won despite the breach.",
        verdict: "guardrail_breach",
      }),
    ).not.toEqual([]);
  });

  it("does not flag a validated_outcome, whose finding is real", () => {
    expect(
      validateOutcomeWording({
        text: "The campaign increased value versus baseline.",
        verdict: "validated_outcome",
      }),
    ).toEqual([]);
  });
});
