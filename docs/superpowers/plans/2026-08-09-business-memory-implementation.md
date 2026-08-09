# Business Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Business Memory V1 from `specs/004-business-memory.md`: a tenant-safe memory store with governed write paths, hybrid lexical and semantic retrieval with a deterministic degrade path, read-through structured facts that keep the digital twin authoritative, a real destination for Integration Hub records, a Redis cache that stores rankings rather than content, and a Hub-scale operator workspace.

**Architecture:** Keep trust ordering, freshness, sensitivity gating, and source-tier derivation as pure versioned TypeScript. Postgres owns memory items, links, retrieval logs, and both indexes; the vector index is always filtered by organization inside SQL before similarity is computed. React Server Components perform authenticated initial reads; organization-scoped application services enforce permissions and call RLS-backed repositories; TanStack Query and Form own only interactive client state. Multi-table atomic work uses `security definer` Postgres functions with `set search_path = ''` and an operations table for idempotency, matching `20260808025602_integration_authenticated_operations.sql`. Embedding is asynchronous through Trigger.dev and never blocks a write or hard-fails a read. Redis caches result identifiers, scores, aggregates, and query vectors only; rows are always hydrated from Postgres under the caller's RLS context, so the cache cannot answer a question the database would have refused. `business_facts` stays the single writable source of truth; memory proposes and a human promotes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, pnpm 11, Supabase/Postgres with forced RLS and pgvector, Redis via `ioredis`, Zod 4, TanStack Query v5, TanStack Form v1, Trigger.dev SDK 4.0.0, shadcn/ui New York/Radix, Tailwind CSS 4 semantic tokens, Lucide, Vitest, Testing Library, pgTAP, Playwright, and Chrome DevTools.

## Global Constraints

- Use **pnpm** exclusively with Node 22. Do not use npm or Yarn.
- Start from `specs/004-business-memory.md`, ADR 0011, and ADR 0012. Do not add procedural memory, normalized metrics, signals, cross-tenant retrieval, re-ranking, or query rewriting.
- **The cache stores the ranking, never the content.** Never write a title, body, structured value, query text, credential, provider payload, or reviewer name to Redis. Always hydrate rows from Postgres under the caller's RLS context. A cache read path that returns content directly is a tenancy defect, however fast it is.
- Every cache key includes the organization ID, the version stamp, and the effective sensitivity ceiling. A key missing any of the three is a defect, not a simplification.
- Every write path bumps the organization version stamp. Never use `KEYS` or an unbounded `SCAN`, and never use an `INCR` counter for the version.
- The cache is optional and disposable. `REDIS_URL` absent, unreachable, or flushed must change latency and nothing else, and the suite must pass identically in all three states.
- Business Memory ships without an organization allowlist. Do not add one, and do not gate hybrid retrieval behind a flag. The degrade path in spec section 9.4 is the safety mechanism and must be tested as a first-class behavior.
- Every tenant-owned query and mutation accepts an authenticated `organizationId`, scopes by it, and relies on RLS in user-facing request paths. A service-role client is allowed only inside validated background workers.
- Filter by `organization_id` in SQL before any similarity computation. Never search the vector index across tenants and filter afterward.
- `business_facts` is written only through the confirmed-promotion path, never by the projector, never by a model.
- A model may only produce `proposed` items. Any AI-origin write at `verified` is a bug, not a configuration choice.
- Use Zod at HTTP, retrieval, embedding, adapter, task, and ingestion boundaries.
- Treat `body`, `structured_value`, and every provider-derived string as untrusted content. Strip reviewer names before storage. Never log full bodies or untruncated query text.
- Do not optimistically claim verification, promotion, supersession, embedding, or storage that has not been persisted.
- All user-facing controls compose shadcn/ui. Add missing primitives with `pnpm dlx shadcn@latest add <component>`. Preserve reduced motion, keyboard access, 200% zoom, and status meaning without color.
- Check off a task only after its focused tests pass. Commit each task as one reviewable change; do not mix unrelated work.

## Stable Interfaces

These signatures are the contract shared across tasks. If implementation evidence requires a change, update this plan and the spec or ADR in the same commit.

```ts
export type MemoryType =
  | "structured_fact"
  | "document"
  | "note"
  | "episode"
  | "decision"
  | "outcome"
  | "lesson"
  | "fact_proposal";

export type MemoryOrigin =
  | "user_verified"
  | "provider_imported"
  | "system_generated"
  | "ai_proposed"
  | "outcome_learned";

export type VerificationState = "proposed" | "unverified" | "verified" | "rejected";
export type Sensitivity = "public" | "internal" | "confidential" | "customer_content";
export type Freshness = "fresh" | "aging" | "stale" | "superseded" | "expired";
export type SourceTier = 1 | 2 | 3 | 4 | 5;
export type TrustRank = 0 | 1 | 2 | 3 | 4;

export type MemoryPurpose =
  | "decision_context"
  | "opportunity_generation"
  | "outcome_analysis"
  | "operator_search"
  | "onboarding_assist";

export type MemoryRetrievalPort = {
  retrieve(query: MemoryRetrievalQuery): Promise<MemoryRetrievalResponse>;
};

export type EmbeddingProvider = {
  readonly model: string;
  readonly dimensions: number;
  embed(input: {
    organizationId: string;
    correlationId: string;
    texts: readonly string[];
  }): Promise<readonly (readonly number[])[]>;
};

export type MemoryCache = {
  getRanking(key: CacheKey): Promise<CachedRanking | null>;
  setRanking(key: CacheKey, value: CachedRanking, ttlSeconds: number): Promise<void>;
  getEmbedding(model: string, contentHash: string): Promise<readonly number[] | null>;
  setEmbedding(model: string, contentHash: string, vector: readonly number[]): Promise<void>;
  getSnapshot(organizationId: string): Promise<CachedSnapshot | null>;
  setSnapshot(organizationId: string, value: CachedSnapshot, ttlSeconds: number): Promise<void>;
  invalidateOrganization(organizationId: string): Promise<void>;
  withRebuildLock<T>(organizationId: string, run: () => Promise<T>): Promise<T | null>;
};

export type CacheKey = {
  organizationId: string;
  ceiling: Sensitivity;
  filterHash: string;
  queryHash: string;
};

export type CachedRanking = {
  itemIds: readonly string[];
  factReferences: readonly string[];
  scores: readonly { lexical: number; semantic: number; blended: number }[];
  retrievalMode: "hybrid" | "lexical";
  builtAt: string;
};

export type MemoryTaskName =
  | "memory.embed-items"
  | "memory.reembed-item"
  | "memory.expire-items"
  | "memory.rebuild-organization-cache";

export type MemoryTaskPayload = {
  taskName: MemoryTaskName;
  organizationId?: string;
  itemId?: string;
  correlationId: string;
  idempotencyKey: string;
};

export type MemoryWorkerDependencies = {
  repository: MemoryWorkerRepository;
  embeddings: EmbeddingProvider | null;
  cache: MemoryCache | null;
  now: () => Date;
};
```

