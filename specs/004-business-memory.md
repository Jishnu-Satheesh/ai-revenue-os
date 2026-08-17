# Feature Specification: Business Memory

**Status:** Approved product and architecture design; implementation not started

**Primary user:** Agency operator, plus every platform worker that needs organizational context

**Route:** `/organizations/[organizationId]/memory`

**Package manager:** **pnpm** (`pnpm@11.20.0`); do not use npm or Yarn

**Depends on:** `specs/001-organization-digital-twin.md`, `specs/003-integration-hub.md`, ADR 0011

## 1. Business outcome

Give every organization a durable, explainable context store so the platform stops rediscovering the same facts, preferences, mistakes, and outcomes. Workers and operators retrieve trustworthy organizational context with visible provenance, and lessons learned from real outcomes survive across runs, sessions, and worker versions.

Success is measured by retrieval that a human can audit — correct provenance, correct precedence, correct exclusions — not by the number of memories stored.

## 2. V1 objective

Deliver the smallest production-complete Business Memory vertical slice:

- A tenant-scoped memory store for episodic, semantic, decision, outcome, and lesson items.
- Read-through access to authoritative structured facts without copying them.
- Five governed write paths: user verified, provider imported, system generated, AI proposed with user confirmation, and outcome learning.
- Hybrid retrieval combining deterministic lexical search and pgvector semantic search, with a lexical-only degrade path.
- Deterministic trust ordering that no relevance score can override.
- Supersession, expiry, sensitivity classification, and freshness derivation.
- A Hub-scale operator workspace for search, timeline, lessons, and review.
- Replacement of the Integration Hub's acknowledging ingestion stub for Google Business Profile record types.
- A Redis caching layer that stores rankings rather than content, invalidates on every write, and degrades to direct reads.

The slice must prove that retrieved context is attributable and governable before the Decision Engine consumes it.

## 3. Scope

### 3.1 Included

- `memory_items`, `memory_links`, `memory_retrieval_log`, and the embedding columns that support them.
- Memory types `document`, `note`, `episode`, `decision`, `outcome`, `lesson`, and `fact_proposal`.
- The virtual memory type `structured_fact`, served exclusively by read-through projection over `business_facts`.
- Provenance, source tier, verification state, confidence, sensitivity, effective dates, review dates, and supersession.
- A server-only `MemoryRetrievalPort` for workers and an authenticated HTTP surface for the workspace.
- An `EmbeddingProvider` port, asynchronous embedding through Trigger.dev, and deterministic degrade when embedding is unavailable.
- Projection of `google_business_profile.location.v1` and `google_business_profile.review.v1` into memory items and fact proposals.
- A four-tab memory workspace built from installed shadcn/ui primitives.
- A `MemoryCache` port with a Redis adapter, version-counter invalidation, and a daily rebuild task.
- Tenant isolation at both application and database boundaries.

### 3.2 Explicitly excluded from V1

- Memory ownership of authoritative facts. `business_facts` remains the single source of truth; see ADR 0011.
- Read-through projection of `goals`, `constraints`, and `policies`. The Decision Engine reads those directly as authoritative inputs.
- Projection of `csv_import.row`. The projector rejects it with `UNSUPPORTED_RECORD_TYPE`; see section 10.4.
- `NormalizedMetric`, `Signal`, and any time-series aggregation. Those belong to the Data Ingestion slice.
- Procedural memory: playbooks, worker versions, and learned execution patterns.
- Cross-organization retrieval, benchmarks, or shared lessons of any kind.
- Automatic deletion of memory. Expiry excludes an item from retrieval; it does not remove the row.
- Model-authored writes that bypass confirmation for anything at or above `internal` sensitivity.
- Re-ranking models, query rewriting, and retrieval-augmented generation orchestration.
- Caching item content, query text, or anything the cache could use to answer a question Postgres would have refused. The cache stores rankings and aggregates only; see section 12.
- Any behavior whose correctness depends on the daily rebuild having run.

## 4. Product principles

- Provenance travels with every result. A retrieval result that cannot explain where it came from is a defect.
- Trust ordering is structural, not statistical. Relevance breaks ties inside a trust tier; it never crosses one.
- An inference never overwrites a verified fact. It proposes, and a human confirms.
- Superseded and expired knowledge is excluded by default and recoverable on request.
- Sensitivity is assigned on write, enforced on read, and never inferred by a model.
- Degraded retrieval is announced, not hidden. Lexical-only results say so.
- Memory is additive. Correcting a memory supersedes it; it does not erase the record.
- The minimum necessary content reaches a model prompt.
- Every cache is disposable. Deleting all of it must change latency and nothing else.

## 5. Users and permissions

Application services must evaluate permissions in addition to relying on RLS.

| Action | Allowed organization roles |
| --- | --- |
| Search and read non-sensitive memory, timeline, lessons | owner, admin, operator, viewer |
| Read `confidential` or `customer_content` memory | owner, admin |
| Create a note or document memory | owner, admin, operator |
| Verify or reject a proposed item | owner, admin, operator |
| Confirm a fact proposal into the digital twin | owner, admin, operator |
| Supersede an item | owner, admin, operator |
| Write provider-imported, system-generated, and outcome-learned memory | validated background worker only |

Required permission names are `memory.read`, `memory.read_sensitive`, `memory.write`, `memory.verify`, `memory.supersede`, and `memory.promote_fact`. Services consume permission checks; UI code must not scatter role comparisons. The permission vocabulary and role map live in a dependency-free module the browser may import, exactly as `src/domain/integrations/permissions.ts` does.

## 6. Domain language

### 6.1 Memory type

`structured_fact`, `document`, `note`, `episode`, `decision`, `outcome`, `lesson`, `fact_proposal`.

`structured_fact` is virtual: it is never a row in `memory_items` and a check constraint enforces that. It is produced at read time by projecting `business_facts`.

`fact_proposal` is a pending change to the digital twin, not knowledge. It is excluded from ordinary retrieval and appears only in the review queue.

### 6.2 Origin

The write path that produced the item: `user_verified`, `provider_imported`, `system_generated`, `ai_proposed`, `outcome_learned`.

