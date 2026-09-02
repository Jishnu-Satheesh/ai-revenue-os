/**
 * The slow evidence loop's deterministic core.
 *
 * This is the whole verdict engine, and it is deliberately a pure function of
 * recorded facts. It reads one campaign's preregistered plan, its reconstructed
 * exposure, its primary-metric observations, and its guardrail state, and
 * returns exactly one of four verdicts. There is no model, no clock, no
 * randomness, no second campaign, and no provider anywhere in this file — a
 * verdict is arithmetic over what actually happened, and the same inputs always
 * produce the same verdict.
 *
 * The four verdicts are ADR 0019's vocabulary:
 *
 *  - `validated_outcome` — the preregistered method's evidence bar was met under
 *    the preregistered attribution method. Unreachable on engagement alone.
 *  - `inconclusive` — the honest default. Some primary evidence exists but it
 *    did not clear the bar.
 *  - `guardrail_breach` — a registered guardrail was breached, regardless of the
 *    primary metric.
 *  - `execution_only` — the campaign ran, but there is no primary-metric evidence
 *    to evaluate at all.
 *
 * Two walls live here. The first is the verdict boundary: engagement
 * diagnostics — impressions and clicks — are never an input to this function,
 * so they can never produce a verdict. The second is the wording boundary: a
 * summary drafted about a computed result must pass
 * `validateOutcomeWording`, and `inconclusive` is never allowed to read as
 * causal. Neither is enforced by convention; both are enforced by code and by
 * tests.
 */

export type CampaignVerdict =
  | "validated_outcome"
  | "inconclusive"
  | "guardrail_breach"
  | "execution_only";

/** Coarse evidence tier, matching the measurement plan's `minimumEvidenceTier`. */
export type EvidenceTier = "computed" | "observed";

export type AttributionMethod = "observational_prepost" | "provider_randomized_experiment";

/** Why a variant's exposure stopped short of the plan. */
export type TruncationCauseKind = "agent_pause" | "operator_pause" | "guardrail";

export type TruncationCause = {
  variantId: string;
  cause: TruncationCauseKind;
  /** The rule that fired, when the cause was a deterministic rule. */
  ruleKey: string | null;
  /** UTC instant the truncation was recorded. */
  at: string;
};

/**
 * Planned and realized exposure, kept as two numbers that are never summed into
 * one. `plannedCount` is what the approved plan scheduled; `realizedCount` is
 * what actually reached a provider. The difference is explained by the
 * truncations, not by arithmetic that hides it.
 */
export type ExposureReconstruction = {
  plannedCount: number;
  realizedCount: number;
  truncations: readonly TruncationCause[];
};

/** The preregistered plan, copied from the plan that was on file at first exposure. */
export type RegisteredMeasurementPlan = {
  primaryMetricKey: string;
  guardrailMetricKeys: readonly string[];
  baselineSource: string;
  baselineLookbackDays: number;
  attributionMethod: AttributionMethod;
  outcomeWindowDays: number;
  settlementDelayDays: number;
  minimumEvidenceTier: EvidenceTier;
};

/** One observation of the primary metric, in its own integer units. */
export type MetricObservation = {
  /** Minor units for money; whole units for counts. */
  valueMinor: number;
  /** Start of the period the value covers. */
  periodStart: string;
  evidenceTier: EvidenceTier;
};

export type GuardrailState = "breached" | "clear" | "unmeasured";

export type GuardrailAssessment = {
  state: GuardrailState;
  /** Sum of realized spend reconstructed from receipts. Null when unmeasured. */
  realizedSpendMinor: number | null;
  /** Null when the campaign has no money guardrail (organic). */
  spendCeilingMinor: number | null;
  currency: string | null;
};

export type Estimate = {
  estimateMinor: number;
  lowMinor: number;
  highMinor: number;
  /** Null only when a money estimate's currency could not be resolved. */
  currency: string | null;
};

export type VerdictInput = {
  plan: RegisteredMeasurementPlan;
  exposure: ExposureReconstruction;
  primaryObservations: readonly MetricObservation[];
  baseline: MetricObservation | null;
  guardrail: GuardrailAssessment;
  /**
   * A provider-supplied treatment effect. Present only when the preregistered
   * randomized experiment is eligible and the provider actually returned one.
   */
  providerEffect: Estimate | null;
};

export type Outcome = {
  verdict: CampaignVerdict;
  /** The tier the verdict was actually computed at; null when no evidence was used. */
  evidenceTier: EvidenceTier | null;
  estimate: Estimate | null;
  limitations: readonly string[];
};

/** `observed` is stronger than `computed`, so it satisfies a lower minimum too. */
const TIER_RANK: Readonly<Record<EvidenceTier, number>> = { computed: 1, observed: 2 };

