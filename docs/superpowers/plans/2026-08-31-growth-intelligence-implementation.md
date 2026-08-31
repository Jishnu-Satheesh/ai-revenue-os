# Growth Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only when the user explicitly authorizes delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Goal:** Build the approved evidence-first Growth Intelligence loop so an organization can confirm its market, receive recurring cited market and business intelligence, triage advice, and create exactly one governed Campaign draft from an eligible Opportunity without publishing, spending, or approving execution.
- **Architecture:** Postgres owns tenant state, immutable evidence, current-state derivation, durable requests, leases, retries, idempotency, and governed transitions. Trigger.dev carries identifiers and runs bounded research, synthesis, and Campaign-draft workers. The page composes authoritative Opportunities, Channel Recommendations, synthesized intelligence, Data Gaps, and Market Evidence rather than copying them into one feed table.
- **Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, Zod, Supabase/Postgres/Auth/RLS, Trigger.dev, Vercel AI SDK, TanStack Query, shadcn/ui, Vitest, Testing Library, pgTAP, and Playwright.
- **Spec:** `specs/022-growth-intelligence.md`
- **ADR:** `adrs/0044-evidence-first-growth-intelligence.md`
- **Status:** Planning complete when this document passes self-review. No production code, migration, Trigger deployment, or staging mutation is authorized until the user approves this plan.

## Global Constraints

- Read `docs/collaboration/asset-library-and-studio-board.md` before every task, claim every file before opening it for edits, and stop when another active claim overlaps.
- Preserve unrelated worktree changes. Never use `git stash`, destructive checkout, or reset.
- Use `PATH=/home/spy/.local/node/bin:$PATH` for pnpm commands and keep pnpm and Node metadata aligned.
- There is no local database. Never run `supabase start`, `supabase db reset`, Docker, or `pnpm db:types`.
- Create every migration at execution time with `pnpm exec supabase migration new <descriptive_name>` after confirming the hosted-staging migration tail; do not pre-invent a timestamp or edit an applied migration.
- Review every additive migration with `pnpm db:migrations:list` and `pnpm db:migrations:dry-run` before `pnpm db:migrations:push`; only the board's migration owner may push it to shared staging.
- Run every new or replaced PL/pgSQL function that reads another table at least once against hosted staging after apply.
- Maintain `src/lib/supabase/database.types.ts` by hand and satisfy `src/lib/supabase/database.types.test.ts` for every new table and RPC.
- All user-facing reads and mutations use the signed-in Supabase session. Service role access is confined to fenced workers and never substitutes for membership or permission checks.
- Every exposed tenant table enables and forces RLS, uses `(organization_id, id)` uniqueness and tenant-composite foreign keys, receives explicit least-privilege grants, and has indexes for RLS, foreign keys, leases, and bounded reads.
- Every security-definer function uses `set search_path = ''`, reloads tenant and actor or worker authority, revokes execution from `PUBLIC`, `anon`, and unauthorized roles, and grants only the exact caller.
- Postgres owns work state, due time, claims, leases, attempts, cancellation, terminal outcome, replay, current state, and audit. Trigger.dev accepts identifiers and correlation metadata only.
- No external request runs inside a database transaction or while holding a database lock.
- Opening `/growth-intelligence` is read-only and never triggers research, analysis, synthesis, or Campaign creation.
- Public source content is untrusted data. It cannot select tools, expand scope, change prompts or policy, create an action, or supply a tenant identity.
- External research rejects private, loopback, link-local, metadata-service, internal, non-HTTP(S), DNS-rebound, and unsafe-redirect targets. It respects paywalls, authentication, CAPTCHAs, robots controls, and provider terms.
- Raw reports, workbook rows or cells, formulas, private storage paths, signed URLs, credentials, prompts containing sensitive data, and customer PII never cross the research or model boundary and never enter logs or snapshots.
- Models may propose profiles, bounded queries, claim candidates, connections, and narratives. Deterministic code owns source class, support grade, freshness, materiality, priority, money, eligibility, policy, permission, suppression, and outcome verdicts.
- A model never chooses a financial value, confidence value, rank, risk tier, Campaign readiness result, or realized-result claim.
- Advice may appear with an explicit limitation. Stale business evidence blocks a Campaign Opportunity but does not suppress a supported Insight or Recommendation.
- Current activity month, governed business evidence window, source observation date, and source retrieval date remain distinct everywhere.
- Channel Recommendations and Opportunities remain authoritative in their own modules. Growth Intelligence never copies their lifecycle into `growth_intelligence_items`.
- A manual Recommendation `planned` decision records intent only. It never means completed or effective.
- Opportunity CTA copy is `Create governed draft`. Draft success requires a linked Campaign and frozen source snapshot; it never implies generation, approval, scheduling, publishing, spend, or measurement.
- Campaign approval continues to require `campaign.approve`; draft creation requires `campaign.create` and cannot reuse approval wording or authority.
- Core logic stays industry-neutral. The Dubai Kerala-cuisine scenario is a redacted acceptance fixture, not platform-core policy.
- All timestamps persist in UTC and render in the organization's configured timezone. All money remains integer minor units with ISO currency.
- Each increment is off by default behind a server-only organization allowlist. Membership is checked before a rollout refusal so the flag cannot enumerate organizations.
- Git push is the user's step.

## Release Decomposition

- **Increment 1 — Market intelligence foundation:** Market Profile proposal and confirmation, source policy, durable work, one qualified research adapter, cited Market Evidence, daily and weekly work, recovery, a read-only Market Watch, and a controlled canary.
- **Increment 2 — Automatic business synthesis:** ADR 0043 monthly analysis resolution, transactional report-current handoff, existing Channel Recommendation chaining, governed synthesis, new typed items, freshness, lineage, and duplicate suppression.
- **Increment 3 — Growth Intelligence experience:** Composed read model, renamed route and navigation, Priority actions, Insights, Market Watch, Data Gaps, Timeline, current-month behavior, synchronized source decisions, pins, and role-controlled triage.
- **Increment 4 — Governed Campaign handoff:** Active-opportunity uniqueness repair, deterministic impact and eligibility, draft playbook, atomic request, complete source snapshot, exactly-once Campaign creation, retry behavior, and verified-outcome separation.
- Each increment must be deployable and testable on its own, must have its own rollout allowlist, and must be disabled safely without deleting evidence or history.
- Increment 2 depends on Increment 1. Increment 3 depends on the read contracts from Increments 1 and 2. Increment 4 depends on all earlier increments but may remain disabled while the client-visible intelligence experience ships.

## Planned File Structure

- Create pure Growth Intelligence contracts under `src/domain/growth-intelligence/` with one file per responsibility and an explicit `index.ts` export surface.
- Create application services and ports under `src/modules/growth-intelligence/application/`.
- Create session-bound repositories, model providers, and research safety boundaries under `src/modules/growth-intelligence/infrastructure/`.
- Create bounded workflow functions under `src/workflows/growth-intelligence/` and Trigger task definitions in `src/trigger/growth-intelligence.ts`.
- Create client components under `src/components/growth-intelligence/`.
- Create organization-scoped APIs under `src/app/api/organizations/[organizationId]/growth-intelligence/` and `src/app/api/organizations/[organizationId]/market-profile/`.
- Create the canonical page under `src/app/(platform)/organizations/[organizationId]/growth-intelligence/` and retain a redirect under the existing `opportunities` route.
- Add focused pgTAP suites under `supabase/tests/database/`; migrations are generated with descriptive names at execution time.
- Add full-flow browser coverage in `e2e/growth-intelligence.spec.ts` and redacted canary evidence under `docs/verification/growth-intelligence/`.

## Stable Interfaces