`MemoryRetrievalQuery` and `MemoryRetrievalResponse` are defined in spec section 9.1 and must match it exactly. The application service depends on `MemoryRepository`, `EventPublisher`, `MemoryTaskDispatcher`, and `now`. Worker runners depend only on the interfaces above; Trigger.dev imports stay in thin registration files.

## Proposed File Map

| Area | Files |
| --- | --- |
| Domain | `src/domain/memory/{types,schemas,permissions,trust,freshness,sensitivity,purposes,errors}.ts` |
| Application/persistence | `src/modules/memory/{application,infrastructure}/**` |
| Retrieval and projection | `src/modules/memory/application/{retrieval,ranking,fact-projection}.ts`, `src/modules/memory/infrastructure/{repository,embedding-provider,memory-projection-port}.ts` |
| Cache | `src/modules/memory/application/cache-keys.ts`, `src/modules/memory/infrastructure/{redis-cache,cache-noop}.ts` |
| Workers | `src/workflows/memory/**`, `src/trigger/memory.ts` |
| API | `src/app/api/organizations/[organizationId]/memory/**/route.ts` |
| UI | `src/app/(platform)/organizations/[organizationId]/memory/**`, `src/components/memory/**` |
| Database | CLI-created `supabase/migrations/*_business_memory.sql`, `supabase/tests/database/business_memory_rls_test.sql`, generated `src/lib/supabase/database.types.ts` |
| Verification | colocated Vitest tests, `e2e/business-memory.spec.ts`, `progress-tracker.md` |

---

### Task 1: Domain vocabulary and deterministic derivation

**Files:**

- Create: `src/domain/memory/types.ts`
- Create: `src/domain/memory/permissions.ts`
- Create: `src/domain/memory/permissions.test.ts`
- Create: `src/domain/memory/trust.ts`
- Create: `src/domain/memory/trust.test.ts`
- Create: `src/domain/memory/freshness.ts`
- Create: `src/domain/memory/freshness.test.ts`
- Create: `src/domain/memory/purposes.ts`
- Create: `src/domain/memory/purposes.test.ts`
- Create: `src/domain/memory/errors.ts`

**Interfaces:**

- Produces: `deriveSourceTier`, `deriveTrustRank`, `deriveFreshness`, `sensitivityCeilingFor`, `hasMemoryPermission`, `MemoryError`
- Consumes: `OrganizationRole` from `src/domain/organizations/types`

- [x] **Step 1: Write failing derivation tests.**

  ```ts
  expect(deriveTrustRank({ verificationState: "verified", sourceTier: 1 })).toBe(0);
  expect(deriveTrustRank({ verificationState: "unverified", sourceTier: 5 })).toBe(4);
  expect(deriveSourceTier({ origin: "ai_proposed", verificationState: "verified" })).toBe(1);
  expect(deriveFreshness({ now, expiresAt: past, supersededById: id })).toBe("expired");
  expect(sensitivityCeilingFor({ purpose: "decision_context" })).toBe("internal");
  expect(sensitivityCeilingFor({ purpose: "operator_search", role: "operator" })).toBe("internal");
  expect(sensitivityCeilingFor({ purpose: "operator_search", role: "admin" })).toBe(
    "customer_content",
  );
  ```

- [x] **Step 2: Write the ordering property test.**

  Generate items across every `(verificationState, sourceTier)` pair with random lexical and semantic scores in `[0, 1]`, sort with the production comparator, and assert that `trustRank` is non-decreasing across the whole result for every generated weight pair. This is acceptance criterion 2 and must fail before the comparator exists.

- [x] **Step 3: Run `pnpm vitest run src/domain/memory` and confirm the missing-module failures.**

- [x] **Step 4: Implement the vocabulary and derivations.**

  Keep `permissions.ts` free of any server-only import so the browser can hide controls a role cannot use, exactly as `src/domain/integrations/permissions.ts` does. Keep `errors.ts` server-only and never import it from a Client Component. Derive `sourceTier` from origin with the verified override from spec section 6.3; derive `trustRank` from spec section 6.7; derive freshness in the priority order from spec section 6.6.

  **Resolved during implementation:** spec section 6.3 read as an unordered table left tier 3 unreachable, because a confirmed document satisfies both the verified rule and the document rule. Section 6.3 now states the evaluation order explicitly and section 6.7 covers the combinations the original table omitted. Both were updated in this task's commit rather than left aspirational.

- [x] **Step 5: Run `pnpm vitest run src/domain/memory && pnpm typecheck && pnpm lint`.**

- [x] **Step 6: Commit with `git commit -m "feat(memory): add trust, freshness, and permission vocabulary"`.**

### Task 2: Database migration, RLS, indexes, and pgTAP coverage

**Files:**

- Create through CLI: `supabase/migrations/<timestamp>_business_memory.sql`
- Create: `supabase/tests/database/business_memory_rls_test.sql`

