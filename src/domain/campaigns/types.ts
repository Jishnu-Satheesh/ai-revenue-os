/**
 * The Campaign Bundle domain's public surface.
 *
 * Everything a caller outside `src/domain/campaigns` needs comes through here,
 * so the internal split between schema, normalization, digest, diff, state, and
 * policy stays free to move without a rewrite at every call site.
 */

export {
  ASSET_TRUTH_CLASSES,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_GENERATION_PROFILES,
  CAMPAIGN_PLACEMENTS,
  CREATIVE_DIRECTION_KINDS,
  campaignBundleManifestSchema,
  campaignBundleSchema,
  campaignChannelActionSchema,
  campaignMeasurementPlanSchema,
  creativeDirectionSchema,
  moneySchema,
} from "@/domain/campaigns/schemas";

export type {
  CampaignAsset,
  CampaignAssetTruthClass,
  CampaignBundleManifest,
  CampaignChannel,
  CampaignChannelAction,
  CampaignCopy,
  CampaignCreativeDirection,
  CampaignGenerationProfile,
  CampaignHashtagSet,
  CampaignMeasurementPlan,
  CampaignMoney,
  CampaignPlacement,
  CreativeDirectionKind,
} from "@/domain/campaigns/schemas";

export { bundleDigest, canonicalManifestJson } from "@/domain/campaigns/digest";
export { normalizeManifest } from "@/domain/campaigns/normalization";
export { diffManifests } from "@/domain/campaigns/diff";
export type { CampaignDiff, CampaignDiffChange } from "@/domain/campaigns/diff";

export { evaluateContentPolicy, effectiveProfile } from "@/domain/campaigns/content-policy";
export type {
  ChannelContentLimits,
  ContentPolicyInput,
  ContentPolicyViolation,
} from "@/domain/campaigns/content-policy";

export {
  CAMPAIGN_STATES,
  allowedTransitions,
  approvalStatus,
  assertTransition,
  canTransition,
  isTerminal,
} from "@/domain/campaigns/state-machine";
export type {
  ApprovalRow,
  ApprovalStatus,
  ApprovalSubject,
  CampaignState,
} from "@/domain/campaigns/state-machine";

export {
  campaignPermissions,
  hasCampaignPermission,
  rolesWith,
} from "@/domain/campaigns/permissions";
export type { CampaignPermission } from "@/domain/campaigns/permissions";

export {
  CAMPAIGN_VARIANT_STATES,
  campaignCreativeVariantSchema,
} from "@/domain/campaigns/variants";
export type { CampaignCreativeVariant, CampaignVariantState } from "@/domain/campaigns/variants";

export { checkVariantDerivation, variantContentHash } from "@/domain/campaigns/derivation";
export type {
  VariantDerivationFailure,
  VariantDerivationInput,
  VariantDerivationResult,
  VariantEvidence,
} from "@/domain/campaigns/derivation";

export { CampaignError } from "@/domain/campaigns/errors";
export type { CampaignErrorCode } from "@/domain/campaigns/errors";

export {
  ALLOCATION_RULE_KEYS,
  ALLOCATION_RULE_VERSIONS,
  evaluateVariant,
} from "@/domain/campaigns/allocation";
export type {
  AllocationAction,
  AllocationDecision,
  AllocationEvaluationInput,
  AllocationRuleThresholds,
  ResolvedMargin,
  ResolvedMarginGrade,
  VariantDiagnostics,
} from "@/domain/campaigns/allocation";

export {
  assessGuardrail,
  computeVerdict,
  meetsEvidenceTier,
  validateOutcomeWording,
  OVERCLAIM_PATTERNS,
} from "@/domain/campaigns/measurement";
export type {
  AttributionMethod,
  CampaignVerdict,
  Estimate,
  EvidenceTier,
  ExposureReconstruction,
  GuardrailAssessment,
  GuardrailState,
  MetricObservation,
  Outcome,
  RegisteredMeasurementPlan,
  TruncationCause,
  TruncationCauseKind,
  VerdictInput,
  WordingViolation,
} from "@/domain/campaigns/measurement";
