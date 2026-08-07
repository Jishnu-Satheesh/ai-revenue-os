# Guided Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved, agency-operator-first Guided Onboarding workflow: a resumable ten-section workspace that builds a trustworthy Digital Twin and explains AI readiness without silently treating AI output as fact.

**Architecture:** Keep organization creation as the one-time tenant bootstrap. Redirect the created draft organization to a new organization-scoped onboarding route, backed by a session plus per-section draft state. Write confirmed inputs into the existing Organization + Digital Twin records; keep mutable onboarding drafts, requests, uploads, extraction suggestions, and versioned readiness assessments in dedicated tenant-scoped tables. Run document extraction as a bounded Trigger.dev task behind a Zod-validated provider boundary; the UI only ever presents candidates for an operator to confirm, edit, reject, or mark unknown.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, pnpm, Supabase/Postgres with RLS and private Storage, Zod 4, TanStack Query v5, TanStack Form v1, Trigger.dev 4, Vercel AI SDK boundary, shadcn/ui New York/Radix components, Tailwind 4 semantic tokens, Framer Motion, Vitest, Testing Library, Playwright.

## Implementation status (2026-08-08)

Tasks 1–8 and the page wiring portion of Tasks 9–10 are implemented. Focused/full unit checks, lint, formatting, production build, and protected/reduced-motion E2E checks pass. Live Supabase migration/RLS verification remains pending because local Postgres is unavailable at `127.0.0.1:54322`; authenticated two-tenant database fixtures are therefore deferred.

## Global Constraints

- Use **pnpm** exclusively. The repository requires Node 22 or later and `pnpm@11.20.0`.
- Preserve `organizations` as the tenant root. Every new persistent row has `organization_id`, application query scoping, and `TO authenticated` RLS policies using the existing membership helpers.
- Keep the core industry-neutral. Restaurant menu fields live behind a restaurant onboarding-section adapter and do not become platform-core columns.
- Use Zod at every HTTP, upload, worker, and AI boundary. Model output is suggestion data only; a user confirmation is required before a fact becomes `verified`.
- Do not receive credentials in ordinary form fields or execute an external side effect from AI output. Integration cards only describe governed connection handoffs.
- All feature controls must compose existing or CLI-installed shadcn/ui primitives. Do not introduce raw `button`, `input`, `textarea`, `select`, dialog, menu, card, or sidebar controls when an equivalent shadcn component exists.
- Use semantic CSS variables and `cn()`; do not add hard-coded colour values, gradients, `space-y-*`, or raw HTML controls. Use `SelectGroup` around `SelectItem` entries.
- Follow ADR 0008: use TanStack Query for onboarding server state owned by Client Components and TanStack Form for the ten-section forms. Keep the initial server snapshot in the Server Component boundary and do not duplicate it in a global store.
- Every sensitive mutation emits the named domain event and retains actor, correlation, source, verification, and audit information. Logs contain no file contents, secrets, credentials, or unnecessary customer PII.
- Start implementation only after this plan receives explicit approval. Each task below is independently testable and must be checked off only after its verification passes.

## Proposed File Map

| Area | Files |
| --- | --- |
| Domain contracts | `src/domain/onboarding/{types.ts,readiness.ts,section-registry.ts,*.test.ts}` |
| Application and persistence | `src/modules/onboarding/{application,infrastructure}/**`, `src/domain/organizations/repository.ts` |
| API and workers | `src/app/api/organizations/[organizationId]/onboarding/**/route.ts`, `src/trigger/onboarding-extract.ts` |
| Workspace UI | `src/app/(platform)/organizations/[organizationId]/onboarding/page.tsx`, `src/components/onboarding/**` |
| Tenant persistence | `supabase/migrations/<timestamp>_guided_onboarding.sql`, generated `src/lib/supabase/database.types.ts` |
| Tests and documentation | `src/**/**/*.test.ts(x)`, `e2e/guided-onboarding.spec.ts`, `adrs/0009-guided-onboarding-control-plane.md`, `progress-tracker.md` |

---

### Task 1: Establish the domain vocabulary, completion rules, and deterministic readiness rubric

**Files:**
- Create: `src/domain/onboarding/types.ts`
- Create: `src/domain/onboarding/section-registry.ts`
- Create: `src/domain/onboarding/readiness.ts`
- Create: `src/domain/onboarding/types.test.ts`
- Create: `src/domain/onboarding/readiness.test.ts`