/** Whether an observation's tier clears a preregistered minimum. */
export function meetsEvidenceTier(actual: EvidenceTier, minimum: EvidenceTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[minimum];
}

/**
 * The money guardrail, evaluated against realized spend reconstructed from
 * receipts. A ceiling with no receipts is `unmeasured`, never `clear`: absence
 * of spend data is not evidence that spend stayed inside the ceiling.
 */
export function assessGuardrail(input: {
  spendCeilingMinor: number | null;
  realizedSpendMinor: number | null;
  currency: string | null;
}): GuardrailAssessment {
  if (input.spendCeilingMinor === null) {
    // No money guardrail exists, so there is nothing to breach. This is the
    // organic case, and it must not be dressed up as "measured and clear".
    return {
      state: "clear",
      realizedSpendMinor: null,
      spendCeilingMinor: null,
      currency: null,
    };
  }
  if (input.realizedSpendMinor === null) {
    return {
      state: "unmeasured",
      realizedSpendMinor: null,
      spendCeilingMinor: input.spendCeilingMinor,
      currency: input.currency,
    };
  }
  return {
    state: input.realizedSpendMinor > input.spendCeilingMinor ? "breached" : "clear",
    realizedSpendMinor: input.realizedSpendMinor,
    spendCeilingMinor: input.spendCeilingMinor,
    currency: input.currency,
  };
}

type EvidenceBarResult =
  | { kind: "met"; tier: EvidenceTier; limitations: readonly string[] }
  | { kind: "unmet"; tier: EvidenceTier | null; limitations: readonly string[] };

/**
 * Whether the preregistered method's evidence threshold is met. The method is
 * the plan's, never something invented at settlement time.
 */
function evidenceBarMet(input: VerdictInput): EvidenceBarResult {
  const { attributionMethod, minimumEvidenceTier } = input.plan;

  if (attributionMethod === "provider_randomized_experiment") {
    // A randomized experiment is only evidence when the provider supplied the
    // effect. A plan that names the method without a provider effect has no
    // claim to make, whatever engagement it happened to collect.
    if (input.providerEffect === null) {
      return {
        kind: "unmet",
        tier: null,
        limitations: [
          "The preregistered randomized experiment supplied no provider effect estimate, so no outcome can be validated.",
        ],
      };
    }
    return { kind: "met", tier: "observed", limitations: [] };
  }

  // observational_prepost. The plan registers the baseline up front; without a
  // numeric baseline the before/after comparison cannot be made at all.
  const unmet: string[] = [];
  if (input.baseline === null) {
    unmet.push(
      `No numeric baseline is recorded (baseline described by source only: ${input.plan.baselineSource}).`,
    );
  }
  if (input.primaryObservations.length === 0) {
    unmet.push("No observation of the primary metric was recorded for the outcome window.");
  }

  if (unmet.length > 0) {
    return { kind: "unmet", tier: null, limitations: unmet };
  }

  const weakest = input.primaryObservations.reduce<EvidenceTier>(
    (lowest, observation) =>
      TIER_RANK[observation.evidenceTier] < TIER_RANK[lowest] ? observation.evidenceTier : lowest,
    "observed",
  );

  if (!meetsEvidenceTier(weakest, minimumEvidenceTier)) {
    return {
      kind: "unmet",
      tier: weakest,
      limitations: [
        `The primary metric was observed at ${weakest}, below the preregistered minimum of ${minimumEvidenceTier}.`,
      ],
    };
  }

  return { kind: "met", tier: weakest, limitations: [] };
}

/** Build the point estimate and a descriptive range. No statistical inference is invented. */
function buildEstimate(input: VerdictInput): Estimate {
  if (input.plan.attributionMethod === "provider_randomized_experiment") {
    // The provider owns the effect and its range; the platform repeats it, never
    // recomputes it into something the provider did not say.
    return input.providerEffect as Estimate;
  }

  const currency = input.guardrail.currency;
  const totalPost = input.primaryObservations.reduce(
    (sum, observation) => sum + observation.valueMinor,
    0,
  );
  const baseline = input.baseline as MetricObservation;

  // A simple before/after difference. The range is the observed minimum and
  // maximum of the post periods, not a confidence interval — the limitations on
  // the outcome say so explicitly.
  const postValues = input.primaryObservations.map((observation) => observation.valueMinor);
  const minPost = Math.min(...postValues);
  const maxPost = Math.max(...postValues);

  return {
    estimateMinor: totalPost - baseline.valueMinor,
    lowMinor: minPost - baseline.valueMinor,
    highMinor: maxPost - baseline.valueMinor,
    currency,
  };
}