**Interfaces:**

- Produces: `public.memory_items`, `public.memory_links`, `public.memory_retrieval_log`, the pgvector extension, and both search indexes

- [ ] **Step 1: Create the migration with `pnpm supabase migration new business_memory`.** Do not invent a timestamp.

- [ ] **Step 2: Write the failing pgTAP test first.**

  Cover two organizations and assert: cross-tenant select returns zero rows; an operator cannot select a `confidential` or `customer_content` row through RLS; an admin can; a viewer cannot insert; `memory_type = 'structured_fact'` is rejected; `(organization_id, source_system, source_record_id)` rejects a duplicate; an item cannot reference another organization's branch or supersede an item in another organization; `memory_retrieval_log` has no update or delete privilege; `anon` has zero table privileges; every foreign key has a supporting index.

- [ ] **Step 3: Install pgvector and create the tables.**

  ```sql
  create extension if not exists vector with schema extensions;
  ```

  Declare the column as `embedding extensions.vector(1536)` so the definition does not depend on the caller's `search_path`. Implement every field, check constraint, and uniqueness rule in spec sections 7.1 through 7.3, including the paired `verified_by`/`verified_at` check, the `fact_proposal` column requirements, and `from_item_id <> to_item_id`.

- [ ] **Step 4: Add the generated search vector and indexes.**

  ```sql
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored
  ```

  Add a GIN index on `search_vector`, an HNSW index on `embedding` using `vector_cosine_ops`, and the composite and partial indexes listed in spec section 8.

- [ ] **Step 5: Enable and force RLS, then write policies.**

  Reuse `private.is_organization_member` and `private.has_organization_role`, wrapping `auth.uid()` in `select`. The `SELECT` policy on `memory_items` must include the sensitivity predicate so the boundary exists in the database, not only in the service. `UPDATE` policies carry both `USING` and tenant-preserving `WITH CHECK`. Grant only the required operations to `authenticated`; grant nothing to `anon`; grant `memory_retrieval_log` only `INSERT` and `SELECT`.

- [ ] **Step 6: Run `pnpm supabase db reset` and `pnpm supabase test db supabase/tests/database/business_memory_rls_test.sql` when Docker is available.** If Docker is unavailable, record the gap in `progress-tracker.md` and do not claim the test passed.

- [ ] **Step 7: Commit with `git commit -m "feat(memory): add tenant-safe memory schema and indexes"`.**

### Task 3: Generated types and the memory repository

**Files:**

- Modify: `src/lib/supabase/database.types.ts` (regenerated)
- Create: `src/modules/memory/application/ports.ts`
- Create: `src/modules/memory/infrastructure/repository.ts`
- Create: `src/modules/memory/infrastructure/repository.test.ts`
- Create: `src/modules/memory/infrastructure/repository.integration.test.ts`

**Interfaces:**

- Produces: `MemoryRepository` with `search`, `listTimeline`, `listReviewQueue`, `getItem`, `createItem`, `updateItemState`, `insertLink`, `logRetrieval`, and `snapshot`

- [ ] **Step 1: Regenerate types with `pnpm db:types`.** Remove any provisional row type once the generated schema covers it.

- [ ] **Step 2: Write failing repository tests.**

  Assert that every method scopes by `organizationId`, that `search` emits a single statement whose organization predicate precedes the similarity expression, that `limit` is capped at 50, and that a null embedding argument produces the lexical-only statement.

- [ ] **Step 3: Implement the repository.**

  Express hybrid search as one RPC-backed query that takes the organization, the filter set, the optional query vector, and the weights, returning `lexical`, `semantic`, and the raw row. Order in SQL by `trust_rank asc, blended desc, observed_at desc nulls last, id asc`. Never assemble candidate sets in application code.

- [ ] **Step 4: Write the integration test against a reset local database.**

  Seed two organizations, assert cross-tenant isolation, assert the sensitivity boundary, and assert that a verified item with a deliberately poor lexical match outranks an unverified inference with an exact match.

- [ ] **Step 5: Run `pnpm vitest run src/modules/memory && pnpm typecheck && pnpm lint`.**

- [ ] **Step 6: Commit with `git commit -m "feat(memory): add organization-scoped memory repository"`.**

### Task 4: Retrieval schemas, ranking, and sensitivity gating

**Files:**

- Create: `src/domain/memory/schemas.ts`
- Create: `src/domain/memory/schemas.test.ts`
- Create: `src/modules/memory/application/ranking.ts`
- Create: `src/modules/memory/application/retrieval.ts`
- Create: `src/modules/memory/application/retrieval.test.ts`

**Interfaces:**

- Produces: `memoryRetrievalQuerySchema`, `memoryRetrievalResponseSchema`, `blendScores`, `createMemoryRetrieval(deps): MemoryRetrievalPort`

- [ ] **Step 1: Write failing retrieval tests with a fake repository.**

  ```ts
  await expect(
    retrieval.retrieve({ ...base, purpose: "decision_context", sensitivityAllowance: "confidential" }),
  ).rejects.toMatchObject({ code: "MEMORY_SENSITIVITY_DENIED" });

  const response = await retrieval.retrieve({ ...base, query: "late night discounts" });
  expect(response.results.map((result) => result.trustRank)).toEqual([...sorted]);
  expect(response.results.every((result) => result.provenance.origin !== undefined)).toBe(true);
  ```

  Also assert that superseded, expired, and rejected items are absent by default, that `includeSuperseded` returns them labelled, and that a denial writes a retrieval log row with zero results.

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Implement schemas, blending, and the retrieval service.**

  Weights are exported constants. The comparator from Task 1 does the ordering; blending only breaks ties within a rank. A request above its ceiling throws `MEMORY_SENSITIVITY_DENIED` and is never silently downgraded.

- [ ] **Step 4: Log every retrieval, including empty and denied ones,** with truncated query text and at most 50 result IDs.

- [ ] **Step 5: Run `pnpm vitest run src/modules/memory src/domain/memory && pnpm typecheck && pnpm lint`.**

