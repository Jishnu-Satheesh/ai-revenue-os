# AI Revenue OS Progress Tracker

> This file is the fast orientation point for future AI agents. Read it before starting work.

## Current state

- Date: 2026-08-09
- Package manager: **pnpm** (`pnpm@11.20.0`); Node 22 is required.
- Product stage: foundation, Organization + Digital Twin vertical slice, and the Integration Hub V1 runtime.
- Current active work: Business Memory V1, on branch `feat/business-memory`. Plan tasks 1-7 of 17 are implemented, verified, and committed; tasks 8-17 (Redis cache, cached retrieval, fact promotion, ingestion projector, workers, rebuild cron, API routes, workspace UI, E2E) are not started. All fourteen Integration Hub plan tasks are implemented and committed, and their remaining work is environment-gated, not code-gated: the staging migration, pgTAP, live type generation, and authenticated browser/E2E verification are blocked on credentials and a database runtime this workspace does not have.
- Primary user: agency operator.
- Approved UI direction: section rail with an animated focused work panel.
- Current implementation plan: `docs/superpowers/plans/2026-08-09-business-memory-implementation.md`.
- Previous Integration Hub plan: `docs/superpowers/plans/2026-08-08-integration-hub-implementation.md`.
- Previous onboarding plan: `docs/superpowers/plans/2026-08-08-guided-onboarding-implementation.md`.

## Completed

- Integration Hub V1 runtime: rollout gate, domain contracts and health policy, six-table tenant
  schema with forced RLS and a private import bucket, scoped repositories and the health-first read
  model, governed application flows, the deterministic Google Business Profile fixture with
  credential/ingestion boundaries, five leased Trigger.dev workers, all ten APIs, the four-tab
  operator workspace, and the Playwright suite.
- Next.js App Router + TypeScript foundation.
- Supabase tenancy schema, auth boundary, RLS patterns, and organization context.
- Organization creation and Digital Twin editor.
- shadcn/ui New York/Radix primitives installed and feature UI migrated away from bare controls.
- Critical shadcn rule documented in `context/14-coding-standards.md`, `context/15-ai-coding-standards.md`, and `README.md`.
- Superdesign repository context in `.superdesign/init/` and approved design system in `.superdesign/design-system.md`.
- Visual companion session: `.superpowers/brainstorm/42386-1786126676/` (ignored; canvas mockups are exploratory).

## Approved Integration Hub decisions

- Use the health-first operator workspace at `/organizations/[organizationId]/integrations` with Connections, Catalog, Data sources, and Activity tabs.
- Google Business Profile is the reference provider, using a deterministic read-only fixture until Google approves API access.
- Provider definitions/adapters live in versioned TypeScript; tenant connection state, grants, mappings, sources, runs, and health live in Postgres.
- Manual and CSV sources are `DataSource` records, not fake provider connections.
- Supabase Vault is behind a server-only `CredentialStore`; application tables store only opaque references and safe metadata.
- Vault is Public Alpha, so real OAuth requires a separate least-privilege, rotation, backup/restore, incident-recovery, and migration security review.
- Trigger.dev owns durable tests, syncs, imports, freshness checks, and cleanup; Postgres remains the source of business state.
- Provider writes, webhooks, n8n, and autonomous execution are excluded from V1.
- Integration UI must compose shadcn/ui and use RSC initial reads, TanStack Query for interactive server state, and TanStack Form for mapping forms.
- Approved Superdesign: `https://p.superdesign.dev/draft/035fe2fe-c036-4158-afb8-972e4222c075`.

## Approved Business Memory decisions

