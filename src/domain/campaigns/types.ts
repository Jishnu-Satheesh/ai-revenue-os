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

export { CampaignError } from "@/domain/campaigns/errors";
export type { CampaignErrorCode } from "@/domain/campaigns/errors";