- [ ] **Step 6: Commit with `git commit -m "feat(memory): add governed hybrid retrieval service"`.**

### Task 5: Embedding provider and the degrade path

**Files:**

- Modify: `src/lib/env.ts`
- Create: `src/modules/memory/infrastructure/embedding-provider.ts`
- Create: `src/modules/memory/infrastructure/embedding-provider.test.ts`
- Modify: `src/modules/memory/application/retrieval.ts`
- Modify: `src/modules/memory/application/retrieval.test.ts`

**Interfaces:**

- Consumes: `OPENAI_API_KEY`, new optional `MEMORY_EMBEDDING_MODEL`
- Produces: `createEmbeddingProvider(): EmbeddingProvider | null`, `retrievalMode` and `degradedReason` on every response

- [ ] **Step 1: Write failing degrade tests.**

  ```ts
  expect(await retrieveWith({ embeddings: null })).toMatchObject({
    retrievalMode: "lexical",
    degradedReason: "EMBEDDING_NOT_CONFIGURED",
  });
  expect(await retrieveWith({ embeddings: neverResolves })).toMatchObject({
    retrievalMode: "lexical",
    degradedReason: "EMBEDDING_TIMEOUT",
  });
  expect(await retrieveWith({ embeddings: throws })).toMatchObject({
    retrievalMode: "lexical",
    degradedReason: "EMBEDDING_UNAVAILABLE",
  });
  ```

  Assert in each case that results are still returned and that the request does not reject.

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Add `MEMORY_EMBEDDING_MODEL` to `serverEnvSchema` as an optional server-only string.** Do not prefix it with `NEXT_PUBLIC_`. Return `null` from the factory when no key is configured; absence is a supported state, not an error.

- [ ] **Step 4: Implement the provider with a validated response shape,** asserting the returned dimensionality equals 1536 and rejecting a mismatch before it reaches the database.

- [ ] **Step 5: Wrap the read-path embedding call at 1500 ms with no retry** using `AbortSignal.timeout`, and map every failure mode to its `degradedReason`.

- [ ] **Step 6: Run `pnpm vitest run src/modules/memory && pnpm typecheck && pnpm lint`.**

- [ ] **Step 7: Commit with `git commit -m "feat(memory): add embeddings with deterministic lexical degrade"`.**

### Task 6: Read-through structured-fact projection

**Files:**

- Create: `src/modules/memory/application/fact-projection.ts`
- Create: `src/modules/memory/application/fact-projection.test.ts`
- Modify: `src/modules/memory/infrastructure/repository.ts`
- Modify: `src/modules/memory/application/retrieval.ts`

**Interfaces:**

- Produces: `projectBusinessFact(row): MemoryRetrievalResult`, merged ranking across memory rows and projected facts

- [ ] **Step 1: Write failing projection tests.**

  Assert the field mapping in spec section 7.4, that `itemId` is null and `sourceReference` points at the `business_facts` row, that a `verified` fact projects to trust rank 0, that an `inferred` fact projects to source tier 5, that a `stale` fact projects with freshness `stale`, and that a projected fact always carries semantic score 0.

- [ ] **Step 2: Write the merge test.** A verified projected fact must outrank a semantically closer `lesson`. This is the concrete form of acceptance criterion 2 across both stores.

- [ ] **Step 3: Run the tests and confirm they fail.**

- [ ] **Step 4: Implement the projection and the merged query.**

  Fetch matching `business_facts` rows with the same organization filter and a lexical predicate over `fact_key` and the text content of `value`, project them, then merge into the single comparator before truncation. Do not write to `business_facts` anywhere in this task.

- [ ] **Step 5: Run `pnpm vitest run src/modules/memory && pnpm typecheck && pnpm lint`.**

- [ ] **Step 6: Commit with `git commit -m "feat(memory): retrieve digital-twin facts through read-through projection"`.**

### Task 7: Write paths, permissions, events, and audit

**Files:**

- Create: `src/modules/memory/application/api-schemas.ts`
- Create: `src/modules/memory/application/authorization.ts`
- Create: `src/modules/memory/application/service.ts`
- Create: `src/modules/memory/application/service.test.ts`
- Modify: `src/domain/events/types.ts`

**Interfaces:**

- Produces: `createMemoryService(deps)` with `createItem`, `verifyItem`, `rejectItem`, `supersedeItem`, `getSnapshot`, `listTimeline`
- Produces: the eight `memory.*` event names and their payload types

- [ ] **Step 1: Write failing service tests.**

  ```ts
  await expect(service.createItem({ ...base, origin: "ai_proposed", verificationState: "verified" }))
    .rejects.toMatchObject({ code: "MEMORY_VERIFICATION_FORBIDDEN" });
  await expect(service.createItem({ ...base, origin: "ai_proposed", links: [] }))
    .rejects.toMatchObject({ code: "MEMORY_EVIDENCE_REQUIRED" });
  await expect(service.supersedeItem({ ...base, itemId: id, replacementOf: id }))
    .rejects.toMatchObject({ code: "MEMORY_SUPERSESSION_INVALID" });
  ```

  Assert that a viewer is refused every mutation, that verification sets both `verified_by` and `verified_at`, that an `outcome` without baseline, measured value, unit, and attribution window is refused, and that each mutation publishes its event and appends an audit row.

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Extend the event vocabulary** with the eight names from spec section 14. Payloads carry identifiers, type, origin, verification state, sensitivity class, and counts only — never `body`, `structured_value`, or query text.

- [ ] **Step 4: Implement authorization and the service.**

  Every method takes an authenticated organization context, checks the permission from Task 1, and re-reads the target entity tenant-scoped before mutating. Supersession runs through a `security definer` function so the insert and the state change are one transaction; depth is limited to 32 and self-supersession is rejected.

- [ ] **Step 5: Run `pnpm vitest run src/modules/memory && pnpm typecheck && pnpm lint`.**