- `public.business_facts` stays the single writable source of truth. Business Memory owns episodic, semantic, decision, outcome, lesson, and fact-proposal items and never copies facts.
- `structured_fact` is a virtual retrieval type produced by read-through projection over `business_facts`, so one API returns both stores ranked together with provenance.
- Ordering is lexicographic: a derived trust rank sorts first and blended relevance only breaks ties inside a rank, so no weight change can rank an inference above a verified fact.
- Retrieval is hybrid Postgres full-text search plus pgvector, shipped enabled with **no** organization allowlist and no feature flag. The bounded 1500 ms embedding call with a lexical-only degrade path replaces the kill switch.
- Embedding is asynchronous; an item is lexically retrievable before its vector exists. The column is fixed at 1536 dimensions and every row stores its `embedding_model`.
- The Integration Hub's `createAcknowledgingDataIngestionPort` stub is deleted and replaced by a real projector for `google_business_profile.location.v1` and `.review.v1`.
- The projector never writes `business_facts`; a divergence becomes a `fact_proposal` that a human confirms through the digital-twin service inside one transaction.
- `csv_import.row` has no destination in this slice and is rejected with `UNSUPPORTED_RECORD_TYPE`. CSV imports will report zero accepted rows with honest operator copy until the Data Ingestion slice lands.
- The workspace at `/organizations/[organizationId]/memory` is Hub-scale with Search, Timeline, Lessons, and Review tabs.
- Redis caches the **ranking, never the content**. Entries hold result identifiers, scores, aggregates, and query vectors; rows are always hydrated from Postgres under the caller's RLS context, so the cache cannot answer a question the database would have refused.
- Every cache key carries the organization ID, a version stamp, and the effective sensitivity ceiling. Omitting the ceiling would serve an admin's ranking to an operator.
- Invalidation bumps a per-organization version stamp holding epoch milliseconds. `KEYS`, unbounded `SCAN`, and `INCR` counters are prohibited; an `INCR` counter resets to 1 after eviction and can collide with live keys, while a timestamp always misses.
- `REDIS_URL` is server-only and optional. Absent, unreachable, or flushed must change latency and nothing else; the suite runs identically in all three states.
- `memory.rebuild-organization-cache` runs daily after `memory.expire-items` to warm snapshot aggregates and recurring-purpose embeddings. It is a warm-and-repair pass, **not** the invalidation mechanism, and nothing may depend on it having run.
- Recorded in `specs/004-business-memory.md`, `adrs/0011-business-memory-read-through-facts.md`, and `adrs/0012-business-memory-cache-boundary.md`.

## Approved onboarding decisions

- Agency operator owns the flow; missing information can be assigned to client contacts.
- All ten sections in `specs/002-guided-onboarding.md` are in scope.
- Six visual phases group the ten sections: Foundation, Commercial context, Customer context, Governance, Data intake, Review.
- The persistent rail exposes all ten sections and their status.
- The focused panel uses directional slide transitions, dynamic height, animated connectors, shadcn controls, and reduced-motion support.
- Save is allowed for incomplete sections. Unknown and needs-attention are explicit states.
- AI extraction is suggestion-only until operator confirmation.
- Implementation uses TanStack Query v5 for the onboarding client snapshot/mutations and TanStack Form v1 for section editors; server reads remain RSC-owned.
- The onboarding control plane is recorded in `adrs/0009-guided-onboarding-control-plane.md` and migration `supabase/migrations/20260807193344_guided_onboarding.sql`.
- Staging Supabase now has all seven repository migrations through `20260808011000_fix_audit_trigger_coalesce.sql`; local and remote migration histories are aligned.
- Database hardening explicitly removes anonymous table privileges, keeps authenticated table grants scoped, hardens tenant-changing `UPDATE` policies, fixes trigger search paths, and covers all foreign keys with indexes.
- The shared Digital Twin audit trigger now normalizes polymorphic trigger rows through JSON before reading table-specific fields. A pgTAP regression test covers organization and business-profile writes plus their audit events.

## Canonical documents