- [ ] **Step 1: Write failing unit tests for valid/invalid onboarding boundaries.**

  Add tests that prove all ten immutable section keys are registered, a state can be saved as incomplete, a future section cannot be completed by navigation, and candidate facts require evidence plus an explicit confirmation transition:

  ```ts
  expect(onboardingSectionKeys).toHaveLength(10)
  expect(sectionSaveSchema.parse({ status: "in_progress", payload: {} }).status).toBe("in_progress")
  expect(() => confirmCandidateFact({ status: "inferred" })).toThrow("evidence")
  ```

  Add readiness fixtures showing a missing consent requirement blocks outbound retention even when the average score is high, and missing conversion tracking blocks autonomous ad optimisation.

- [ ] **Step 2: Run the focused tests and confirm they fail because the modules do not exist.**

  Run: `pnpm vitest run src/domain/onboarding/types.test.ts src/domain/onboarding/readiness.test.ts`

  Expected: module-not-found failures.

- [ ] **Step 3: Implement the schemas and deterministic functions.**

  Define Zod schemas and exported types for `OnboardingSectionKey`, section status (`not_started`, `in_progress`, `complete`, `needs_attention`, `blocked`), session status, request status, upload/extraction lifecycle, provenance, verification state, candidate disposition, and idempotency key. Keep payloads as bounded JSON records per registered section rather than adding unvalidated generic fields.

  Implement a ten-row registry grouped into the approved six visual phases:

  ```ts
  export const onboardingSectionKeys = [
    "business_identity", "branches_operations", "products_services", "channels_presence",
    "historical_performance", "customers_consent", "brand_assets", "governance",
    "integrations_uploads", "review_readiness",
  ] as const
  ```

  Implement `calculateReadiness(input)` as a pure, versioned function returning overall score, capability scores, requirement-level reasons, critical blockers, prioritized next actions, estimated effort, and owner. Points must come only from named requirements; blockers override the applicable capability’s availability, not the whole score.

- [ ] **Step 4: Run focused tests and the type checker.**

  Run: `pnpm vitest run src/domain/onboarding/types.test.ts src/domain/onboarding/readiness.test.ts && pnpm typecheck`

  Expected: all assertions pass and no implicit `any` or schema/type drift remains.

- [ ] **Step 5: Self-review this task.**

  Confirm no restaurant-specific column or core type was added, unknown remains explicit, and no function can produce `verified` data from an inferred candidate without operator confirmation.

### Task 2: Add the onboarding control-plane schema, RLS, audit coverage, and ADR

**Files:**
- Create: `supabase/migrations/<timestamp>_guided_onboarding.sql`
- Update: `src/lib/supabase/database.types.ts`
- Create: `adrs/0009-guided-onboarding-control-plane.md`
- Create: `src/modules/onboarding/infrastructure/repository.integration.test.ts`

- [ ] **Step 1: Write the migration integration tests first.**

  Create two authenticated user fixtures in different organizations. Assert that a member can read and mutate only their organization’s session/state/request/upload/extraction/assessment rows, that an operator cannot complete review or confirm a candidate if the policy requires owner/admin, and that a second identical idempotency key returns the original mutation result rather than a duplicate row.

- [ ] **Step 2: Run the database-focused test command and confirm the expected environment failure or failing assertions.**

  Run: `pnpm supabase:start && pnpm supabase:reset && pnpm vitest run src/modules/onboarding/infrastructure/repository.integration.test.ts`

  Expected in the current environment: an explicit `supabase: command not found` blocker. Once the CLI is installed, expected pre-migration failures are missing-table/policy errors.