- [ ] **Step 6: Commit with `git commit -m "feat(memory): add governed memory write paths"`.**

### Task 8: Cache port, key composition, and the Redis adapter

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Create: `src/modules/memory/application/cache-keys.ts`
- Create: `src/modules/memory/application/cache-keys.test.ts`
- Create: `src/modules/memory/infrastructure/redis-cache.ts`
- Create: `src/modules/memory/infrastructure/redis-cache.test.ts`
- Create: `src/modules/memory/infrastructure/cache-noop.ts`

**Interfaces:**

- Consumes: new optional server-only `REDIS_URL`
- Produces: `buildCacheKey`, `buildEmbeddingKey`, `createMemoryCache(): MemoryCache | null`

- [ ] **Step 1: Write failing key-composition tests.**

  ```ts
  const admin = buildCacheKey({ ...base, ceiling: "customer_content" });
  const operator = buildCacheKey({ ...base, ceiling: "internal" });
  expect(admin).not.toEqual(operator);
  expect(buildCacheKey({ ...base, branchId: branchA })).not.toEqual(
    buildCacheKey({ ...base, branchId: branchB }),
  );
  expect(buildCacheKey({ ...base, includeSuperseded: true })).not.toEqual(buildCacheKey(base));
  expect(buildEmbeddingKey(model, text)).not.toContain(text);
  ```

  Add a table-driven test that varies every field of `MemoryRetrievalQuery` one at a time and asserts each variation produces a distinct key. A collision here is a cross-role leak, so the test enumerates rather than samples.

- [ ] **Step 2: Write failing adapter tests.**

  Assert that a missing `REDIS_URL` returns `null` rather than throwing; that a connection error, a 250 ms timeout, and a malformed JSON entry each resolve to `null` instead of rejecting; that a write failure resolves rather than rejecting; that a missing version key resolves to current server time rather than zero or one; and that `invalidateOrganization` issues a single `SET` of the version stamp and never a `KEYS` or `SCAN`.

- [ ] **Step 3: Run `pnpm vitest run src/modules/memory` and confirm the failures.**

- [ ] **Step 4: Install the client.**

  ```bash
  pnpm add ioredis
  ```

  Do not upgrade unrelated packages.

- [ ] **Step 5: Add `REDIS_URL` to `serverEnvSchema` as an optional server-only URL.** Never prefix it with `NEXT_PUBLIC_`. Add it to `.env.example` with a comment stating that it is optional and that absence disables caching. Do not read `process.env` anywhere outside `src/lib/env.ts`.

- [ ] **Step 6: Implement the adapter** with a module-level singleton connection, a 250 ms command timeout, no in-request retry, and every failure path logged and swallowed. Validate every entry with Zod on read and discard a mismatch rather than repairing it. Confine the client import to this one file so a serverless target can swap adapters without touching a caller.

- [ ] **Step 7: Implement `cache-noop.ts`** as the null-object used when no URL is configured, so callers never branch on `cache === null` in business logic.

- [ ] **Step 8: Run `pnpm vitest run src/modules/memory && pnpm typecheck && pnpm lint`.**

- [ ] **Step 9: Commit with `git commit -m "feat(memory): add the disposable cache boundary"`.**

### Task 9: Cached retrieval, hydration, and version invalidation

**Files:**

- Modify: `src/modules/memory/application/retrieval.ts`
- Modify: `src/modules/memory/application/retrieval.test.ts`
- Modify: `src/modules/memory/application/service.ts`
- Modify: `src/modules/memory/application/service.test.ts`
- Modify: `src/modules/memory/infrastructure/repository.ts`
- Create: `src/modules/memory/application/cached-retrieval.test.ts`

**Interfaces:**

- Produces: `servedFromCache` and `builtAt` on `MemoryRetrievalResponse`, `repository.hydrateByIds`

- [ ] **Step 1: Write the cold-equals-warm test first.** It is the acceptance criterion the whole design exists to satisfy.

  ```ts
  const cold = await retrieval.retrieve(query);
  const warm = await retrieval.retrieve(query);
  expect(warm.results).toEqual(cold.results);
  await cache.flushAll();
  expect((await retrieval.retrieve(query)).results).toEqual(cold.results);
  ```

- [ ] **Step 2: Write the failing correctness tests.**

  Assert that an item superseded after caching is absent from the next hit; that a rejected item is absent; that an expired item is absent; that a ranking cached under a `customer_content` ceiling is never returned to an `internal` caller; that a sensitivity denial is rejected before the cache is consulted and never cached; that a cache hit still writes a `memory_retrieval_log` row; and that a cache outage mid-test produces identical results with `servedFromCache: false`.

- [ ] **Step 3: Run the tests and confirm they fail.**

- [ ] **Step 4: Implement `hydrateByIds`** as a tenant-scoped primary-key read under the caller's RLS context, preserving the cached score order and dropping identifiers that no longer qualify. Increment the hydration drop metric for each drop; a rising rate is the early warning that invalidation is broken.

- [ ] **Step 5: Wire the embedding cache ahead of the provider call,** so a hit skips the external round-trip entirely and the read path loses its external dependency for repeated queries.

- [ ] **Step 6: Cache rankings with a 60-second TTL** after a miss, and set `servedFromCache` and `builtAt` on every response.

- [ ] **Step 7: Invalidate in every write path in `service.ts`** — create, verify, reject, supersede — after the database commit, never before. An invalidation failure is logged and swallowed; it must not fail a write that already succeeded.

- [ ] **Step 8: Run `pnpm vitest run src/modules/memory && pnpm typecheck && pnpm lint`.**

- [ ] **Step 9: Commit with `git commit -m "feat(memory): cache rankings behind RLS hydration"`.**

### Task 10: Proposal confirmation and transactional fact promotion

**Files:**

- Create: `supabase/migrations/<timestamp>_memory_promotion_operations.sql`
- Modify: `supabase/tests/database/business_memory_rls_test.sql`
- Modify: `src/modules/memory/application/service.ts`
- Modify: `src/modules/memory/application/service.test.ts`
- Create: `src/modules/memory/infrastructure/promotion.integration.test.ts`