/**
 * The one deterministic verdict computation.
 *
 * Order matters and is part of the contract: guardrail first, then execution,
 * then the evidence bar, then the honest fallbacks. A reader can rely on a
 * guardrail breach never being masked by a good primary metric, and on an empty
 * primary metric never being dressed up as `validated_outcome`.
 */
export function computeVerdict(input: VerdictInput): Outcome {
  // 1. A guardrail breach dominates, regardless of the primary metric.
  if (input.guardrail.state === "breached") {
    return {
      verdict: "guardrail_breach",
      evidenceTier: null,
      estimate: null,
      limitations: [
        `Realized spend of ${input.guardrail.realizedSpendMinor} ${input.guardrail.currency} exceeded the approved ceiling of ${input.guardrail.spendCeilingMinor} ${input.guardrail.currency}.`,
      ],
    };
  }

  // 2. Nothing reached a provider, so there is nothing to conclude.
  if (input.exposure.realizedCount === 0) {
    return {
      verdict: "execution_only",
      evidenceTier: null,
      estimate: null,
      limitations: ["No confirmed exposure was recorded for this campaign."],
    };
  }

  // 3. The preregistered evidence bar was met.
  const bar = evidenceBarMet(input);
  if (bar.kind === "met") {
    return {
      verdict: "validated_outcome",
      evidenceTier: bar.tier,
      estimate: buildEstimate(input),
      limitations: [
        input.plan.attributionMethod === "observational_prepost"
          ? "The estimate is a simple before/after difference, not an incrementality measurement; no confidence interval is computed."
          : "The estimate and range are the provider's, repeated unchanged.",
      ],
    };
  }

  // 4. Some primary evidence exists but the bar was not met. Honest default.
  if (input.primaryObservations.length > 0 || input.baseline !== null) {
    return {
      verdict: "inconclusive",
      evidenceTier: bar.tier,
      estimate: null,
      limitations: [...bar.limitations, "The preregistered evidence bar was not met."],
    };
  }

  // 5. Execution happened, but there is no primary evidence to evaluate.
  return {
    verdict: "execution_only",
    evidenceTier: null,
    estimate: null,
    limitations: ["The campaign ran, but no observation of the primary metric was recorded."],
  };
}

/**
 * Causal, impact, and overclaim language that drafted wording must not contain
 * unless the verdict actually supports it. Each entry names the concept so a
 * violation can be reported by label rather than as a bare regex match.
 */
export const OVERCLAIM_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: "causation", pattern: /\bcaus(e|ed|ing|es|al|ality|ation)\b/i },
  { label: "impact", pattern: /\bimpact(ed|ing|s|ful)?\b/i },
  { label: "effect", pattern: /\beffect(ed|ing|s|ive)?\b/i },
  { label: "lift", pattern: /\blift(ed|ing|s)?\b/i },
  { label: "increase", pattern: /\bincreas(e|ed|ing|es)?\b/i },
  { label: "growth", pattern: /\bgrow(n|ing|th|s)?\b/i },
  { label: "drive", pattern: /\bdr(iv|ove)(n|s|ing)?\b/i },
  { label: "improve", pattern: /\bimprov(e|ed|ing|ement|ements)?\b/i },
  { label: "boost", pattern: /\bboost(ed|ing|s)?\b/i },
  { label: "resulted-in", pattern: /\bresult(ed|ing|s)?\s+in\b/i },
  { label: "led-to", pattern: /\bled\s+to\b/i },
  { label: "because", pattern: /\bbecause\b/i },
  { label: "roas-roi", pattern: /\b(roas|roi)\b/i },
  { label: "conversion", pattern: /\bconversion(s)?\b|\bconvert(ed|ing|s)?\b/i },
  { label: "win", pattern: /\b(won|winning|wins?)\b/i },
  { label: "outperform", pattern: /\boutperform(ed|ing|s)?\b/i },
  { label: "significant", pattern: /\bsignificant(ly)?\b/i },
  { label: "proven", pattern: /\bprov(en|ed|e|ing)\b/i },
];

export type WordingViolation = { label: string };

/**
 * Rejects wording that overclaims a computed result.
 *
 * Applied to any summary a model drafts from an already-computed verdict, and
 * to the deterministic copy the UI renders. An `inconclusive` or
 * `execution_only` result must never read as causal or as an improvement, and a
 * result that was not validated must never read as proven.
 */
export function validateOutcomeWording(input: {
  text: string;
  verdict: CampaignVerdict;
}): readonly WordingViolation[] {
  // A validated outcome may use the vocabulary of an actual finding. The other
  // three verdicts must not, because none of them is a finding of effect.
  if (input.verdict === "validated_outcome") return [];

  return OVERCLAIM_PATTERNS.filter(({ pattern }) => pattern.test(input.text)).map(({ label }) => ({
    label,
  }));
}