- Product requirements: `specs/002-guided-onboarding.md`, `specs/003-integration-hub.md`, `specs/004-business-memory.md`, `specs/008-ai-readiness-score.md`.
- Approved designs: `docs/superpowers/specs/2026-08-08-guided-onboarding-design.md`, `docs/superpowers/specs/2026-08-08-integration-hub-design.md`.
- UI language: `context/13-ui-ux-context.md`, `.superdesign/design-system.md`.
- Architecture: `context/03-architecture.md`, `context/04-domain-model.md`, `context/05-module-map.md`.

## Architectural decisions and notes

- ADR 0008 adopts TanStack selectively: Query v5 for interactive Client Component server state, Form v1 for complex forms, Table v8 for advanced grids, and Virtual only after measured need.
- React Server Components remain the default for server-owned reads. TanStack is not an application-wide stack.
- Vercel AI SDK and Trigger.dev remain the V1 AI/orchestration choices; TanStack AI, DB, Store, Charts, Hotkeys, Pacer, and Table v9 are deferred.
- ADR 0010 records the fixture-first provider strategy and replaceable Supabase Vault credential boundary.
- Core platform remains industry-neutral; restaurant menu behavior belongs to the Restaurant Industry Pack.
- No model may directly execute destructive or money-moving actions.
- Every AI output requires schema validation, provenance, review hooks, and explicit verification for trusted facts.
- Every organization-owned record must be tenant-scoped in application queries and RLS.
- User-facing UI must compose shadcn/ui primitives. Add missing primitives with `pnpm dlx shadcn@latest add <component>`.
- Use semantic CSS tokens and `cn()`. Do not use `space-y-*`, raw controls, manual color literals, or hidden state changes.

## Blockers and risks

- The Integration Hub migrations are committed but **not applied to staging**. Until they are, the
  Hub's authenticated reads fail closed and the feature cannot be enabled for any organization.
- pgTAP, `supabase db lint --local`, `supabase:reset`, and `pnpm db:types` have never run for the
  Integration Hub schema: this workspace has neither Docker/Podman nor the Supabase CLI. The row
  types in `src/modules/integrations/application/ports.ts` are therefore still hand-written stand-ins
  for the generated `Database` type.
- Fourteen of twenty Integration Hub E2E scenarios skip because no seeded tenant exists. Authorization,
  worker state, CSV import, disconnect, and responsive behaviour are covered by unit and component
  tests but have no browser evidence yet.
- Chrome DevTools verification of the Hub itself is incomplete: the signed-in account in this
  workspace belongs to zero organizations, so only the route chrome and error boundary were inspected.
- Rotate the staging database password and update `.env.local`: the credential was exposed to a local process listing during connection diagnostics. No credential value is recorded in this tracker.
- Supabase Auth leaked-password protection is disabled in the staging project and should be enabled in the dashboard before production use.
- The direct Supabase database hostname is IPv6-only and this development environment has no IPv6 route. CLI database work uses the staging region's session pooler with TLS; the pooler URL is derived at runtime and is not committed.
- Local Supabase reset and pgTAP execution still require Docker/Postgres. Remote migration lint and transaction-safe behavior checks pass, but the CLI's type generator also requires a container even when given the pooler URL; the Supabase project API successfully generated and confirmed the live schema shape.
- Next 16.0.0 reports an inherited security warning during dependency installation; upgrading it is intentionally deferred from this scoped implementation.
- Google Business Profile production access is pending Google approval; V1 must remain in deterministic fixture mode.
- Supabase Vault is Public Alpha; real OAuth is blocked until the credential security gate in `specs/003-integration-hub.md` passes.

## Next implementation sequence

Active implementation work is Business Memory V1. Resume at **Task 8** of
`docs/superpowers/plans/2026-08-09-business-memory-implementation.md` and read
`specs/004-business-memory.md`, `adrs/0011-business-memory-read-through-facts.md`, and
`adrs/0012-business-memory-cache-boundary.md` first. The plan has seventeen tasks.
Tasks 8, 9, and 13 need a Redis instance, and all three must also pass with `REDIS_URL` unset.

Everything below is an Integration Hub release gate that needs credentials or a database runtime,
not further implementation. Gates 1 and 2 also block the Business Memory migrations.