- `MarketProfileDocumentV1` carries schema version, public identity, niche descriptors, branch trade areas, city/country, competitors, topics, source exclusions, disclosure limits, timezone, and research cadence.
- `createMarketProfileDigest(document: MarketProfileDocumentV1): string` canonicalizes the bounded profile document and excludes volatile proposal metadata.
- `GrowthIntelligenceRequestKind` is `profile_discovery`, `market_research`, `weekly_synthesis`, `business_evidence_changed`, or `evidence_reassessment`.
- `createGrowthIntelligenceRequestFingerprint(input: GrowthIntelligenceRequestFingerprintInput): string` binds organization scope, request kind, trigger reason, evidence digest or absence, profile version, source/research rules, local time bucket, and synthesis/playbook versions.
- `MarketEvidenceSupportGrade` is `primary`, `corroborated`, `single_source`, `contextual`, or `conflicted` and is returned only by `classifyMarketEvidenceSupport`.
- `MarketEvidenceGeography` is exactly one of `trade_area`, `city`, or `country` plus a normalized location reference.
- `GrowthIntelligenceItemKind` is `insight`, `recommendation`, or `data_gap`; Opportunity remains owned by the Decision Engine.
- `GrowthIntelligenceReadModel` exposes `opportunities`, `recommendations`, `insights`, `marketWatch`, `dataGaps`, `timeline`, bounded cursors, source counts, activity month, and carry-over labels without duplicating source state.
- `ResearchAdapter` accepts one approved bounded query batch and returns normalized source results with safe fetch state, citation metadata, retrieval time, provider cost, and content digests; it never returns unrestricted browser capability.
- `SynthesisProvider` accepts compact current business findings, eligible Market Evidence Claims, approved goals/profile context, and allowed preference signals; it returns schema-validated cited candidates only.
- `evaluateCampaignDraftEligibility` returns either a complete deterministic eligibility result and assertions or named blocking Data Gaps. A partial result cannot create an Opportunity.
- `request_campaign_draft_from_opportunity` is the only user mutation that transitions a governed-draft Opportunity and inserts or replays a Campaign draft request.
- `complete_campaign_draft_request` is the only worker completion that binds the Campaign, source snapshot, request, and Opportunity `draft_created` state atomically.

## Open Assumptions and Execution Gates

- One search/content provider is not yet qualified. Task 6 is a mandatory commercial, privacy, retention, security, terms, citation, crawl, cost, and controlled-canary gate; production research remains disabled until it passes.
- Provider credentials, daily/weekly cost ceilings, and the first canary organization must be supplied through the existing secret and environment process before live enablement.
- ADR 0043 is accepted but not implemented in this worktree. Task 11 resumes it as a prerequisite for report-driven synthesis; current free-form or package-window behavior is not reused.
- Existing Channel analysis and Recommendation files remain under another active board claim at plan time. Tasks 11 through 16 cannot start until those claims are released or explicitly handed over.
- A deterministic Campaign-specific impact method does not yet exist. Task 20 must define a versioned method from governed inputs; when no defensible range exists, the result remains a Recommendation with a Data Gap.
- The existing active-opportunity uniqueness rule has a known cross-playbook regression. Task 19 repairs it before the governed-draft playbook is seeded or enabled.
- Core may accept Industry Pack topic declarations, but no restaurant-specific detector, source list, competitor rule, or priority rule is added by this plan.
- Existing environment allowlist conventions are reused instead of adding a mutable feature-flag table: `GROWTH_INTELLIGENCE_MARKET_ORGANIZATION_IDS`, `GROWTH_INTELLIGENCE_SYNTHESIS_ORGANIZATION_IDS`, `GROWTH_INTELLIGENCE_TRIAGE_ORGANIZATION_IDS`, and `GROWTH_INTELLIGENCE_CAMPAIGN_DRAFT_ORGANIZATION_IDS`.
- Migration filenames are generated only when each database task begins. The plan names each migration by its required descriptive slug and never assumes a timestamp.

---

## Increment 1 — Market Intelligence Foundation

### Task 1: Lock pure Market Profile, request, evidence, and materiality contracts

- **Files:**
  - Create `src/domain/growth-intelligence/types.ts`.
  - Create `src/domain/growth-intelligence/schemas.ts` and `schemas.test.ts`.
  - Create `src/domain/growth-intelligence/profile-digest.ts` and `profile-digest.test.ts`.
  - Create `src/domain/growth-intelligence/request-fingerprint.ts` and `request-fingerprint.test.ts`.
  - Create `src/domain/growth-intelligence/evidence-quality.ts` and `evidence-quality.test.ts`.
  - Create `src/domain/growth-intelligence/geography.ts` and `geography.test.ts`.
  - Create `src/domain/growth-intelligence/material-change.ts` and `material-change.test.ts`.
  - Create `src/domain/growth-intelligence/errors.ts`.
  - Create `src/domain/growth-intelligence/index.ts`.
- **Interfaces:**
  - Produce every stable pure interface named in the Stable Interfaces section except Campaign eligibility.
  - Keep Zod documents strict, versioned, bounded, and able to represent explicit `unknown` without silently defaulting a fact.
- **Steps:**
  - [x] Write failing schema tests for valid/invalid profile documents, normalized competitors and geography, source exclusions, disclosure limits, cadence, unknown fields, collection caps, URL/domain normalization, and immutable schema version.
  - [x] Write failing property tests proving profile and request digests are stable under key order and invalidated by every bound semantic change.
  - [x] Write failing evidence tests for source hierarchy, corroboration, contradiction, freshness registry, expiry, excluded sources, geographic compatibility, and material-change suppression.
  - [x] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/growth-intelligence` and verify failure because the contracts are absent.
  - [x] Implement only deterministic domain logic; do not import Supabase, Trigger.dev, a model SDK, or Next.js.
  - [x] Add redacted Dubai trade-area/city/country fixtures that contain no client identity or private business values.
  - [x] Re-run the focused suite and verify every contract passes, including mixed geography and stale/conflicted refusal cases.
  - [x] Commit only these files as `feat(growth-intelligence): define governed market evidence contracts`.

### Task 2: Add rollout access and Growth Intelligence permissions

- **Files:**
  - Modify `src/lib/env.ts`.
  - Create `src/modules/growth-intelligence/application/feature-access.ts` and `feature-access.test.ts`.
  - Modify `src/domain/access/permissions.ts`, `permissions.test.ts`, and `permissions.drift.test.ts`.
  - Create migration with slug `growth_intelligence_permissions`.
  - Modify `supabase/tests/database/permission_catalogue_test.sql`.
- **Interfaces:**
  - Produce `assertGrowthIntelligenceAccess(organizationId, increment)` and `hasGrowthIntelligenceAccess(organizationId, increment)` for `market`, `synthesis`, `triage`, and `campaign_draft`.
  - Add `growth_intelligence.read` to viewer and above and `growth_intelligence.manage` to operator and above.
  - Preserve `recommendation.triage`, `campaign.create`, `campaign.approve`, and `opportunity.approve` as separate permissions.
- **Steps:**
  - [ ] Write failing tests for empty and duplicate allowlist entries, case-normalized UUIDs, increment separation, and membership-before-rollout route ordering.
  - [ ] Write failing permission tests proving role nesting and the exact new read/manage matrix.
  - [ ] Implement environment parsing and the application-side rollout mirror.
  - [ ] Generate and review the permission migration; seed the catalogue and role mappings without widening any existing permission.
  - [ ] Run migration dry-run, push as the migration owner, run the focused permission pgTAP suite, and verify direct unauthorized permission use fails.
  - [ ] Update the handwritten database types only if the migration changes typed RPCs or tables.
  - [ ] Run focused Vitest, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(access): govern Growth Intelligence rollout and roles`.

### Task 3: Persist Market Profiles and the durable request ledger

- **Files:**
  - Create migration with slug `growth_intelligence_profiles_and_requests`.
  - Create `supabase/tests/database/growth_intelligence_profiles_test.sql`.
  - Create `supabase/tests/database/growth_intelligence_requests_test.sql`.
  - Modify `src/lib/supabase/database.types.ts` and `database.types.test.ts`.
- **Schemas and operations:**
  - Add `organization_market_profiles`, `organization_market_profile_versions`, `organization_market_profile_decisions`, and `growth_intelligence_requests` exactly as specified.
  - Add append-only guards for versions and decisions; a current profile pointer changes only through the decision operation.
  - Add `propose_market_profile_version`, `decide_market_profile_version`, `enqueue_growth_intelligence_request`, `retry_growth_intelligence_request`, `claim_growth_intelligence_request`, `complete_growth_intelligence_request`, `fail_growth_intelligence_request`, `cancel_growth_intelligence_request`, and `claim_due_growth_intelligence_requests`.
  - Make profile confirmation, automatic supersession of the prior current version, and the initial research request one transaction. Replay returns the same version, decisions, and request identifiers.
  - Append identifier-only audit events in the same transaction as each committed state change; `market_research.requested` records durable request admission before any best-effort wake-up.