**Interfaces:**

- Produces: `public.confirm_memory_fact_proposal(...)`, `service.confirmProposal`, `service.rejectProposal`

- [ ] **Step 1: Write the failing promotion tests.**

  Assert that confirming a `fact_proposal` writes `business_facts` and sets the proposal to `verified` atomically; that a forced failure inside the function rolls both back; that a second confirm with the same idempotency key returns the first result without a second write; and that confirming emits `memory.fact_promoted`.

- [ ] **Step 2: Create the migration with `pnpm supabase migration new memory_promotion_operations`.**

- [ ] **Step 3: Implement the operation.**

  Follow the pattern in `20260808025602_integration_authenticated_operations.sql`: an operations table keyed by `(organization_id, idempotency_key)` with forced RLS and all privileges revoked, plus a `security definer` function with `set search_path = ''` that validates membership and role, upserts the fact, updates the proposal, and appends the audit row in one transaction.

- [ ] **Step 4: Preserve the source hierarchy.** The promoted fact takes `status = 'verified'` with the confirming user as `updated_by`. A proposal may never downgrade an existing `verified` fact silently; if the current fact is `verified` and differs, the confirmation body must include an explicit `overrideVerified: true`.

- [ ] **Step 5: Extend the pgTAP test** to cover the function's membership check, its role check, and its refusal to touch another organization's fact.

- [ ] **Step 6: Invalidate the organization after a successful promotion,** and assert in a test that a ranking cached before the promotion does not survive it. Promotion changes a `business_facts` row that read-through projection returns, so skipping this leaves a stale fact retrievable.

- [ ] **Step 7: Run `pnpm vitest run src/modules/memory && pnpm typecheck && pnpm lint`, plus the pgTAP suite when Docker is available.**

- [ ] **Step 8: Commit with `git commit -m "feat(memory): promote confirmed fact proposals atomically"`.**

### Task 11: Replace the acknowledging ingestion stub with the memory projector

**Files:**

- Create: `src/modules/memory/infrastructure/memory-projection-port.ts`
- Create: `src/modules/memory/infrastructure/memory-projection-port.test.ts`
- Modify: `src/modules/integrations/infrastructure/ingestion-sink.ts`
- Modify: `src/modules/integrations/infrastructure/ingestion-sink.test.ts`
- Modify: `src/trigger/integrations.ts`
- Modify: `src/components/integrations/data-sources-tab.tsx`

**Interfaces:**

- Produces: `createMemoryProjectionPort(deps): DataIngestionPort`
- Removes: `createAcknowledgingDataIngestionPort`

- [ ] **Step 1: Write failing projector tests.**

  ```ts
  const result = await port.ingest({ ...run, records: [locationRecord, reviewRecord, csvRow] });
  expect(result).toMatchObject({ accepted: 2, rejected: 1 });
  expect(result.rejectionReasons).toContain("UNSUPPORTED_RECORD_TYPE");
  ```

  Assert that a location record whose hours differ from the current fact creates exactly one `fact_proposal`; that an identical re-sync creates none and duplicates nothing; that a review record lands at `customer_content` with `observed_at` set and no reviewer name anywhere in the row; and that the projector never writes `business_facts`.

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Implement routing** for the two Google record types, the tracked-field list from spec section 10.4, reviewer-name stripping, and idempotency on `(organization_id, source_system, source_record_id)`.

- [ ] **Step 4: Delete `createAcknowledgingDataIngestionPort` and its test coverage,** then wire `createMemoryProjectionPort` into `src/trigger/integrations.ts`. Deleting the stub is part of the definition of done; bypassing it is not sufficient.

- [ ] **Step 5: Update the Data sources tab copy** to state plainly that rows were validated and that Business Memory V1 stores Google Business Profile records only. Do not restore a silent success path.

- [ ] **Step 6: Invalidate the organization once per ingestion run,** after the run reaches a terminal state, not once per record. A sync that writes 500 items must bump the version once.

- [ ] **Step 7: Run `pnpm vitest run src/modules/memory src/modules/integrations src/trigger && pnpm typecheck && pnpm lint`.**

- [ ] **Step 8: Commit with `git commit -m "feat(memory): land integration records in business memory"`.**

### Task 12: Embedding and expiry workers

**Files:**

- Create: `src/workflows/memory/contracts.ts`
- Create: `src/workflows/memory/embed-items.ts`
- Create: `src/workflows/memory/reembed-item.ts`
- Create: `src/workflows/memory/expire-items.ts`
- Create: `src/workflows/memory/workers.test.ts`
- Create: `src/trigger/memory.ts`
- Create: `src/trigger/memory.test.ts`

**Interfaces:**

- Produces: the three tasks in `MemoryTaskName`, each with a testable runner separate from its Trigger.dev registration

- [ ] **Step 1: Write failing worker tests.**

  Assert that `embed-items` claims at most 64 pending rows per run, writes `embedding`, `embedding_model`, and `embedding_updated_at` together, sets `failed` after exhausting bounded retries, emits `memory.embedding_failed`, and leaves a failed item lexically retrievable. Assert that `reembed-item` resets status on content change. Assert that `expire-items` sets `skipped` on newly expired and superseded rows and changes nothing else.

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Implement the runners** against `MemoryWorkerDependencies` only, keeping Trigger.dev imports inside `src/trigger/memory.ts`.

- [ ] **Step 4: Validate `organizationId` inside every worker before using a privileged client,** and scope every query by organization.

- [ ] **Step 5: Invalidate the organization after an embedding batch completes and after the expiry sweep,** once per batch rather than once per item. Expiry is the case write-driven invalidation would otherwise miss, because nothing but the clock changed.

- [ ] **Step 6: Run `pnpm vitest run src/workflows/memory src/trigger && pnpm typecheck && pnpm lint`.**

