import { z } from "zod";

import { candidateFingerprint, type SubjectRef } from "@/domain/decisions/digest";
import {
  checkDraftEligibility,
  type DraftEligibilityInput,
} from "@/domain/decisions/campaign-draft-eligibility";
import {
  GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY,
  governedCampaignDraftPlaybookV1,
} from "@/modules/decisions/playbooks/governed-campaign-draft-v1";

/**
 * The Growth Intelligence source reads a synthesized Recommendation through
 * the `OpportunitySource` port contract: it declares the inputs it requires up
 * front, and when any of them is missing it yields nothing and records why.
 *
 * Only `recommendation` items can become Campaign Opportunities. Insights and
 * Data Gaps stay where they are; an Insight is missing draft prerequisites by
 * kind, not by evidence, so it reports that instead of a gap list that
 * implies providing something would qualify it.
 */

export const governedDraftActionParametersSchema = z.strictObject({
  objective: z.string().trim().min(1).max(500),
  audience: z.string().trim().min(1).max(500),
  opportunityItemId: z.string().uuid(),
  itemFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

export type GovernedDraftActionParameters = z.infer<typeof governedDraftActionParametersSchema>;

export type GrowthIntelligenceItemEvidence = {
  itemKind: "insight" | "recommendation" | "data_gap";
  itemId: string;
  itemFingerprint: string;
  narrative: string;
  businessEvidenceCurrent: boolean;
  businessEvidenceObservedAt: Date | null;
  marketSupport: "primary" | "corroborated" | "single_source" | "conflicted" | "none";
  marketEvidenceUnexpired: boolean;
  marketProfileApprovedCurrent: boolean;
  activeGoalMetricKeys: readonly string[];
  objective: string;
  audience: string;
  brandGuidanceCurrent: boolean;
  brandAssetsUsable: boolean;
  syntheticAssetPathAllowed: boolean;
  impact: DraftEligibilityInput["impact"];
  evaluationTemplateRegistered: boolean;
  assertionsRecheckable: boolean;
  currencyAgreement: boolean;
  policyProhibition: boolean;
  governanceBreach: boolean;
};

export type GrowthIntelligenceCandidate = {
  candidateFingerprint: string;
  playbookVersionId: string;
  subject: SubjectRef;
  parameters: GovernedDraftActionParameters;
  impactEvidence: {
    evidenceTier: "computed" | "observed" | "prior";
    impactLowMinor: number;
    impactHighMinor: number;
    expectedContributionMinor: number;
    currency: string;
    sourceRevisionIds: readonly string[];
    observedAt: Date;
    timeToImpactDays: number;
  };
};

export type GrowthIntelligenceSourceResult =
  | { outcome: "candidates"; candidates: readonly GrowthIntelligenceCandidate[] }
  | { outcome: "needs_data"; missingEvidenceKeys: readonly string[] };

export type GrowthIntelligenceSourceInput = {
  organizationId: string;
  playbookVersionId: string;
  evidence: GrowthIntelligenceItemEvidence;
  now: Date;
};

export function createGrowthIntelligenceOpportunitySource() {
  const playbook = governedCampaignDraftPlaybookV1;

  return {
    playbookActionKey: GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY,
    requiredEvidenceKeys: playbook.requiredEvidenceKeys,
    requiredCapabilityKeys: playbook.requiredCapabilityKeys,

    generate(input: GrowthIntelligenceSourceInput): GrowthIntelligenceSourceResult {
      const { evidence } = input;
      if (evidence.itemKind !== "recommendation") {
        return { outcome: "needs_data", missingEvidenceKeys: ["item_kind_recommendation"] };
      }

      const eligibility = checkDraftEligibility({
        businessEvidenceCurrent: evidence.businessEvidenceCurrent,
        businessEvidenceObservedAt: evidence.businessEvidenceObservedAt,
        freshnessBoundMinutes: playbook.freshnessBoundMinutes,
        marketSupport: evidence.marketSupport,
        marketEvidenceUnexpired: evidence.marketEvidenceUnexpired,
        marketProfileApprovedCurrent: evidence.marketProfileApprovedCurrent,
        activeGoalMetricKeys: evidence.activeGoalMetricKeys,
        primaryMetricKey: playbook.primaryMetricKey,
        objective: evidence.objective,
        audience: evidence.audience,
        brandGuidanceCurrent: evidence.brandGuidanceCurrent,
        brandAssetsUsable: evidence.brandAssetsUsable,
        syntheticAssetPathAllowed: evidence.syntheticAssetPathAllowed,
        impact: evidence.impact,
        evaluationTemplateRegistered: evidence.evaluationTemplateRegistered,
        assertionsRecheckable: evidence.assertionsRecheckable,
        currencyAgreement: evidence.currencyAgreement,
        policyProhibition: evidence.policyProhibition,
        governanceBreach: evidence.governanceBreach,
        now: input.now,
      });
      if (!eligibility.eligible) {
        return { outcome: "needs_data", missingEvidenceKeys: eligibility.missingGaps };
      }

      const subject: SubjectRef = {
        subjectKind: "organization",
        subjectId: input.organizationId,
      };
      const parameters = governedDraftActionParametersSchema.parse({
        objective: evidence.objective.trim(),
        audience: evidence.audience.trim(),
        opportunityItemId: evidence.itemId,
        itemFingerprint: evidence.itemFingerprint,
      });
      const impact = eligibility.impact;
      return {
        outcome: "candidates",
        candidates: [
          {
            candidateFingerprint: candidateFingerprint({
              playbookVersionId: input.playbookVersionId,
              subject,
              parameters,
            }),
            playbookVersionId: input.playbookVersionId,
            subject,
            parameters,
            impactEvidence: {
              evidenceTier: impact.evidenceTier,
              impactLowMinor: impact.impactLowMinor,
              impactHighMinor: impact.impactHighMinor,
              expectedContributionMinor: impact.expectedContributionMinor,
              currency: impact.currency,
              sourceRevisionIds: impact.sourceRevisionIds,
              observedAt: impact.observedAt,
              timeToImpactDays: impact.timeToImpactDays,
            },
          },
        ],
      };
    },
  };
}

export type GrowthIntelligenceOpportunitySource = ReturnType<
  typeof createGrowthIntelligenceOpportunitySource
>;
