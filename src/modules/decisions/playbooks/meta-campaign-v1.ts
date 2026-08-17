import { z } from "zod";

/**
 * One playbook, one action.
 *
 * Decision Engine V1 selects exactly one action per decision. A campaign is
 * therefore a single selected action whose parameters describe the bundle the
 * Campaign module will later compile. The three creative directions — control,
 * evidence-led, experimental — are alternatives *inside* that compiled bundle,
 * never additional Decision Engine candidates. Admitting them here would make
 * propensity the probability of a set rather than of an action, and the
 * counterfactual for any single direction uninterpretable.
 *
 * The platform core stays industry-neutral: an Industry Pack may supply the
 * objective wording and evidence requirements, but no industry concept appears
 * in this action.
 */
export const CAMPAIGN_META_BUNDLE_ACTION_KEY = "campaign.meta_bundle_v1" as const;

const moneySchema = z.strictObject({
  amountMinor: z.number().int(),
  currency: z.string().trim().min(1).max(3),
});

/**
 * `strictObject` keeps this an exact contract. A parameter nobody declared is
 * a defect, and a differently-parameterised proposal over the same subject must
 * be a genuinely different candidate rather than a repeat.
 */
export const campaignActionParametersSchema = z.strictObject({
  objective: z.string().trim().min(1).max(500),
  channels: z.array(z.enum(["instagram", "facebook"])).min(1),
  placements: z.array(z.enum(["feed_image", "image_story"])).min(1),
  // Required, never optional. A media action with no configured budget has an
  // unbounded cost, which is `needs_data` rather than a zero.
  spendCeiling: moneySchema,
  measurementMethod: z.enum(["reconciliation", "provider_experiment"]),
  executionMode: z.enum(["best_effort", "all_channels_required"]),
  constraints: z.array(z.string().trim().min(1)),
});

export type CampaignActionParameters = z.infer<typeof campaignActionParametersSchema>;

export type CampaignPlaybookVersion = {
  playbookKey: string;
  semanticVersion: string;
  actionKey: typeof CAMPAIGN_META_BUNDLE_ACTION_KEY;
  primaryMetricKey: string;
  guardrailMetricKeys: readonly string[];
  requiredCapabilityKeys: readonly string[];
  requiredEvidenceKeys: readonly string[];
  requiredImpactEvidenceKeys: readonly string[];
  requiredPolicyKeys: readonly string[];
  requiredMarginKeys: readonly string[];
  requiredMeasurementKeys: readonly string[];
  /** Tier 3 under `specs/010`: public organic publishing plus paid media. */
  riskClass: 0 | 1 | 2 | 3 | 4;
  freshnessBoundMinutes: number;
  measurementWindowDays: number;
  prior: null;
  resurfaceCondition: { signalKey: string; threshold: number };
};

export const metaCampaignPlaybookV1: CampaignPlaybookVersion = Object.freeze({
  playbookKey: "campaign.meta_bundle",
  semanticVersion: "1.0.0",
  actionKey: CAMPAIGN_META_BUNDLE_ACTION_KEY,
  primaryMetricKey: "contribution.incremental_gross_profit",
  guardrailMetricKeys: Object.freeze(["spend.total", "contribution.margin_rate"]),
  // Declared, not granted. Each is currently blocked on the Meta provider
  // definition, so a candidate cannot pass screening today.
  requiredCapabilityKeys: Object.freeze([
    "publish_instagram",
    "publish_facebook",
    "advertise_meta_ads",
  ]),
  requiredEvidenceKeys: Object.freeze([
    "organization_profile_current",
    "brand_constraints_verified",
    "brand_assets_usable_or_synthetic_allowed",
    "economics_configured",
    "active_goal_metric",
    "meta_account_mapped",
    "action_capabilities_granted",
    "spend_policy_configured",
    "tracking_ready",
    "inputs_fresh",
    "impact.range",
    "impact.currency",
    "impact.source_revisions",
    "impact.observed_at",
    "impact.time_to_impact",
    "policy.access.active",
    "policy.spend.active",
    "margin.firewall.pass",
    "measurement.tracking_ready",
    "measurement.plan_registered",
  ]),
  requiredImpactEvidenceKeys: Object.freeze([
    "impact.range",
    "impact.currency",
    "impact.source_revisions",
    "impact.observed_at",
    "impact.time_to_impact",
  ]),
  requiredPolicyKeys: Object.freeze(["policy.access.active", "policy.spend.active"]),
  requiredMarginKeys: Object.freeze(["margin.firewall.pass"]),
  requiredMeasurementKeys: Object.freeze([
    "measurement.tracking_ready",
    "measurement.plan_registered",
  ]),
  riskClass: 3,
  freshnessBoundMinutes: 24 * 60,
  measurementWindowDays: 7,
  // No synthetic prior: absent governed impact evidence remains needs_data.
  prior: null,
  // A named signal with a threshold, declared here rather than inferred at
  // runtime, so resurfacing stays a checkable predicate.
  resurfaceCondition: Object.freeze({
    signalKey: "contribution.incremental_gross_profit.delta_pct",
    threshold: 10,
  }),
});
