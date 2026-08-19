import { describe, expect, it } from "vitest";

import {
  ALLOCATION_RULE_KEYS,
  evaluateVariant,
  type AllocationDecision,
  type AllocationEvaluationInput,
  type AllocationRuleThresholds,
  type ResolvedMargin,
} from "@/domain/campaigns/allocation";

const thresholds: AllocationRuleThresholds = {
  spendCeilingMinor: 10_000,
  ctrFloor: 0.02,
  marginFloorMinor: 5_000,
  minimumImpressions: 100,
};

function input(
  overrides: {
    variantId?: string;
    impressions?: number | null;
    clicks?: number | null;
    spendMinor?: number | null;
    margin?: ResolvedMargin | null;
  } = {},
): AllocationEvaluationInput {
  return {
    variantId: overrides.variantId ?? "v1",
    diagnostics: {
      // `??` would treat an explicit null as "use the default", which is exactly
      // the absent-versus-zero conflation this domain exists to avoid.
      impressions: overrides.impressions === undefined ? 500 : overrides.impressions,
      clicks: overrides.clicks === undefined ? 20 : overrides.clicks,
      spendMinor: overrides.spendMinor === undefined ? 5_000 : overrides.spendMinor,
    },
    margin:
      overrides.margin === undefined
        ? { contributionMarginMinor: 8_000, qualityTier: "measured", currency: "AED" }
        : overrides.margin,
  };
}

function byRule(decisions: readonly AllocationDecision[]): Map<string, AllocationDecision> {
  return new Map(decisions.map((entry) => [entry.ruleKey, entry]));
}