### 6.3 Source tier

The precedence rank from `context/09-business-memory.md`, derived deterministically from origin, verification state, memory type, and review date, and never set by a caller:

| Tier | Meaning |
| --- | --- |
| 1 | Explicitly verified current user input |
| 2 | Direct provider or system-of-record data |
| 3 | Recent approved documents |
| 4 | Historical imported data |
| 5 | Model inference |

The evaluation order is part of the rule, not an implementation detail. Checks run top to bottom in decreasing authority, and the first match wins:

1. `verificationState` is `verified` → tier 1. Human confirmation outranks how the item was produced; a model proposal a person confirmed is verified knowledge.
2. Origin is `ai_proposed` or `outcome_learned` → tier 5. Unconfirmed model output is inference regardless of what it describes. This is checked before the document and provider branches so a model-authored document is never promoted to an approved document.
3. Origin is `user_verified` → tier 1. Direct user input is tier 1 even before confirmation, because the source is a person stating something about their own business.
4. `memoryType` is `document` → tier 3.
5. Origin is `provider_imported` → tier 4 when `review_due_at` is in the past, otherwise tier 2.
6. Otherwise → tier 2.

Ordering rules 1 and 4 conflict if read as an unordered table: a confirmed document satisfies both. Rule 1 wins, so tier 3 holds documents that are present and approved but not individually confirmed. Implemented in `src/domain/memory/trust.ts`.

### 6.4 Verification state

`proposed`, `unverified`, `verified`, `rejected`.

- `proposed`: awaiting human confirmation. Excluded from default retrieval.
- `unverified`: recorded but not human-confirmed. Included, ranked below verified.
- `verified`: a permitted role confirmed it. `verified_by` and `verified_at` are required.
- `rejected`: a human declined it. Excluded from all retrieval; retained for audit.

### 6.5 Sensitivity

`public`, `internal`, `confidential`, `customer_content`, in increasing restriction. Assigned on write by deterministic classification rules, never by a model.

### 6.6 Freshness

Derived at read time, never stored, in this priority order:

1. `expired` when `expires_at` is in the past, or `effective_to` is in the past.
2. `superseded` when `superseded_by_id` is set.
3. `stale` when `review_due_at` is in the past.
4. `aging` when `review_due_at` is within seven days.
5. `fresh` otherwise.

Items that are `expired`, `superseded`, or `rejected` are excluded from default retrieval. A caller may request them explicitly and receives them labelled.

### 6.7 Trust rank

The single integer that governs ordering, derived from verification state and source tier:

| Trust rank | Condition |
| --- | --- |
| 4 | `proposed` or `rejected`, at any source tier |
| 0 | `verified` and source tier 1 |
| 1 | `verified` and any other source tier |
| 1 | `unverified` and source tier 1 |
| 2 | `unverified` and source tier 2 |
| 3 | `unverified` and source tier 3 or 4 |
| 4 | `unverified` and source tier 5 |

The function is total across every combination, including ones the write paths should make unreachable. `proposed` and `rejected` are pinned to the lowest rank as a second line of defence: they are already excluded from retrieval, and if an exclusion is ever missed they must not be able to outrank real knowledge.

`unverified` at source tier 1 is direct user input awaiting confirmation. It ranks below verified input but above provider data, which is why tier 1 alone does not imply rank 0.

Retrieval sorts by ascending trust rank first, then descending blended relevance, then descending `observed_at`, then ascending `id`. The last key exists so two otherwise identical results always sort the same way, which is what lets a cached ranking and a freshly computed one be byte-identical. This ordering makes "verified facts rank above inferences" a structural guarantee that no embedding score, lexical score, or weight change can violate. Implemented in `src/domain/memory/trust.ts`.

## 7. Core entities

Every tenant-owned table includes `organization_id uuid not null`, forced RLS, explicit authenticated grants, and indexes for foreign keys and policy predicates. All timestamps use `timestamptz` in UTC.

### 7.1 `MemoryItem`

Required fields:

- `id`
- `organization_id`
- `branch_id` nullable
- `memory_type`
- `title`
- `body` — bounded text, at most 8000 characters
- `structured_value` jsonb nullable — bounded, used by `fact_proposal` and `outcome`
- `origin`
- `source_tier` smallint 1..5
- `source_system` nullable — for example `google_business_profile`
- `source_reference` nullable — opaque connection or data-source identifier
- `source_run_id` nullable — the `ingestion_runs` identifier that produced it
- `source_record_id` nullable — the provider `externalRecordId`
- `verification_state`
- `confidence` numeric(5,4) nullable, 0..1
- `sensitivity`
- `observed_at` nullable — when the described thing happened
- `effective_from` and `effective_to` nullable
- `review_due_at` and `expires_at` nullable
- `superseded_by_id` nullable, `superseded_at` nullable, `supersession_reason` nullable
- `proposed_fact_key`, `proposed_fact_value`, `proposed_branch_id` — nullable, `fact_proposal` only
- `search_vector` generated `tsvector`
- `embedding` `extensions.vector(1536)` nullable
- `embedding_model` nullable, `embedding_status`, `embedding_updated_at` nullable
- `created_by`, `verified_by`, `verified_at`, `created_at`, `updated_at`

Rules:

- `memory_type <> 'structured_fact'` is a check constraint.
- `(organization_id, source_system, source_record_id)` is unique where `source_record_id is not null`, making re-sync idempotent.
- `source_tier` is computed by the application from origin and verification state; a client-supplied value is ignored.
- A non-null `branch_id` uses the composite foreign key `(organization_id, branch_id)` against `branches`, so an item can never reference another organization's branch.
- `superseded_by_id` uses a composite tenant-safe foreign key. An item may not supersede itself, and supersession chains are depth-limited to 32 at write time.
- `verified_by` and `verified_at` are both null or both set, enforced by a check constraint.
- `fact_proposal` requires `proposed_fact_key` and `proposed_fact_value`; every other type requires both to be null.
- `embedding_status` is `pending`, `ready`, `failed`, or `skipped`. Superseded, expired, and rejected items are `skipped`.
- `body` is stored as provided but is treated as untrusted content in every downstream use.