- [ ] **Step 3: Write the migration with the following durable model.**

  Add `onboarding_sessions`, `onboarding_section_states`, `onboarding_requests`, `onboarding_uploads`, `onboarding_extractions`, `onboarding_extraction_candidates`, `ai_readiness_assessments`, and `onboarding_idempotency_records`. Each table includes an `organization_id`, `created_at`, relevant actor IDs, and constraints that tie child organization/session/upload IDs together. Store storage object paths and checksums, never file content or credentials, in PostgreSQL.

  Add targeted tenant-leading indexes, including `(organization_id, updated_at desc)` for section state, `(organization_id, status, updated_at desc)` for sessions/requests/uploads, `(organization_id, session_id, created_at)` for candidates, and the unique idempotency scope `(organization_id, operation, idempotency_key)`.

  Enable RLS on every new public table. Add `SELECT`, `INSERT`, `UPDATE` (both `USING` and `WITH CHECK`), and only necessary `DELETE` policies with `TO authenticated` and `private.is_organization_member` / `private.has_organization_role`. Add explicit `storage.objects` policies for a private `onboarding-files` bucket whose object paths begin with `organization_id/session_id/upload_id`; validate the first folder segment against an accessible organization. Do not use a service-role bypass in browser or user-facing request paths.

  Add audit triggers/events for session start/completion, section completion, request creation/state changes, file upload state transitions, extraction completion, fact confirmation, and readiness generation. Persist enough payload metadata to explain an outcome without raw sensitive content.

  Record the decision in ADR 0009: the onboarding control plane is separate from canonical Digital Twin records, uses private Storage, and promotes data only through explicit confirmation.

- [ ] **Step 4: Regenerate types and run schema verification.**

  Run: `pnpm supabase:reset && pnpm db:types && pnpm typecheck && pnpm vitest run src/modules/onboarding/infrastructure/repository.integration.test.ts`

  Expected: the migration applies from a clean database, generated types contain all new rows/enums, tenant-crossing attempts fail, and idempotent retries create no duplicates.

- [ ] **Step 5: Self-review SQL security.**

  Check every organization-owned table has `organization_id`, RLS, a tenant-leading index, `TO authenticated`, and paired `USING`/`WITH CHECK` on updates. Verify upload paths cannot be forged to another tenant and no trigger logs file content, credentials, or PII.

### Task 3: Implement session lifecycle, save/resume, request assignment, and event contracts

**Files:**
- Create: `src/modules/onboarding/infrastructure/repository.ts`
- Create: `src/modules/onboarding/application/service.ts`
- Create: `src/modules/onboarding/application/authorization.ts`
- Create: `src/modules/onboarding/application/service.test.ts`
- Update: `src/domain/events/types.ts`
- Update: `src/lib/api/organization-context.ts`

- [ ] **Step 1: Add failing application tests.**

  Cover: loading-or-creating exactly one active session per draft organization; saving a partial section with an idempotency key; resuming from the persisted current section; an operator assigning a missing-data request; completing a section only when its registered completion requirements pass; and event names/payloads for `onboarding.started`, `onboarding.step_completed`, and `onboarding.completed`.

- [ ] **Step 2: Run the test file and confirm failure.**

  Run: `pnpm vitest run src/modules/onboarding/application/service.test.ts`

  Expected: unresolved onboarding service imports.

- [ ] **Step 3: Implement the application layer.**

  Resolve organization context through the existing `getOrganizationContext` and role checks; do not trust an organization ID submitted in a payload. Add typed helpers for correlation/idempotency IDs and publish events only after a validated successful state transition. Keep local drafts resumable after a failed write and make repeated saves safe.

  Reuse existing `business_profiles`, `branches`, `business_facts`, `goals`, `constraints`, and `policies` repositories for canonical confirmed data. The onboarding service coordinates those writes rather than duplicating their domain logic.

- [ ] **Step 4: Run focused tests and type checking.**

  Run: `pnpm vitest run src/modules/onboarding/application/service.test.ts && pnpm typecheck`

  Expected: one session per organization, valid repeat-save behavior, correct authorization rejection, and emitted events with stable past-tense names.

- [ ] **Step 5: Self-review event and authorization paths.**

  Verify each event includes `organizationId`, `sessionId`, `sectionKey` where relevant, actor type/ID, correlation ID, and outcome metadata; no sensitive payload is emitted.

### Task 4: Add validated onboarding HTTP endpoints and bootstrap redirect

**Files:**
- Create: `src/app/api/organizations/[organizationId]/onboarding/route.ts`
- Create: `src/app/api/organizations/[organizationId]/onboarding/sections/[sectionKey]/route.ts`
- Create: `src/app/api/organizations/[organizationId]/onboarding/requests/route.ts`
- Create: `src/app/api/organizations/[organizationId]/onboarding/readiness/route.ts`
- Create: `src/app/api/organizations/[organizationId]/onboarding/**/*.test.ts`
- Update: `src/app/(platform)/organizations/new/page.tsx`