describe("evaluateVariant", () => {
  it("pauses on spend above the ceiling, and holds at exactly the ceiling", () => {
    const over = byRule(evaluateVariant(input({ spendMinor: 10_001 }), thresholds)).get(
      ALLOCATION_RULE_KEYS.spendCeiling,
    );
    expect(over).toMatchObject({ action: "pause", reasonCode: "spend_ceiling_exceeded" });
    expect(over?.observedValue).toBe(10_001);
    expect(over?.threshold).toBe(10_000);

    const atBoundary = byRule(evaluateVariant(input({ spendMinor: 10_000 }), thresholds)).get(
      ALLOCATION_RULE_KEYS.spendCeiling,
    );
    expect(atBoundary).toMatchObject({ action: "no_action", reasonCode: "no_threshold_breached" });
  });

  it("pauses on CTR below the floor, and holds at exactly the floor", () => {
    // 9 clicks / 500 impressions = 0.018, below 0.02.
    const below = byRule(evaluateVariant(input({ clicks: 9, impressions: 500 }), thresholds)).get(
      ALLOCATION_RULE_KEYS.ctrFloor,
    );
    expect(below).toMatchObject({ action: "pause", reasonCode: "ctr_below_floor" });
    expect(below?.observedValue).toBeCloseTo(0.018, 10);
    expect(below?.threshold).toBe(0.02);

    // 10 / 500 = exactly 0.02.
    const atBoundary = byRule(
      evaluateVariant(input({ clicks: 10, impressions: 500 }), thresholds),
    ).get(ALLOCATION_RULE_KEYS.ctrFloor);
    expect(atBoundary).toMatchObject({ action: "no_action", reasonCode: "no_threshold_breached" });
  });

  it("pauses on margin below the floor, and holds at exactly the floor", () => {
    const below = byRule(
      evaluateVariant(
        input({
          margin: { contributionMarginMinor: 4_999, qualityTier: "measured", currency: "AED" },
        }),
        thresholds,
      ),
    ).get(ALLOCATION_RULE_KEYS.marginFloor);
    expect(below).toMatchObject({
      action: "pause",
      reasonCode: "margin_below_floor",
      resolvedMarginGrade: "measured",
    });
    expect(below?.observedValue).toBe(4_999);
    expect(below?.threshold).toBe(5_000);

    const atBoundary = byRule(
      evaluateVariant(
        input({
          margin: { contributionMarginMinor: 5_000, qualityTier: "measured", currency: "AED" },
        }),
        thresholds,
      ),
    ).get(ALLOCATION_RULE_KEYS.marginFloor);
    expect(atBoundary).toMatchObject({ action: "no_action", reasonCode: "no_threshold_breached" });
  });

  it("never stops on a thin CTR: the minimum-exposure floor gates the noise-prone rule", () => {
    // 0 clicks over 3 impressions is a terrible ratio, but 3 impressions is
    // noise. The floor must refuse a stop here.
    const thin = byRule(
      evaluateVariant(input({ impressions: 3, clicks: 0, spendMinor: 5_000 }), thresholds),
    ).get(ALLOCATION_RULE_KEYS.ctrFloor);
    expect(thin).toMatchObject({
      action: "no_action",
      reasonCode: "below_minimum_exposure",
      observedValue: null,
      threshold: null,
    });

    // At exactly the floor the rule is allowed to act, so a below-floor CTR stops.
    const atFloor = byRule(evaluateVariant(input({ impressions: 100, clicks: 0 }), thresholds)).get(
      ALLOCATION_RULE_KEYS.ctrFloor,
    );
    expect(atFloor?.action).toBe("pause");
  });

  it("does not let a spend ceiling hide behind the exposure floor", () => {
    // Money is leaving even with few impressions recorded. The spend ceiling
    // must fire regardless of the exposure floor.
    const over = byRule(
      evaluateVariant(input({ impressions: 3, spendMinor: 10_001 }), thresholds),
    ).get(ALLOCATION_RULE_KEYS.spendCeiling);
    expect(over).toMatchObject({ action: "pause", reasonCode: "spend_ceiling_exceeded" });
  });

  it("does not fire the margin rule when the Channel Economics Ledger grade is insufficient", () => {
    const decisions = byRule(evaluateVariant(input({ margin: null }), thresholds));
    const margin = decisions.get(ALLOCATION_RULE_KEYS.marginFloor);
    expect(margin).toMatchObject({
      action: "no_action",
      reasonCode: "margin_grade_insufficient",
      observedValue: null,
      threshold: null,
      resolvedMarginGrade: null,
    });

    // A null margin can never produce a pause from any rule family.
    expect([...decisions.values()].some((entry) => entry.action === "pause")).toBe(false);
  });

  it("records the resolved margin grade on the margin rule even when it holds", () => {
    const held = byRule(
      evaluateVariant(
        input({
          margin: { contributionMarginMinor: 9_000, qualityTier: "assumed", currency: "AED" },
        }),
        thresholds,
      ),
    ).get(ALLOCATION_RULE_KEYS.marginFloor);
    expect(held).toMatchObject({
      action: "no_action",
      reasonCode: "no_threshold_breached",
      resolvedMarginGrade: "assumed",
    });
  });

  it("reports unavailable values rather than inventing a zero", () => {
    const decisions = byRule(
      evaluateVariant(
        input({ impressions: 500, clicks: null, spendMinor: null, margin: null }),
        thresholds,
      ),
    );
    expect(decisions.get(ALLOCATION_RULE_KEYS.spendCeiling)).toMatchObject({
      action: "no_action",
      reasonCode: "value_unavailable",
    });
    expect(decisions.get(ALLOCATION_RULE_KEYS.ctrFloor)).toMatchObject({
      action: "no_action",
      reasonCode: "value_unavailable",
    });
  });

  it("is deterministic: identical inputs produce identical decisions", () => {
    const first = evaluateVariant(input(), thresholds);
    const second = evaluateVariant(input(), thresholds);
    expect(first).toEqual(second);
  });

  it("never compares variants against each other: only the given variant is named", () => {
    // The evaluator's whole input surface is one variant's diagnostics and one
    // channel margin. There is no second-variant argument to pass, so two
    // evaluations share no state and cannot influence one another.
    const decisions = evaluateVariant(input({ variantId: "a" }), thresholds);
    expect(decisions.every((entry) => entry.variantId === "a")).toBe(true);

    // A different variant's outcome depends only on its own numbers.
    const quiet = evaluateVariant(
      input({ variantId: "b", impressions: 3, clicks: 0, spendMinor: 100, margin: null }),
      thresholds,
    );
    expect(quiet.every((entry) => entry.variantId === "b")).toBe(true);
    expect(quiet.some((entry) => entry.action === "pause")).toBe(false);
  });

  it("emits a decision for every rule a variant is evaluated against, including no_action", () => {
    const decisions = evaluateVariant(input(), thresholds);
    expect(decisions.map((entry) => entry.ruleKey).sort()).toEqual(
      [
        ALLOCATION_RULE_KEYS.ctrFloor,
        ALLOCATION_RULE_KEYS.spendCeiling,
        ALLOCATION_RULE_KEYS.marginFloor,
      ].sort(),
    );
  });
});