### 7.2 `MemoryLink`

Relates items so a lesson can name the episodes it came from.

Required fields: `id`, `organization_id`, `from_item_id`, `to_item_id`, `relation`, `created_by`, `created_at`.

Rules:

- `relation` is `derived_from`, `supports`, `contradicts`, or `explains`.
- `(organization_id, from_item_id, to_item_id, relation)` is unique.
- Both endpoints use composite tenant-safe foreign keys; cross-organization links are impossible at the database level.
- `from_item_id <> to_item_id`.

### 7.3 `MemoryRetrievalLog`

Append-only record of what was retrieved, so a later answer can be explained.

Required fields: `id`, `organization_id`, `purpose`, `actor_type`, `actor_id` nullable, `query_text` truncated to 500 characters, `retrieval_mode`, `degraded_reason` nullable, `requested_types`, `sensitivity_allowance`, `result_item_ids` uuid array bounded to 50, `result_count`, `latency_ms`, `correlation_id`, `created_at`.

Rules:

- Append-only; no update or delete policy exists.
- `query_text` is truncated and never contains a credential or a raw provider payload.
- Retrieval that returns nothing is still logged.

### 7.4 Read-through structured facts

`business_facts` is unchanged. The projection maps each row to a retrieval result:

| Memory field | Source |
| --- | --- |
| `memoryType` | `structured_fact` |
| `title` | `fact_key` |
| `structuredValue` | `value` |
| `origin` | `user_verified` when status is `verified`, otherwise `provider_imported` |
| `verificationState` | `verified` when status is `verified`, `unverified` when `imported` or `inferred`, and the item is treated as `stale` when status is `stale` |
| `sourceTier` | 1 for `verified`, 2 for `imported`, 5 for `inferred` |
| `confidence` | `confidence` |
| `effectiveFrom` / `effectiveTo` | `effective_from` / `effective_to` |
| `sensitivity` | `internal` |

Structured facts participate in lexical ranking over `fact_key` and the text content of `value`. They are not embedded in V1; their semantic score is zero and their trust rank carries them.

## 8. Database and tenancy requirements

- Use an imperative Supabase migration created with `supabase migration new business_memory`; do not invent a migration timestamp.
- Install pgvector with `create extension if not exists vector with schema extensions;` and reference the type as `extensions.vector(1536)` in DDL so the column definition does not depend on the caller's `search_path`.
- Index `search_vector` with GIN. Index `embedding` with HNSW using `vector_cosine_ops`.
- Index every foreign key, every `organization_id` RLS predicate, `(organization_id, memory_type, created_at desc)` for the timeline, `(organization_id, verification_state)` filtered to `proposed` for the review queue, and `(organization_id, embedding_status)` filtered to `pending` for the embedding worker.
- Add `(organization_id, id)` uniqueness where composite tenant-safe foreign keys require it.
- Enable and force RLS on all three new tables.
- `SELECT` is available to organization members; the sensitivity boundary is enforced in the application service and in a policy predicate, not in the application alone. Rows at `confidential` or `customer_content` are selectable only by members holding owner or admin roles.
- Mutations require owner/admin/operator membership. `UPDATE` policies require both `USING` and tenant-preserving `WITH CHECK` clauses.
- `memory_retrieval_log` grants `INSERT` and `SELECT` only. No `UPDATE` or `DELETE` policy exists.
- Reuse `private.is_organization_member` and `private.has_organization_role`; wrap `auth.uid()` in `select` inside RLS helpers.
- Grant only required table operations to `authenticated`; grant nothing to `anon`.
- Background workers may use privileged credentials only after validating `organizationId` and only through repositories that scope every query by organization.
- User-facing routes must not use a service-role client to bypass RLS.
- Migration verification must include Supabase database lint and advisors, missing-foreign-key-index checks, and two-tenant pgTAP coverage that includes the sensitivity boundary.

## 9. Retrieval

### 9.1 Contract

```ts
type MemoryPurpose =
  | "decision_context"
  | "opportunity_generation"
  | "outcome_analysis"
  | "operator_search"
  | "onboarding_assist";

type MemoryRetrievalQuery = {
  organizationId: string;
  branchId?: string;
  purpose: MemoryPurpose;
  query: string;
  memoryTypes?: readonly MemoryType[];
  sensitivityAllowance: Sensitivity;
  maxAgeDays?: number;
  includeSuperseded?: boolean;
  includeExpired?: boolean;
  limit: number;
  correlationId: string;
};

type MemoryRetrievalResult = {
  itemId: string | null;
  memoryType: MemoryType;
  title: string;
  body?: string;
  structuredValue?: unknown;
  provenance: {
    origin: Origin;
    sourceTier: 1 | 2 | 3 | 4 | 5;
    sourceSystem?: string;
    sourceReference?: string;
    verificationState: VerificationState;
    verifiedAt?: string;
    confidence?: number;
  };
  trustRank: 0 | 1 | 2 | 3 | 4;
  freshness: "fresh" | "aging" | "stale" | "superseded" | "expired";
  observedAt?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sensitivity: Sensitivity;
  scores: { lexical: number; semantic: number; blended: number };
};

type MemoryRetrievalResponse = {
  results: readonly MemoryRetrievalResult[];
  retrievalMode: "hybrid" | "lexical";
  degradedReason?: "EMBEDDING_UNAVAILABLE" | "EMBEDDING_TIMEOUT" | "EMBEDDING_NOT_CONFIGURED";
  serverTime: string;
};

type MemoryRetrievalPort = {
  retrieve(query: MemoryRetrievalQuery): Promise<MemoryRetrievalResponse>;
};
```

`itemId` is null only for projected structured facts, which carry `sourceReference` pointing at the `business_facts` row instead.

### 9.2 Ordering

1. Filter by organization, then by branch scope, type, sensitivity allowance, freshness requirement, and exclusion rules. Organization filtering happens in SQL before any similarity computation.
2. Compute `lexical` with `ts_rank_cd` over `search_vector` and `semantic` as `1 - cosine_distance` over `embedding`, each normalized to 0..1.
3. Compute `blended = 0.5 * lexical + 0.5 * semantic` in hybrid mode and `blended = lexical` in lexical mode.
4. Sort by ascending `trustRank`, then descending `blended`, then descending `observed_at`, then ascending `id` for total determinism.
5. Truncate to `limit`, capped at 50.