- [ ] **Step 1: Write route tests before handlers.**

  Test unauthenticated (`401`), non-member (`403`), malformed section/request payload (`400`), safe partial save (`200`), idempotent retry (`200` and same record), and cross-tenant organization ID rejection. Assert the organization-creation response redirects to `/organizations/:id/onboarding`, not the Digital Twin editor.

- [ ] **Step 2: Run the route tests and confirm failure.**

  Run: `pnpm vitest run 'src/app/api/organizations/[organizationId]/onboarding/**/*.test.ts'`

  Expected: handler-module failures.

- [ ] **Step 3: Implement handlers.**

  Validate params and JSON with Task 1 schemas; derive user and tenant context server-side; call the Task 3 service; return only public error messages through `apiErrorResponse`. The onboarding GET route must return an operator-safe snapshot: session, rail states, canonical values, pending requests, uploads/extractions, and the latest readiness assessment.

  Reduce `/organizations/new` to tenant bootstrap fields required by the existing RPC. After successful creation, navigate to the new onboarding route, whose Business identity and Branches sections prefill the bootstrap values for confirmation/enrichment. Never create a second tenant as an onboarding save effect.

- [ ] **Step 4: Run tests and formatting.**

  Run: `pnpm vitest run 'src/app/api/organizations/[organizationId]/onboarding/**/*.test.ts' && pnpm format:check && pnpm typecheck`

  Expected: protected routes pass their happy/error cases, and bootstrap retains exactly one organization.

- [ ] **Step 5: Self-review public error handling.**

  Confirm raw Supabase/AI errors and storage paths are not exposed to the browser, and all failed saves preserve retryable client state.

### Task 5: Add only the required shadcn primitives and the motion dependency

**Files:**
- Update: `package.json`
- Update: `pnpm-lock.yaml`
- Add only CLI-generated files under `src/components/ui/` when absent

- [ ] **Step 1: Inspect the installed component registry.**

  Run: `pnpm dlx shadcn@latest info` and `rg --files src/components/ui | sort`.

  Expected: identify which of `scroll-area`, `tabs`, `spinner`, `sonner`, and `dialog` are missing; do not overwrite existing customized components.

- [ ] **Step 2: Add focused component smoke tests.**

  Add a small render test proving the chosen shadcn `Spinner` is announced beside a disabled `Button`, and a `ScrollArea` remains keyboard reachable in the section rail.

- [ ] **Step 3: Add dependencies with pnpm.**

  Run the shadcn CLI only for missing primitives, for example `pnpm dlx shadcn@latest add spinner scroll-area tabs sonner dialog`, after checking each component’s CLI documentation. Add the approved dependencies with `pnpm add framer-motion @tanstack/react-query @tanstack/react-form` and development-only Query Devtools with `pnpm add -D @tanstack/react-query-devtools`. Do not use `--overwrite`.

- [ ] **Step 4: Run smoke tests and dependency verification.**

  Run: `pnpm install --frozen-lockfile && pnpm test && pnpm typecheck`

  Expected: lockfile is current, no UI primitive is replaced unexpectedly, and motion imports resolve.

- [ ] **Step 5: Self-review UI compliance.**

  Ensure dependency and generated-code changes are limited to the necessary components and no bare control is introduced in feature code.

### Task 6: Build the accessible hybrid section rail and animated work-panel shell

**Files:**
- Create: `src/components/onboarding/onboarding-workspace.tsx`
- Create: `src/components/onboarding/onboarding-section-rail.tsx`
- Create: `src/components/onboarding/animated-phase-stepper.tsx`
- Create: `src/components/onboarding/onboarding-workspace.test.tsx`
- Create: `src/components/onboarding/onboarding-section-rail.test.tsx`

- [ ] **Step 1: Write component tests against the approved behavior.**

  Render ten rail rows grouped into six phase headings. Test completed/active/future indicator states, that unvisited future rows cannot be activated, a previously visited row can, switching direction changes the Motion custom value, the active section heading receives focus, and `prefers-reduced-motion` makes transition duration zero while preserving content changes.

- [ ] **Step 2: Run tests and confirm failure.**

  Run: `pnpm vitest run src/components/onboarding/onboarding-workspace.test.tsx src/components/onboarding/onboarding-section-rail.test.tsx`

  Expected: missing components.

