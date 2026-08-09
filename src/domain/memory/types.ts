/**
 * The Business Memory vocabulary. These unions are the shared language for the
 * domain, the database check constraints, and the retrieval contract, so a
 * value added here must be added to the migration in the same change.
 *
 * This module has no server-only dependency: the browser imports it to label
 * results and to hide controls a role cannot use. Enforcement lives in the
 * service, the routes, and RLS.
 */

/**
 * `structured_fact` is virtual. It is never a row in `memory_items` — a check
 * constraint forbids it — and is produced at read time by projecting
 * `business_facts`, which remains the single writable source of truth.
 *
 * `fact_proposal` is a pending change to the digital twin rather than
 * knowledge, so it is excluded from ordinary retrieval and appears only in the
 * review queue.
 */
export const memoryTypes = [
  "structured_fact",
  "document",
  "note",
  "episode",
  "decision",
  "outcome",
  "lesson",
  "fact_proposal",
] as const;

export type MemoryType = (typeof memoryTypes)[number];

/** Memory types that may be persisted. See ADR 0011. */
export const persistableMemoryTypes = memoryTypes.filter(
  (memoryType): memoryType is Exclude<MemoryType, "structured_fact"> =>
    memoryType !== "structured_fact",
);

export type PersistableMemoryType = (typeof persistableMemoryTypes)[number];

/** The write path that produced an item. */
export const memoryOrigins = [
  "user_verified",
  "provider_imported",
  "system_generated",
  "ai_proposed",
  "outcome_learned",
] as const;

export type MemoryOrigin = (typeof memoryOrigins)[number];

/** Origins a model may produce. These can never be written as `verified`. */
export const modelAuthoredOrigins: readonly MemoryOrigin[] = ["ai_proposed", "outcome_learned"];

export const verificationStates = ["proposed", "unverified", "verified", "rejected"] as const;

export type VerificationState = (typeof verificationStates)[number];

/** Ordered by increasing restriction. The order is load-bearing; do not sort it. */
export const sensitivities = ["public", "internal", "confidential", "customer_content"] as const;

export type Sensitivity = (typeof sensitivities)[number];

export const freshnessStates = ["fresh", "aging", "stale", "superseded", "expired"] as const;

export type Freshness = (typeof freshnessStates)[number];

/** The precedence rank from `context/09-business-memory.md`, 1 strongest. */
export const sourceTiers = [1, 2, 3, 4, 5] as const;

export type SourceTier = (typeof sourceTiers)[number];

/** The ordering key. 0 is most trustworthy. See spec section 6.7. */
export const trustRanks = [0, 1, 2, 3, 4] as const;

export type TrustRank = (typeof trustRanks)[number];

export const memoryPurposes = [
  "decision_context",
  "opportunity_generation",
  "outcome_analysis",
  "operator_search",
  "onboarding_assist",
] as const;

export type MemoryPurpose = (typeof memoryPurposes)[number];

export const memoryLinkRelations = ["derived_from", "supports", "contradicts", "explains"] as const;

export type MemoryLinkRelation = (typeof memoryLinkRelations)[number];

export const embeddingStatuses = ["pending", "ready", "failed", "skipped"] as const;

export type EmbeddingStatus = (typeof embeddingStatuses)[number];

export const retrievalModes = ["hybrid", "lexical"] as const;

export type RetrievalMode = (typeof retrievalModes)[number];

export const degradedReasons = [
  "EMBEDDING_UNAVAILABLE",
  "EMBEDDING_TIMEOUT",
  "EMBEDDING_NOT_CONFIGURED",
] as const;

export type DegradedReason = (typeof degradedReasons)[number];

/** Provenance as it appears on a retrieval result. Never carries a raw payload. */
export type MemoryProvenance = {
  origin: MemoryOrigin;
  sourceTier: SourceTier;
  sourceSystem?: string;
  sourceReference?: string;
  verificationState: VerificationState;
  verifiedAt?: string;
  confidence?: number;
};
