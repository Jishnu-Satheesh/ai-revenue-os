/**
 * Governed Business Memory public boundary (Spec 023). No feature imports
 * another feature's internals: consumers reach context assembly, retrieval,
 * and erasure only through these explicit named exports.
 */

export {
  buildBusinessFactSummary,
  buildBusinessProfileSummary,
  buildCampaignVersionSummary,
  buildCaptureEventSummary,
  buildConstraintSummary,
  buildContextCanonicalText,
  buildGoalSummary,
  buildMemoryItemSummary,
  capSummary,
  charLength,
  CONTEXT_MAX_BYTES,
  CONTEXT_MAX_ENTRIES,
  CONTEXT_OBSERVATIONS_AI_CAP,
  CONTEXT_POLICY_VERSION_DEFAULT,
  CONTEXT_SCHEMA_VERSION,
  CONTEXT_SECTION_BUDGETS,
  CONTEXT_SECTION_CANDIDATE_LIMIT,
  CONTEXT_SUMMARY_MAX_CHARS,
  contextConsumerKinds,
  contextExclusionCodes,
  contextPurposes,
  contextSourceKinds,
  contextStatementKinds,
  contextStatuses,
  escapeContextText,
  pgJsonbText,
  purposesForConsumerKind,
  utf8ByteLength,
} from "@/domain/memory/context";
export type {
  ContextConsumerKind,
  ContextEntry,
  ContextExclusionCode,
  ContextPack,
  ContextPurpose,
  ContextRequest,
  ContextRequestInput,
  ContextSection,
  ContextSourceKind,
  ContextStatementKind,
  ContextStatus,
} from "@/domain/memory/context";

export { selectContextCandidates } from "@/modules/memory/application/context-selection";
export type {
  ContextCandidate,
  ContextSelection,
} from "@/modules/memory/application/context-selection";

export {
  groupBySection,
  renderContextPack,
  serializeForModel,
} from "@/modules/memory/application/context-renderer";

export { assembleContextPack, computeContextDigest } from "@/modules/memory/application/context-service";

export { createContextRepository } from "@/modules/memory/infrastructure/context-repository";
export type {
  ConsumedContext,
  ContextEntryInput,
  ContextRepository,
  PreparedContext,
  RevalidatedContext,
} from "@/modules/memory/infrastructure/context-repository";

export {
  applyBranchOverrides,
  createSupabaseCurrentStateQuery,
  labelEqualAuthorityConflicts,
  readCurrentState,
} from "@/modules/memory/infrastructure/current-state-reader";
export type {
  BusinessFactView,
  BusinessProfileView,
  ConstraintView,
  CurrentState,
  CurrentStateQuery,
  GoalView,
  LabeledFact,
} from "@/modules/memory/infrastructure/current-state-reader";