- [ ] **Step 3: Implement the shell using shadcn composition.**

  Use `Card`, `Button`, `Progress`, `Badge`/`StatusBadge`, `ScrollArea`, `Tooltip`, `Alert`, and `Spinner`. Provide one application-level Query client, hydrate the server snapshot once, use organization/session/section-shaped query keys, and expose background-refetch/stale/error states. The rail is a section navigation list with real button semantics supplied by shadcn `Button`; the content panel uses `AnimatePresence` with a 20px directional slide and measured height transition. Completed connectors animate origin-left to 100%; active uses semantic primary outline; future uses muted styling. Respect `useReducedMotion`, keep the compact six-phase stepper visual-only, and focus the `h2` after every activated section.

- [ ] **Step 4: Run component tests and lint.**

  Run: `pnpm vitest run src/components/onboarding/onboarding-workspace.test.tsx src/components/onboarding/onboarding-section-rail.test.tsx && pnpm lint && pnpm typecheck`

  Expected: rail/navigation/motion/accessibility tests pass with no raw controls.

- [ ] **Step 5: Self-review mobile and keyboard behavior.**

  Verify the rail collapses to a shadcn Sheet or stacked navigation under the design breakpoint, the active indicator has an accessible name, keyboard users can reach all permitted sections, and focus never lands in exiting content.

### Task 7: Implement Foundation, Commercial, and Customer section editors

**Files:**
- Create: `src/components/onboarding/sections/business-identity-section.tsx`
- Create: `src/components/onboarding/sections/branches-operations-section.tsx`
- Create: `src/components/onboarding/sections/products-services-section.tsx`
- Create: `src/components/onboarding/sections/channels-presence-section.tsx`
- Create: `src/components/onboarding/sections/historical-performance-section.tsx`
- Create: `src/components/onboarding/sections/customers-consent-section.tsx`
- Create: `src/components/onboarding/sections/brand-assets-section.tsx`
- Create: `src/components/onboarding/sections/*.test.tsx`

- [ ] **Step 1: Write failing section tests.**

  For each of the seven sections, assert labelled shadcn field composition, server-validation errors focus the first invalid field, Save preserves incomplete drafts, Save and continue does not advance on failure, unknown is visible/serialised, and source plus verification cues render alongside every fact. Add restaurant menu tests behind the restaurant adapter and a core-industry test proving it renders a neutral product/service vocabulary.

- [ ] **Step 2: Run the section test group and confirm failure.**

  Run: `pnpm vitest run src/components/onboarding/sections`

  Expected: component-module failures.

- [ ] **Step 3: Implement section forms.**

  Use TanStack Form v1 for typed form/field state, granular subscriptions, nested arrays, and synchronous/debounced validation. Compose `Field`, `FieldGroup`, `FieldLabel`, `FieldDescription`, `Input`, `Textarea`, `Select` + `SelectGroup`, `Checkbox`, `Alert`, and `Button`; use `Card` only as a composed container. Reuse existing organization/domain API contracts for branches, profiles, and facts. Do not add restaurant-specific properties to `business_profiles`; use registered industry-pack payload validation for menu concepts.

  Implement explicit source choices (`operator`, `client`, `upload`, `inferred`) and verification labels. Consent fields require an operator-confirmed/client-provided source; forms must never offer an AI-confirmed consent option.

- [ ] **Step 4: Run focused UI and domain tests.**

  Run: `pnpm vitest run src/components/onboarding/sections src/domain/onboarding && pnpm typecheck`

  Expected: all seven sections save/resume safely and surface unknown/source/verification state.

- [ ] **Step 5: Self-review industry isolation.**

  Confirm restaurant specifics are isolated to the restaurant adapter/section payload and that every displayed field is traceable to a schema and source.

### Task 8: Implement Governance, Integration/Data Intake, and Review section editors

**Files:**
- Create: `src/components/onboarding/sections/governance-section.tsx`
- Create: `src/components/onboarding/sections/integrations-uploads-section.tsx`
- Create: `src/components/onboarding/sections/review-readiness-section.tsx`
- Create: `src/components/onboarding/sections/governance-section.test.tsx`
- Create: `src/components/onboarding/sections/integrations-uploads-section.test.tsx`
- Create: `src/components/onboarding/sections/review-readiness-section.test.tsx`

- [ ] **Step 1: Write failing tests.**

  Cover measurable goal/baseline validation, integer minor-unit budget validation, approval mode display, constraint saving, connection cards that never render credential fields, request assignment, data-quality warning visibility, readiness reason rendering, and review completion blocked while critical requirements remain unresolved.