- **Steps:**
  - [ ] Write pgTAP red tests for two-account/two-organization reads and mutations, viewer/operator/admin behavior, append-only enforcement, automatic prior-version supersession, one-current-version invariant, digest replay, request fingerprint uniqueness, due indexes, leases, fencing, retry, cancellation, identifier-only audit, and explicit grants.
  - [ ] Generate the migration, inspect all referenced columns and existing membership helpers, and keep JSON document validation aligned with Task 1's schema version and allowlists.
  - [ ] Add tenant-composite foreign keys and indexes before enabling and forcing RLS.
  - [ ] Implement narrow security-definer operations with empty search paths and exact grants; no authenticated caller may invoke worker claim/completion functions.
  - [ ] Dry-run and push the migration, run focused pgTAP, then invoke every new function once on staging with a rollback-safe fixture transaction where possible.
  - [ ] Hand-maintain table/RPC types and prove the database type drift test passes.
  - [ ] Run `pnpm db:test`, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(growth-intelligence): persist profiles and durable work`.

### Task 4: Build Market Profile proposal, review, and confirmation boundaries

- **Files:**
  - Create `src/modules/growth-intelligence/application/ports.ts`.
  - Create `src/modules/growth-intelligence/application/profile-service.ts` and `profile-service.test.ts`.
  - Create `src/modules/growth-intelligence/application/api-schemas.ts` and `api-schemas.test.ts`.
  - Create `src/modules/growth-intelligence/infrastructure/profile-repository.ts` and `profile-repository.test.ts`.
  - Create `src/modules/growth-intelligence/infrastructure/profile-proposal-provider.ts` and `profile-proposal-provider.test.ts`.
  - Create `src/app/api/organizations/[organizationId]/market-profile/route.ts` and `route.test.ts`.
  - Create `src/app/api/organizations/[organizationId]/market-profile/proposals/route.ts` and `route.test.ts`.
  - Create `src/app/api/organizations/[organizationId]/market-profile/versions/[versionId]/decisions/route.ts` and `route.test.ts`.
- **Interfaces:**
  - `MarketProfileService.propose` reads confirmed Digital Twin facts, performs one bounded discovery request, validates the candidate, and persists a proposal only.
  - `MarketProfileService.decide` accepts `confirmed`, `rejected`, or `disabled`, exact version/digest, bounded reason, and correlation ID; confirmation supersedes the prior current version and enqueues recurring or evidence-reassessment work.
- **Steps:**
  - [ ] Write failing service and route tests for membership, rollout, read/manage permission, bounded discovery input, malformed model output, one repair attempt, replay, stale version decision, automatic supersession, source exclusion revision, disablement, and safe public errors.
  - [ ] Prove in tests that a proposal cannot start research, change the current profile, or create visible Market Evidence.
  - [ ] Implement the signed-in repository and strict model provider; pass only confirmed public identity, niche, location, and topics and exclude raw business evidence.
  - [ ] Implement routes in the order membership, rollout, permission, Zod parse, service call.
  - [ ] Emit identifier-only `market_profile.proposed`, `market_profile.confirmed`, `market_profile.revision_proposed`, and `market_profile.disabled` events from committed domain outcomes.
  - [ ] Run focused Vitest, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(growth-intelligence): govern market profile approval`.

### Task 5: Qualify and fence the public research adapter

- **Files:**
  - Create `docs/provider-contracts/market-research-v1.md`.
  - Create `docs/verification/growth-intelligence/research-adapter-qualification.md`.
  - Create `src/modules/growth-intelligence/infrastructure/research/ports.ts`.
  - Create `src/modules/growth-intelligence/infrastructure/research/safe-public-http.ts` and `safe-public-http.test.ts`.
  - Create `src/modules/growth-intelligence/infrastructure/research/query-plan.ts` and `query-plan.test.ts`.
  - Create `src/modules/growth-intelligence/infrastructure/research/qualified-provider.ts` and `qualified-provider.test.ts`.
  - Create redacted recorded fixtures under `src/modules/growth-intelligence/infrastructure/research/__fixtures__/`.
- **Interfaces and external gate:**
  - `ResearchAdapter.searchAndFetch` accepts only approved profile scope, query count, result count, byte, redirect, timeout, and cost ceilings.
  - The provider contract records official endpoints, versions, auth, fields, citations, retry facts, data retention/training/residency, terms, robots behavior, commercial approval, and verified failure semantics.
  - The adapter remains unavailable when any required contract fact or controlled-canary evidence is absent.
- **Steps:**
  - [ ] Select one provider only after comparing official documentation and legal/commercial/privacy/security requirements; record the decision and dated sources in the provider contract.
  - [ ] Stop this task without enabling research if provider terms, citation provenance, retention, SSRF controls, or cost ceilings cannot satisfy the approved spec.
  - [ ] Write contract tests for success, partial results, robots/access refusal, paywall/CAPTCHA, redirect, timeout before and after request, rate limit, malformed content, removed source, cost ceiling, and safe normalized errors.
  - [ ] Write SSRF and DNS tests for loopback, RFC1918, link-local, IPv6 local, metadata hosts, credential-bearing URLs, unsafe ports, DNS rebinding, redirect escape, and non-HTTP(S) schemes.
  - [ ] Write adversarial tests proving source text cannot change query scope, call another tool, inject instructions, or select the tenant.
  - [ ] Implement the deterministic query executor and bounded adapter from the verified contract only; do not invent retry codes, fields, or permissions.
  - [ ] Capture one controlled, redacted canary retrieval with citations, safe identifiers, measured latency/cost, failure cleanup, and no stored full page.
  - [ ] Run focused tests, typecheck, lint, and secret/sensitive-log scans.
  - [ ] Commit as `feat(growth-intelligence): qualify bounded public research` only when the adapter gate is fully evidenced; otherwise commit the reviewed refusal state without enabling the adapter.

### Task 6: Persist immutable Market Evidence and current-state events

- **Files:**
  - Create migration with slug `growth_intelligence_market_evidence`.
  - Create `supabase/tests/database/market_evidence_test.sql`.
  - Modify `src/lib/supabase/database.types.ts` and `database.types.test.ts`.
  - Create `src/modules/growth-intelligence/infrastructure/evidence-repository.ts` and `evidence-repository.test.ts`.
- **Schemas and operations:**
  - Add `market_research_runs`, `market_evidence_sources`, `market_evidence_claims`, `market_evidence_claim_events`, and `market_evidence_links`.
  - Add `begin_market_research_run`, `complete_market_research_run`, `fail_market_research_run`, `record_market_evidence_claims`, and `append_market_evidence_claim_event` with request fencing.
  - Claims and links are immutable; expiry, withdrawal, exclusion, correction, and supersession append events.
