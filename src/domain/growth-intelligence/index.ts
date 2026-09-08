export * from "@/domain/growth-intelligence/types";
export { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
export type { GrowthIntelligenceErrorCode } from "@/domain/growth-intelligence/errors";
export {
  marketProfileDocumentSchema,
  marketProfileDocumentV2Schema,
  marketProfileDocumentV1Schema,
} from "@/domain/growth-intelligence/schemas";
export {
  RESEARCH_BUDGET_LIMITS,
  RESEARCH_COVERAGE_OUTCOMES,
  RESEARCH_PIPELINE_STAGES,
  RESEARCH_PIPELINE_STAGE_DISPLAY,
  TERMINAL_RESEARCH_PIPELINE_STAGES,
  isTerminalPipelineStage,
  remainingRetryAttempts,
  researchAttemptUsageSchema,
  researchCoverageEntrySchema,
  resolvePipelineStageAfterResearch,
  sumKnownAttemptCost,
} from "@/domain/growth-intelligence/research-pipeline";
export type {
  ResearchAttemptUsage,
  ResearchAttemptUsageSummary,
  ResearchCoverageEntry,
  ResearchCoverageOutcome,
  ResearchCoverageSlotKind,
  ResearchPipelineStage,
} from "@/domain/growth-intelligence/research-pipeline";
export {
  RESEARCH_PROVIDER_BLOCKER_CODES,
  RESEARCH_PROVIDER_REQUIRED_USES,
  isResearchProviderQualified,
  isResearchSourceEligibleForSynthesis,
  renderResearchSourceState,
  researchAttemptReservationSchema,
  researchErasureReasonSchema,
  researchExcerptProvenanceSchema,
  researchProviderQualificationSchema,
  researchQuoteSchema,
  researchSupportReviewSchema,
  researchSupportVerdictSchema,
  researchWorkScopeSchema,
  settleResearchAttemptSchema,
  toResearchWorkScopeKey,
  validateResearchQuote,
} from "@/domain/growth-intelligence/research-budget";
export type {
  ResearchAttemptPhase,
  ResearchAttemptReservation,
  ResearchErasureReason,
  ResearchExcerptProvenance,
  ResearchProviderBlockerCode,
  ResearchProviderQualification,
  ResearchProviderRequiredUse,
  ResearchQuote,
  ResearchSourceAvailability,
  ResearchSourceEligibilityInput,
  ResearchSupportReview,
  ResearchSupportVerdict,
  ResearchWorkScope,
  ResearchWorkScopeKey,
  SettleResearchAttempt,
} from "@/domain/growth-intelligence/research-budget";
export { createMarketProfileDigest } from "@/domain/growth-intelligence/profile-digest";
export { createGrowthIntelligenceRequestFingerprint } from "@/domain/growth-intelligence/request-fingerprint";
export {
  classifyMarketEvidenceFreshness,
  classifyMarketEvidenceSupport,
  MARKET_EVIDENCE_FRESHNESS_REGISTRY_VERSION,
} from "@/domain/growth-intelligence/evidence-quality";
export { evaluateGeographicCompatibility } from "@/domain/growth-intelligence/geography";
export { validateSynthesisCandidate } from "@/domain/growth-intelligence/synthesis";
export type {
  EligibleSynthesisClaim,
  SynthesisCandidate,
  SynthesisValidationContext,
  SynthesisValidationReason,
  SynthesisValidationResult,
} from "@/domain/growth-intelligence/synthesis";
export {
  createGrowthIntelligenceItemFingerprint,
  createGrowthIntelligenceItemIdentity,
} from "@/domain/growth-intelligence/items";
export type {
  GrowthIntelligenceItemIdentity,
  GrowthIntelligenceItemInput,
} from "@/domain/growth-intelligence/items";
export {
  buildRecommendationPriority,
  compareRecommendationPriority,
  PRIORITY_RULE_VERSION,
} from "@/domain/growth-intelligence/priority";
export type {
  RecommendationPriority,
  RecommendationPriorityBand,
  RecommendationPriorityComponent,
  RecommendationPriorityInput,
} from "@/domain/growth-intelligence/priority";
export { classifyItemLineage } from "@/domain/growth-intelligence/lineage";
export type { ItemLineage } from "@/domain/growth-intelligence/lineage";
export {
  createMarketEvidenceMaterialFingerprint,
  hasMaterialMarketEvidenceChange,
} from "@/domain/growth-intelligence/material-change";
