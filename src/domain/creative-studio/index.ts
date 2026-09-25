/**
 * The public Studio domain contracts. Every export here is pure: schemas,
 * admission rules and digests with no Node built-ins, so the browser can
 * read them (schema-only until Task 7) without breaking the client build.
 */

export {
  DEFAULT_ASPECT_PRESET,
  MAX_BRAND_MARKS,
  MAX_DESIGN_REFERENCES,
  MAX_PRODUCT_REFERENCES,
  MAX_STUDIO_MARKERS,
  STUDIO_ASPECT_PRESETS,
  STUDIO_ASPECT_PRESET_REGISTRY_VERSION,
  admitExactDesignPrimary,
  admitGenerationReferences,
  admitLogoSubstitutions,
  admitStudioMarkers,
  applySuggestion,
  aspectPresetSchema,
  channelLogoSubstitutionSchema,
  studioDraftSchema,
  studioMarkerSchema,
  studioModeSchema,
  studioPromptOperationSchema,
  studioReferenceSchema,
  studioSuggestionOperationSchema,
  studioSuggestionSchema,
  studioUsageSchema,
  validatePromptForOperation,
} from "@/domain/creative-studio/schemas";
export type {
  AspectPreset,
  ChannelLogoSubstitution,
  GenerationReferenceCode,
  LogoSubstitutionAdmission,
  LogoSubstitutionRefusalCode,
  MarkerAdmissionCode,
  PrimaryReferenceCode,
  PromptValidation,
  StudioDraft,
  StudioMarker,
  StudioMode,
  StudioPromptOperation,
  StudioReference,
  StudioSuggestion,
  StudioSuggestionOperation,
  StudioUsage,
  SuggestionApplication,
} from "@/domain/creative-studio/schemas";

export {
  admitStudioEdit,
  checkProviderCaps,
  studioPreviewMimeSchema,
  studioProviderOperationSchema,
  studioProviderProfileSchema,
  studioProviderRequestSchema,
} from "@/domain/creative-studio/provider";
export type {
  EditAdmissionCode,
  ProviderCapCode,
  ProviderContract,
  StudioEditContinuation,
  StudioPreviewMime,
  StudioProvider,
  StudioProviderEvent,
  StudioProviderOperation,
  StudioProviderProfile,
  StudioProviderRequest,
} from "@/domain/creative-studio/provider";

export {
  STUDIO_EPHEMERAL_STATES,
  STUDIO_PERSISTED_RUN_STATES,
  STUDIO_RUN_EVENTS,
  STUDIO_SAFE_FAILURE_CODES,
  StudioRunTransitionError,
  isTerminalRunState,
  toSafeFailure,
  transitionRunState,
} from "@/domain/creative-studio/events";
export type {
  StudioRunEvent,
  StudioRunState,
  StudioSafeFailure,
  StudioSafeFailureCode,
} from "@/domain/creative-studio/events";

export {
  recordRunCost,
  reserveStudioRun,
  studioGenerationPolicySchema,
} from "@/domain/creative-studio/policy";
export type {
  ReservationRefusalCode,
  StudioGenerationPolicy,
} from "@/domain/creative-studio/policy";

export {
  StudioSourceResolutionError,
  resolveDeliverableSource,
  selectStudioCampaignCreativeSchema,
  studioCampaignLinkStateSchema,
  studioSelectionIdentity,
} from "@/domain/creative-studio/campaign-link";
export type {
  SelectStudioCampaignCreative,
  StudioArtifact,
  StudioCampaignLinkState,
  StudioSourceResolutionReason,
} from "@/domain/creative-studio/campaign-link";

export {
  sha256HexBytes,
  sha256HexCanonical,
  sha256HexText,
  studioExportDigest,
  studioIdempotencyDigest,
  studioLogoSubstitutionDigest,
  studioPromptDigest,
  studioReferenceManifestDigest,
  studioTextCopyDigest,
} from "@/domain/creative-studio/digest";