- [ ] **Step 7: Commit with `git commit -m "feat(memory): add embedding and expiry workers"`.**

### Task 13: Snapshot cache and the daily rebuild schedule

**Files:**

- Create: `src/workflows/memory/rebuild-organization-cache.ts`
- Create: `src/workflows/memory/rebuild-organization-cache.test.ts`
- Modify: `src/trigger/memory.ts`
- Modify: `src/trigger/memory.test.ts`
- Modify: `src/modules/memory/application/service.ts`
- Modify: `src/modules/memory/application/service.test.ts`

**Interfaces:**

- Produces: `memory.rebuild-organization-cache` as a Trigger.dev scheduled task, and a cached `getSnapshot`

- [ ] **Step 1: Write failing snapshot-cache tests.**

  Assert that the snapshot is aggregate-only and contains no item body; that a cached snapshot is invalidated by any write; that a 300-second TTL bounds time-derived drift; and that a snapshot read with no cache configured returns the same payload computed directly.

- [ ] **Step 2: Write failing rebuild tests.**

  ```ts
  await rebuild({ organizations: [orgA, orgB, orgC] });
  expect(cache.getSnapshot(orgA)).resolves.not.toBeNull();
  expect(lock.acquiredFor(orgA)).toBe(true);
  ```

  Assert that the pass is idempotent; that an organization already holding the rebuild lock is skipped rather than blocked or rebuilt twice; that an organization with zero memory items is skipped; that a failure for one organization does not abort the batch; that concurrency is capped; and that with no cache configured the task no-ops rather than throwing.

- [ ] **Step 3: Run the tests and confirm they fail.**

- [ ] **Step 4: Implement the runner** against `MemoryWorkerDependencies`, iterating organizations in bounded batches, staggering start offsets by a hash of the organization ID so a single instant does not stampede Postgres.

- [ ] **Step 5: Warm only the recurring worker purposes.** Do not embed arbitrary historical operator queries; that spends real money on text nobody will ask for again. Cap the number of warmed queries per organization and record the count.

- [ ] **Step 6: Register the daily schedule in `src/trigger/memory.ts`,** ordered to run after `memory.expire-items` so the aggregates reflect the overnight sweep. Keep the Trigger.dev import inside the registration file.

- [ ] **Step 7: Assert the rebuild is not load-bearing.** Add a test that runs the full retrieval and snapshot suites with the rebuild never executed and expects identical results. If any assertion depends on the cron having run, the design has drifted and the plan and ADR 0012 must be corrected before continuing.

- [ ] **Step 8: Emit counts, durations, skips, and failures** per run. A per-organization failure is logged with its organization ID and does not propagate.

- [ ] **Step 9: Run `pnpm vitest run src/workflows/memory src/modules/memory src/trigger && pnpm typecheck && pnpm lint`.**

- [ ] **Step 10: Commit with `git commit -m "feat(memory): warm organization snapshots on a daily schedule"`.**

### Task 14: API routes

**Files:**

- Create: `src/app/api/organizations/[organizationId]/memory/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/search/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/timeline/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/items/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/items/[itemId]/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/items/[itemId]/supersede/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/proposals/[itemId]/confirm/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/proposals/[itemId]/reject/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/routes.test.ts`

**Interfaces:**

- Consumes: `getOrganizationContext`, `apiErrorResponse`, `publishOrganizationEvent` from `src/lib/api/organization-context`

- [ ] **Step 1: Write failing route tests.**

  Assert that a non-member receives an authorization error with no work performed; that a viewer receives an authorization error on every mutation route; that a route organization ID mismatching a body entity is refused; that search returns `retrievalMode` and `servedFromCache` in every response; that search rejects a body carrying `idempotencyKey`; and that every mutation route requires one. Add a test that the same request from an operator and an admin returns different result sets even when issued back to back, proving the ceiling reaches the cache key through the route.

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Implement the routes** as thin adapters over the service with colocated Zod schemas. Never construct a service-role client in a route.

- [ ] **Step 4: Confirm no route response contains `body` for a withheld sensitivity class,** a full retrieval log row, or an internal error cause.

- [ ] **Step 5: Run `pnpm vitest run src/app/api && pnpm typecheck && pnpm lint`.**

- [ ] **Step 6: Commit with `git commit -m "feat(memory): expose memory APIs"`.**

### Task 15: Workspace shell and the Search tab

**Files:**

- Create: `src/app/(platform)/organizations/[organizationId]/memory/{page,loading,error}.tsx`
- Create: `src/components/memory/memory-workspace-client.tsx`
- Create: `src/components/memory/query-options.ts`
- Create: `src/components/memory/search-tab.tsx`
- Create: `src/components/memory/result-card.tsx`
- Create: `src/components/memory/provenance-badges.tsx`
- Create: `src/components/memory/search-tab.test.tsx`
- Modify: `src/components/layout/*` for the sidebar entry

**Interfaces:**

- Consumes: the snapshot and search routes
- Produces: the four-tab shell with Search implemented

- [ ] **Step 1: Add any missing shadcn primitives** with `pnpm dlx shadcn@latest add <component>`. Reuse the installed `tabs`, `card`, `badge`, `status-badge`, `alert`, `empty`, `skeleton`, `sheet`, `separator`, `field`, and `sonner`.

- [ ] **Step 2: Write failing component tests.**

  Assert that a degraded response renders the `Alert` and still lists results; that trust rank and freshness each render a text label, not color alone; that the three empty states are distinct; that a background refetch does not blank current results; that a cached result shows its `builtAt` age so an operator can tell how current the answer is; and that a viewer sees no mutation controls.

- [ ] **Step 3: Render the authenticated first read in the Server Component** and start client interactivity only inside the workspace.

- [ ] **Step 4: Implement Search** with organization-scoped TanStack Query keys, filters for type, sensitivity, freshness, and verification state, and results grouped by trust rank with the group label visible.

- [ ] **Step 5: Move focus to the result summary after a search** and preserve keyboard access and reduced motion.

