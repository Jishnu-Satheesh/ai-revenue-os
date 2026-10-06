# ADR 0011: Keep authoritative facts in the digital twin and retrieve them through Business Memory

## Status

Accepted; read-through fact retrieval and provider projection are implemented. This does not assert full operational acceptance of every original memory requirement. The 2026-09-10 [inspection](../docs/research/2026-09-10-business-memory-shared-intelligence.md) distinguishes current implementation from remaining integrations.

## Context

`specs/004-business-memory.md` originally listed "structured facts" inside Business Memory's scope. The Organization Digital Twin already ships `public.business_facts`, which carries value, source, verification status, confidence, effective dates, and last-verified timestamp, with uniqueness per organization, branch, and fact key. `context/04-domain-model.md` also lists `BusinessFact` and `MemoryItem` as separate entities.

Implementing structured facts inside Business Memory would create two writable stores for the same knowledge. Onboarding, provider imports, and the memory service would each be able to answer "what are this branch's hours" differently, and the source hierarchy in `context/09-business-memory.md` — which requires that an inference never overwrite a verified fact — would depend on convention rather than structure. AGENTS.md section 7 requires resolving a contradiction between implementation and documentation rather than treating either as aspirational.

Separately, the Integration Hub hands validated record envelopes to `createAcknowledgingDataIngestionPort`, which counts records as accepted and persists nothing. Provider data currently has no destination, and the first module that needs it is Business Memory.

Retrieval also needed a search strategy. The project has no pgvector extension and `AiProvider` exposes only `generate`. The acceptance criteria — verified above inferred, superseded excluded, sensitivity gated, provenance exposed — are all satisfiable deterministically, but semantic recall over paraphrased queries is not.

## Decision

- `public.business_facts` remains the single writable source of truth for authoritative structured facts. Business Memory does not own, copy, or mirror them.
- Business Memory owns `document`, `note`, `episode`, `decision`, `outcome`, `lesson`, and `fact_proposal` items. A check constraint forbids a `structured_fact` row.
- `structured_fact` is a virtual retrieval type produced by projecting `business_facts` at read time, so callers get one unified, ranked, provenance-carrying result set from one API.
- Ordering is lexicographic: a derived integer trust rank sorts first, and blended relevance sorts only within a rank. Precedence is therefore structural and cannot be inverted by tuning a weight.
- The ingestion projector never writes `business_facts`. Provider records become memory items, and a divergence from a current fact becomes a `fact_proposal`. Promotion into the digital twin happens only after human confirmation, through the existing digital-twin service, inside one transaction with the proposal's state change.
- Retrieval is hybrid: Postgres full-text search plus pgvector cosine similarity, shipped enabled with no organization allowlist and no feature flag.
- Because there is no rollout gate, the read-path embedding call is bounded at 1500 ms with no retry, and any failure degrades the query to lexical-only with an explicit `retrievalMode` and `degradedReason` in the response. Retrieval never hard-fails on an external model dependency.
- Embedding is asynchronous. An item is lexically retrievable the moment it is written; the vector arrives later through a Trigger.dev task.
- The embedding column is fixed at 1536 dimensions and every row stores its `embedding_model`. Changing to a model of different dimensionality is a migration, not a configuration change.

## Consequences

- There is exactly one place to change a fact, and the source hierarchy is enforced by the write path rather than by reviewer vigilance.
- Retrieval ranks across two backing stores, so the ranking implementation is more complex than a single-table query and needs its own tests for the projection path.
- Provider data finally lands somewhere, and `createAcknowledgingDataIngestionPort` is deleted rather than bypassed.
- `csv_import.row` has no destination in this slice and is rejected with `UNSUPPORTED_RECORD_TYPE`. CSV imports will report zero accepted rows with honest operator copy instead of the current silent success. That regression in apparent behavior is the accurate state and is resolved by the Data Ingestion slice.
- Fact promotion requires a human, so provider drift does not self-heal. The review queue can accumulate, and its depth is an observability metric.
- Shipping without a rollout gate means the degrade path, not a flag, is the safety mechanism, and it must be tested as a first-class behavior rather than an edge case.
- pgvector adds an extension, an HNSW index, an `EmbeddingProvider` port, a backlog worker, and an external model dependency in a read path that previously had none.
- Organization filtering must precede similarity computation in SQL. A vector search that filters tenants afterward would be a cross-tenant leak, so the query plan is part of the test surface.

## References

- `specs/004-business-memory.md`
- `adrs/0012-business-memory-cache-boundary.md`, which caches the retrieval this ADR defines
- `specs/003-integration-hub.md` sections 7.5 and 9
- `context/09-business-memory.md`
- `context/04-domain-model.md`
- `src/modules/integrations/infrastructure/ingestion-sink.ts`
- `supabase/migrations/20260807200000_organization_digital_twin.sql`
- <https://supabase.com/docs/guides/database/extensions/pgvector>
- <https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes>
