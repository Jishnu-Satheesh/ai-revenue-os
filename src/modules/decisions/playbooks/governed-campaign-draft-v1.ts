/**
 * The governed-draft playbook (spec 022 section 10.1): Tier 1, internal and
 * reversible. It creates a draft, never an external action, so it requires no
 * provider capabilities — only governed evidence. Missing provider mapping,
 * publishing permission, ad accounts, spend authorization, or tracking is
 * rechecked before Campaign approval and execution, never here.
 */

export const GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY = "campaign.governed_draft_v1" as const;

export type GovernedCampaignDraftPlaybookVersion = {
  playbookKey: string;
  semanticVersion: string;
  actionKey: typeof GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY;
  primaryMetricKey: string;
  guardrailMetricKeys: readonly string[];
  /** Empty on purpose: an internal draft calls no provider. */
  requiredCapabilityKeys: readonly string[];
  requiredEvidenceKeys: readonly string[];
  requiredImpactEvidenceKeys: readonly string[];
  requiredPolicyKeys: readonly string[];
  requiredMarginKeys: readonly string[];
  requiredMeasurementKeys: readonly string[];
  /** Tier 1 under `specs/010`: internal or reversible draft. */
  riskClass: 1;
  freshnessBoundMinutes: number;
  measurementWindowDays: number;
  prior: null;
  resurfaceCondition: { signalKey: string; threshold: number };
};

export const governedCampaignDraftPlaybookV1: GovernedCampaignDraftPlaybookVersion = Object.freeze({
  playbookKey: "campaign.governed_draft",
  semanticVersion: "1.0.0",
  actionKey: GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY,
  primaryMetricKey: "contribution.incremental_gross_profit",
  guardrailMetricKeys: Object.freeze(["spend.total", "contribution.margin_rate"]),
  requiredCapabilityKeys: Object.freeze([]),
  requiredEvidenceKeys: Object.freeze([
    "business_evidence_current",
    "market_support_primary_or_corroborated",
    "market_profile_approved_current",
    "active_goal_metric",
    "campaign_objective",
    "campaign_audience",
    "brand_guidance_current",
    "brand_assets_usable_or_synthetic_allowed",
    "evaluation_template_registered",
    "assertions_recheckable",
    "impact_qualified",
  ]),
  requiredImpactEvidenceKeys: Object.freeze([
    "impact.range",
    "impact.currency",
    "impact.source_revisions",
    "impact.observed_at",
    "impact.time_to_impact",
  ]),
  requiredPolicyKeys: Object.freeze([]),
  requiredMarginKeys: Object.freeze([]),
  requiredMeasurementKeys: Object.freeze(["evaluation_template_registered"]),
  riskClass: 1,
  freshnessBoundMinutes: 60 * 24 * 7,
  measurementWindowDays: 30,
  prior: null,
  resurfaceCondition: {
    signalKey: "contribution.incremental_gross_profit.delta_pct",
    threshold: 10,
  },
});
