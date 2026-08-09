import type {
  EmbeddingStatus,
  Freshness,
  MemoryLinkRelation,
  MemoryOrigin,
  PersistableMemoryType,
  RetrievalMode,
  Sensitivity,
  SourceTier,
  TrustRank,
  VerificationState,
} from "@/domain/memory/types";

/**
 * Provisional schema boundary for Business Memory tables.
 *
 * `pnpm db:types` needs a container runtime that is not available in this
 * workspace, so `src/lib/supabase/database.types.ts` predates the memory
 * migration. Keep these definitions local until it can be regenerated, exactly
 * as `src/modules/integrations/application/ports.ts` does.
 */
export type MemoryItemRow = {
  id: string;
  organization_id: string;
  branch_id: string | null;
  memory_type: PersistableMemoryType;
  title: string;
  body: string | null;
  structured_value: Record<string, unknown> | null;
  origin: MemoryOrigin;
  source_tier: SourceTier;
  source_system: string | null;
  source_reference: string | null;
  source_run_id: string | null;
  source_record_id: string | null;
  verification_state: VerificationState;
  confidence: number | null;
  sensitivity: Sensitivity;
  observed_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  review_due_at: string | null;
  expires_at: string | null;
  superseded_by_id: string | null;
  superseded_at: string | null;
  supersession_reason: string | null;
  rejection_reason: string | null;
  proposed_fact_key: string | null;
  proposed_fact_value: unknown;
  proposed_branch_id: string | null;
  embedding_model: string | null;
  embedding_status: EmbeddingStatus;
  embedding_updated_at: string | null;
  created_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The shape returned by `public.search_memory_items`. */
export type MemorySearchRow = {
  id: string;
  memory_type: PersistableMemoryType;
  title: string;
  body: string | null;
  structured_value: Record<string, unknown> | null;
  origin: MemoryOrigin;
  source_tier: SourceTier;
  source_system: string | null;
  source_reference: string | null;
  verification_state: VerificationState;
  verified_at: string | null;
  confidence: number | null;
  sensitivity: Sensitivity;
  observed_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  superseded_by_id: string | null;
  trust_rank: TrustRank;
  freshness: Freshness;
  lexical: number;
  semantic: number;
  blended: number;
};

export type BusinessFactRow = {
  id: string;
  organization_id: string;
  branch_id: string | null;
  fact_key: string;
  value: unknown;
  source: string;
  source_reference: string | null;
  status: "verified" | "imported" | "inferred" | "stale";
  confidence: number | null;
  effective_from: string | null;
  effective_to: string | null;
  last_verified_at: string | null;
  updated_at: string;
};

export type MemoryLinkRow = {
  id: string;
  organization_id: string;
  from_item_id: string;
  to_item_id: string;
  relation: MemoryLinkRelation;
  created_by: string | null;
  created_at: string;
};

export type MemorySearchParameters = {
  organizationId: string;
  query: string;
  queryEmbedding: readonly number[] | null;
  branchId?: string;
  memoryTypes?: readonly PersistableMemoryType[];
  sensitivities: readonly Sensitivity[];
  maxAgeDays?: number;
  includeSuperseded: boolean;
  includeExpired: boolean;
  lexicalWeight: number;
  semanticWeight: number;
  limit: number;
};

export type MemoryRetrievalLogInsert = {
  organization_id: string;
  purpose: string;
  actor_type: "user" | "system" | "ai";
  actor_id?: string | null;
  query_text?: string | null;
  retrieval_mode: RetrievalMode;
  degraded_reason?: string | null;
  requested_types?: readonly string[];
  sensitivity_allowance: Sensitivity;
  denied?: boolean;
  result_item_ids?: readonly string[];
  result_count: number;
  served_from_cache?: boolean;
  latency_ms?: number | null;
  correlation_id: string;
};

export type MemoryItemInsert = {
  organization_id: string;
  branch_id?: string | null;
  memory_type: PersistableMemoryType;
  title: string;
  body?: string | null;
  structured_value?: Record<string, unknown> | null;
  origin: MemoryOrigin;
  sensitivity: Sensitivity;
  verification_state: VerificationState;
  confidence?: number | null;
  observed_at?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  review_due_at?: string | null;
  expires_at?: string | null;
  created_by?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
};

export type MemoryItemStateUpdate = {
  verification_state?: VerificationState;
  verified_by?: string | null;
  verified_at?: string | null;
  rejection_reason?: string | null;
  sensitivity?: Sensitivity;
  review_due_at?: string | null;
  expires_at?: string | null;
  superseded_by_id?: string | null;
  superseded_at?: string | null;
  supersession_reason?: string | null;
  embedding_status?: EmbeddingStatus;
  title?: string;
  body?: string | null;
};

export type MemorySnapshotCounts = {
  byType: Readonly<Record<string, number>>;
  byVerificationState: Readonly<Record<string, number>>;
  bySensitivity: Readonly<Record<string, number>>;
  reviewQueueDepth: number;
  embeddingBacklog: number;
  total: number;
};

export type GoogleBusinessProfileProjectionWrite = {
  organizationId: string;
  ingestionRunId: string;
  sourceConnectionId: string;
  sourceSystem: "google_business_profile";
  sourceRecordId: string;
  branchId?: string;
  title: string;
  body: string | null;
  structuredValue: Record<string, unknown> | null;
  sensitivity: "internal" | "customer_content";
  observedAt: string;
  locationFactValues: Record<string, unknown>;
};

/**
 * Every method takes an authenticated `organizationId` and scopes by it. The
 * persistence implementation additionally runs under the caller's RLS context,
 * so a missing scope is a defence-in-depth failure rather than a leak.
 */
export type MemoryPersistencePort = {
  search(parameters: MemorySearchParameters): Promise<MemorySearchRow[]>;
  searchFacts(input: {
    organizationId: string;
    query: string;
    branchId?: string;
    limit: number;
  }): Promise<BusinessFactRow[]>;
  projectGoogleBusinessProfileRecord(input: GoogleBusinessProfileProjectionWrite): Promise<void>;
  hydrateByIds(input: {
    organizationId: string;
    ids: readonly string[];
    sensitivities: readonly Sensitivity[];
    includeSuperseded: boolean;
    includeExpired: boolean;
  }): Promise<MemoryItemRow[]>;
  getItem(input: { organizationId: string; itemId: string }): Promise<MemoryItemRow | null>;
  listTimeline(input: {
    organizationId: string;
    sensitivities: readonly Sensitivity[];
    branchId?: string;
    limit: number;
    before?: string;
  }): Promise<MemoryItemRow[]>;
  listByTypes(input: {
    organizationId: string;
    sensitivities: readonly Sensitivity[];
    memoryTypes: readonly PersistableMemoryType[];
    verificationStates?: readonly VerificationState[];
    limit: number;
  }): Promise<MemoryItemRow[]>;
  listLinks(input: {
    organizationId: string;
    itemIds: readonly string[];
  }): Promise<MemoryLinkRow[]>;
  insertItem(input: MemoryItemInsert): Promise<MemoryItemRow>;
  updateItem(input: {
    organizationId: string;
    itemId: string;
    patch: MemoryItemStateUpdate;
  }): Promise<MemoryItemRow>;
  insertLinks(input: {
    organizationId: string;
    links: readonly Omit<MemoryLinkRow, "id" | "created_at">[];
  }): Promise<void>;
  insertRetrievalLog(input: MemoryRetrievalLogInsert): Promise<void>;
  countsFor(input: { organizationId: string }): Promise<MemorySnapshotCounts>;
};