- **Steps:**
  - [ ] Write pgTAP red tests for RLS, grants, cross-tenant source/link refusal, append-only claims/events, fenced writes, digest replay, bounded quotations, source exclusion, current-state derivation, corroboration and contradiction edges, and partial run preservation.
  - [ ] Generate the migration and align relational fields and bounded JSON allowlists with the section 7.2 claim contract.
  - [ ] Add tenant-leading indexes for active/fresh claims, profile/run lineage, source-domain exclusion, geography, expiry, and evidence links.
  - [ ] Implement repository integration tests proving only compact claims and citation metadata cross the boundary and no full public page is persisted.
  - [ ] Dry-run, push, run focused pgTAP, and invoke every new function once on staging.
  - [ ] Update handwritten types and run the database type drift test.
  - [ ] Run `pnpm db:test`, focused Vitest, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(growth-intelligence): store cited market evidence`.

### Task 7: Run daily research, weekly consolidation, and durable recovery

- **Files:**
  - Create `src/workflows/growth-intelligence/run-market-research.ts` and `run-market-research.test.ts`.
  - Create `src/workflows/growth-intelligence/consolidate-market-evidence.ts` and `consolidate-market-evidence.test.ts`.
  - Create `src/workflows/growth-intelligence/dispatch-due-work.ts` and `dispatch-due-work.test.ts`.
  - Create `src/trigger/growth-intelligence.ts` and `growth-intelligence.test.ts`.
  - Modify `trigger.config.ts` only if the new task module is not discovered by the existing configuration.
- **Interfaces:**
  - Add `growth-intelligence.dispatch-due` as the scheduled sweeper, `growth-intelligence.run-market-research` as an identifier-only `schemaTask`, and `growth-intelligence.consolidate-market-evidence` as the weekly identifier-only task.
  - Research completion emits `market_research.completed`, `market_research.partially_completed`, or `market_research.failed` from persisted outcome state.
- **Steps:**
  - [ ] Load the Trigger authoring skill before editing task definitions.
  - [ ] Write failing workflow tests for organization-timezone due selection, daily and weekly buckets, immediate dispatch, lost dispatch, duplicate Trigger delivery, expired lease, cancellation, partial source failure, adapter/model budget, and per-organization concurrency.
  - [ ] Write tests proving worker payloads contain identifiers only and every worker reloads the approved profile, source policy, request version, and tenant scope after claim.
  - [ ] Implement claim, bounded query planning, adapter execution outside the claim transaction, deterministic evidence grading, fenced completion, and safe failure mapping.
  - [ ] Make unchanged evidence update run lineage without creating a materially duplicate current claim or visible card.
  - [ ] Persist any newly inferred competitor, topic, geography, or source-rule change as an immutable profile proposal only; prove it cannot alter active research until an operator confirms it.
  - [ ] Enqueue evidence reassessment when a source expires, is excluded, is withdrawn, or materially changes, so derived current items can supersede without rewriting history.
  - [ ] Add structured identifier-only logs and latency/cost metrics; scan tests for raw content, source pages, prompts, private paths, and client data.
  - [ ] Run focused workflow/Trigger tests, typecheck, lint, and Trigger task contract checks.
  - [ ] Deploy tasks only after code and staging schema are present and the provider gate is green.
  - [ ] Commit as `feat(growth-intelligence): run durable market monitoring`.

### Task 8: Ship Market Profile review and read-only Market Watch

- **Files:**
  - Create `src/modules/growth-intelligence/application/market-watch.ts` and `market-watch.test.ts`.
  - Create `src/modules/growth-intelligence/infrastructure/read-repository.ts` and `read-repository.test.ts`.
  - Create `src/app/api/organizations/[organizationId]/growth-intelligence/route.ts` and `route.test.ts` with Market Watch and profile status only in this increment.
  - Create `src/app/api/organizations/[organizationId]/growth-intelligence/requests/[requestId]/retry/route.ts` and `route.test.ts`.
  - Create `src/components/growth-intelligence/market-profile-review.tsx` and `market-profile-review.test.tsx`.
  - Create `src/components/growth-intelligence/market-watch.tsx` and `market-watch.test.tsx`.
  - Create `src/components/growth-intelligence/source-evidence-drawer.tsx` and `source-evidence-drawer.test.tsx`.
  - Create `src/app/(platform)/organizations/[organizationId]/growth-intelligence/page.tsx`, `loading.tsx`, and `error.tsx`.
  - Modify `src/lib/routes.ts` and add or modify its test.
- **Interfaces:**
  - `buildMarketWatch` returns only current eligible claims plus explicit stale, withdrawn, excluded, conflicted, or delayed states; it never triggers a request.
  - The page loader checks membership, market rollout, and `growth_intelligence.read` before any tenant read.
- **Steps:**
  - [ ] Write failing read and retry-route tests for bounded pagination, profile absence, stale and conflicted claims, three geographic layers, source citations, retrieval/publication dates, exclusions, membership, manage permission, eligible retry state, server-owned scope/provider/query inputs, and cross-tenant rows.
  - [ ] Write component tests for proposal review, exact confirmation, disabled profile, read-only viewer, operator controls, empty, delayed, partial, failed, stale, and source-drawer states.
  - [ ] Implement the session-bound read repository and Market Watch builder without a generic feed table.
  - [ ] Implement profile confirmation controls with non-optimistic success; success appears only after the authoritative read returns the approved version and request identifier.
  - [ ] Render source URL, publisher, source class, retrieval/observation date, geography, support grade, freshness, conflict, and limitations on every applicable signal.
  - [ ] Add the canonical route helper but do not remove or redirect the Opportunities page until Increment 3 is enabled.
  - [ ] Run focused Vitest, typecheck, lint, build, and authenticated browser checks at desktop and mobile widths with console/network inspection and keyboard focus.
  - [ ] Commit as `feat(growth-intelligence): ship governed Market Watch`.

### Task 9: Pass the Increment 1 canary gate

- **Files:**
  - Create `docs/verification/growth-intelligence/increment-1-canary.md`.
  - Modify `progress-tracker.md` only to record verified state.
- **Steps:**
  - [ ] Enable only the approved canary organization in `GROWTH_INTELLIGENCE_MARKET_ORGANIZATION_IDS`.
  - [ ] Confirm a redacted Market Profile and capture safe profile/request/run identifiers.
  - [ ] Observe one immediate research run, one scheduled due/recovery path, and one weekly consolidation result.
  - [ ] Verify every visible claim has a working citation, attribution, retrieval date, geography, support/freshness state, and limitation and that no full source content or business payload is stored or logged.
  - [ ] Run two-tenant direct read/write/RPC misuse checks, queue/lease recovery checks, database advisors, and the full Increment 1 test set.
  - [ ] Disable the rollout flag and prove new work stops while prior evidence remains readable through authorized diagnostics.
  - [ ] Record measured latency, cost, partial/failure behavior, and remaining release limits without claiming business impact.
  - [ ] Commit as `docs(growth-intelligence): verify the market intelligence canary`.

## Increment 2 — Automatic Business Synthesis

### Task 10: Implement ADR 0043 monthly evidence resolution and content-addressed reuse

- **Files:**
  - Modify `src/domain/analysis/calendar.ts` and `calendar.test.ts`.
  - Modify `src/modules/analysis/application/ports.ts`, `read-model.ts`, `dispatch.ts`, and focused tests.
  - Modify `src/modules/analysis/infrastructure/evidence-repository.ts`, `read-repository.ts`, and focused tests.
  - Modify `src/workflows/analysis/run-channel-analysis.ts` and its test.
  - Modify `src/trigger/analysis.ts` and its test.
  - Modify `src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route.ts` and `route.test.ts`.
  - Modify `src/components/analysis/channel-workspace.tsx` and its test.
  - Modify `src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx` and its test.
  - Create migration with slug `channel_analysis_month_cache`.
  - Modify `supabase/tests/database/governed_channel_analysis_test.sql`.
  - Modify `src/lib/supabase/database.types.ts` when the run/RPC shape changes.
- **Interfaces:**
  - The route accepts canonical `YYYY-MM` only; the server resolves local bounds, branch scope, grain, current evidence digest, and version tuple.
  - Completed immutable `channel_analysis_runs` are reusable only for an identical content-addressed cache key recomputed under the worker lease.
- **Steps:**
  - [ ] Re-read ADR 0043 and its approved companion design, then acquire all currently active analysis claims before editing.
  - [ ] Write failing pure tests for canonical months, leap years, horizon edges, internal empty months, no-evidence success, and disabled future/out-of-horizon choices.
  - [ ] Write failing repository/worker tests for current-only evidence, branch/timezone/grain limitations, cache hit, invalidation on every evidence/reconciliation/version change, and invalidation during claim.
  - [ ] Generate the additive migration for `evidence_digest`, `cache_key`, constrained metadata, and tenant-leading completed-cache index; retain existing immutable run ownership.
  - [ ] Implement server resolution and remove caller-supplied raw dates, grain, and branch from the analysis admission path.
  - [ ] Replace the package selector with Month and Year controls and preserve the month in the URL without changing evidence dates.
  - [ ] Dry-run, push, run pgTAP, and invoke each replaced claim/admission function on staging.
  - [ ] Run focused analysis tests, full pgTAP, typecheck, lint, build, and the authenticated month-selection walkthrough.
  - [ ] Commit as `feat(analysis): resolve governed monthly evidence windows`.

### Task 11: Enqueue intelligence work transactionally when governed evidence becomes current

- **Files:**
  - Create migration with slug `enqueue_growth_intelligence_on_report_current`.
  - Modify `supabase/tests/database/governed_report_projection_test.sql`.
  - Modify `supabase/tests/database/governed_report_period_grain_projection_test.sql`.
  - Modify `supabase/tests/database/governed_report_reconciliation_test.sql`.
  - Modify `supabase/tests/database/growth_intelligence_requests_test.sql`.
  - Modify `src/workflows/reports/project-report-package.test.ts` only for the identifier handoff contract.
  - Modify `src/trigger/reports.ts` and its test only for immediate wake-up after the committed database outcome.
- **Schemas and blast radius:**
  - Replace forward the current definitions of `complete_governed_report_package_projection`, `complete_governed_report_package_period_grain_projection`, `resolve_governed_report_projection_overlap`, and `resolve_governed_report_projection_overlap_group` so every change to current governed evidence inserts or replays monthly intelligence requests in the same transaction.
  - Preserve current projection, revision, reconciliation, validation, and audit semantics; the new enqueue cannot turn a failed projection into success.
- **Steps:**
  - [ ] Trace the authoritative current-evidence writes and write pgTAP red tests for exact-range completion, period-grain completion, correction, supersession, single/group reconciliation, multi-month packages, multi-channel packages, duplicate upload, and replay.
  - [ ] Prove each affected `organization + channel + month` gets one request and one channel's failure does not block another.
  - [ ] Generate the migration by copying the current live function definitions and adding only the transactional request insert/replay after current-state success.
  - [ ] Keep the full declared report period in lineage while binding each request to the server-resolved monthly evidence digest.
  - [ ] Return safe request identifiers from committed outcomes so Trigger wake-up is latency optimization, not durability.
  - [ ] Dry-run, push, run focused and full pgTAP, and call every replaced function on staging using current valid fixture paths.
  - [ ] Run workflow/Trigger tests and verify a lost immediate wake remains discoverable by the sweeper.
  - [ ] Commit as `feat(reports): enqueue intelligence from current evidence`.

### Task 12: Define deterministic synthesis, typed items, priority, and duplicate rules

- **Files:**
  - Create `src/domain/growth-intelligence/synthesis.ts` and `synthesis.test.ts`.
  - Create `src/domain/growth-intelligence/items.ts` and `items.test.ts`.
  - Create `src/domain/growth-intelligence/priority.ts` and `priority.test.ts`.
  - Create `src/domain/growth-intelligence/lineage.ts` and `lineage.test.ts`.
  - Modify `src/domain/growth-intelligence/index.ts`.
- **Interfaces:**
  - `validateSynthesisCandidate` verifies citations, geography, freshness, exclusions, item kind, safe narrative, and limitations before persistence.
  - `createGrowthIntelligenceItemFingerprint` binds material narrative/evidence identity and suppresses byte-identical or evidence-identical repeats.
  - `buildRecommendationPriority` returns an explainable band and ordered components without a blended money/confidence score.
- **Steps:**
  - [ ] Write failing tests for Insight, Recommendation, Data Gap, stale-business advice, conflicting market evidence, wrong geography, excluded source, missing citation, unsupported causal language, and Campaign-ineligible output.
  - [ ] Write failing ordering tests for urgency, goal priority, support, freshness, deterministic impact presence, mixed currency refusal, stable tie-breaking, and user pin separation.
  - [ ] Write material-change tests proving unchanged daily evidence does not create a new item while changed evidence, limitations, or narration lineage creates a new untriaged item.
  - [ ] Implement pure deterministic validators and digests; do not add database or model imports.
  - [ ] Add adversarial fixtures for prompt injection, invented prices/events/trends/impact/confidence/sources/outcomes, unsupported Campaign action, and stale-evidence promotion.
  - [ ] Run focused Vitest and verify deterministic business findings survive invalid synthesis candidates.
  - [ ] Commit as `feat(growth-intelligence): validate typed business synthesis`.

### Task 13: Persist synthesis runs, items, lineage, decisions, and pins

- **Files:**
  - Create migration with slug `growth_intelligence_synthesis_items`.
  - Create `supabase/tests/database/growth_intelligence_synthesis_test.sql`.
  - Create `supabase/tests/database/growth_intelligence_item_decisions_test.sql`.
  - Modify `src/lib/supabase/database.types.ts` and `database.types.test.ts`.
  - Create `src/modules/growth-intelligence/infrastructure/synthesis-repository.ts` and `synthesis-repository.test.ts`.
- **Schemas and operations:**
  - Add `growth_intelligence_synthesis_runs`, `growth_intelligence_items`, `growth_intelligence_item_market_claims`, `growth_intelligence_item_channel_findings`, `growth_intelligence_item_goals`, `growth_intelligence_item_decisions`, `growth_intelligence_item_preferences`, `channel_recommendation_preferences`, and `opportunity_preferences`.
  - Add `begin_growth_intelligence_synthesis`, `complete_growth_intelligence_synthesis`, `fail_growth_intelligence_synthesis`, `decide_growth_intelligence_item`, and `set_growth_intelligence_preference`.
  - Use source-specific tenant-composite links; do not add unchecked polymorphic evidence identifiers.
- **Steps:**
  - [ ] Write pgTAP red tests for two-tenant RLS, append-only runs/items/decisions, immutable lineage, fingerprint idempotency, supersession, actor-scoped pins, Data Gap resolution, snooze future-time validation, and direct RPC permission misuse.
  - [ ] Prove a Channel Recommendation or Opportunity identifier cannot be inserted as a synthesized item copy and a cross-tenant source link fails.
  - [ ] Generate the migration with indexes for current items, activity month, kind, source links, unresolved carry-over, expiry, user pins, and bounded timeline reads.
  - [ ] Implement repository tests for fenced completion and partial failure without erasing deterministic findings or validated claims.
  - [ ] Dry-run, push, run focused/full pgTAP, invoke every new function once, and update handwritten types.
  - [ ] Run focused Vitest, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(growth-intelligence): persist governed synthesis`.

