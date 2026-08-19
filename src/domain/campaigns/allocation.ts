/**
 * The deterministic allocation rules.
 *
 * This is the whole decision engine for the fast loop, and it is deliberately
 * small. It reads one variant's own diagnostics and, where the Channel
 * Economics Ledger supplies a graded margin, that channel's contribution
 * margin. It returns a decision per rule it evaluated. There is no model, no
 * randomness, no clock, and no second campaign anywhere in this file — a pause
 * is arithmetic over recorded numbers, and the same numbers always produce the
 * same decision.
 *
 * Two rule families exist, exactly as ADR 0021 requires:
 *
 *  - Diagnostic thresholds. A spend ceiling and a click-through floor, read
 *    from the variant's own observations. These are diagnostics under ADR 0019
 *    — none of them is a claim about incremental profit.
 *
 *  - A contribution-margin floor. Resolved through the Channel Economics
 *    Ledger, and only when the completeness grade is sufficient. An
 *    `indicative` margin is a bound, not a figure, so it can never be compared
 *    against a floor; the rule records that it did not fire rather than
 *    pretending a number nobody has.
 *
 * The minimum-exposure floor gates only the noise-prone ratio (click-through).
 * A spend ceiling is a money guardrail — money leaving is money leaving, however
 * few impressions happened to be recorded — and the margin floor is a fact about
 * the channel's economics rather than this variant's thin early traffic. A CTR
 * computed over three impressions, though, is not evidence of anything, so a
 * stop is refused until the variant has actually been seen.
 */

/** The quality tier of the margin the floor rule actually compared. */
export type ResolvedMarginGrade = "measured" | "derived" | "estimated" | "assumed";

export const ALLOCATION_RULE_KEYS = {
  spendCeiling: "diagnostic.spend_ceiling",
  ctrFloor: "diagnostic.ctr_floor",
  marginFloor: "margin.contribution_floor",
} as const;

export const ALLOCATION_RULE_VERSIONS = {
  spendCeiling: "v1",
  ctrFloor: "v1",
  marginFloor: "v1",
} as const;

export type AllocationAction = "pause" | "no_action";

/**
 * One decision, matching the Stable Interface in the feedback-loop plan.
 *
 * `resolvedMarginGrade` is set only on a margin rule, and carries the quality
 * tier of the margin that was compared. Every other rule leaves it null, so a
 * reader can tell "the margin was measured" from "there was no margin rule".
 */
export type AllocationDecision = {
  variantId: string;
  ruleKey: string;
  ruleVersion: string;
  observedValue: number | null;
  threshold: number | null;
  resolvedMarginGrade: ResolvedMarginGrade | null;
  action: AllocationAction;
  reasonCode: string;
};

/** A variant's own observations, whatever the provider has actually returned. */
export type VariantDiagnostics = {
  /** May be null when nothing has been collected yet. Absence is not zero. */
  impressions: number | null;
  clicks: number | null;
  /** Minor units. */
  spendMinor: number | null;
};

/**
 * A margin the ledger graded as a scalar. The service resolves this through the
 * Channel Economics Ledger and passes null when the grade is insufficient
 * (`indicative`), so the floor rule cannot compare a bound against a floor.
 */
export type ResolvedMargin = {
  contributionMarginMinor: number;
  qualityTier: ResolvedMarginGrade;
  currency: string;
};

export type AllocationRuleThresholds = {
  /** Pause above this, in minor units. */
  spendCeilingMinor: number;
  /** Pause below this click-through rate, a share in 0..1. */
  ctrFloor: number;
  /** Pause below this contribution margin, in minor units. */
  marginFloorMinor: number;
  /** Impressions below which the click-through rule refuses to act. */
  minimumImpressions: number;
};

export type AllocationEvaluationInput = {
  variantId: string;
  diagnostics: VariantDiagnostics;
  /** Null exactly when the Channel Economics Ledger grade is insufficient. */
  margin: ResolvedMargin | null;
};

const REASONS = {
  spendCeilingExceeded: "spend_ceiling_exceeded",
  ctrBelowFloor: "ctr_below_floor",
  marginBelowFloor: "margin_below_floor",
  noThresholdBreached: "no_threshold_breached",
  belowMinimumExposure: "below_minimum_exposure",
  marginGradeInsufficient: "margin_grade_insufficient",
  valueUnavailable: "value_unavailable",
} as const;

/**
 * The three decisions for one variant, in a fixed order.
 *
 * The order is part of the contract: a reader can rely on spend-ceiling first,
 * then click-through, then margin. It never changes, because a ledger that
 * reorders itself later is a ledger nobody can diff.
 */
export function evaluateVariant(
  input: AllocationEvaluationInput,
  thresholds: AllocationRuleThresholds,
): readonly AllocationDecision[] {
  return [
    evaluateSpendCeiling(input, thresholds),
    evaluateCtrFloor(input, thresholds),
    evaluateMarginFloor(input, thresholds),
  ];
}

