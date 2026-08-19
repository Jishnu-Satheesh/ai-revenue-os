import { describe, expect, it, vi } from "vitest";

import {
  buildEvidenceLinks,
  citedEvidenceIds,
  composeHypothesis,
  composeObservation,
  learningValidationIsClean,
  proposeLearning,
  validateLearningLesson,
  type LearningContext,
  type LearningServiceDependencies,
} from "@/modules/campaigns/application/learning-service";

const OUTCOME_ID = "10000000-0000-4000-8000-000000000001";
const BUNDLE_ID = "20000000-0000-4000-8000-000000000002";
const VARIANT_A = "30000000-0000-4000-8000-000000000003";
const VARIANT_B = "30000000-0000-4000-8000-000000000004";
const POLICY_ID = "40000000-0000-4000-8000-000000000005";
const FOREIGN_ID = "99999999-0000-4000-8000-000000000999";

function context(overrides: Partial<LearningContext> = {}): LearningContext {
  return {
    organizationId: "org1",
    campaignId: "camp1",
    outcomeId: OUTCOME_ID,
    bundleVersionId: BUNDLE_ID,
    bundleDigest: "a".repeat(64),
    policyVersionIds: [POLICY_ID],
    variantIds: [VARIANT_A, VARIANT_B],
    plannedExposureCount: 6,
    realizedExposureCount: 4,
    verdict: "inconclusive",
    evidenceTier: null,
    primaryMetricKey: "margin.contribution",
    attributionMethod: "observational_prepost",
    outcomeWindowDays: 14,
    settlementDelayDays: 3,
    baselineSource: "goal_baseline_measured:margin.contribution",
    baselineLookbackDays: 28,
    estimateMinor: null,
    estimateCurrency: null,
    limitations: ["The preregistered evidence bar was not met."],
    settledAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

const CLEAN_LESSON = `Variant ${VARIANT_A} is the campaign's own record; the lesson stays attached to this campaign.`;

function deps(overrides: Partial<LearningServiceDependencies> = {}) {
  const readContext = vi.fn<LearningServiceDependencies["readContext"]>();
  readContext.mockResolvedValue(context());
  const draftLesson = vi.fn<LearningServiceDependencies["draftLesson"]>();
  draftLesson.mockResolvedValue(CLEAN_LESSON);
  const writeProposal = vi.fn<LearningServiceDependencies["writeProposal"]>();
  writeProposal.mockResolvedValue({ result: "proposed", proposalId: "p1" });

  const built: LearningServiceDependencies = {
    readContext,
    draftLesson,
    writeProposal,
    ...overrides,
  };
  return { built, readContext, draftLesson, writeProposal };
}

describe("validateLearningLesson", () => {
  it("rejects a causal or winning draft for an inconclusive outcome", () => {
    const violations = validateLearningLesson({
      lesson: "This variant increased purchases and won against the control.",
      verdict: "inconclusive",
      citedEvidenceIds: [OUTCOME_ID, BUNDLE_ID, VARIANT_A],
    });
    expect(violations.overclaim.map((v) => v.label)).toEqual(
      expect.arrayContaining(["increase", "win"]),
    );
    expect(learningValidationIsClean(violations)).toBe(false);
  });

  it("rejects a winning rule drafted from an execution_only outcome", () => {
    const violations = validateLearningLesson({
      lesson: "The creative is proven to drive growth for this brand.",
      verdict: "execution_only",
      citedEvidenceIds: [OUTCOME_ID],
    });
    expect(violations.overclaim.map((v) => v.label)).toEqual(
      expect.arrayContaining(["proven", "growth"]),
    );
  });

  it("rejects a performance lesson drafted from a guardrail breach", () => {
    const violations = validateLearningLesson({
      lesson: "This creative lifted conversion and improved performance.",
      verdict: "guardrail_breach",
      citedEvidenceIds: [OUTCOME_ID],
    });
    expect(violations.overclaim.map((v) => v.label)).toEqual(
      expect.arrayContaining(["lift", "conversion", "improve"]),
    );
  });

  it("allows causal wording only for a validated outcome", () => {
    const violations = validateLearningLesson({
      lesson: "The variant increased purchases within this campaign.",
      verdict: "validated_outcome",
      citedEvidenceIds: [OUTCOME_ID, BUNDLE_ID, VARIANT_A],
    });
    expect(violations.overclaim).toEqual([]);
  });

  it("rejects prohibited generalization whatever the verdict", () => {
    const validated = validateLearningLesson({
      lesson: "This works for all clients and always works across campaigns.",
      verdict: "validated_outcome",
      citedEvidenceIds: [OUTCOME_ID],
    });
    expect(validated.generalization).toEqual(
      expect.arrayContaining(["all-clients", "always-works", "across-campaigns"]),
    );
    expect(learningValidationIsClean(validated)).toBe(false);
  });

  it("rejects a draft that cites evidence the proposal does not actually cite", () => {
    const violations = validateLearningLesson({
      lesson: `Compare against ${FOREIGN_ID} to generalize the result.`,
      verdict: "inconclusive",
      citedEvidenceIds: [OUTCOME_ID, BUNDLE_ID, VARIANT_A],
    });
    expect(violations.uncitedEvidenceIds).toContain(FOREIGN_ID.toLowerCase());
    expect(learningValidationIsClean(violations)).toBe(false);
  });

  it("accepts a clean campaign-scoped lesson", () => {
    const violations = validateLearningLesson({
      lesson: CLEAN_LESSON,
      verdict: "inconclusive",
      citedEvidenceIds: [OUTCOME_ID, BUNDLE_ID, VARIANT_A, VARIANT_B],
    });
    expect(learningValidationIsClean(violations)).toBe(true);
  });
});

describe("evidence assembly", () => {
  it("cites every piece of the campaign's own evidence and nothing else", () => {
    expect(citedEvidenceIds(context())).toEqual([
      OUTCOME_ID,
      BUNDLE_ID,
      VARIANT_A,
      VARIANT_B,
      POLICY_ID,
    ]);
    expect(buildEvidenceLinks(context())).toEqual([
      { kind: "outcome", id: OUTCOME_ID },
      { kind: "bundle_version", id: BUNDLE_ID },
      { kind: "variant", id: VARIANT_A },
      { kind: "variant", id: VARIANT_B },
      { kind: "policy", id: POLICY_ID },
    ]);
  });

  it("keeps the hypothesis and the observation as two separate fields", () => {
    const hypothesis = composeHypothesis(context());
    const observation = composeObservation(context());
    expect(hypothesis).not.toBe(observation);
    expect(hypothesis).toContain("preregistered plan");
    expect(hypothesis).toContain("margin.contribution");
    expect(observation).toContain("settled verdict");
    expect(observation).toContain("inconclusive");
  });

  it("never lets the composed hypothesis or observation overclaim an inconclusive result", () => {
    const observation = composeObservation(context());
    expect(
      validateLearningLesson({
        lesson: observation,
        verdict: "inconclusive",
        citedEvidenceIds: citedEvidenceIds(context()),
      }).overclaim,
    ).toEqual([]);
  });
});

describe("proposeLearning", () => {
  it("writes a proposal that quotes the exact evidence, with hypothesis and observation apart", async () => {
    const { built, writeProposal } = deps();
    const result = await proposeLearning({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toEqual({ result: "proposed", proposalId: "p1" });

    const write = writeProposal.mock.calls[0][0];
    expect(write.variantIds).toEqual([VARIANT_A, VARIANT_B]);
    expect(write.evidenceLinks).toEqual(buildEvidenceLinks(context()));
    expect(write.hypothesis).not.toBe(write.observation);
    expect(write.hypothesis).toContain("preregistered plan");
    expect(write.observation).toContain("settled verdict");
    expect(write.proposedLesson).toBe(CLEAN_LESSON);
  });

  it("hands the model only the computed context, and repairs one overclaiming draft", async () => {
    const draftLesson = vi.fn<LearningServiceDependencies["draftLesson"]>();
    draftLesson
      .mockResolvedValueOnce("This variant increased sales for every campaign.")
      .mockResolvedValueOnce(CLEAN_LESSON);
    const { built, writeProposal } = deps({ draftLesson });

    const result = await proposeLearning({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toEqual({ result: "proposed", proposalId: "p1" });
    expect(draftLesson).toHaveBeenCalledTimes(2);
    // The second call carries the violation labels from the first attempt.
    expect(draftLesson.mock.calls[1][0].repairHints).toEqual(
      expect.arrayContaining(["increase", "every-campaign"]),
    );
    expect(writeProposal).toHaveBeenCalledTimes(1);
    expect(writeProposal.mock.calls[0][0].proposedLesson).toBe(CLEAN_LESSON);
  });

  it("writes nothing when the repaired draft still oversteps", async () => {
    const draftLesson = vi.fn<LearningServiceDependencies["draftLesson"]>();
    draftLesson.mockResolvedValue("This variant always works and lifted sales everywhere.");
    const { built, writeProposal } = deps({ draftLesson });

    const result = await proposeLearning({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toMatchObject({ result: "validation_failed" });
    expect(writeProposal).not.toHaveBeenCalled();
  });

  it("refuses to propose for a campaign with no current settled outcome", async () => {
    const { built, draftLesson } = deps({ readContext: vi.fn(async () => null) });
    const result = await proposeLearning({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toEqual({ result: "failed", failureCode: "campaign_has_no_settled_outcome" });
    expect(draftLesson).not.toHaveBeenCalled();
  });

  it("surfaces a write refusal with its reason code", async () => {
    const { built } = deps({
      writeProposal: vi.fn(async () => ({
        result: "refused" as const,
        reasonCode: "campaign_learning_already_proposed",
      })),
    });
    const result = await proposeLearning({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toEqual({ result: "refused", reasonCode: "campaign_learning_already_proposed" });
  });
});