The weights are the only tunable numbers, and they are constants in versioned TypeScript with a test asserting that no weight assignment can reorder trust ranks.

### 9.3 Sensitivity gating

- A query may not exceed its purpose's ceiling. The purpose-to-ceiling map is a constant table in TypeScript; a caller cannot raise its own ceiling.
- `operator_search` inherits the caller's role ceiling: `internal` for operator and viewer, `customer_content` for owner and admin.
- Worker purposes default to `internal`. `outcome_analysis` may reach `confidential`. No purpose reaches `customer_content` in V1.
- A request whose `sensitivityAllowance` exceeds its ceiling is rejected with `MEMORY_SENSITIVITY_DENIED`. It is not silently downgraded, and the denial is logged.

### 9.4 Degrade path

Because hybrid retrieval ships enabled with no rollout gate, the embedding call in the read path is the one external dependency that can fail. It is bounded and non-fatal:

- The query embedding call has a 1500 ms timeout and no retry.
- On timeout, provider error, or missing configuration, retrieval proceeds lexically, sets `retrievalMode: "lexical"`, sets `degradedReason`, and records both in the retrieval log.
- A degraded retrieval is never presented as complete. The workspace shows an inline `Alert`, and worker callers receive the mode in the response so a decision record can state it.
- Items whose `embedding_status` is not `ready` still match lexically. Semantic absence never hides an item.

## 10. Write paths

### 10.1 User verified

An operator creates a note or document through the workspace. Origin `user_verified`, verification state `verified`, source tier 1, `verified_by` and `verified_at` set to the acting user and server time. Sensitivity is chosen by the operator from the four values with inline explanation of each.

### 10.2 Provider imported

The Integration Hub sync worker hands validated envelopes to the sink, which now reaches a real projector. See section 10.4.

### 10.3 System generated and outcome learned

Platform workers write `episode` and `outcome` items with origin `system_generated` or `outcome_learned`, verification state `unverified`, and a required `source_run_id`. An outcome item must carry a `structured_value` containing baseline, measured value, unit, and attribution window, because AGENTS.md forbids declaring business impact without them.

### 10.4 Ingestion projection

`createAcknowledgingDataIngestionPort` is deleted and replaced by `createMemoryProjectionPort`, which routes by `recordType`:

| Record type | Projection |
| --- | --- |
| `google_business_profile.location.v1` | One `episode` item summarizing the observed location profile, plus one `fact_proposal` per tracked field whose observed value differs from the current `business_facts` value |
| `google_business_profile.review.v1` | One `episode` item at `customer_content` sensitivity with `observed_at` set to the review time |
| `csv_import.row` | Rejected with `UNSUPPORTED_RECORD_TYPE` |
| anything else | Rejected with `UNSUPPORTED_RECORD_TYPE` |

Rules:

- Tracked location fields in V1 are `google_business_profile.location.hours`, `.primary_category`, `.address`, and `.phone`. No other field produces a proposal.
- The projector never writes `business_facts`. It only proposes. Promotion happens through the digital-twin service after human confirmation, which preserves the source hierarchy and existing validation.
- A proposal that duplicates an open proposal for the same `(organization, branch, fact_key)` updates that proposal rather than creating a second one.
- Reviewer display names are stripped before storage. The item retains an opaque `source_record_id` only.
- Projection is idempotent on `(organization_id, source_system, source_record_id)`. Re-running a sync updates the existing item and does not duplicate it.
- Rejections return safe reasons and counts; they never silently succeed.

**Known consequence:** CSV imports currently report every row as accepted because the stub acknowledges everything. After this change they will report `accepted: 0` with `UNSUPPORTED_RECORD_TYPE` rejections. That is the honest state — the rows were validated but stored nowhere — and the Data sources tab must say so in plain copy: *"Rows validated. Business Memory V1 stores Google Business Profile records only; CSV storage arrives with Data Ingestion."* Presenting the previous silent success would violate the prohibition on implying work occurred when it did not.

### 10.5 AI proposed and user confirmed

- A model may only produce `proposed` items. A check on the service layer rejects any AI-origin write at `verified`.
- Every AI-proposed item requires `confidence`, a `source_run_id`, and at least one `derived_from` link to the evidence it came from. An unsupported proposal is rejected at write time.
- Proposed items are invisible to retrieval until confirmed.
- Confirming an `episode`, `lesson`, or `outcome` sets `verified`, `verified_by`, `verified_at`, and recomputes trust rank.
- Confirming a `fact_proposal` calls the digital-twin service to write `business_facts` inside one transaction with the proposal's state change, then emits `memory.fact_promoted`.
- Rejecting sets `rejected` with a required reason and excludes the item permanently.

### 10.6 Supersession

Correcting knowledge inserts a new item and marks the old one superseded in one transaction: `superseded_by_id`, `superseded_at`, `supersession_reason`, and a `supersedes` link. The superseded item keeps its row, its provenance, and its audit trail, and its `embedding_status` becomes `skipped`.

## 11. Embedding

```ts
type EmbeddingProvider = {
  readonly model: string;
  readonly dimensions: number;
  embed(input: {
    organizationId: string;
    correlationId: string;
    texts: readonly string[];
  }): Promise<readonly (readonly number[])[]>;
};
```

- The column is fixed at 1536 dimensions. Changing the embedding model to a different dimensionality requires a migration, not a configuration change; `embedding_model` is stored on every row so a mismatch is detectable.
- Writes never block on embedding. An item is created with `embedding_status: 'pending'` and becomes lexically retrievable immediately.
- `memory.embed-items` batches pending items, bounded to 64 per run, with bounded retry and a terminal `failed` state after exhaustion. A `failed` item is retrievable lexically and is reported in observability.
- Content changes and supersession reset or skip the embedding.
- `customer_content` items are embedded. Google reviews are already public provider content, and reviewer identity is stripped before storage. No other sensitivity class changes embedding behavior.
- The embedding text is `title` plus `body`, truncated to the provider's limit. `structured_value` is not embedded.

