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
  SUBJECT_PROFILE_STATES,
  campaignBundleModelManifestSchema,
  campaignBundleManifestSchema,
  campaignBundleSchema,
  campaignChannelActionSchema,
  campaignMeasurementPlanSchema,
  creativeDirectionSchema,
  moneySchema,
  subjectProfileSchema,
} from "@/domain/campaigns/schemas";

export type {
  CampaignAsset,
  CampaignAssetTruthClass,
  CampaignBundleManifest,
  CampaignBundleModelManifest,
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
  SubjectProfile,
  SubjectProfileState,
} from "@/domain/campaigns/schemas";

export {
  ASSET_OWNERSHIPS,
  CONDITIONING_ROLES,
  CORE_CREATIVE_REVIEW_REASON_CODES,
  CREATIVE_REVIEW_REASON_CODES,
  CREATIVE_REVIEW_SUBJECT_KINDS,
  CREATIVE_REVIEW_VERDICTS,
  ISO_15924_SCRIPT_CODE_PATTERN,
  REFERENCE_MODES,
  REFERENCE_RESOLUTION_OUTCOMES,
  REFERENCE_RESOLUTION_REFUSAL_CODES,
  RESTAURANT_CREATIVE_REVIEW_REASON_CODES,
  assetOwnershipSchema,
  assetTagComparisonKey,
  assetTagSchema,
  assetTagsMatch,
  assetTagsSchema,
  conditioningRoleSchema,
  creativeAssetReviewSchema,
  creativeReviewReasonCodeSchema,
  creativeReviewSubjectKindSchema,
  creativeReviewVerdictSchema,
  namesByScriptSchema,
  normalizeAssetTag,
  referenceModeSchema,
  referenceResolutionOutcomeSchema,
  referenceResolutionRefusalCodeSchema,
  scriptCodeSchema,
  subjectExclusionsSchema,
} from "@/domain/campaigns/asset-library";
export type {
  AssetOwnership,
  ConditioningRole,
  CreativeAssetReview,
  CreativeReviewReasonCode,
  CreativeReviewVerdict,
  ReferenceMode,
  ReferenceResolutionOutcome,
  ReferenceResolutionRefusalCode,
  ScriptCode,
} from "@/domain/campaigns/asset-library";

export { bundleDigest, canonicalManifestJson } from "@/domain/campaigns/digest";
export { normalizeManifest } from "@/domain/campaigns/normalization";
export { diffManifests } from "@/domain/campaigns/digest";
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