### Task 14: Run synthesis after business or market evidence changes

- **Files:**
  - Create `src/modules/growth-intelligence/infrastructure/synthesis-provider.ts` and `synthesis-provider.test.ts`.
  - Create `src/modules/growth-intelligence/application/synthesis-service.ts` and `synthesis-service.test.ts`.
  - Create `src/workflows/growth-intelligence/run-synthesis.ts` and `run-synthesis.test.ts`.
  - Modify `src/trigger/growth-intelligence.ts` and `growth-intelligence.test.ts`.
- **Interfaces:**
  - `growth-intelligence.run-synthesis` receives request and correlation identifiers only.
  - The provider receives compact current findings/citations, eligible claims, approved goals/profile context, and permitted preferences; strict output permits one bounded repair attempt.
  - Persisted results emit `growth_intelligence.synthesized`, `growth_intelligence.item_created`, and `growth_intelligence.item_superseded` from committed outcomes.
- **Steps:**
  - [ ] Write failing tests for business-only synthesis, market-only advice with stale-data limitation, combined evidence, missing market evidence, invalid model output, failed repair, duplicate replay, changed evidence, cancellation, and expired lease.
  - [ ] Prove the worker cannot pass raw normalized metrics, report rows, workbook data, customer data, signed URLs, unrestricted prompts, or source pages to the model.
  - [ ] Implement current-state reads, bounded provider call, deterministic validation, fenced persistence, and safe outcome events.
  - [ ] Chain successful monthly analysis to existing Channel Recommendation generation and Growth Intelligence synthesis without making either consumer authoritative for the other.
  - [ ] Preserve deterministic Channel findings and Recommendations when market research or synthesis narration fails.
  - [ ] Run focused model/workflow/Trigger tests, typecheck, lint, sensitive-log scans, and duplicate/replay integration tests.
  - [ ] Commit as `feat(growth-intelligence): synthesize current business and market evidence`.

### Task 15: Pass the Increment 2 report-to-intelligence gate

- **Files:**
  - Create `docs/verification/growth-intelligence/increment-2-report-handoff.md`.
  - Modify `progress-tracker.md` only to record verified state.
- **Steps:**
  - [ ] Enable synthesis only for the controlled canary organization.
  - [ ] Complete a governed report that spans at least two local months and verify one durable request per affected channel/month.
  - [ ] Verify the monthly analysis resolves current evidence, existing Channel Recommendations generate, and new market-connected items persist without a page visit.
  - [ ] Replay the upload, Trigger wake, analysis claim, and synthesis request and prove no duplicate run/item appears for the same fingerprint.
  - [ ] Apply a correction or reconciliation that changes current evidence and verify a new digest/request/result supersedes rather than rewrites prior history.
  - [ ] Capture report-current to visible-intelligence latency, request lineage, safe identifiers, and failure/recovery behavior.
  - [ ] Run the Increment 2 focused/full test set, hosted pgTAP, database advisors, typecheck, lint, and build.
  - [ ] Commit as `docs(growth-intelligence): verify automatic business synthesis`.