## 12. Caching and invalidation

Redis is a derived, disposable projection. Postgres remains the only source of business state, and RLS remains the only enforcement of who may read a row. A cache that can answer a question the database would have refused is a tenancy defect, not a performance optimization.

### 12.1 What is cached, and what never is

| Cached | Never cached |
| --- | --- |
| Ranked result identifiers with their `lexical`, `semantic`, and `blended` scores | `title`, `body`, `structured_value`, or any item content |
| Query embeddings, keyed by model and content hash | Raw query text |
| Organization snapshot aggregates: counts by type, origin, verification state, and sensitivity class; review-queue depth; embedding backlog | Retrieval log rows |
| The organization cache version counter | Anything derived from a `business_facts` value |

The rule that makes this safe: **the cache stores the ranking, never the content.** A search hit returns identifiers, and the rows are then hydrated from Postgres by primary key under the caller's own RLS context. Three properties follow, and all three are load-bearing:

- Customer content, confidential bodies, and provider text never leave the RLS boundary for a store with no tenant isolation.
- An item superseded, rejected, expired, or made invisible since the entry was written disappears at hydration, so a stale ranking cannot resurrect excluded knowledge.
- A cached ranking produced for one role cannot expose a row to another role, because the hydrating query is the one that enforces visibility.

Hydration by primary key over an indexed lookup is cheap. What the cache removes is the expensive part: the external embedding round-trip and the hybrid scan with its HNSW probe, GIN match, and read-through fact merge.

### 12.2 Cache port

```ts
type MemoryCache = {
  getRanking(key: CacheKey): Promise<CachedRanking | null>;
  setRanking(key: CacheKey, value: CachedRanking, ttlSeconds: number): Promise<void>;
  getEmbedding(model: string, contentHash: string): Promise<readonly number[] | null>;
  setEmbedding(model: string, contentHash: string, vector: readonly number[]): Promise<void>;
  getSnapshot(organizationId: string): Promise<CachedSnapshot | null>;
  setSnapshot(organizationId: string, value: CachedSnapshot, ttlSeconds: number): Promise<void>;
  invalidateOrganization(organizationId: string): Promise<void>;
  withRebuildLock<T>(organizationId: string, run: () => Promise<T>): Promise<T | null>;
};

type CachedRanking = {
  itemIds: readonly string[];
  factReferences: readonly string[];
  scores: readonly { lexical: number; semantic: number; blended: number }[];
  retrievalMode: "hybrid" | "lexical";
  builtAt: string;
};
```

The port is the seam. `REDIS_URL` is a server-only environment variable, never prefixed with `NEXT_PUBLIC_`, and its absence is a supported state: with no URL configured the factory returns `null` and every read path runs directly against Postgres. The V1 adapter targets a TCP client with a module-level singleton connection. A serverless deployment target should swap the adapter for an HTTP client rather than change any caller.

### 12.3 Key namespace and version-counter invalidation

```
mem:{organizationId}:ver                                        -> epoch milliseconds
mem:{organizationId}:{version}:search:{ceiling}:{filterHash}:{queryHash}
mem:{organizationId}:{version}:snapshot
emb:{model}:{sha256(text)}
lock:mem:{organizationId}:rebuild
```

Rules:

- **The sensitivity ceiling is part of the key.** A ranking computed under an admin's `customer_content` ceiling must never be served to an operator whose ceiling is `internal`, even though hydration would filter it. Omitting the ceiling from the key is a privilege-escalation bug.
- Branch scope, memory types, freshness bounds, and the inclusion flags all feed `filterHash`. Two queries that differ in any filter are different keys.
- Invalidation bumps `mem:{organizationId}:ver` to the current epoch in milliseconds. It never scans or deletes key ranges; `KEYS` and unbounded `SCAN` are prohibited. Superseded entries expire on their own TTL and are unreachable the moment the version moves.
- The version is a timestamp, not a counter, specifically so eviction is safe. A missing version key is read as the current server time, which is strictly greater than every version used before it, so an evicted counter produces a miss rather than resurrecting entries written under a reused number. An `INCR`-based counter would reset to 1 after eviction and could collide with live keys; do not use one.
- Every write path invalidates: item creation, verification, rejection, supersession, proposal confirmation, fact promotion, ingestion projection, embedding completion, and the expiry sweep.
- The embedding key contains a content hash, not the text, so nothing readable is recoverable from the cache. The value is a vector and nothing else.

### 12.4 Cached retrieval

1. Resolve the caller's effective ceiling, then build the cache key. A request that fails sensitivity gating is rejected before the cache is consulted; a denial is never cached.
2. On an embedding-cache hit, skip the external embedding call entirely. This is the largest latency win and it removes the read path's only external dependency for repeated queries.
3. On a ranking hit, hydrate rows from Postgres under the caller's RLS context, drop anything that no longer qualifies, and return the result with `servedFromCache: true` and the entry's `builtAt`.
4. On a miss, run the full retrieval, then write the ranking with a 60-second TTL. The short TTL is a backstop, not the primary mechanism; writes invalidate through the version.
5. Rankings are cached only for `operator_search` and worker purposes with bounded, repeating queries. A one-off query still populates the entry, but the short TTL keeps the working set small.
6. Every retrieval is logged to `memory_retrieval_log` whether or not it was served from cache. The cache must not create a blind spot in the audit trail.

### 12.5 Organization snapshot and the daily rebuild

The workspace snapshot is aggregate-only and safe to precompute. The Trigger.dev scheduled task `memory.rebuild-organization-cache` runs daily and:

- Iterates organizations in bounded batches with a concurrency cap, staggered by a hash of the organization ID so a single instant does not stampede the database.
- Takes `lock:mem:{organizationId}:rebuild` with a bounded expiry, and skips an organization already being rebuilt.
- Skips organizations with no memory items.
- Recomputes snapshot aggregates and writes them under the current version with a 300-second live TTL plus a warmed copy.
- Warms the embedding cache for the recurring worker purposes only. It must not embed arbitrary historical operator queries, which would spend real money on text nobody will ask for again.
- Runs after `memory.expire-items` so the aggregates reflect the overnight expiry sweep.
- Emits counts, durations, and failures. A failure for one organization must not abort the batch.

