import {
  validateOutcomeWording,
  type AttributionMethod,
  type CampaignVerdict,
  type EvidenceTier,
  type WordingViolation,
} from "@/domain/campaigns/measurement";

/**
 * The evidence loop's last arrow: drafting a campaign-scoped learning proposal.
 *
 * This service drafts exactly one governed proposal per campaign, and only
 * after the campaign has a settled outcome. It composes the hypothesis (from
 * the preregistered plan) and the observation (from the outcome) as two
 * separate fields that are never merged, hands a model the computed result and
 * the cited evidence — and nothing else — to draft the lesson wording, then
 * runs the deterministic validators before anything is written.
 *
 * Three walls are enforced in code, not by prompt:
 *
 *  - Verdict consistency. `validateOutcomeWording` rejects causal or winning
 *    language for `inconclusive`, `execution_only`, and `guardrail_breach`, so
 *    an inconclusive result can never be drafted into a winning rule.
 *  - No generalization. A lesson that reaches beyond its campaign ("all
 *    clients", "always works", cross-campaign inference) is rejected whatever
 *    the verdict, because learning stays campaign-scoped until promoted.
 *  - Evidence tracing. Every evidence id the draft names must be one the
 *    proposal actually cites; nothing may cite evidence from another campaign
 *    or another tenant.
 *
 * The model never chooses a verdict, a method, a stopping rule, or a
 * promotion. It drafts wording from an already-computed result, and the draft
 * must survive the validators or the proposal is not written.
 */

export type LearningEvidenceLink = {
  kind: "outcome" | "bundle_version" | "variant" | "policy";
  id: string;
};

/** The computed result a worker reads before drafting, and nothing more. */
export type LearningContext = {
  organizationId: string;
  campaignId: string;
  outcomeId: string;
  bundleVersionId: string;
  bundleDigest: string;
  policyVersionIds: readonly string[];
  variantIds: readonly string[];
  plannedExposureCount: number;
  realizedExposureCount: number;
  verdict: CampaignVerdict;
  evidenceTier: EvidenceTier | null;
  primaryMetricKey: string;
  attributionMethod: AttributionMethod;
  outcomeWindowDays: number;
  settlementDelayDays: number;
  baselineSource: string;
  baselineLookbackDays: number;
  estimateMinor: number | null;
  estimateCurrency: string | null;
  limitations: readonly string[];
  settledAt: string;
};

export type ProposeLearningWrite = {
  organizationId: string;
  campaignId: string;
  variantIds: readonly string[];
  hypothesis: string;
  observation: string;
  proposedLesson: string;
  suggestedNextTest: string;
  evidenceLinks: readonly LearningEvidenceLink[];
};

export type ProposeWriteResult =
  | { result: "proposed"; proposalId: string }
  | { result: "unchanged"; proposalId: string }
  | { result: "refused"; reasonCode: string };

export type DraftLessonInput = {
  context: LearningContext;
  /** Violation labels from a previous attempt, for one bounded repair pass. */
  repairHints: readonly string[];
};

export type LearningServiceDependencies = {
  /** Null when the campaign has no current settled outcome to draft from. */
  readContext(input: {
    organizationId: string;
    campaignId: string;
  }): Promise<LearningContext | null>;
  draftLesson(input: DraftLessonInput): Promise<string>;
  writeProposal(input: ProposeLearningWrite): Promise<ProposeWriteResult>;
};

export type LearningValidation = {
  overclaim: readonly WordingViolation[];
  generalization: readonly string[];
  uncitedEvidenceIds: readonly string[];
};

export type ProposeLearningResult =
  | { result: "proposed" | "unchanged"; proposalId: string }
  | { result: "refused"; reasonCode: string }
  | { result: "validation_failed"; violations: LearningValidation }
  | { result: "failed"; failureCode: string };

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Language that generalizes a campaign's own result into a claim about other
 * clients or other campaigns. Rejected whatever the verdict, because ADR 0019
 * keeps learning campaign-scoped until a separate governed decision promotes it.
 */
export const PROHIBITED_GENERALIZATION_PATTERNS: readonly {
  label: string;
  pattern: RegExp;
}[] = [
  { label: "all-clients", pattern: /\ball\s+(clients?|customers?|accounts?|organizations?)\b/i },
  { label: "always-works", pattern: /\balways\s+works?\b/i },
  { label: "across-campaigns", pattern: /\bacross\s+campaigns?\b/i },
  { label: "cross-campaign", pattern: /\bcross[- ]campaign\b/i },
  { label: "other-campaigns", pattern: /\bother\s+campaigns?\b/i },
  { label: "between-campaigns", pattern: /\bbetween\s+campaigns?\b/i },
  { label: "every-campaign", pattern: /\bevery\s+campaign\b/i },
  { label: "in-general", pattern: /\bin\s+general\b/i },
  { label: "universally", pattern: /\buniversally?\b/i },
  { label: "guaranteed", pattern: /\bguarantee(d|s|ing)?\b/i },
];

/**
 * The deterministic gate a drafted lesson must pass.
 *
 * `validateOutcomeWording` enforces verdict consistency: an `inconclusive`,
 * `execution_only`, or `guardrail_breach` result cannot read as causal or as a
 * win. The generalization check applies to every verdict, because even a
 * validated campaign result is one campaign's result. The evidence check
 * rejects any evidence id the draft names that the proposal does not cite, so
 * a lesson can only ever point at the campaign's own evidence.
 */
