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
  posterPlanSchema,
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
  CampaignPosterPlan,
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

export {
  AVOID_REFERENCE_LIMIT,
  NEGATIVE_RULE_LIMIT,
  POSITIVE_REFERENCE_LIMIT,
  REFERENCE_SLOT_CAPS,
  RESOLVER_VERSION,
  TYPOGRAPHY_SCRIPT_LIMIT,
  ReferenceResolutionError,
  avoidReferenceSchema,
  negativeRuleSchema,
  referenceCandidateSchema,
  referenceResolutionInputSchema,
  referenceResolutionRequestSchema,
  referenceResolutionSchema,
  resolveReferences,
  resolvedReferenceSlotSchema,
  reviewReasonRegistryEntrySchema,
} from "@/domain/campaigns/reference-resolution";
export type {
  AvoidReference,
  NegativeRule,
  ReferenceCandidate,
  ReferenceResolution,
  ReferenceResolutionErrorCode,
  ReferenceResolutionInput,
  ReferenceResolutionRequest,
  ResolvedReferenceSlot,
} from "@/domain/campaigns/reference-resolution";

export { artDirectionBlueprintSchema } from "@/domain/campaigns/art-direction";
export type { ArtDirectionBlueprint } from "@/domain/campaigns/art-direction";

export {
  TruthClassDerivationError,
  deriveGeneratedTruthClass,
} from "@/domain/campaigns/truth-class";
export type { GeneratedAssetTruthClass } from "@/domain/campaigns/truth-class";

export {
  POSTER_TEMPLATE_OWNER_SCOPES,
  POSTER_TEMPLATE_STATES,
  POSTER_TEXT_ALIGNMENTS,
  POSTER_TEXT_SLOTS,
  RENDERABLE_SCRIPTS,
  posterLayoutSchema,
  posterTemplateSchema,
  posterTextBoxSchema,
  renderableScriptSchema,
} from "@/domain/campaigns/poster-template";
export type {
  PosterLayout,
  PosterTemplate,
  PosterTextAlignment,
  PosterTextBox,
  PosterTextSlot,
  RenderableScript,
} from "@/domain/campaigns/poster-template";

export { resolvePosterSlots, templateAvailability } from "@/domain/campaigns/poster-slots";
export type {
  PosterSlotAbsenceReason,
  PosterSlotInput,
  PosterSlotResolution,
  PosterSlotSource,
  PosterTemplateAvailability,
  ResolvedPosterSlot,
} from "@/domain/campaigns/poster-slots";

export { candidateFontSizes, fitTextToBox } from "@/domain/campaigns/text-fitting";
export type { TextFitOutcome, TextMeasure } from "@/domain/campaigns/text-fitting";

export {
  SHAPING_CONTROL_CODEPOINTS,
  describeCodepoint,
  findUncoveredGlyphs,
} from "@/domain/campaigns/glyph-coverage";
export type {
  GlyphCoverageOracle,
  GlyphCoverageProblem,
  PosterTextValue,
} from "@/domain/campaigns/glyph-coverage";

export { renderDigest } from "@/domain/campaigns/render-digest";
export type { RenderInputs } from "@/domain/campaigns/render-digest";

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
