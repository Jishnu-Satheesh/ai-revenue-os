import { qualifyDraftImpact, type DraftImpact } from "@/domain/decisions/campaign-draft-impact";

/**
 * Whether a synthesized item may become a Campaign Opportunity (spec 022
 * section 10.1). Missing prerequisites are ordinary outcomes: the item stays
 * a Recommendation and each gap is named so the readiness surface can ask for
 * exactly what is missing. Prohibitions, breaches, and currency conflicts are
 * ineligibility, not gaps — nothing the operator provides can fill them.
 *
 * Missing provider mapping, publishing permission, ad-account capability,
 * spend authorization, or tracking never blocks an internal draft. Those are
 * rechecked before Campaign approval and execution, and the type carries them
 * only so a caller cannot silently forget they were unchecked.
 */

export type DraftEligibilityInput = {
  businessEvidenceCurrent: boolean;
  businessEvidenceObservedAt: Date | null;
  freshnessBoundMinutes: number;
  marketSupport: "primary" | "corroborated" | "single_source" | "conflicted" | "none";
  marketEvidenceUnexpired: boolean;
  marketProfileApprovedCurrent: boolean;
  activeGoalMetricKeys: readonly string[];
  primaryMetricKey: string;
  objective: string;
  audience: string;
  brandGuidanceCurrent: boolean;
  brandAssetsUsable: boolean;
  syntheticAssetPathAllowed: boolean;
  impact: Parameters<typeof qualifyDraftImpact>[0];
  evaluationTemplateRegistered: boolean;
  assertionsRecheckable: boolean;
  currencyAgreement: boolean;
  policyProhibition: boolean;
  governanceBreach: boolean;
  providerMappingPresent?: boolean;
  publishPermissionGranted?: boolean;
  adAccountCapability?: boolean;
  spendAuthorizationPresent?: boolean;
  trackingReady?: boolean;
  now: Date;
};

export type DraftEligibility =
  | { eligible: true; impact: DraftImpact }
  | { eligible: false; missingGaps: readonly string[] };

export function checkDraftEligibility(input: DraftEligibilityInput): DraftEligibility {
  // Hard bars first: these are verdicts, and verdicts do not come with homework.
  if (input.policyProhibition || input.governanceBreach || !input.currencyAgreement) {
    return { eligible: false, missingGaps: [] };
  }

  const missingGaps: string[] = [];

  if (!input.businessEvidenceCurrent || input.businessEvidenceObservedAt === null) {
    missingGaps.push("business_evidence_current");
  } else {
    const ageMinutes =
      (input.now.getTime() - input.businessEvidenceObservedAt.getTime()) / (60 * 1000);
    if (ageMinutes > input.freshnessBoundMinutes) missingGaps.push("business_evidence_current");
  }

  if (
    (input.marketSupport !== "primary" && input.marketSupport !== "corroborated") ||
    !input.marketEvidenceUnexpired
  ) {
    missingGaps.push("market_support_primary_or_corroborated");
  }
  if (!input.marketProfileApprovedCurrent) missingGaps.push("market_profile_approved_current");
  if (!input.activeGoalMetricKeys.includes(input.primaryMetricKey)) {
    missingGaps.push("active_goal_metric");
  }
  if (input.objective.trim().length === 0) missingGaps.push("campaign_objective");
  if (input.audience.trim().length === 0) missingGaps.push("campaign_audience");
  if (!input.brandGuidanceCurrent) missingGaps.push("brand_guidance_current");
  if (!input.brandAssetsUsable && !input.syntheticAssetPathAllowed) {
    missingGaps.push("brand_assets_usable_or_synthetic_allowed");
  }
  if (!input.evaluationTemplateRegistered) missingGaps.push("evaluation_template_registered");
  if (!input.assertionsRecheckable) missingGaps.push("assertions_recheckable");

  let impact: DraftImpact;
  try {
    impact = qualifyDraftImpact(input.impact);
  } catch {
    // An unqualifiable range is one gap, not a defect: the evidence surface
    // explains which input failed when the operator opens it.
    return { eligible: false, missingGaps: [...missingGaps, "impact_qualified"] };
  }

  if (missingGaps.length > 0) return { eligible: false, missingGaps };
  return { eligible: true, impact };
}