The daily cadence earns its place for one specific reason: freshness derives from wall-clock time, so aggregates rot with no write to invalidate them. Write-driven invalidation cannot catch the passage of midnight. The rebuild is a warm-and-repair pass over that drift.

The rebuild is explicitly **not** the invalidation mechanism, and a cache entry is never allowed to outlive a write. Any design in which correctness depends on the cron having run is wrong.

### 12.6 Degrade behavior

The cache follows the same rule as embedding: it is an optimization that may vanish without breaking correctness.

- No `REDIS_URL` configured, a connection failure, a timeout, or a malformed entry all degrade to a direct Postgres read.
- Cache operations are bounded at 250 ms and never retried inside a request.
- A cache write failure is logged and swallowed. It never fails the user's request.
- A malformed or schema-mismatched entry is discarded, not repaired.
- Responses carry `servedFromCache` and `builtAt` so the workspace and a decision record can state where an answer came from.

### 12.7 Cache security requirements

- The cache instance is private and network-isolated. It is not exposed publicly and not shared with another environment; a staging cache must never share a namespace with production.
- Never write item content, query text, credentials, provider payloads, reviewer names, or audit payloads to Redis.
- Never use Redis to answer a question Postgres would have refused. Hydration under RLS is mandatory, not an optimization to be removed later.
- The organization ID and sensitivity ceiling are both required key components. A key missing either is a defect.
- Cache state is not business state. No domain event is emitted for a cache write, hit, miss, or rebuild; these are observability signals only.
- Flushing the entire cache must be safe at any moment, and a test asserts that a cold cache produces results identical to a warm one.

## 13. API surface

All inputs and responses have colocated Zod schemas and typed public errors.

| Method and route | Purpose |
| --- | --- |
| `GET /api/organizations/:organizationId/memory` | Workspace snapshot: counts by type and state, review-queue size, recent items, retrieval health |
| `POST /api/organizations/:organizationId/memory/search` | Ranked retrieval with provenance and retrieval mode |
| `GET /api/organizations/:organizationId/memory/timeline` | Episodic items ordered by `observed_at`, cursor paginated |
| `POST /api/organizations/:organizationId/memory/items` | Create a note or document |
| `PATCH /api/organizations/:organizationId/memory/items/:itemId` | Verify, reject, or edit sensitivity and review date |
| `POST /api/organizations/:organizationId/memory/items/:itemId/supersede` | Insert a replacement and supersede transactionally |
| `POST /api/organizations/:organizationId/memory/proposals/:itemId/confirm` | Confirm a proposal; promotes a fact proposal into the digital twin |
| `POST /api/organizations/:organizationId/memory/proposals/:itemId/reject` | Reject with a required reason |

Search is a `POST` because its body carries a structured query, not because it mutates. It is idempotent and must not be given a mutation idempotency key. Every other mutation request includes `idempotencyKey`.

## 14. Events and audit

Required events, using the repository event envelope:

- `memory.item_created`
- `memory.item_verified`
- `memory.item_rejected`
- `memory.item_superseded`
- `memory.proposal_created`
- `memory.proposal_confirmed`
- `memory.fact_promoted`
- `memory.embedding_failed`

Payloads carry opaque identifiers, type, origin, verification state, sensitivity class, and counts. They never carry `body`, `structured_value`, query text, or customer content.

Creation, verification, rejection, supersession, fact promotion, and every denied sensitive retrieval append immutable `audit_events` with safe identifiers and before/after state.

## 15. Trigger.dev tasks

- `memory.embed-items` — batch embed pending items.
- `memory.reembed-item` — re-embed after a content change.
- `memory.expire-items` — scheduled sweep that sets `embedding_status: 'skipped'` on newly expired items and emits nothing else; freshness itself stays derived.
- `memory.rebuild-organization-cache` — daily scheduled warm-and-repair pass over snapshot aggregates and recurring-purpose embeddings, ordered after `memory.expire-items`; see section 12.5.

Every task requires organization ID, correlation ID, idempotency key, timeout, bounded retry, cancellation support, and an explicit terminal state. Trigger.dev is an executor, not the source of business state.

## 16. User experience

### 16.1 Information architecture

The memory workspace has four tabs at `/organizations/[organizationId]/memory`:

1. **Search** — default. Query field, type/sensitivity/freshness/verification filters, ranked results grouped by trust rank with a visible rank label, retrieval-mode indicator, and an empty state that distinguishes "no memory yet" from "no match".
2. **Timeline** — episodic items by `observed_at` descending, filterable by source system and branch, with cursor pagination.
3. **Lessons** — `lesson`, `decision`, and `outcome` items with their `derived_from` evidence links expanded inline.
4. **Review** — proposed items and fact proposals with confirm and reject actions, showing the proposed value against the current digital-twin value side by side.

A detail `Sheet` shows full provenance, the supersession chain, links, embedding status, and the verify, supersede, and reject actions.

### 16.2 shadcn/ui requirement

All user-facing controls compose installed shadcn/ui primitives. Bare HTML controls in feature code are prohibited. `Tabs` for the four views, full `Card` composition for results and detail, `StatusBadge` for trust rank and freshness, `Badge` for sensitivity, `Alert` for degraded retrieval, `Empty` for the three empty states, `Skeleton` for initial loading, `Sheet` for detail, `AlertDialog` for reject and supersede, `Field` primitives with TanStack Form for the note and supersede forms, `Separator` instead of raw rules, and Sonner for mutation results. Add missing primitives with `pnpm dlx shadcn@latest add <component>`.

### 16.3 Server and client state

- React Server Components own authenticated initial reads.
- TanStack Query v5 owns interactive client server-state with organization-scoped keys such as `['organizations', organizationId, 'memory', 'search', queryHash]`.
- Mutations use targeted invalidation. No optimistic verification, promotion, or supersession state.
- TanStack Form v1 with Zod owns the note, supersede, and reject forms.
- Server data must not be copied into a global client store.

### 16.4 Required states

