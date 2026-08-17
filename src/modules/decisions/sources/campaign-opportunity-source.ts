import { candidateFingerprint, type SubjectRef } from "@/domain/decisions/digest";
import type { CompletenessGrade } from "@/domain/economics/types";
import {
  CAMPAIGN_META_BUNDLE_ACTION_KEY,
  campaignActionParametersSchema,
  metaCampaignPlaybookV1,
  type CampaignActionParameters,
} from "@/modules/decisions/playbooks/meta-campaign-v1";

/**
 * The campaign source reads through the `OpportunitySource` port contract: it
 * declares the inputs it requires up front, and when any of them is missing it
 * yields nothing and records why.
 *
 * It never yields a candidate with invented inputs. That is the whole point of
 * the port — a proposal the platform cannot defend is a `needs_data` decision,
 * which surfaces on the readiness surface rather than in the opportunity feed.
 */
export type CampaignEvidence = {
  organizationProfileCurrent: boolean;
  brandConstraintsVerified: boolean;
  brandAssetsUsable: boolean;
  syntheticAssetsAllowed: boolean;
  economics: { currency: string; completenessGrade: CompletenessGrade } | null;
  activeGoalMetricKeys: readonly string[];
  metaAccountMapped: boolean;
  grantedCapabilityKeys: readonly string[];
  spendPolicy: { monthlyBudgetMinor: number; currency: string } | null;
  trackingReady: boolean;
  measurementPlanRegistered: boolean;
  accessPolicyActive: boolean;
  marginFirewallResult: "pass" | "breach" | "unknown";
  impactEvidence: {
    evidenceTier: "computed" | "observed" | "prior";
    impactLowMinor: number | null;
    impactHighMinor: number | null;
    currency: string | null;
    sourceRevisionIds: readonly string[];
    observedAt: Date | null;
    timeToImpactDays: number | null;
    completenessGrade: CompletenessGrade;
  } | null;
  inputsObservedAt: Date | null;
  observedVolume: number;
};

export type CampaignCandidate = {
  candidateFingerprint: string;
  playbookVersionId: string;
  subject: SubjectRef;
  parameters: CampaignActionParameters;
  impactEvidence: {
    evidenceTier: "computed";
    impactLowMinor: number;
    impactHighMinor: number;
    currency: string;
    sourceRevisionIds: readonly string[];
    observedAt: Date;
    timeToImpactDays: number;
    completenessGrade: "complete" | "partial";
  };
};

export type CampaignSourceResult =
  | { outcome: "candidates"; candidates: readonly CampaignCandidate[] }
  | {
      outcome: "needs_data";
      missingEvidenceKeys: readonly string[];
      missingCapabilityKeys: readonly string[];
    }
  | { outcome: "rejected"; rejectionReason: "margin_firewall_breach" };

export type CampaignSourceInput = {
  organizationId: string;
  playbookVersionId: string;
  evidence: CampaignEvidence;
  now: Date;
};