1. Rotate the staging database password and enable leaked-password protection in Supabase Auth.
   Both need dashboard authority no agent in this workspace has.
2. Apply `20260807230118_integration_hub.sql`, `20260808012410_integration_worker_run_transitions.sql`,
   `20260808025602_integration_authenticated_operations.sql`, and
   `20260808033746_integration_data_source_operations.sql` to staging: compare histories, dry-run,
   apply, then run database lint and the security/performance advisors.
3. Run the committed pgTAP test (`supabase test db supabase/tests/database/integration_hub_rls_test.sql`)
   once Docker/Postgres is available, and add it to CI.
4. Regenerate `src/lib/supabase/database.types.ts` and remove the provisional row types in
   `src/modules/integrations/application/ports.ts` that stand in for the generated schema.
5. Seed operator and viewer accounts plus an allowlisted organization, set
   `INTEGRATION_HUB_V1_ORGANIZATION_IDS` and the `E2E_*` variables, then run
   `pnpm test:e2e -- e2e/integration-hub.spec.ts` at desktop and narrow viewports.
6. Repeat Chrome DevTools verification against an authenticated allowlisted organization: all four
   tabs, fixture connect, mapping validation, queued/running/error states, CSV validation and
   import, disconnect, keyboard/focus, 200% zoom, reduced motion, and background refetch.

## Verification record

### Business Memory retrieval verification against a seeded corpus (2026-08-09)

Seeded 1430 realistic memory items plus 14 business facts into **Al Noor Kitchen**
(`2dda45b8-82db-4f5f-b17d-611b9bbb7846`) with `node scripts/seed-business-memory.mjs --reset`.
Content is grounded in `industry-packs/restaurant/dubai-pilot.md` and `playbooks.md`, not filler:
Google reviews, marketplace listing snapshots, daypart observations, agency lessons, decisions,
measured outcomes with baseline and attribution window, client notes, brand documents, and fact
proposals. Distribution: 647 customer-content, 121 proposed, 6 superseded, 30 expired. Two extra
branches (Al Barsha, Deira) were added alongside the existing Jumeirah branch.

**Two retrieval defects were found that an empty table cannot reveal, and both are fixed:**

1. **Filtered HNSW recall was 5%.** A normal operator query returned 1 of the 20 true nearest
   neighbours. An HNSW scan walks roughly `hnsw.ef_search` (default 40) globally nearest
   candidates and applies the WHERE clause afterwards; Business Memory's filter removes
   customer content the caller cannot read, proposed, superseded, and expired items, which is
   close to half a realistic corpus, so almost nothing survived. Fixed in
   `20260809065550_memory_search_hnsw_recall.sql` with pgvector 0.8 iterative scans
   (`hnsw.iterative_scan = relaxed_order`, `hnsw.ef_search = 200`) attached to the function.
   Candidate-pool recall is now 20/20.
2. **The lexical half was effectively dead.** `websearch_to_tsquery` joins terms with AND, so
   "biryani margin discount talabat" matched 1 row where OR matches 202, and
   "packaging leaked delivery" matched 1 where OR matches 15. Fixed in
   `20260809065808_memory_search_lexical_recall.sql` by rebuilding the query as OR'd lexemes;
   precision comes from `ts_rank_cd` ordering rather than from the filter. Lexical signal now
   appears on 12-20 of 20 results instead of about 1.

**A trap worth remembering:** `CREATE OR REPLACE FUNCTION` replaces the function's configuration
too, so the second migration had to restate all three `SET` clauses. Omitting them would have
silently reverted HNSW recall to 5%. `pg_proc.proconfig` is asserted after the change.

Verified after both fixes: all four pgTAP suites pass, `pnpm test` 329 tests, typecheck, lint, and
format clean. The plan uses `memory_items_embedding_idx` (HNSW) and `memory_items_search_idx`
(GIN); the organization predicate is applied inside the scan, and no other tenant's rows are
reachable.

