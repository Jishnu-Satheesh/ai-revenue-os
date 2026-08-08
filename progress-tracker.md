# AI Revenue OS Progress Tracker

> This file is the fast orientation point for future AI agents. Read it before starting work.

## Current state

- Date: 2026-08-08
- Package manager: **pnpm** (`pnpm@11.20.0`); Node 22 is required.
- Product stage: foundation, Organization + Digital Twin vertical slice, and the Integration Hub V1 runtime.
- Current active work: all fourteen Integration Hub plan tasks are implemented and committed. Remaining work is environment-gated, not code-gated: the staging migration, pgTAP, live type generation, and authenticated browser/E2E verification are blocked on credentials and a database runtime this workspace does not have.
- Primary user: agency operator.
- Approved UI direction: section rail with an animated focused work panel.
- Current implementation plan: `docs/superpowers/plans/2026-08-08-integration-hub-implementation.md`.
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

- Product requirements: `specs/002-guided-onboarding.md`, `specs/003-integration-hub.md`, `specs/008-ai-readiness-score.md`.
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

Integration Hub code is complete. Everything below is a release gate that needs credentials or a
database runtime, not further implementation.

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
- The client may read the role-to-permission mapping from `src/domain/integrations/permissions.ts`,
  but enforcement lives only in the service, the routes, and RLS. Do not import
  `src/domain/integrations/errors.ts` from a Client Component: it is server-only and will break the
  build.