- [ ] **Step 6: Run `pnpm vitest run src/components/memory && pnpm typecheck && pnpm lint && pnpm build`.**

- [ ] **Step 7: Commit with `git commit -m "feat(memory): build the memory search workspace"`.**

### Task 16: Timeline, Lessons, Review, and the detail sheet

**Files:**

- Create: `src/components/memory/timeline-tab.tsx`
- Create: `src/components/memory/lessons-tab.tsx`
- Create: `src/components/memory/review-tab.tsx`
- Create: `src/components/memory/item-detail-sheet.tsx`
- Create: `src/components/memory/note-form.tsx`
- Create: `src/components/memory/supersede-dialog.tsx`
- Create: `src/components/memory/review-tab.test.tsx`
- Create: `src/components/memory/item-detail-sheet.test.tsx`

**Interfaces:**

- Consumes: the timeline, items, supersede, confirm, and reject routes

- [ ] **Step 1: Write failing tests.**

  Assert that Review shows the proposed value against the current digital-twin value side by side; that confirming removes the item from the queue only after the mutation resolves; that rejecting requires a reason; that supersession keeps the old item reachable behind an explicit toggle; and that Lessons expands `derived_from` evidence inline.

- [ ] **Step 2: Implement the three tabs and the detail `Sheet`** with full provenance, supersession chain, links, and embedding status.

- [ ] **Step 3: Use TanStack Form v1 with Zod** for the note, supersede, and reject forms, with targeted invalidation and no optimistic verification, promotion, or supersession state.

- [ ] **Step 4: Use `AlertDialog` for reject and supersede,** naming what changes and what is retained.

- [ ] **Step 5: Run `pnpm vitest run src/components/memory && pnpm typecheck && pnpm lint && pnpm build`.**

- [ ] **Step 6: Commit with `git commit -m "feat(memory): complete timeline, lessons, and review surfaces"`.**

### Task 17: End-to-end verification and documentation

**Files:**

- Create: `e2e/business-memory.spec.ts`
- Modify: `progress-tracker.md`
- Modify: `context/09-business-memory.md`
- Modify: `context/05-module-map.md`
- Modify: `README.md` if the environment surface changed

**Interfaces:**

- Produces: the release-gate record for this slice

- [ ] **Step 1: Write the end-to-end suite.**

  Cover the four tabs at desktop and 390 px; a search with results and provenance; a degraded search showing the alert; a viewer blocked from mutation controls and from the mutation APIs; an operator unable to see a `customer_content` item that an admin can see; a fact proposal confirmed and reflected in the digital twin; and a supersession that keeps the prior item reachable. Skipped scenarios must report their missing environment rather than passing vacuously.

- [ ] **Step 2: Run the full gate.**

  ```bash
  pnpm install --frozen-lockfile
  pnpm format:check
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  pnpm test:e2e
  ```

- [ ] **Step 2b: Run `pnpm test` a second time with `REDIS_URL` unset,** and a third time against a Redis instance flushed mid-run. All three must produce identical results. A difference between them is a correctness defect, not a caching quirk.

- [ ] **Step 3: Run the database gate when Docker is available:** `pnpm supabase db reset` and both pgTAP suites.

- [ ] **Step 4: Verify the retrieval query plan.** Confirm with `explain analyze` that the organization predicate is applied before the vector operation and that both the GIN and HNSW indexes are used. A plan that filters tenants after similarity is a blocking defect.

- [ ] **Step 5: Run Chrome DevTools verification** across all four tabs: loading, empty, no-match, degraded, withheld, and error states; keyboard and focus order; 200% zoom; reduced motion; background refetch; and no horizontal overflow at 390 px. Confirm the served HTML and client scripts contain no service-role key, no Redis URL, no retrieval log body, and no reviewer name.

- [ ] **Step 5b: Audit the live cache contents.** Dump every key written during the E2E run and confirm that no value contains a title, body, structured value, query text, or reviewer name, and that every ranking key carries an organization ID, a version stamp, and a sensitivity ceiling. This is a direct check of ADR 0012's central claim and cannot be inferred from unit tests.

- [ ] **Step 6: Update documentation.**

  Record the verification results, the Docker and staging gaps, and the CSV rejection behavior in `progress-tracker.md`. Update `context/09-business-memory.md` so it matches the shipped model, and add the module to `context/05-module-map.md`. Resolve any contradiction rather than leaving the document aspirational.

- [ ] **Step 7: Commit with `git commit -m "test(memory): verify governed retrieval end to end"`.**

## Staging Gates

These are environment gates, not implementation work. They inherit the two open Integration Hub gates.

1. The staging database password rotation and leaked-password protection from the Integration Hub sequence still block remote database work.
2. Apply the two Business Memory migrations to staging, compare histories, dry-run, apply, then run database lint and the security and performance advisors. Confirm the advisor reports no new exposure from the pgvector extension or the promotion function.
3. Configure `OPENAI_API_KEY` and `MEMORY_EMBEDDING_MODEL` in staging, then confirm that unsetting the key produces lexical-only retrieval rather than an error.
4. Seed a corpus large enough to make the HNSW index meaningful before judging retrieval quality; a handful of rows will sequential-scan and prove nothing.
5. Provision the Redis instance privately and network-isolated, with no public endpoint. Staging must not share a namespace or an instance with production; a shared version stamp across environments would let one invalidate the other's entries and, worse, let one serve the other's rankings.
6. Set `REDIS_URL` in the deployment environment and in Trigger.dev, not only in `.env.local`. The daily rebuild runs in the worker runtime and silently no-ops without it, which looks like a working system doing nothing.
7. Confirm the eviction policy cannot break correctness. The version stamp is designed to be eviction-safe, but verify it by evicting the stamp deliberately and asserting the next read misses rather than serving a stale entry.
8. Enable the daily schedule only after the first manual run is inspected. Verify its duration, the organizations touched, the embedding spend, and that it caused no database load spike before letting it run unattended.