**Not verified:** semantic relevance quality. No embedding API key is configured
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and the Google key are all empty), so the seed wrote
deterministic hashed bag-of-words vectors labelled `embedding_model = 'local-hashed-bow-v1'`.
Those exercise the index and the hybrid merge but say nothing about semantic quality. Re-run the
seed with a real key to replace them.

### Business Memory tasks 1-7 (2026-08-09)

- Applied to the remote database and verified there: `20260809053839_business_memory`,
  `20260809054943_memory_search_function`, `20260809060450_memory_write_operations`, and
  `20260809060647_fix_memory_supersede_digest_schema`. Local and remote histories match.
- pgTAP against the remote database: `business_memory_rls_test` 42 assertions,
  `business_memory_search_test` 8, `business_memory_write_test` 11 - all passing. The
  pre-existing `organization_audit_trigger_test` still passes after the shared audit function
  was extended.
- `pnpm test` passes with **329 tests in 48 files**, up from 249 before this work.
  `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` are clean.
- Remote `supabase db lint` reports no schema errors for `public` and `private`. All three new
  memory trigger functions carry an empty `search_path`.
- Acceptance criterion 2 is proved twice: as a 200-corpus property test over the comparator, and
  in SQL against the real database, where an inference that scores strictly higher on both
  lexical and semantic similarity still ranks below a verified item.
- Not yet verified, because it needs a seeded corpus: that the retrieval query plan uses the GIN
  and HNSW indexes. Against an empty table Postgres sequential-scans regardless, so this is
  deferred to Task 17 step 4 as planned.
- `supabase test db`, `supabase db reset`, and `supabase gen types` cannot run here - no
  container runtime. `pnpm db:test <file>` runs a pgTAP file against the configured database
  instead.
- Three bugs were caught by tests rather than by review, and are described in their commits: a
  pgcrypto function qualified as `pg_catalog.digest` that would have failed on first call, a
  pgTAP assertion that called a function inside a `WHERE` clause and so passed vacuously against
  an empty table, and a fixture that set `verification_state = 'verified'` with no verifying
  actor, which the schema correctly rejected.
- **Correction to an earlier tracker entry:** the four Integration Hub migrations listed as a
  pending staging gate were already applied remotely. `pnpm db:migrations:list` shows all
  thirteen prior versions present on the remote. That gate is closed; the password rotation and
  leaked-password-protection gates remain open.

### Integration Hub V1 (2026-08-08)

- Full gate passed: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test` (**249 tests in 41 files**), and `pnpm build` (compiled successfully,
  8/8 static pages).
- `pnpm test:e2e`: **6 passed, 14 skipped**. The skips are the authenticated Integration Hub
  scenarios; they report their missing environment rather than passing vacuously.
- Integration regression suites pass: repository integration, connection routes, data-source routes,
  and workers -- 42 tests.
- Service-role isolation verified by search: `SUPABASE_SERVICE_ROLE_KEY` appears only in
  `src/lib/env.ts` and `src/lib/supabase/service.ts`, and `src/lib/supabase/service` is imported
  only by `src/trigger/integrations.ts`.
- Chrome DevTools (partial, see blockers): route-aware breadcrumb and the organization sidebar group
  render from the pathname; an inaccessible organization renders the shadcn error boundary with a
  retry control and no leak of the underlying reason; no horizontal overflow at 390px, at a 640px
  CSS viewport (the 200%-zoom equivalent), or at desktop width; the served HTML and all 37 client
  scripts contain none of `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `service_role`,
  `credential_reference`, `internalCause`, `TRIGGER_SECRET_KEY`, or `DB_PASSWORD`. The only console
  error is React's development-mode log of the handled boundary error.
- No provider write or webhook code exists in the runtime: the registry rejects any definition with
  `supportsWebhooks` or `supportsWrites`, and no webhook route is registered.