## Increment 3 — Growth Intelligence Experience

### Task 16: Build the composed organization read service

- **Files:**
  - Create `src/modules/growth-intelligence/application/read-model.ts` and `read-model.test.ts`.
  - Create `src/modules/growth-intelligence/application/read-service.ts` and `read-service.test.ts`.
  - Modify `src/modules/growth-intelligence/application/ports.ts`.
  - Modify `src/modules/growth-intelligence/infrastructure/read-repository.ts` and `read-repository.test.ts`.
  - Modify `src/modules/decisions/application/ports.ts` and `feed.test.ts` only to return stored action identity and draft lifecycle safely.
  - Modify `src/modules/decisions/infrastructure/repository.ts` and `repository.test.ts` only for those read fields.
  - Modify `src/modules/analysis/application/read-model.ts` and `read-model.test.ts` only for organization-level Recommendation/Insight/Data Gap projection.
  - Modify `src/app/api/organizations/[organizationId]/growth-intelligence/route.ts` and `route.test.ts`.
- **Interfaces:**
  - `getGrowthIntelligence` accepts canonical activity month, section filters, and bounded cursors; it performs reads only.
  - The read service composes active Opportunities, Channel Recommendations by label, synthesized items, Market Evidence, Data Gaps, and timeline events while retaining source IDs and mutation owners.
- **Steps:**
  - [ ] Write failing tests for default local current month, explicit month, unresolved carry-over, bounded cursors, source filters, empty sections, duplicate suppression, and activity-date/evidence-date separation.
  - [ ] Write tests proving a Channel Recommendation has one decision state on both pages and is not copied into `growth_intelligence_items`.
  - [ ] Write tests proving Data Gaps never enter Opportunity/Recommendation counts and an Opportunity read returns its stored action key rather than a default.
  - [ ] Implement source-specific repository reads with tenant scope, current/supersession filters, bounded pagination, and safe batch sizes.
  - [ ] Build deterministic priority groups without mixed currencies, evidence tiers, or model scores.
  - [ ] Run focused read/route tests, typecheck, lint, and query-bound regression tests.
  - [ ] Commit as `feat(growth-intelligence): compose the organization intelligence view`.

### Task 17: Complete synchronized triage, snooze, acknowledgement, and pins

- **Files:**
  - Create migration with slug `growth_intelligence_triage_and_recommendation_snooze`.
  - Modify `supabase/tests/database/channel_recommendation_decisions_test.sql`.
  - Modify `supabase/tests/database/growth_intelligence_item_decisions_test.sql`.
  - Modify `src/modules/analysis/application/triage.ts` and `triage.test.ts`.
  - Modify `src/app/api/organizations/[organizationId]/channel-recommendations/[recommendationId]/decisions/route.ts` and `route.test.ts`.
  - Create `src/modules/growth-intelligence/application/triage-service.ts` and `triage-service.test.ts`.
  - Create `src/app/api/organizations/[organizationId]/growth-intelligence/items/[itemId]/decisions/route.ts` and `route.test.ts`.
  - Create `src/app/api/organizations/[organizationId]/growth-intelligence/preferences/[sourceKind]/[sourceId]/route.ts` and `route.test.ts`.
- **Interfaces and lifecycle:**
  - Channel Recommendation decisions add `snoozed` with required `snoozed_until` while retaining existing append-only ownership.
  - Synthesized Insights accept acknowledge/pin; Recommendations accept plan/snooze/dismiss/pin; Data Gaps resolve only from current compatible evidence.
  - Pins remain actor-scoped presentation preferences and emit no organization policy change.
- **Steps:**
  - [ ] Write red route/application/pgTAP tests for viewer refusal, operator manage, Channel Recommendation permission separation, exact-source decision routing, reason bounds, future snooze time, replay, stale item version, and cross-tenant IDs.
  - [ ] Prove `planned` removes a Recommendation from active work, preserves the timeline, and does not set completed/effective or emit a realized result.
  - [ ] Prove acknowledgement clears new state without deleting the Insight and a pin changes only the current actor's ordering.
  - [ ] Generate the migration, extend the existing decision allowlist and current-state projection forward, and retain append-only history.
  - [ ] Dry-run, push, run pgTAP, and invoke each changed decision function on staging.
  - [ ] Implement non-optimistic API mutations; UI success waits for explicit domain outcome and refreshed authoritative state.
  - [ ] Emit identifier-only `growth_intelligence.item_triaged` after committed outcomes.
  - [ ] Run focused Vitest, full pgTAP, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(growth-intelligence): govern intelligence triage`.

### Task 18: Replace the Opportunity page with the full Growth Intelligence workspace

- **Files:**
  - Create `src/components/growth-intelligence/growth-intelligence-workspace.tsx` and `growth-intelligence-workspace.test.tsx`.
  - Create `src/components/growth-intelligence/priority-actions.tsx` and `priority-actions.test.tsx`.
  - Create `src/components/growth-intelligence/insights-list.tsx` and `insights-list.test.tsx`.
  - Create `src/components/growth-intelligence/data-gaps.tsx` and `data-gaps.test.tsx`.
  - Create `src/components/growth-intelligence/intelligence-timeline.tsx` and `intelligence-timeline.test.tsx`.
  - Create `src/components/growth-intelligence/intelligence-card.tsx` and `intelligence-card.test.tsx`.
  - Create `src/components/growth-intelligence/query-options.ts` and `query-options.test.ts`.
  - Modify `src/components/growth-intelligence/market-watch.tsx` and its test.
  - Modify `src/app/(platform)/organizations/[organizationId]/growth-intelligence/page.tsx`, `loading.tsx`, and `error.tsx`.
  - Replace `src/app/(platform)/organizations/[organizationId]/opportunities/page.tsx` with a server redirect and modify `loading.tsx` and `error.tsx` as required by the redirect behavior.
  - Modify `src/components/layout/sidebar.tsx` and `sidebar.test.tsx`.
  - Modify `src/lib/routes.ts` and its test.
  - Modify `src/components/opportunities/opportunity-card.tsx` only if shared Opportunity display remains; do not preserve the misleading Approve action.
- **Interfaces and presentation:**
  - Sections are Priority actions, Insights, Market Watch, Data Gaps, and Timeline.
  - Priority actions visibly separates platform-ready Opportunities from operator-performed Recommendations.
  - Every card separates generated date, business evidence window, market observation/retrieval dates, support/freshness, limitations, estimate assumptions, source, and next action.
- **Steps:**
  - [ ] Write failing component/page tests for all sections, counts, current-month default, earlier-month carry-over, source-owned decisions, viewer/operator/admin states, loading, empty, stale, partial, failed, retrying, and disabled-rollout states.
  - [ ] Write tests proving no Data Gap appears in Opportunity/Recommendation totals and no unavailable financial value renders as zero.
  - [ ] Implement the workspace using the existing design system with clear business language and progressive evidence drawers.
  - [ ] Rename sidebar `Opportunities` to `Growth Intelligence`, route it canonically, and redirect old bookmarks without starting work.
  - [ ] Remove Approve wording from Opportunity controls; until Increment 4 is enabled, eligible draft CTA renders unavailable with a precise release/prerequisite reason.
  - [ ] Make activity-month navigation change history only and never relabel an evidence period.
  - [ ] Run focused component/page tests, typecheck, lint, build, and authenticated desktop/mobile browser checks for layout, keyboard navigation, focus, console, and failed requests.
  - [ ] Commit as `feat(growth-intelligence): replace the Opportunity workspace`.

### Task 19: Pass the Increment 3 client-workspace gate

- **Files:**
  - Create `e2e/growth-intelligence.spec.ts` with all non-Campaign flows.
  - Create `docs/verification/growth-intelligence/increment-3-workspace.md`.
  - Modify `progress-tracker.md` only to record verified state.
- **Steps:**
  - [ ] Enable Market, synthesis, and triage flags for the canary organization while leaving Campaign draft disabled.
  - [ ] Run the redacted profile → research → report-current → analysis → Recommendation/synthesis → composed page flow.
  - [ ] Verify current activity date and older evidence period remain visually distinct.
  - [ ] Plan and snooze Recommendations, acknowledge and pin Insights, inspect Market Watch citations, and follow a Data Gap repair link.
  - [ ] Verify the same Channel Recommendation decision state on its source page and Growth Intelligence.
  - [ ] Verify viewer mutation refusal and cross-tenant route/source identifiers fail closed without enumeration.
  - [ ] Run E2E, focused/full Vitest, hosted pgTAP, typecheck, lint, build, database advisors, and authenticated desktop/mobile acceptance.
  - [ ] Commit as `test(growth-intelligence): verify the governed client workspace`.

## Increment 4 — Governed Campaign Handoff

### Task 20: Repair Opportunity uniqueness and define the governed-draft playbook

- **Files:**
  - Create `src/domain/decisions/campaign-draft-impact.ts` and `campaign-draft-impact.test.ts`.
  - Create `src/domain/decisions/campaign-draft-eligibility.ts` and `campaign-draft-eligibility.test.ts`.
  - Create `src/modules/decisions/playbooks/governed-campaign-draft-v1.ts` and `governed-campaign-draft-v1.test.ts`.
  - Create `src/modules/decisions/sources/growth-intelligence-opportunity-source.ts` and `growth-intelligence-opportunity-source.test.ts`.
  - Modify `src/modules/decisions/application/ports.ts`, `service.ts`, and focused tests.
  - Create migration with slug `repair_active_opportunity_uniqueness_and_seed_draft_playbook`.
  - Modify `supabase/tests/database/decision_engine_test.sql`.
  - Modify `supabase/tests/database/campaign_decision_cycle_runtime_test.sql`.
- **Interfaces and eligibility:**
  - The impact method is versioned, deterministic, currency-safe, assumption-bearing, and based only on governed current inputs; it returns absent with named reasons when unsupported.
  - The playbook requires every section 10.1 input and emits only Tier-1 internal governed-draft action identity.
  - Missing provider mapping, publish permission, ad account, spend authorization, or execution tracking cannot block an internal draft, but missing objective, audience, goal, evidence, estimate, brand/assets, or evaluation assertions does.
- **Steps:**
  - [ ] Reproduce the global active-opportunity uniqueness regression in pgTAP with unrelated non-Campaign candidates before changing the index.
  - [ ] Write failing domain/playbook tests for every required input, stale business data, primary/corroborated market support, conflicted/single-source evidence, geography, active goal/metric, objective/audience, brand/assets/synthetic path, currency, estimate, evaluation assertions, and policy breaches.
  - [ ] Write tests proving no model supplies the estimate, confidence rationale, rank, eligibility result, or assertion verdict.
  - [ ] Implement deterministic impact and eligibility; unsupported estimate paths remain Recommendations with named Data Gaps.
  - [ ] Generate the migration to scope the active-candidate uniqueness rule correctly and seed the versioned governed-draft playbook only after the regression test passes.
  - [ ] Dry-run, push, run focused/full pgTAP, and invoke affected decision admission/claim functions on staging.
  - [ ] Run focused Decision tests, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(decisions): qualify governed Campaign drafts`.