- [ ] **Step 2: Run the tests and confirm failure.**

  Run: `pnpm vitest run src/components/onboarding/sections/governance-section.test.tsx src/components/onboarding/sections/integrations-uploads-section.test.tsx src/components/onboarding/sections/review-readiness-section.test.tsx`

  Expected: missing editor components.

- [ ] **Step 3: Implement the last three editors.**

  Reuse the canonical goals, constraints, and policies APIs; represent budgets in integer minor units plus ISO currency. Make integrations a capability/status catalogue with permission/health gaps and a governed connection handoff only. In review, show each readiness dimension’s requirements, score, blockers, priority, effort, responsible person, contradictions, and pending client requests; require an explicit owner/admin confirmation to complete onboarding.

- [ ] **Step 4: Run focused tests.**

  Run: `pnpm vitest run src/components/onboarding/sections/governance-section.test.tsx src/components/onboarding/sections/integrations-uploads-section.test.tsx src/components/onboarding/sections/review-readiness-section.test.tsx && pnpm typecheck`

  Expected: governance is explainable, no credentials are collected, and review cannot complete with unresolved critical blockers.

- [ ] **Step 5: Self-review policy safety.**

  Confirm the UI never presents autonomous money-moving/public-brand actions as immediate effects and all policy choices remain approval-gated.

### Task 9: Implement private upload ingestion, bounded extraction, and candidate review

**Files:**
- Create: `src/app/api/organizations/[organizationId]/onboarding/uploads/route.ts`
- Create: `src/app/api/organizations/[organizationId]/onboarding/uploads/[uploadId]/complete/route.ts`
- Create: `src/app/api/organizations/[organizationId]/onboarding/candidates/[candidateId]/route.ts`
- Create: `src/trigger/onboarding-extract.ts`
- Create: `src/modules/onboarding/application/extraction-service.ts`
- Create: `src/modules/onboarding/application/extraction-service.test.ts`
- Create: `src/components/onboarding/upload-status-list.tsx`
- Create: `src/components/onboarding/candidate-review.tsx`
- Create: `src/components/onboarding/candidate-review.test.tsx`

- [ ] **Step 1: Write failing tests with fixtures.**

  Include safe CSV/text extraction fixtures, a malformed file/extraction failure, an oversized or unsupported MIME type, a prompt-injection-like text document, a conflicting candidate, duplicate upload retry, and manual fallback. Assert raw model text is not stored as a verified fact, a candidate includes source location/confidence, and `confirm`/`edit`/`reject`/`mark unknown` require an operator action.

- [ ] **Step 2: Run tests and confirm failure.**

  Run: `pnpm vitest run src/modules/onboarding/application/extraction-service.test.ts src/components/onboarding/candidate-review.test.tsx`

  Expected: missing upload/extraction modules.

- [ ] **Step 3: Implement the safe ingestion pipeline.**

  Validate type, size, checksum, declared section, and idempotency before issuing a private scoped upload path. Record `pending`, `uploaded`, `extracting`, `succeeded`, or `failed` status and emit `onboarding.file_uploaded`. Trigger a durable task only after the upload is complete. Parse CSV deterministically; pass bounded PDF/image/text extraction requests through the configured AI provider boundary with a strict Zod output schema, a source-reference requirement, retry metadata, and no tool access.

  Persist candidates separately from canonical facts; resolve contradictions against existing source-aware facts. Candidate confirmation calls the existing fact/metric repositories with user-supplied verification state, emits `onboarding.fact_confirmed`, and never downgrades a verified fact. Failed extraction stays visible with manual entry and retry actions.

- [ ] **Step 4: Run focused tests and worker checks.**

  Run: `pnpm vitest run src/modules/onboarding/application/extraction-service.test.ts src/components/onboarding/candidate-review.test.tsx && pnpm typecheck && pnpm lint`

  Expected: failure paths are visible/retryable, suggestions remain untrusted, and candidate promotion is auditable.

- [ ] **Step 5: Self-review privacy and model controls.**

  Confirm Storage is private, allowed paths are tenant-scoped, worker logs redact source content, the model has no execution tools, and files/extractions are not exposed across organizations.

### Task 10: Wire the organization onboarding page and preserve the Digital Twin handoff

