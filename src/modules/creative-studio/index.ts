/**
 * The supported Studio module surface.
 *
 * Browser applicability is schema-only until Task 7: this index re-exports
 * the pure domain contracts (schemas, admission rules, digests) and nothing
 * else — no adapters, no worker code, no Node built-ins. The client-boundary
 * suite pins that split, so a future server-only helper cannot slip in
 * unnoticed. Named exports only: adding a name here is a supported-contract
 * decision, not an accident of `export *`.
 */

export {
  DEFAULT_ASPECT_PRESET,
  STUDIO_ASPECT_PRESETS,
  STUDIO_ASPECT_PRESET_REGISTRY_VERSION,
  STUDIO_EPHEMERAL_STATES,
  STUDIO_PERSISTED_RUN_STATES,
  STUDIO_RUN_EVENTS,
  STUDIO_SAFE_FAILURE_CODES,
  admitExactDesignPrimary,
  admitGenerationReferences,
  admitLogoSubstitutions,
  admitStudioEdit,
  admitStudioMarkers,
  applySuggestion,
  aspectPresetSchema,
  channelLogoSubstitutionSchema,
  checkProviderCaps,
  isTerminalRunState,
  recordRunCost,
  reserveStudioRun,
  resolveDeliverableSource,
  selectStudioCampaignCreativeSchema,
  studioCampaignLinkStateSchema,
  studioDraftSchema,
  studioExportDigest,
  studioGenerationPolicySchema,
  studioIdempotencyDigest,
  studioLogoSubstitutionDigest,
  studioMarkerSchema,
  studioModeSchema,
  studioPromptDigest,
  studioPromptOperationSchema,
  studioProviderOperationSchema,
  studioProviderProfileSchema,
  studioProviderRequestSchema,
  studioReferenceManifestDigest,
  studioReferenceSchema,
  studioSuggestionOperationSchema,
  studioSuggestionSchema,
  studioTextCopyDigest,
  studioUsageSchema,
  toSafeFailure,
  transitionRunState,
  validatePromptForOperation,
} from "@/domain/creative-studio";

export {
  StudioRunTransitionError,
  StudioSourceResolutionError,
} from "@/domain/creative-studio";

export type {
  AspectPreset,
  ChannelLogoSubstitution,
  ProviderCapCode,
  ReservationRefusalCode,
  SelectStudioCampaignCreative,
  StudioArtifact,
  StudioCampaignLinkState,
  StudioDraft,
  StudioEditContinuation,
  StudioGenerationPolicy,
  StudioMarker,
  StudioMode,
  StudioPromptOperation,
  StudioProvider,
  StudioProviderEvent,
  StudioProviderOperation,
  StudioProviderProfile,
  StudioProviderRequest,
  StudioReference,
  StudioRunEvent,
  StudioRunState,
  StudioSafeFailure,
  StudioSafeFailureCode,
  StudioSuggestion,
  StudioSuggestionOperation,
  StudioUsage,
  SuggestionApplication,
} from "@/domain/creative-studio";

export {
  deliverableRenderInputsUnionSchema,
  studioFullPosterRenderInputsSchema,
} from "@/domain/campaigns/deliverable";
export type {
  DeliverableSource,
  StudioFullPosterRenderInputs,
  StudioVersionSource,
} from "@/domain/campaigns/deliverable";