export function createCampaignOpportunitySource() {
  const playbook = metaCampaignPlaybookV1;

  return {
    playbookActionKey: CAMPAIGN_META_BUNDLE_ACTION_KEY,
    requiredEvidenceKeys: playbook.requiredEvidenceKeys,

    generate(input: CampaignSourceInput): CampaignSourceResult {
      const { evidence } = input;
      const missingEvidenceKeys: string[] = [];

      if (!evidence.organizationProfileCurrent) {
        missingEvidenceKeys.push("organization_profile_current");
      }
      if (!evidence.brandConstraintsVerified)
        missingEvidenceKeys.push("brand_constraints_verified");

      // Either real assets or an explicit allowance to generate them. An
      // implicit allowance would let the platform invent imagery nobody agreed
      // to publish.
      if (!evidence.brandAssetsUsable && !evidence.syntheticAssetsAllowed) {
        missingEvidenceKeys.push("brand_assets_usable_or_synthetic_allowed");
      }

      // `indicative` maps to no evidence tier. It never falls back to a prior.
      if (evidence.economics === null || evidence.economics.completenessGrade === "indicative") {
        missingEvidenceKeys.push("economics_configured");
      }

      if (!evidence.activeGoalMetricKeys.includes(playbook.primaryMetricKey)) {
        missingEvidenceKeys.push("active_goal_metric");
      }
      if (!evidence.metaAccountMapped) missingEvidenceKeys.push("meta_account_mapped");

      const missingCapabilityKeys = playbook.requiredCapabilityKeys.filter(
        (key) => !evidence.grantedCapabilityKeys.includes(key),
      );
      if (missingCapabilityKeys.length > 0) {
        missingEvidenceKeys.push("action_capabilities_granted");
      }

      // An unbounded cost is `needs_data`, not a zero.
      if (evidence.spendPolicy === null) {
        missingEvidenceKeys.push("spend_policy_configured", "policy.spend.active");
      }
      if (!evidence.trackingReady) missingEvidenceKeys.push("tracking_ready");
      if (!evidence.trackingReady) missingEvidenceKeys.push("measurement.tracking_ready");
      if (!evidence.measurementPlanRegistered) {
        missingEvidenceKeys.push("measurement.plan_registered");
      }
      if (!evidence.accessPolicyActive) missingEvidenceKeys.push("policy.access.active");
      if (evidence.marginFirewallResult === "unknown") {
        missingEvidenceKeys.push("margin.firewall.pass");
      }

      const impact = evidence.impactEvidence;
      if (impact === null || impact.impactLowMinor === null || impact.impactHighMinor === null) {
        missingEvidenceKeys.push("impact.range");
      }
      if (impact === null || impact.currency === null) missingEvidenceKeys.push("impact.currency");
      if (impact === null || impact.sourceRevisionIds.length === 0) {
        missingEvidenceKeys.push("impact.source_revisions");
      }
      if (impact === null || impact.observedAt === null) {
        missingEvidenceKeys.push("impact.observed_at");
      }
      if (impact === null || impact.timeToImpactDays === null) {
        missingEvidenceKeys.push("impact.time_to_impact");
      }
      if (impact !== null && impact.evidenceTier !== "computed") {
        missingEvidenceKeys.push("impact.approved_source");
      }
      if (impact !== null && impact.completenessGrade === "indicative") {
        missingEvidenceKeys.push("impact.approved_source");
      }

      if (evidence.inputsObservedAt === null) {
        missingEvidenceKeys.push("inputs_fresh");
      } else {
        const ageMinutes =
          (input.now.getTime() - evidence.inputsObservedAt.getTime()) / (60 * 1000);
        if (ageMinutes > playbook.freshnessBoundMinutes) missingEvidenceKeys.push("inputs_fresh");
      }

      // A candidate whose components span currencies is a defect, not a
      // conversion, so it is refused before it can be scored.
      if (
        evidence.economics !== null &&
        evidence.spendPolicy !== null &&
        evidence.economics.currency !== evidence.spendPolicy.currency
      ) {
        missingEvidenceKeys.push("currency_agreement");
      }
      if (
        impact?.currency !== null &&
        impact?.currency !== undefined &&
        evidence.spendPolicy !== null &&
        impact.currency !== evidence.spendPolicy.currency
      ) {
        missingEvidenceKeys.push("currency_agreement");
      }

      if (evidence.marginFirewallResult === "breach") {
        return { outcome: "rejected", rejectionReason: "margin_firewall_breach" };
      }

      if (missingEvidenceKeys.length > 0) {
        return { outcome: "needs_data", missingEvidenceKeys, missingCapabilityKeys };
      }

      // Narrowing for TypeScript; both are proven present by the checks above.
      const economics = evidence.economics!;
      const spendPolicy = evidence.spendPolicy!;
      const controlledImpact = evidence.impactEvidence! as CampaignCandidate["impactEvidence"];

      const subject: SubjectRef = {
        subjectKind: "organization",
        subjectId: input.organizationId,
      };

      // The proposal never exceeds the configured budget. Policy re-checks this
      // independently; proposing above it would only be removed later anyway.
      const parameters = campaignActionParametersSchema.parse({
        objective: "Increase incremental gross profit through governed Meta campaigns",
        channels: ["instagram", "facebook"],
        placements: ["feed_image", "image_story"],
        spendCeiling: {
          amountMinor: Math.min(spendPolicy.monthlyBudgetMinor, 450_000),
          currency: economics.currency,
        },
        measurementMethod: "reconciliation",
        executionMode: "best_effort",
        constraints: [],
      });

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
            impactEvidence: controlledImpact,
          },
        ],
      };
    },
  };
}

export type CampaignOpportunitySource = ReturnType<typeof createCampaignOpportunitySource>;