**Files:**
- Create: `src/app/(platform)/organizations/[organizationId]/onboarding/page.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/onboarding/loading.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/onboarding/error.tsx`
- Update: `src/app/(platform)/organizations/[organizationId]/digital-twin/page.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/onboarding/page.test.tsx`

- [ ] **Step 1: Write failing page tests.**

  Test authenticated draft organization loads the ten-section workspace and its persisted active section; an active organization can revisit its onboarding history read-only/with permitted edits; unauthorized access returns the existing auth behavior; loading/error UI uses shadcn Skeleton/Alert; and a completed review links to the Digital Twin with the readiness score visible.

- [ ] **Step 2: Run page tests and confirm failure.**

  Run: `pnpm vitest run 'src/app/(platform)/organizations/[organizationId]/onboarding/page.test.tsx'`

  Expected: missing route modules.

- [ ] **Step 3: Implement server-to-client wiring.**

  Load the onboarding snapshot on the server through organization context and render `OnboardingWorkspace` with the approved rail/work-panel layout. Render explicit loading, unauthorised, empty, save-error, unsynced, upload-failure, and extraction-contradiction states. Link the Digital Twin page back to onboarding for incomplete draft work and display the latest readiness assessment without recomputing a conflicting score.

- [ ] **Step 4: Run the route and UI tests.**

  Run: `pnpm vitest run 'src/app/(platform)/organizations/[organizationId]/onboarding/page.test.tsx' src/components/onboarding && pnpm typecheck`

  Expected: a draft organization enters the new onboarding workspace and the Digital Twin remains the canonical view of confirmed data.

- [ ] **Step 5: Self-review route safety.**

  Ensure no onboarding snapshot uses a user-provided organization ID without server authorization and no page silently changes lifecycle status.

### Task 11: Add end-to-end coverage, observability, and documentation updates

**Files:**
- Create: `e2e/guided-onboarding.spec.ts`
- Update: `context/05-module-map.md`
- Update: `specs/002-guided-onboarding.md` only if implementation resolves an explicit spec ambiguity
- Update: `progress-tracker.md`

- [ ] **Step 1: Write E2E cases before fixing flows.**

  Add an operator scenario: bootstrap organization → save incomplete identity → resume in another session → complete all ten sections with one explicit unknown → upload a failing file and use manual fallback → confirm a candidate fact → review deterministic blockers/actions → complete onboarding → open Digital Twin. Add a cross-tenant access scenario that must fail and a reduced-motion browser scenario that maintains navigable content.

- [ ] **Step 2: Run the E2E target and record the result.**

  Run: `pnpm test:e2e -- e2e/guided-onboarding.spec.ts`

  Expected before browser installation: the known missing-Chromium failure is documented. After `pnpm exec playwright install chromium`, expected: all scenarios pass against a reset local Supabase database.

- [ ] **Step 3: Add structured observability.**

  Log save/upload/extraction/readiness latency and failures with `organizationId`, `sessionId`, `runId`/`workerId` where available, and `correlationId`. Add safe metrics/event assertions for all six required onboarding event names. Do not emit payload values, upload bytes, credentials, or customer PII.

- [ ] **Step 4: Update living documentation.**

  Update the module map to locate the onboarding control plane, extraction workflow, and Digital Twin handoff. Update the tracker with migration name, verification results, any deferred provider integrations, and exact remaining blockers. Only update the feature spec when behavior is intentionally clarified and reflect the same decision in the ADR if architectural.

- [ ] **Step 5: Run the full verification suite.**

  Run:

  ```bash
  pnpm install --frozen-lockfile
  pnpm format:check
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  pnpm test:e2e -- e2e/guided-onboarding.spec.ts
  ```

  Expected: all local checks pass. If Supabase CLI or Chromium is unavailable, report those exact environmental blockers and do not claim database/E2E completion.

- [ ] **Step 6: Final implementation self-review.**

  Inspect `git diff --check`, review all new controls for shadcn composition, verify every new tenant table/query/policy with two-tenant tests, verify all ten sections and six phases are represented, and search for unfinished placeholders:

  ```bash
  rg -n "TODO|FIXME|not implemented|mock|placeholder" src supabase e2e
  ```

  Expected: no production placeholder, cross-tenant leak, unvalidated AI output, or untested high-severity path remains.

## Approval Gate

Implementation is intentionally paused here. Do not run any task above or alter application/schema files until the user explicitly approves this plan.