### Task 21: Add atomic Campaign draft request and Opportunity lifecycle

- **Files:**
  - Create migration with slug `campaign_draft_requests_and_opportunity_lifecycle`.
  - Create `supabase/tests/database/campaign_draft_requests_test.sql`.
  - Modify `supabase/tests/database/decision_engine_behavior_test.sql`.
  - Modify `supabase/tests/database/decision_aggregate_contract_test.sql`.
  - Modify `src/lib/supabase/database.types.ts` and `database.types.test.ts`.
  - Create `src/modules/decisions/application/campaign-draft-service.ts` and `campaign-draft-service.test.ts`.
- **Schemas and operations:**
  - Add `campaign_draft_requests` with `pending`, `processing`, `completed`, `retryable_failed`, `permanent_failed`, and `cancelled`.
  - Extend governed-draft Opportunity lifecycle to `proposed`, `draft_requested`, and `draft_created` while keeping legacy values readable.
  - Add exact Opportunity version/action identity to the draft decision and feedback contract.
  - Add `request_campaign_draft_from_opportunity`, `claim_campaign_draft_request`, `fail_campaign_draft_request`, and `complete_campaign_draft_request`.
- **Steps:**
  - [ ] Write pgTAP red tests for `campaign.create`, exact organization/opportunity/version/action, proposed/current/unexpired state, assertion recheck, concurrent request, replay, explicit requeue of the same retryable request, lease fencing, permanent failure, cancellation, and cross-tenant/direct-RPC misuse.
  - [ ] Prove the request transaction makes no model/provider call, creates no Campaign directly, grants no Campaign approval, and cannot move spend or publish.
  - [ ] Generate the migration with one request per organization/opportunity, append-only decision/audit history, and identifier-only `campaign.draft_requested` on first admission or authorized retry.
  - [ ] Keep a failed worker's Opportunity at `draft_requested`; the request state carries retryability and a safe code.
  - [ ] Dry-run, push, run focused/full pgTAP, invoke every new function once, and update handwritten types.
  - [ ] Implement the application service on the signed-in client and return explicit `created` or `replayed` domain outcomes.
  - [ ] Run focused Vitest, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(decisions): request governed Campaign drafts atomically`.

### Task 22: Freeze complete Opportunity evidence into exactly one Campaign draft

- **Files:**
  - Modify `src/domain/campaigns/schemas.ts`, `types.ts`, and focused tests.
  - Modify `src/modules/campaigns/application/ports.ts`, `qualification.ts`, `service.ts`, and focused tests.
  - Modify `src/modules/campaigns/infrastructure/snapshot-reader.ts`, `creation-repository.ts`, `repository.ts`, and focused tests.
  - Create `src/workflows/campaigns/create-from-opportunity.ts` and `create-from-opportunity.test.ts`.
  - Modify `src/trigger/campaigns.ts` and `campaigns.test.ts`.
  - Create migration with slug `complete_campaign_opportunity_source_snapshot`.
  - Modify `supabase/tests/database/campaign_bundle_test.sql`.
  - Modify `supabase/tests/database/campaign_decision_cycle_runtime_test.sql`.
  - Modify `src/lib/supabase/database.types.ts` if snapshot/RPC contracts change.
- **Snapshot contract:**
  - Freeze Decision record, playbook version, Opportunity version, stored action key, assertions, internal findings/evidence digests, Market Evidence Claim/Profile references, objective, audience, goal, primary metric, brand/assets readiness versions, estimate, assumptions, and evaluation plan.
  - Preserve source kind `decision_opportunity`; Campaign state is `draft` and source snapshot creation is atomic with Campaign creation.
- **Steps:**
  - [ ] Write failing tests proving the stored action key is used and qualification assertions, objective, audience, evidence, and readiness versions reach the atomic snapshot.
  - [ ] Write worker tests for duplicate Trigger delivery, concurrent workers, lost dispatch, expired lease, changed prerequisite, retryable failure, permanent stale assertion, and exact replay.
  - [ ] Prove Campaign creation calls no generation model, provider, publish, schedule, spend, approval, or Tool Gateway path.
  - [ ] Extend the snapshot schema and migration forward without weakening manual Campaign source validation.
  - [ ] Implement the worker to claim the request, reload all bound versions, call the Campaign module once, and complete Campaign/request/Opportunity linkage atomically.
  - [ ] Emit identifier-only `campaign.draft_request_failed` from persisted failure; retain existing `campaign.created` only after the Campaign and snapshot commit.
  - [ ] Dry-run, push, run pgTAP, and invoke every replaced Campaign/Decision function on staging.
  - [ ] Run focused Campaign/Decision/workflow/Trigger tests, typecheck, lint, and `git diff --check`.
  - [ ] Commit as `feat(campaigns): create one frozen draft from an Opportunity`.

### Task 23: Expose Create governed draft, retry, and truthful success states

- **Files:**
  - Create `src/app/api/organizations/[organizationId]/opportunities/[opportunityId]/campaign-draft/route.ts` and `route.test.ts`.
  - Modify `src/components/growth-intelligence/priority-actions.tsx` and its test.
  - Create `src/components/growth-intelligence/campaign-draft-action.tsx` and `campaign-draft-action.test.tsx`.
  - Modify `src/components/growth-intelligence/intelligence-timeline.tsx` and its test.
  - Modify `src/modules/growth-intelligence/application/read-model.ts` and its test for request/Campaign links.
  - Modify `src/modules/decisions/application/feed.ts` and `feed.test.ts` to remove Approve semantics from governed-draft entries.
- **Interfaces and UX:**
  - The CTA submits exact Opportunity version and action identity and waits for the authoritative request outcome.
  - `draft_requested` shows pending/processing/retryable/permanent state; success appears only for `draft_created` with a linked Campaign route.
  - A retry calls the same Campaign-draft endpoint with the exact Opportunity version/action identity; the server requeues only the already-linked retryable request and reloads every prerequisite.
- **Steps:**
  - [ ] Write failing route tests for membership, campaign rollout, `campaign.create`, viewer refusal, replay, stale version, expired Opportunity, changed assertion, cross-tenant request, and safe retry admission.
  - [ ] Write component tests for eligible CTA, missing prerequisites, pending, processing, delayed, retryable failure, permanent failure, replay, success link, and separate Campaign approval copy.
  - [ ] Implement non-optimistic mutations and invalidate the composed read only after explicit domain outcomes.
  - [ ] Add timeline entries for draft-requested, retry, draft-created, and failure without claiming generation or execution.
  - [ ] Verify Campaign workspace shows `draft`, frozen source evidence, no approved version, no provider action, and no spend authorization.
  - [ ] Run focused route/component tests, typecheck, lint, build, and authenticated browser checks at desktop/mobile widths.
  - [ ] Commit as `feat(growth-intelligence): create governed Campaign drafts`.

### Task 24: Prove the full governed loop and close documentation

- **Files:**
  - Extend `e2e/growth-intelligence.spec.ts` with Campaign handoff cases.
  - Create `docs/verification/growth-intelligence/increment-4-campaign-handoff.md`.
  - Create `docs/runbooks/growth-intelligence.md`.
  - Modify `context/03-architecture.md`.
  - Modify `context/04-domain-model.md`.
  - Modify `context/05-module-map.md`.
  - Modify `context/10-events-and-workflows.md`.
  - Modify `context/19-glossary.md`.
  - Modify `specs/005-decision-engine-v1.md`.
  - Modify `specs/007-revenue-opportunity-feed.md`.
  - Modify `specs/018-governed-channel-intelligence.md` only after its active owner releases it.
  - Modify `MANIFEST.md` and `progress-tracker.md`.
- **Steps:**
  - [ ] Run the redacted end-to-end sequence: confirm profile, research, upload/current report, monthly analysis, Channel Recommendations, synthesis, plan Recommendation, stale-data refusal, eligible Opportunity, create governed draft, open frozen Campaign source.
  - [ ] Run concurrent and replayed draft requests and prove one request, one Campaign, one snapshot, and one `draft_created` transition.
  - [ ] Prove no publish, provider call, spend, Campaign approval, or realized-result event occurs in the full draft path.
  - [ ] Prove viewer mutations and cross-account/cross-organization reads, writes, citations, links, pins, requests, and Campaign handoffs fail closed.
  - [ ] Prove planning/snooze/dismiss/acknowledgement/pins remain preference evidence and only registered Campaign measurement can produce an effectiveness verdict.
  - [ ] Run Node 22 formatting check, typecheck, lint, full Vitest, build, Trigger task contract tests, hosted migration list/dry-run state, full pgTAP, database advisors, and Playwright.
  - [ ] Verify structured telemetry and actionable thresholds for overdue work, expired leases, repeated adapter failure, cost ceilings, citation rejection, stale profiles, unsupported visible claims, cross-tenant refusal anomalies, and old Campaign draft requests; record the escalation and kill-switch procedure in the runbook.
  - [ ] Perform authenticated browser acceptance at desktop/mobile widths for loading, empty, partial, stale, failed, retrying, permissions, focus, source drawers, timeline, and Campaign handoff; record actual results without asking automated checks to stand in for browser proof.
  - [ ] Update architecture, domain, module, event/workflow, glossary, source specs, runbook, manifest, and tracker to match only behavior proven in staging.
  - [ ] Commit as `docs(growth-intelligence): close the governed intelligence loop`.

## Blast Radius Summary

- **Database:** New tenant-owned profile, request, research, evidence, synthesis, decision/preference, and draft-request records; changed permission catalogue, Channel Recommendation snooze, Opportunity lifecycle, active-candidate uniqueness, Campaign source snapshot, monthly analysis cache, and report-current completion functions.
- **RLS and grants:** Every new table and user/worker operation; direct-RPC misuse and two-tenant coverage are release gates, not optional hardening.
- **Callers:** Market Profile APIs/UI, Channel report projection/reconciliation, Channel analysis admission/worker/UI, Channel Recommendation decisions, Decision Engine feed/playbooks, Campaign qualification/creation, organization navigation, and the canonical Growth Intelligence page.
- **Consumers:** Trigger research/synthesis/draft workers, scheduled sweeper, existing Recommendation generation, composed read service, Timeline, Campaign workspace, audit/logging, and operational runbooks.
- **Events:** Add the identifier-only events listed in spec section 12.3; do not treat events as the sole durable work record.
- **Public exports:** Add the explicit Growth Intelligence domain index and application port contracts; no generic feed-table write API is exported.
- **Background work:** Add daily/weekly/due research, synthesis, and Campaign draft creation; report-current work remains transactionally durable even if immediate Trigger dispatch is lost.

## Test Plan Summary

- **Pure domain:** Profile schema/digest, fingerprint, evidence grading, geography, materiality, synthesis classification, priority, lineage, impact, and Campaign eligibility.
- **AI/adversarial:** Strict schemas, unknown fields, one failed repair, fabricated citations/facts/impact/confidence/outcomes, wrong geography, prompt injection, excessive loops, and budget refusal.
- **Database:** Hosted pgTAP for two accounts/organizations, RLS, grants, composite tenant foreign keys, append-only state, leases/fencing/retry/cancel, current-state derivation, duplicate suppression, and exactly-once Campaign creation.
- **Workers/adapters:** Timezone due selection, lost dispatch, expired lease, duplicate Trigger delivery, SSRF, source refusal/removal, cost ceilings, partial completion, safe logs, and no raw payload leakage.
- **Application/API/UI:** Membership-before-rollout, permission matrix, source-owned mutations, current-month/evidence-date separation, no Data Gap counts, non-optimistic outcomes, accessible loading/error/empty states, and bounded reads.
- **End to end:** The ten-step redacted Dubai Kerala-cuisine scenario in spec section 20.5, including stale advice-only behavior and no-publish/no-spend draft creation.
- **Full gates:** `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, relevant Trigger tests, `pnpm db:migrations:list`, `pnpm db:migrations:dry-run`, `pnpm db:test`, database advisors, Playwright, and authenticated desktop/mobile browser acceptance.