export function validateLearningLesson(input: {
  lesson: string;
  verdict: CampaignVerdict;
  citedEvidenceIds: readonly string[];
}): LearningValidation {
  const overclaim = validateOutcomeWording({ text: input.lesson, verdict: input.verdict });

  const generalization = PROHIBITED_GENERALIZATION_PATTERNS.filter(({ pattern }) =>
    pattern.test(input.lesson),
  ).map(({ label }) => label);

  const cited = new Set(input.citedEvidenceIds.map((id) => id.toLowerCase()));
  const named = input.lesson.match(UUID_PATTERN) ?? [];
  const uncitedEvidenceIds = [
    ...new Set(named.map((id) => id.toLowerCase()).filter((id) => !cited.has(id))),
  ];

  return { overclaim, generalization, uncitedEvidenceIds };
}

export function learningValidationIsClean(validation: LearningValidation): boolean {
  return (
    validation.overclaim.length === 0 &&
    validation.generalization.length === 0 &&
    validation.uncitedEvidenceIds.length === 0
  );
}

/** Every evidence id the proposal cites, assembled from the computed context. */
export function citedEvidenceIds(context: LearningContext): readonly string[] {
  return [
    context.outcomeId,
    context.bundleVersionId,
    ...context.variantIds,
    ...context.policyVersionIds,
  ];
}

export function buildEvidenceLinks(context: LearningContext): readonly LearningEvidenceLink[] {
  return [
    { kind: "outcome", id: context.outcomeId },
    { kind: "bundle_version", id: context.bundleVersionId },
    ...context.variantIds.map((id) => ({ kind: "variant", id }) as const),
    ...context.policyVersionIds.map((id) => ({ kind: "policy", id }) as const),
  ];
}

const METHOD_WORDS: Readonly<Record<AttributionMethod, string>> = {
  observational_prepost: "an observational before-and-after comparison",
  provider_randomized_experiment: "a provider randomized experiment",
};

/** The preregistered hypothesis, in words, as a field of its own. */
export function composeHypothesis(context: LearningContext): string {
  return (
    `The preregistered plan tested whether creative variants moved the primary metric ` +
    `${context.primaryMetricKey}, using ${METHOD_WORDS[context.attributionMethod]} over a ` +
    `${context.outcomeWindowDays}-day outcome window with a ${context.settlementDelayDays}-day ` +
    `settlement delay, against a ${context.baselineLookbackDays}-day baseline.`
  );
}

/** The observed result, in words, as a field of its own — never merged with the hypothesis. */
export function composeObservation(context: LearningContext): string {
  const estimate =
    context.estimateMinor === null ? " No estimate was recorded." : " An estimate was recorded.";
  return (
    `The campaign ran with ${context.plannedExposureCount} planned exposures against ` +
    `${context.realizedExposureCount} realized. The settled verdict is ${context.verdict}` +
    `${context.evidenceTier ? ` at the ${context.evidenceTier} evidence tier` : ""}.${estimate}`
  );
}

/**
 * The next test, composed deterministically from the verdict. A model never
 * chooses a method, so it never chooses the next test either.
 */
const SUGGESTED_NEXT_TEST: Readonly<Record<CampaignVerdict, string>> = {
  validated_outcome:
    "Repeat the test with a larger sample to confirm the estimate before acting on it.",
  inconclusive:
    "Run the same preregistered method again with a larger sample or a longer window before drawing a conclusion.",
  guardrail_breach:
    "Correct the guardrail violation and re-run before drawing any performance conclusion.",
  execution_only: "Run a campaign that records the primary metric before drawing any conclusion.",
};

export async function proposeLearning(
  input: { organizationId: string; campaignId: string },
  deps: LearningServiceDependencies,
): Promise<ProposeLearningResult> {
  const context = await deps.readContext(input);
  if (context === null) {
    // No settlement, no proposal. The allocation loop can never reach this
    // path, and nothing here invents an outcome to draft from.
    return { result: "failed", failureCode: "campaign_has_no_settled_outcome" };
  }

  const evidenceIds = citedEvidenceIds(context);

  // One bounded repair pass: draft, validate, and if the wording oversteps,
  // draft once more with the violation labels as feedback. The second failure
  // is a safe validation failure — no proposal is written.
  const first = await deps.draftLesson({ context, repairHints: [] });
  const firstValidation = validateLearningLesson({
    lesson: first,
    verdict: context.verdict,
    citedEvidenceIds: evidenceIds,
  });

  let lesson = first;
  let violations = firstValidation;
  if (!learningValidationIsClean(firstValidation)) {
    const hints = [
      ...firstValidation.overclaim.map((entry) => entry.label),
      ...firstValidation.generalization,
      ...firstValidation.uncitedEvidenceIds.map((id) => `uncited evidence ${id}`),
    ];
    const second = await deps.draftLesson({ context, repairHints: hints });
    const secondValidation = validateLearningLesson({
      lesson: second,
      verdict: context.verdict,
      citedEvidenceIds: evidenceIds,
    });
    lesson = second;
    violations = secondValidation;
  }

  if (!learningValidationIsClean(violations)) {
    return { result: "validation_failed", violations };
  }

  const write = await deps.writeProposal({
    organizationId: context.organizationId,
    campaignId: context.campaignId,
    variantIds: context.variantIds,
    hypothesis: composeHypothesis(context),
    observation: composeObservation(context),
    proposedLesson: lesson,
    suggestedNextTest: SUGGESTED_NEXT_TEST[context.verdict],
    evidenceLinks: buildEvidenceLinks(context),
  });

  if (write.result === "refused") {
    return { result: "refused", reasonCode: write.reasonCode };
  }
  if (write.result === "unchanged") {
    return { result: "unchanged", proposalId: write.proposalId };
  }
  return { result: "proposed", proposalId: write.proposalId };
}