Every tab supports initial loading, empty, no-match, permission denied, sensitive-content withheld, degraded retrieval, background refetch without blanking, mutation pending, partial success, and recoverable failure.

Status never relies on color alone; trust rank and freshness each carry a text label. Focus moves to the result summary after a search and to the error summary after a failed submission. The page targets WCAG 2.2 AA and remains usable at 200% zoom and keyboard-only.

## 17. Errors and recovery

| Condition | Public behavior |
| --- | --- |
| Authorization or tenant mismatch | Return `AUTHORIZATION_ERROR` or `TENANT_SCOPE_ERROR`; perform no work |
| Sensitivity ceiling exceeded | Return `MEMORY_SENSITIVITY_DENIED`; return no rows and log the denial |
| Embedding unavailable | Return lexical results with `retrievalMode: "lexical"` and a reason |
| Embedding permanently failed for an item | Keep the item lexically retrievable; surface `failed` in the workspace and metrics |
| AI write attempts `verified` | Return `MEMORY_VERIFICATION_FORBIDDEN`; write nothing |
| Proposal confirm loses a race | Return the terminal state; never double-promote a fact |
| Supersession cycle or depth exceeded | Return `MEMORY_SUPERSESSION_INVALID`; write nothing |
| Unsupported ingestion record type | Reject with `UNSUPPORTED_RECORD_TYPE` and a visible count |
| Retrieval returns nothing | Return an empty result set and log it; never fabricate context |
| Cache unavailable, timed out, or malformed | Read directly from Postgres; log and continue; never fail the request |
| Cache write fails | Swallow after logging; the response is already correct without it |
| Cached identifiers no longer qualify at hydration | Drop them silently from the result and increment the hydration drop metric |
| Rebuild lock already held | Skip that organization for this run; never block or double-rebuild |

No error path may silently discard an event, mark uncertain data verified, or imply an external change occurred when it did not.

## 18. Security requirements

- Verify the authenticated session, organization membership, permission, route organization ID, and body entity organization before every mutation.
- Filter by organization in SQL before similarity computation. A vector index must never be searched across tenants and then filtered in application code.
- Never trust item IDs, branch IDs, fact keys, or idempotency keys from the client without a tenant-scoped lookup.
- Do not use JWT `user_metadata` for authorization.
- Treat `body`, `structured_value`, and every provider-derived string as untrusted content. Never interpolate them into a prompt without the delimiting and provenance labelling the AI coding standards require.
- Strip reviewer names and other unnecessary customer PII before storage.
- Never place credentials, tokens, or raw provider responses in memory items, events, retrieval logs, or audit payloads.
- Redact query text beyond 500 characters and never log full result bodies.
- Never let the cache answer a question Postgres would have refused. Cached rankings are hydrated under the caller's RLS context, and the sensitivity ceiling is part of every cache key.
- Never write item content, query text, credentials, provider payloads, or reviewer names to Redis. Keep the cache instance private, network-isolated, and unshared across environments.
- Review Supabase advisors, RLS, function privileges, vector index behavior, and cache key composition before enabling this feature in staging.

## 19. Observability

Structured logs include `organizationId`, `itemId` where relevant, `purpose`, `retrievalMode`, `degradedReason`, `servedFromCache`, `resultCount`, `latencyMs`, `correlationId`, and `workerId` when available.

Track:

- Retrieval latency split by lexical and hybrid mode, and by cache hit and miss.
- Ranking, embedding, and snapshot cache hit rates.
- Cache errors, timeouts, and degrade-to-Postgres count.
- Hydration drop rate: entries whose cached identifiers no longer qualify, which is the early warning that invalidation is failing.
- Daily rebuild duration, organizations processed, skipped, and failed.
- Degrade rate and degrade reason distribution.
- Result count distribution and empty-result rate.
- Items by type, origin, verification state, and sensitivity.
- Review-queue depth and time to confirmation.
- Embedding backlog, failure count, and age of the oldest pending item.
- Fact promotions and rejections.
- Sensitivity denials by purpose.

Never use memory titles, bodies, query text, or customer content as metric dimensions.

## 20. Feature rollout

Business Memory ships without an organization allowlist, and hybrid retrieval ships enabled. This is a deliberate departure from the Integration Hub's `INTEGRATION_HUB_V1_ORGANIZATION_IDS` pattern. The consequences are accepted explicitly:

- The degrade path in section 9.4 replaces the kill switch. Retrieval must never hard-fail because an external embedding provider is unavailable.
- Provider-imported memory only appears for organizations that already reached the Hub, which remains allowlisted, so ingestion exposure is bounded by that gate rather than by a new one.
- `EmbeddingProvider` configuration is absent by default. With no key configured, the system runs lexical-only and reports `EMBEDDING_NOT_CONFIGURED` rather than erroring.
- `REDIS_URL` is likewise optional. With no cache configured, every read path runs directly against Postgres and the daily rebuild task no-ops. The cache is a latency optimization and never a correctness dependency.

## 21. Testing requirements

### 21.1 Unit tests

- Trust-rank derivation across every verification state and source tier combination.
- A property test asserting no weight assignment reorders trust ranks.
- Freshness derivation priority, including the expired-before-superseded ordering.
- Source-tier derivation from origin, including the verified override.
- Purpose-to-ceiling gating, including the operator role ceiling and the refusal to silently downgrade.
- Sensitivity classification rules.
- Supersession cycle and depth rejection.
- Projection routing, tracked-field selection, and reviewer-name stripping.
- Degrade behavior on embedding timeout, error, and missing configuration.
- AI-origin write rejection at `verified`, and proposal-without-evidence rejection.
- Cache key composition: two callers with different sensitivity ceilings, branch scopes, or filters never collide on one key.
- Version bumping on every write path, and the missing-version-key path resolving to server time rather than to zero.
- Cache degrade on unavailable, timed-out, and malformed entries.

### 21.2 Database and repository tests