function decision(
  variantId: string,
  ruleKey: string,
  ruleVersion: string,
  action: AllocationAction,
  reasonCode: string,
  observedValue: number | null,
  threshold: number | null,
  resolvedMarginGrade: ResolvedMarginGrade | null,
): AllocationDecision {
  return {
    variantId,
    ruleKey,
    ruleVersion,
    observedValue,
    threshold,
    resolvedMarginGrade,
    action,
    reasonCode,
  };
}

function evaluateSpendCeiling(
  input: AllocationEvaluationInput,
  thresholds: AllocationRuleThresholds,
): AllocationDecision {
  const spend = input.diagnostics.spendMinor;
  if (spend === null) {
    return decision(
      input.variantId,
      ALLOCATION_RULE_KEYS.spendCeiling,
      ALLOCATION_RULE_VERSIONS.spendCeiling,
      "no_action",
      REASONS.valueUnavailable,
      null,
      null,
      null,
    );
  }
  if (spend > thresholds.spendCeilingMinor) {
    return decision(
      input.variantId,
      ALLOCATION_RULE_KEYS.spendCeiling,
      ALLOCATION_RULE_VERSIONS.spendCeiling,
      "pause",
      REASONS.spendCeilingExceeded,
      spend,
      thresholds.spendCeilingMinor,
      null,
    );
  }
  return decision(
    input.variantId,
    ALLOCATION_RULE_KEYS.spendCeiling,
    ALLOCATION_RULE_VERSIONS.spendCeiling,
    "no_action",
    REASONS.noThresholdBreached,
    spend,
    thresholds.spendCeilingMinor,
    null,
  );
}

function evaluateCtrFloor(
  input: AllocationEvaluationInput,
  thresholds: AllocationRuleThresholds,
): AllocationDecision {
  const { impressions, clicks } = input.diagnostics;

  if (impressions === null || impressions < thresholds.minimumImpressions) {
    // Too thin to mean anything. Acting here is how the platform stops a
    // variant on noise, which is exactly the failure ADR 0021 exists to avoid.
    return decision(
      input.variantId,
      ALLOCATION_RULE_KEYS.ctrFloor,
      ALLOCATION_RULE_VERSIONS.ctrFloor,
      "no_action",
      REASONS.belowMinimumExposure,
      null,
      null,
      null,
    );
  }

  if (clicks === null || impressions === 0) {
    return decision(
      input.variantId,
      ALLOCATION_RULE_KEYS.ctrFloor,
      ALLOCATION_RULE_VERSIONS.ctrFloor,
      "no_action",
      REASONS.valueUnavailable,
      null,
      null,
      null,
    );
  }

  const ctr = clicks / impressions;
  if (ctr < thresholds.ctrFloor) {
    return decision(
      input.variantId,
      ALLOCATION_RULE_KEYS.ctrFloor,
      ALLOCATION_RULE_VERSIONS.ctrFloor,
      "pause",
      REASONS.ctrBelowFloor,
      ctr,
      thresholds.ctrFloor,
      null,
    );
  }
  return decision(
    input.variantId,
    ALLOCATION_RULE_KEYS.ctrFloor,
    ALLOCATION_RULE_VERSIONS.ctrFloor,
    "no_action",
    REASONS.noThresholdBreached,
    ctr,
    thresholds.ctrFloor,
    null,
  );
}

function evaluateMarginFloor(
  input: AllocationEvaluationInput,
  thresholds: AllocationRuleThresholds,
): AllocationDecision {
  if (input.margin === null) {
    // An indicative margin is a ceiling, not a figure. Comparing it against a
    // floor would claim a precision the ledger does not have.
    return decision(
      input.variantId,
      ALLOCATION_RULE_KEYS.marginFloor,
      ALLOCATION_RULE_VERSIONS.marginFloor,
      "no_action",
      REASONS.marginGradeInsufficient,
      null,
      null,
      null,
    );
  }

  const { contributionMarginMinor, qualityTier } = input.margin;
  if (contributionMarginMinor < thresholds.marginFloorMinor) {
    return decision(
      input.variantId,
      ALLOCATION_RULE_KEYS.marginFloor,
      ALLOCATION_RULE_VERSIONS.marginFloor,
      "pause",
      REASONS.marginBelowFloor,
      contributionMarginMinor,
      thresholds.marginFloorMinor,
      qualityTier,
    );
  }
  return decision(
    input.variantId,
    ALLOCATION_RULE_KEYS.marginFloor,
    ALLOCATION_RULE_VERSIONS.marginFloor,
    "no_action",
    REASONS.noThresholdBreached,
    contributionMarginMinor,
    thresholds.marginFloorMinor,
    qualityTier,
  );
}