## Risks and Rollback

- **Provider legal or trust failure:** Keep the adapter unavailable, disable the market allowlist or source kill switch, preserve already stored citation metadata, and do not weaken qualification to meet schedule.
- **Prompt injection or SSRF:** Fail the affected fetch/run safely, retain other independent sources, alert on refusal anomalies, and never retry an unsafe destination through a broader tool.
- **Queue or cost storm:** Enforce Postgres fingerprints, due indexes, per-organization/adapter concurrency, hard request/model ceilings, and operational disablement; preserve pending history for diagnosis.
- **Stale or contradictory advice:** Downgrade or supersede through append-only evidence/item events; keep history visible and block Campaign eligibility.
- **Competing source state:** Route every mutation to the authoritative module, remove any accidental copied state through a forward correction, and keep composed reads read-only.
- **Shared-staging migration conflict:** Stop before push, re-read the migration tail and board, regenerate the migration filename, and re-run dry-run and focused pgTAP.
- **Opportunity/Campaign contract regression:** Keep Campaign draft rollout disabled, preserve existing Campaign approval/execution paths, and repair forward; never reinterpret a failed draft request as approved or successful.
- **UI overload or misleading value:** Feature-flag the composed surface, retain source pages, remove unsupported figures rather than showing zero, and keep Market Watch/read-only access releasable independently.
- **Rollback method:** Disable the affected increment allowlist, stop new due admissions or adapter calls, let bounded claimed work finish or cancel through its state machine, and apply forward corrective migrations. Never delete Profiles, Evidence, Decisions, Campaigns, or audit history.

## Implementation Approval Gate

- [x] The user approves this Execution Plan before Task 1 starts.
- [ ] The executing agent rechecks the board and current implementation before each task because active claims and staging schema can change.
- [ ] A material change to scope, ownership, permission, persistence, provider, or control/execution boundary stops execution for renewed approval.