- Migrations added for the Hub: `20260807230118_integration_hub.sql`,
  `20260808012410_integration_worker_run_transitions.sql`,
  `20260808025602_integration_authenticated_operations.sql`, and
  `20260808033746_integration_data_source_operations.sql`.

- Previous foundation checks passed: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- Passing focused checks: onboarding domain, service, route, rail/workspace, section editor, extraction, and candidate-review tests; `pnpm typecheck`; `pnpm lint`.
- Passing full checks: `pnpm test` (42 tests), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and guided onboarding E2E (2 protected/reduced-motion tests).
- Chrome DevTools MCP verification completed against the running Next.js app: auth redirect/login rendering and the fixture-backed onboarding workspace screenshot were inspected; all ten rail sections and six phases rendered with shadcn controls.
- Staging migration dry-run reports up to date; all seven local migration versions match remote history.
- Remote Supabase database lint passed for `public` and `private` with no schema errors.
- Remote schema verification passed: 18/18 expected tables exist, 18/18 have RLS, 13/13 tenant-changing update policies have privileged `WITH CHECK` rules, authenticated clients have the required table grants, anonymous table grants are zero, and the onboarding storage bucket is private.
- Remote transaction-safe two-tenant verification passed and cleaned up its fixtures: tenant A could not see or update tenant B; an owner in tenant A who was only a viewer in tenant B could not reassign a tenant-owned branch (`SQLSTATE 42501`).
- Supabase security advisor is clear for database schema issues. The only remaining warning is the project-level leaked-password-protection setting. Performance advisor reports only expected unused-index notices on the empty staging schema; all missing-FK-index notices are resolved.
- Audit-trigger pgTAP regression verification passed after first reproducing the prior failure: organization and business-profile writes both succeed and emit the expected audit events.
- Integration Hub Superdesign drafts were repaired after a named-slot projection failure; both variants were browser-rendered, and the user selected the health-first draft.
- Integration Hub documentation was checked against current Google Business Profile prerequisites and Supabase Vault documentation/status; no runtime code or database migration has been applied yet.
- The approved Integration Hub specification now has a 14-task test-first implementation plan with stable interfaces, exact API/UI/worker boundaries, staging security gates, and a final Chrome DevTools verification requirement.

## Notes for future agents

- Read `AGENTS.md`, this tracker, the relevant spec, and the approved design before editing.
- Integration Hub runtime implementation is complete and committed. Do not re-open it as new work; the remaining items in the next-sequence list are environment gates, not code.
- Preserve the approved hybrid layout and operator-first ownership unless the user explicitly changes the decision.
- For Integration Hub work, preserve the approved health-first layout, fixture-first Google provider, no-webhook/no-write V1 boundary, and server-only credential interface.
- Never report a connection as healthy, a sync or import as succeeded, a capability as available, or
  a disconnect as complete from an accepted request alone. Only refetched persisted worker state may
  say so; the UI shows queued or running until then.
- For Business Memory work, never write `business_facts` from the projector or from a model. Memory
  proposes; a human confirms; the digital-twin service performs the write. Never add a rollout flag
  or organization allowlist to Business Memory — the lexical degrade path is the deliberate
  replacement for one, and it must be tested as a first-class behavior rather than an edge case.
- Business Memory retrieval must filter by `organization_id` in SQL before any similarity
  computation. A query plan that filters tenants after the vector operation is a cross-tenant leak,
  not a performance problem.
- Never put memory content in Redis, and never let a cache hit skip RLS hydration. The cache holds
  identifiers and scores; Postgres returns the rows. Both the sensitivity ceiling and the version
  stamp belong in every ranking key. If a change makes the cache faster by removing the hydration
  read, it has removed the only thing making the cache safe.
- The client may read the role-to-permission mapping from `src/domain/integrations/permissions.ts`,
  but enforcement lives only in the service, the routes, and RLS. Do not import
  `src/domain/integrations/errors.ts` from a Client Component: it is server-only and will break the
  build.
