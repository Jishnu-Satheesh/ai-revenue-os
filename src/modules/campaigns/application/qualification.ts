import { CAMPAIGN_META_BUNDLE_ACTION_KEY } from "@/modules/decisions/playbooks/meta-campaign-v1";

/**
 * The boundary where both entry points converge.
 *
 * A Decision Engine opportunity and a manual operator brief create the same
 * kind of campaign and enter the same qualification pipeline. The manual path
 * does not receive a weaker safety path; it simply has no decision record
 * behind it, which is recorded as `null` rather than faked.
 *
 * Qualification reads the opportunity and snapshots it. It never mutates the
 * opportunity: the feed owns that row, and a campaign that edited its own
 * source could not later be reconciled against the decision that proposed it.
 */
export type OpportunityStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "snoozed"
  | "expired";

export type CampaignAssertion = { key: string; expectedOutcome: string };

export type QualificationOpportunity = {
  id: string;
  organizationId: string;
  status: OpportunityStatus;
  actionKey: string;
  playbookVersionId: string;
  decisionRecordId: string;
  assertions: readonly CampaignAssertion[];
  expiresAt: Date;
};

export type CampaignSourceInput =
  | { kind: "manual_brief"; briefId: string }
  | { kind: "decision_opportunity"; opportunity: QualificationOpportunity };

export type QualifiedCampaignSource = {
  outcome: "qualified";
  source: { kind: "manual_brief" | "decision_opportunity"; sourceId: string };
  playbookVersionId: string | null;
  decisionRecordId: string | null;
  assertions: readonly CampaignAssertion[];
};

export type BlockedQualification = {
  outcome: "blocked";
  reason:
    | "brief_missing"
    | "opportunity_not_in_organization"
    | "opportunity_not_proposed"
    | "action_not_campaign"
    | "opportunity_expired"
    | "assertions_missing";
};

export type QualificationResult = QualifiedCampaignSource | BlockedQualification;

export function qualifyCampaignSource(input: {
  organizationId: string;
  source: CampaignSourceInput;
  now: Date;
}): QualificationResult {
  if (input.source.kind === "manual_brief") {
    if (!input.source.briefId) return { outcome: "blocked", reason: "brief_missing" };

    return {
      outcome: "qualified",
      source: { kind: "manual_brief", sourceId: input.source.briefId },
      playbookVersionId: null,
      decisionRecordId: null,
      assertions: Object.freeze([]),
    };
  }

  const { opportunity } = input.source;

  // Tenant scope is checked against the route context, never inferred from the
  // record the caller handed us.
  if (opportunity.organizationId !== input.organizationId) {
    return { outcome: "blocked", reason: "opportunity_not_in_organization" };
  }

  if (opportunity.status !== "proposed") {
    return { outcome: "blocked", reason: "opportunity_not_proposed" };
  }

  if (opportunity.actionKey !== CAMPAIGN_META_BUNDLE_ACTION_KEY) {
    return { outcome: "blocked", reason: "action_not_campaign" };
  }

  // An expired opportunity cannot be executed without reassessment, and
  // reassessment is a new decision rather than a revived row.
  if (opportunity.expiresAt.getTime() <= input.now.getTime()) {
    return { outcome: "blocked", reason: "opportunity_expired" };
  }

  // Assertions are what the Tool Gateway re-evaluates before any side effect.
  // A campaign with none could never be safely executed.
  if (opportunity.assertions.length === 0) {
    return { outcome: "blocked", reason: "assertions_missing" };
  }

  return {
    outcome: "qualified",
    source: { kind: "decision_opportunity", sourceId: opportunity.id },
    playbookVersionId: opportunity.playbookVersionId,
    decisionRecordId: opportunity.decisionRecordId,
    // Frozen copy: the campaign carries the assertions as they were at
    // qualification, not as the live row may later become.
    assertions: Object.freeze(
      opportunity.assertions.map((assertion) => Object.freeze({ ...assertion })),
    ),
  };
}