- RLS read and write isolation across two organizations for all three tables.
- The sensitivity boundary: an operator cannot select a `confidential` or `customer_content` row through RLS, not merely through the service.
- Viewer read-only behavior and operator mutation behavior.
- Tenant-safe composite foreign keys for `branch_id`, `superseded_by_id`, and both link endpoints.
- The `structured_fact` check constraint.
- The `(organization_id, source_system, source_record_id)` uniqueness constraint under re-sync.
- `memory_retrieval_log` has no update or delete path.
- Authenticated grants exist and anonymous table privileges are zero.
- Every foreign key has a supporting index; the GIN and HNSW indexes exist and are used by the retrieval query plan.
- Organization filtering precedes vector search in the executed plan.

### 21.3 Worker and integration tests

- Projection of both Google record types end to end from a fixture sync, including proposal creation and idempotent re-sync.
- `csv_import.row` rejection with correct counts and reasons surfacing in the ingestion run.
- Fact promotion writes `business_facts` and the proposal state in one transaction, and a failed write rolls both back.
- Embedding backlog processing, bounded retry, and terminal failure.
- Retrieval against a seeded corpus asserts that a verified item outranks a semantically closer inference.
- **Cold cache equals warm cache.** The same query against an empty cache and a populated cache returns byte-identical results. This is the single test that proves the cache is an optimization.
- An item superseded, rejected, or expired after a ranking was cached is absent from the next cached hit, proving hydration filters rather than trusting the entry.
- An admin-ceiling ranking is never served to an operator, asserted at the key level and again at hydration.
- A flush of the entire cache mid-suite changes no result.
- The daily rebuild is idempotent, honors the lock, skips empty organizations, and survives a single-organization failure without aborting the batch.

### 21.4 Component and end-to-end tests

- Four tabs at desktop and narrow viewports with loading, empty, no-match, and background-refetch states.
- A degraded search shows the alert and still lists results.
- A viewer cannot see mutation controls or call mutation APIs.
- An operator cannot see a `customer_content` item; an admin can.
- Confirming a fact proposal updates the digital twin and removes the item from the queue.
- Supersession keeps the old item visible under an explicit toggle.
- Trust rank and freshness are understandable without color.

### 21.5 Required commands

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Also run Supabase migration reset and pgTAP tests when Docker is available, remote database lint and advisors against staging, and Chrome DevTools UI verification before declaring implementation complete.

## 22. Acceptance criteria

1. Cross-tenant retrieval fails closed: a member of one organization can never retrieve, link, or supersede another organization's memory through the API, the port, or SQL.
2. A verified item outranks an inference for the same query even when the inference has a strictly higher lexical and semantic score.
3. Superseded, expired, and rejected items are excluded by default and returned labelled only on explicit request.
4. `confidential` and `customer_content` memory requires an explicit capability; a request above its ceiling is denied, logged, and returns no rows rather than a downgraded set.
5. Every retrieval result exposes origin, source tier, verification state, confidence, timestamps, and freshness.
6. A worker can store a lesson or outcome without altering any authoritative fact; `business_facts` changes only through confirmed promotion.
7. A Google Business Profile fixture sync produces memory items and fact proposals, and re-running it produces no duplicates.
8. An unsupported record type is rejected with a visible count and honest operator copy; no run reports storage that did not happen.
9. An AI-origin write cannot create a `verified` item, and a proposal without evidence links is rejected.
10. Confirming a fact proposal updates the digital twin and the proposal atomically, and emits `memory.fact_promoted`.
11. With the embedding provider unavailable, search returns lexical results, states the degrade reason, and never fails the request.
12. An item is retrievable lexically before its embedding exists.
13. No credential, raw provider response, reviewer name, or unnecessary PII appears in items, events, retrieval logs, audit payloads, client responses, or the cache.
14. Retrieval results are identical with a cold cache, a warm cache, and no cache configured at all. Flushing the cache at any moment changes latency and nothing else.
15. No cached entry survives a write that would change its result, and an item excluded after caching is absent from the next hit.
16. A ranking computed under a higher sensitivity ceiling is never served to a caller with a lower one.
17. The cache never stores item content or query text, and Redis being unavailable degrades to a direct read rather than an error.
18. All new tables pass two-tenant RLS tests, sensitivity-boundary tests, explicit-grant checks, and foreign-key-index checks.
19. Every UI control uses shadcn/ui composition; loading, empty, no-match, degraded, withheld, and error states are accessible.
20. Chrome DevTools verification confirms the workspace works at desktop and narrow viewports with no critical console, network, accessibility, or interaction failure.

## 23. Definition of done

- All acceptance criteria pass.
- Migration, generated database types, domain, services, API routes, projector, workers, cache adapter, UI, tests, ADR 0011, ADR 0012, and documentation are included.
- Staging migrations, RLS, and the sensitivity boundary are verified.
- Sensitive changes emit audit events and typed domain events.
- Retrieval latency, degrade rate, embedding backlog, cache hit rate, and hydration drop rate observability exist.
- The full suite passes with `REDIS_URL` set and again with it unset, producing identical results.
- The acknowledging ingestion stub is deleted, not merely bypassed.
- No critical or high-severity security, tenancy, accessibility, or data-integrity issue remains.

## 24. Open follow-ups

These are named here so they are not silently forgotten:

- Data Ingestion slice: `csv_import.row` persistence and `NormalizedMetric`.
- Read-through projection of goals, constraints, and policies if the Decision Engine wants them through one retrieval surface.
- Procedural memory for playbooks and worker versions.
- Retention policy enforcement and hard deletion for data-subject requests. A hard delete must also bump the organization's cache version.
- Re-ranking and query rewriting, once retrieval logs provide an evaluation baseline.
- A shorter rebuild cadence, or an event-driven aggregate refresh, if the daily pass proves too coarse for review-queue depth.
- A shared cache abstraction beyond memory, once a second module needs one. `REDIS_URL` is deliberately generic so the port can be lifted out of `src/modules/memory` without renaming configuration.

## 25. References

- `context/09-business-memory.md`
- `context/04-domain-model.md`
- `specs/003-integration-hub.md` sections 7.5 and 9
- `adrs/0011-business-memory-read-through-facts.md`
- `adrs/0012-business-memory-cache-boundary.md`
- <https://supabase.com/docs/guides/database/extensions/pgvector>
- <https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes>
- <https://www.postgresql.org/docs/current/textsearch-controls.html>
