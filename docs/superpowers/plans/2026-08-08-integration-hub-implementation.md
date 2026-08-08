# Integration Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved health-first, tenant-safe Integration Hub V1 with a deterministic read-only Google Business Profile fixture, manual/CSV data sources, durable health and ingestion work, and accessible shadcn/ui operator workflows.

**Architecture:** Keep provider definitions and deterministic policy in versioned TypeScript while Postgres owns tenant connection state, capability grants, mappings, sources, ingestion runs, and health history. React Server Components perform authenticated initial reads; organization-scoped application services enforce permissions and call RLS-backed repositories; TanStack Query and Form own only interactive client state. Trigger.dev executes thin, idempotent task wrappers around testable worker runners, and every accepted record crosses a Zod-validated `IngestionSink` boundary. V1 uses no provider credentials or writes: Google Business Profile is fixture-only, and a server-only `CredentialStore` interface preserves the future Vault boundary.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, pnpm 11, Supabase/Postgres with forced RLS and private Storage, Zod 4, TanStack Query v5, TanStack Form v1, Trigger.dev SDK/CLI 4.0.0, shadcn/ui New York/Radix, Tailwind CSS 4 semantic tokens, Lucide, Vitest, Testing Library, pgTAP, Playwright, and Chrome DevTools.

## Global Constraints

- Use **pnpm** exclusively with Node 22. Do not use npm or Yarn.
- Start from `specs/003-integration-hub.md`, its approved design, ADR 0010, and this plan. Do not enable Google OAuth, webhooks, provider writes, n8n, or autonomous execution.
- Enforce `INTEGRATION_HUB_V1_ORGANIZATION_IDS` in page loaders, APIs, and workers. Navigation visibility is not authorization.
- Every tenant-owned query and mutation accepts an authenticated `organizationId`, scopes by it, and relies on RLS in user-facing request paths. A service-role client is allowed only inside validated background workers.
- Use Zod at HTTP, CSV, adapter, task, and ingestion boundaries. Never persist or return an unvalidated provider payload.
- Persist a business run and its `(organization_id, idempotency_key)` before dispatching background work. Trigger.dev is an executor, not the system of record.
- Keep credentials server-only. Fixture mode stores no credential reference. Never serialize, log, return, or snapshot a credential handle, token, Vault row, provider body, or unnecessary PII.
- All user-facing controls and surfaces compose shadcn/ui. Add missing primitives with `pnpm dlx shadcn@latest add <component>`; do not introduce bare feature controls.
- Use semantic tokens, `cn()`, `gap-*`, built-in variants, and Lucide icons. Preserve reduced motion, keyboard access, 200% zoom, and status meaning without color.
- Do not optimistically claim connection health, sync/import success, capability availability, disconnect completion, or credential revocation.
- Before remote Supabase work, rotate the exposed staging database password and enable leaked-password protection. Never print connection strings or secrets.
- Check off a task only after its focused tests pass. Commit the task as one reviewable change; do not mix unrelated work.

## Stable Interfaces

These signatures are the contract shared across tasks. If implementation evidence requires a change, update this plan and the approved spec or ADR in the same commit.

```ts
export type IntegrationTaskName =
  | "integration.test-connection"
  | "integration.sync-connection"
  | "integration.import-data-source"
  | "integration.disconnect-connection"
  | "integration.check-freshness";

export type IntegrationTaskPayload = {
  taskName: IntegrationTaskName;
  organizationId: string;
  connectionId?: string;
  dataSourceId?: string;
  ingestionRunId?: string;
  correlationId: string;
  idempotencyKey: string;
  adapterVersion?: string;
};

export type IntegrationTaskDispatcher = {
  dispatch(input: IntegrationTaskPayload): Promise<{ triggerRunId: string }>;
};

export type IntegrationWorkerDependencies = {
  repository: IntegrationWorkerRepository;
  providers: ProviderRegistry;
  credentials: CredentialStore;
  ingestionSink: IngestionSink;
  now: () => Date;
};
```

The application service depends on `IntegrationRepository`, `EventPublisher`, `IntegrationTaskDispatcher`, `ProviderRegistry`, and `now`. Worker runners depend only on the stable interfaces above; Trigger.dev imports remain in thin registration files.

## Proposed File Map

| Area                    | Files                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                  | `src/domain/integrations/{types,schemas,provider-registry,capabilities,health,errors}.ts`                                                                       |
| Application/persistence | `src/modules/integrations/{application,infrastructure}/**`                                                                                                      |
| Provider and workers    | `src/modules/integrations/providers/google-business-profile/**`, `src/workflows/integrations/**`, `src/trigger/integrations.ts`                                 |
| API                     | `src/app/api/organizations/[organizationId]/integrations/**/route.ts`                                                                                           |
| UI                      | `src/app/(platform)/organizations/[organizationId]/integrations/**`, `src/components/integrations/**`                                                           |
| Database                | CLI-created `supabase/migrations/*_integration_hub.sql`, `supabase/tests/database/integration_hub_rls_test.sql`, generated `src/lib/supabase/database.types.ts` |
| Verification            | colocated Vitest tests, `e2e/integration-hub.spec.ts`, `progress-tracker.md`                                                                                    |

---

### Task 1: Establish tooling, Trigger.dev configuration, and the server-only rollout gate

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `trigger.config.ts`
- Modify: `src/lib/env.ts`
- Create: `src/modules/integrations/application/feature-access.ts`
- Create: `src/modules/integrations/application/feature-access.test.ts`
- Create through shadcn CLI: `src/components/ui/breadcrumb.tsx`

**Interfaces:**

- Consumes: `process.env.INTEGRATION_HUB_V1_ORGANIZATION_IDS`, `TRIGGER_PROJECT_REF`
- Produces: `parseIntegrationOrganizationIds(value)`, `assertIntegrationHubEnabled(organizationId)`, a valid Trigger.dev v4 config, and the shadcn Breadcrumb primitive

- [x] **Step 1: Write a failing rollout-gate test.**

  ```ts
  expect(parseIntegrationOrganizationIds(`${organizationA}, ${organizationB}`)).toEqual(
    new Set([organizationA, organizationB]),
  );
  expect(() => parseIntegrationOrganizationIds("not-a-uuid")).toThrow();
  expect(() => assertIntegrationHubEnabled(organizationB, new Set([organizationA]))).toThrowError(
    expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
  );
  ```

- [x] **Step 2: Run `pnpm vitest run src/modules/integrations/application/feature-access.test.ts` and confirm the missing-module failure.**

- [x] **Step 3: Install only the approved dependencies and primitive.**

  Run:

  ```bash
  pnpm add csv-parse@7.0.2
  pnpm add -D trigger.dev@4.0.0
  pnpm dlx shadcn@latest add breadcrumb
  ```

  Keep `@trigger.dev/sdk` and `trigger.dev` on the same `4.0.0` version. Do not upgrade unrelated packages.

- [x] **Step 4: Add the rollout variable and pure gate.**

  Extend `serverEnvSchema` with an optional server-only string named exactly `INTEGRATION_HUB_V1_ORGANIZATION_IDS`. Parse it as comma-separated UUIDs, trim whitespace, reject malformed/duplicate values, and throw `DomainError("FEATURE_NOT_AVAILABLE", ...)` when the organization is absent. Do not export it to client code.

- [x] **Step 5: Replace the incomplete Trigger configuration with the official v4 API.**

  ```ts
  import { defineConfig } from "@trigger.dev/sdk";

  export default defineConfig({
    project: process.env.TRIGGER_PROJECT_REF,
    dirs: ["./src/trigger"],
    runtime: "node-22",
    retries: {
      enabledInDev: false,
      default: { maxAttempts: 3, minTimeoutInMs: 1_000, maxTimeoutInMs: 30_000, factor: 2 },
    },
  });
  ```

- [x] **Step 6: Run `pnpm vitest run src/modules/integrations/application/feature-access.test.ts && pnpm typecheck && pnpm lint`.**

- [x] **Step 7: Commit with `git commit -m "chore(integrations): establish rollout and worker tooling"`.**

### Task 2: Define schemas, provider registry, capability derivation, health, and safe errors

**Files:**

- Create: `src/domain/integrations/types.ts`
- Create: `src/domain/integrations/schemas.ts`
- Create: `src/domain/integrations/provider-registry.ts`
- Create: `src/domain/integrations/capabilities.ts`
- Create: `src/domain/integrations/health.ts`
- Create: `src/domain/integrations/errors.ts`
- Create: `src/domain/integrations/schemas.test.ts`
- Create: `src/domain/integrations/capabilities.test.ts`
- Create: `src/domain/integrations/health.test.ts`
- Create: `src/domain/integrations/provider-registry.test.ts`

**Interfaces:**

- Consumes: approved maturity/status/health vocabularies and adapter contract from spec sections 6, 9, and 17
- Produces: Zod-derived public types, `ProviderRegistry`, `deriveCapabilityGrants`, `deriveConnectionHealth`, and `normalizeProviderError`

- [x] **Step 1: Write failing tests for every bounded vocabulary and external boundary.**

  Assert that all six maturities parse, only `manual`, `imported`, and `read-only` may be available in V1, malformed envelopes fail, exactly one source identifier is required, and normalized public errors never include the internal cause.

- [x] **Step 2: Write failing deterministic policy tests.**

  Cover missing scopes, unsupported capability, platform-policy denial, unmapped account, disconnected connection, stale-before-degraded priority, 65-minute Google freshness, and revoked priority.

- [x] **Step 3: Run the four focused test files and confirm missing exports.**

  Run: `pnpm vitest run src/domain/integrations/schemas.test.ts src/domain/integrations/capabilities.test.ts src/domain/integrations/health.test.ts src/domain/integrations/provider-registry.test.ts`

- [x] **Step 4: Implement Zod-first types.**

  Export the exact `ProviderDefinition`, `ProviderAdapter`, `AdapterContext`, `AdapterSyncContext`, `IntegrationRecordEnvelope`, `IngestionSink`, and `CredentialStore` contracts from the spec. Define `IntegrationErrorCode` as the seven approved provider codes plus application codes `AUTHORIZATION_ERROR`, `TENANT_SCOPE_ERROR`, `VALIDATION_ERROR`, `FEATURE_NOT_AVAILABLE`, `CONFLICT`, and `NOT_FOUND`.

- [x] **Step 5: Implement a closed provider registry.**

  `createProviderRegistry(definitions, adapters)` must reject duplicate provider keys, mismatched adapter versions, webhook/write support in fixture V1, and lookup of an unregistered provider. It exposes `listDefinitions()` and `getAdapter(providerKey, adapterVersion)` without allowing tenant mutation.

- [x] **Step 6: Implement pure capability and health derivation.**

  Grants include `availability` and stable `reasonCodes`; disconnected/revoked always disables all grants. Health follows the exact priority `revoked → stale → degraded → pending → healthy`, and returns explanation plus timestamps rather than a color.

- [x] **Step 7: Implement safe error normalization and redaction.**

  Keep `internalCause` on a server-only error object with a `toJSON()` that omits it. Reject credential-shaped keys (`token`, `secret`, `authorization`, `credential`) from public metadata.

- [x] **Step 8: Run `pnpm vitest run src/domain/integrations && pnpm typecheck && pnpm lint`.**

- [x] **Step 9: Commit with `git commit -m "feat(integrations): define domain contracts and health policy"`.**

### Task 3: Add the six-table tenant schema, private import bucket, constraints, and RLS

**Files:**

- Create with CLI: `supabase/migrations/<CLI-generated timestamp>_integration_hub.sql`
- Create: `supabase/tests/database/integration_hub_rls_test.sql`
- Create: `src/modules/integrations/infrastructure/migration.integration.test.ts`
- Regenerate: `src/lib/supabase/database.types.ts`

**Interfaces:**

- Consumes: existing `organizations`, `organization_memberships`, `branches`, `private.is_organization_member`, `private.has_organization_role`, and audit helpers
- Produces: six tenant-owned tables, explicit grants, composite foreign keys, health/activity indexes, private `integration-imports` bucket and path policies

- [x] **Step 1: Write failing SQL-contract and pgTAP tests before the migration.**

  Verify all six tables are absent first, then encode two-tenant isolation for every table, viewer read-only behavior, operator mutation, zero anonymous privileges, private storage isolation, unique connection/idempotency rules, exactly-one-source check, composite branch/connection tenant FKs, append-only health checks, and supporting indexes for every FK.

- [x] **Step 2: Run `pnpm vitest run src/modules/integrations/infrastructure/migration.integration.test.ts` and confirm the missing-schema failure.**

- [x] **Step 3: Create the imperative migration using `supabase migration new integration_hub`.**

  Do not manually invent the timestamp. Add these exact tables: `integration_connections`, `integration_capability_grants`, `integration_account_mappings`, `integration_data_sources`, `integration_ingestion_runs`, and `integration_health_checks`. Use UUID PKs, `timestamptz`, integer non-negative counters, bounded checks/enums, `created_at`/`updated_at`, `(organization_id, id)` uniqueness, and all fields required in spec section 7.

- [x] **Step 4: Add integrity constraints and query-shaped indexes.**

  Include unique `(organization_id, provider_key, external_account_id)`, unique grants/mappings, unique `(organization_id, idempotency_key)`, XOR `connection_id`/`data_source_id`, composite tenant FKs, and indexes for `(organization_id, status, updated_at desc)`, latest health `(organization_id, connection_id, checked_at desc)`, activity `(organization_id, created_at desc)`, run state `(organization_id, status, created_at desc)`, every FK, active connections, and queued/running runs.

- [x] **Step 5: Add forced RLS and explicit privileges.**

  Enable and force RLS on all tables. Grant only required operations to `authenticated`, revoke all from `anon`, allow organization-member reads, allow owner/admin/operator writes with both `USING` and tenant-preserving `WITH CHECK`, and allow no authenticated update/delete of append-only health rows. Attach the existing safe audit trigger to connection, grant, mapping, data-source, and ingestion-run changes.

- [x] **Step 6: Create the private Storage bucket and path policies.**

  Insert `integration-imports` with `public = false`, `file_size_limit = 10485760`, and CSV MIME allowlisting. Storage policies must verify the first path segment is an accessible organization and allow owner/admin/operator writes; viewers may read metadata/content only when organization policy allows the same source read.

- [ ] **Step 7: Reset, test, lint, and regenerate types locally.**

  Run:

  ```bash
  pnpm supabase:start
  pnpm supabase:reset
  supabase test db supabase/tests/database/integration_hub_rls_test.sql
  supabase db lint --local --level warning
  pnpm db:types
  pnpm vitest run src/modules/integrations/infrastructure/migration.integration.test.ts
  pnpm typecheck
  ```

  If Docker/Postgres is unavailable, record the exact blocker and do not claim database verification; continue only with static migration tests.

  **Current blocker:** this workspace has no Docker/Podman and no local Supabase executable. Static migration tests pass, but pgTAP, database lint, reset, and `database.types.ts` generation remain pending and must be completed before staging deployment or treating the generated type boundary as final.

- [x] **Step 8: Commit with `git commit -m "feat(integrations): add tenant schema and storage policies"`.**

### Task 4: Implement tenant-scoped repositories and the health-first read model

**Files:**

- Create: `src/modules/integrations/application/ports.ts`
- Create: `src/modules/integrations/application/read-model.ts`
- Create: `src/modules/integrations/infrastructure/repository.ts`
- Create: `src/modules/integrations/infrastructure/repository.test.ts`
- Create: `src/modules/integrations/infrastructure/repository.integration.test.ts`

**Interfaces:**

- Consumes: generated database types and an authenticated Supabase client
- Produces: `IntegrationRepository`, `IntegrationWorkerRepository`, and `IntegrationHubSnapshot`

- [x] **Step 1: Write failing repository tests with two organizations.**

  Cover snapshot ordering, omitted `credential_reference`, organization scoping on every lookup/update, latest-health selection, activity union, reconnect upsert, mapping replacement transaction, idempotent run creation, terminal-run guards, and transactional disconnect preserving history.

- [x] **Step 2: Run the repository tests and confirm missing implementations.**

  Run: `pnpm vitest run src/modules/integrations/infrastructure/repository.test.ts src/modules/integrations/infrastructure/repository.integration.test.ts`

- [x] **Step 3: Define narrow ports.**

  `IntegrationRepository` exposes read snapshot/catalog, scoped connection/source lookups, fixture upsert, grant replacement, mapping replacement, source create/update, run find/create, and disconnect operations. Audit writes use the established security-definer/event-publisher path; the authenticated repository must not expose a direct `audit_events` insert because that table is read-only to authenticated clients. `IntegrationWorkerRepository` exposes only scoped task state transitions, health append, grant/status recomputation inputs, and schedule timestamps. No method accepts an unscoped ID alone.

- [x] **Step 4: Implement the authenticated repository.**

  Build `IntegrationHubSnapshot` with `summary`, `connections`, `dataSources`, `recentActivity`, and `serverTime`. Select explicit safe columns; never use `select("*")` on connections. Use one short transaction/RPC for reconnect, mapping replacement, and disconnect invariants rather than multi-request partial writes.

- [x] **Step 5: Implement the worker repository separately.**

  Require `{ organizationId, entityId }` for every privileged call, verify the source before updating, and reject already-terminal runs except idempotent reads of the same terminal result.

- [x] **Step 6: Run focused unit/integration tests and type checking.**

  Run: `pnpm vitest run src/modules/integrations/infrastructure/repository.test.ts src/modules/integrations/infrastructure/repository.integration.test.ts && pnpm typecheck`

- [x] **Step 7: Commit with `git commit -m "feat(integrations): add scoped persistence and read models"`.**

  Implemented in `6081e89` with the review hardening follow-up `bd4a5d7`. Atomic worker transitions require a database CAS/RPC adapter and fail closed when unavailable; direct authenticated audit insertion was removed because current RLS grants are read-only.

### Task 5: Implement permissioned application flows, idempotency, audit, and events

**Files:**

- Create: `src/modules/integrations/application/authorization.ts`
- Create: `src/modules/integrations/application/service.ts`
- Create: `src/modules/integrations/application/service.test.ts`
- Modify: `src/domain/events/types.ts`

**Interfaces:**

- Consumes: authenticated organization context, repository, registry, dispatcher, event publisher, permission mapping
- Produces: `getSnapshot`, `getCatalog`, `connectFixture`, `requestConnectionTest`, `requestSync`, `replaceMappings`, `createDataSource`, `updateDataSource`, `requestImport`, and `disconnectConnection`

- [x] **Step 1: Write failing service tests for every permission and mutation.**

  Prove viewers can read but cannot mutate; operators can act only in their tenant; duplicate fixture connect returns the same connection; duplicate idempotency returns the same run; queued work never reports success; mappings reject foreign branches; disconnect disables grants synchronously and dispatches cleanup; publisher payloads exclude secrets.

- [x] **Step 2: Run `pnpm vitest run src/modules/integrations/application/service.test.ts` and confirm failures.**

- [x] **Step 3: Implement centralized permission mapping.**

  Map roles to the exact permissions `integration.read`, `integration.connect`, `integration.test`, `integration.sync`, `integration.map`, `integration.import`, and `integration.disconnect`. Consume `getOrganizationContext`; never compare roles in route or component code.

- [x] **Step 4: Implement read/connect/mapping/source flows.**

  Validate inputs with domain schemas, enforce feature access first, resolve every connection/branch/source through an organization-scoped lookup, recompute grants after connect/mapping changes, and publish only the approved past-tense events after committed state.

- [x] **Step 5: Implement durable request flows.**

  For test, sync, import, and disconnect: create or load the Postgres run/idempotency record before dispatch; dispatch with a stable raw key containing operation, organization, source, and persisted run ID; save `trigger_run_id`; return `{ runId, status: "queued" }`. A dispatch failure marks the business run failed with a safe code and emits a failure event.

- [x] **Step 6: Add typed event payloads.**

  Support all eleven spec events. Include organization, actor, correlation, causation, schema version, safe source IDs, counts/status, and normalized error code. Never include account labels as metric dimensions or payload secrets.

- [x] **Step 7: Run focused tests, typecheck, and lint.**

  Run: `pnpm vitest run src/modules/integrations/application/service.test.ts && pnpm typecheck && pnpm lint`

- [x] **Step 8: Commit with `git commit -m "feat(integrations): add governed application workflows"`.**

  Implemented in `7f3dc44` with review hardening follow-up `0ec0c1d`. Connect and mapping/grant writes fail closed without atomic RPC implementations; fixture connect requires exact idempotency and dispatches the initial test; disconnect requires authoritative account-label confirmation.

### Task 6: Build the deterministic Google Business Profile fixture and credential/ingestion boundaries

**Files:**

- Create: `src/modules/integrations/providers/google-business-profile/definition.ts`
- Create: `src/modules/integrations/providers/google-business-profile/fixture-data.ts`
- Create: `src/modules/integrations/providers/google-business-profile/fixture-adapter.ts`
- Create: `src/modules/integrations/providers/google-business-profile/fixture-adapter.test.ts`
- Create: `src/modules/integrations/infrastructure/credential-store.ts`
- Create: `src/modules/integrations/infrastructure/fixture-credential-store.ts`
- Create: `src/modules/integrations/infrastructure/credential-store.test.ts`
- Create: `src/modules/integrations/infrastructure/ingestion-sink.ts`
- Create: `src/modules/integrations/infrastructure/ingestion-sink.test.ts`

**Interfaces:**

- Consumes: provider/credential/envelope contracts from Task 2
- Produces: registered `google_business_profile@1`, deterministic adapter behavior, non-serializable fixture credential handle, and a validated ingestion handoff

- [x] **Step 1: Write failing fixture contract tests.**

  Assert the definition is fixture/read-only, schedule is 30 minutes, staleness is 65 minutes, capabilities are exactly `read_google_business_profile` and `read_reviews`, copy is exactly **“Fixture mode — Google API access pending.”**, and multiple deterministic external locations are returned.

- [x] **Step 2: Add failing malformed/error-mode tests.**

  Cover authentication, missing scope, rate limit, unavailable, malformed response, missing resource, partial ingestion, stable external IDs, and identical results for repeated inputs.

- [x] **Step 3: Implement the fixture definition, data, and adapter.**

  Keep data organization-neutral and derive the envelope `organizationId`, source ID, fetched time, and correlation from validated context. Expose test-only error modes through injected fixture scenarios, never from browser-controlled production input.

- [x] **Step 4: Implement the credential boundary without Vault access.**

  `FixtureCredentialStore` returns an opaque object that throws on accidental JSON serialization, requires organization/provider on every call, and stores no token. Define the production interface only; do not query `vault.decrypted_secrets` or implement OAuth.

- [x] **Step 5: Implement the ingestion boundary.**

  Parse every envelope with Zod, enforce matching organization/source and idempotency, pass accepted records to the Data Ingestion port, and return counts/safe rejection reasons. The temporary sink may deterministically acknowledge records because the downstream module is not implemented, but must remain an explicit port and must not persist unbounded payloads in Integration Hub tables.

- [x] **Step 6: Run the three focused test files, typecheck, and lint.**

  Run: `pnpm vitest run src/modules/integrations/providers/google-business-profile/fixture-adapter.test.ts src/modules/integrations/infrastructure/credential-store.test.ts src/modules/integrations/infrastructure/ingestion-sink.test.ts && pnpm typecheck && pnpm lint`

- [x] **Step 7: Commit with `git commit -m "feat(integrations): add fixture provider and secure boundaries"`.**

  Implemented in `fbaeeb3` with ingestion hardening follow-ups `00b9138` and `de8bef5`. The sink is bounded and exactly-once within a process; durable retry idempotency remains owned by persisted ingestion runs.

### Task 7: Implement testable worker runners and register the five Trigger.dev tasks

**Files:**

- Create: `src/lib/supabase/service.ts`
- Create: `src/workflows/integrations/test-connection.ts`
- Create: `src/workflows/integrations/sync-connection.ts`
- Create: `src/workflows/integrations/import-data-source.ts`
- Create: `src/workflows/integrations/disconnect-connection.ts`
- Create: `src/workflows/integrations/check-freshness.ts`
- Create: `src/workflows/integrations/workers.test.ts`
- Create: `src/trigger/integrations.ts`

**Interfaces:**

- Consumes: `IntegrationTaskPayload`, worker dependencies, `SUPABASE_SERVICE_ROLE_KEY`, Trigger.dev v4 `task`
- Produces: five pure runners and five registered tasks with bounded retry, timeout, cancellation, and terminal persistence

- [x] **Step 1: Write failing runner tests.**

  Cover organization/source validation before privileged reads, queued→running→terminal transitions, the same idempotency key across retries, exactly-once sink handoff, cancellation, partial counts, failed tests preserving previous good data, stale evaluation, and cleanup failure leaving grants disabled.

- [x] **Step 2: Run `pnpm vitest run src/workflows/integrations/workers.test.ts` and confirm missing modules.**

- [x] **Step 3: Implement a worker-only Supabase client.**

  Require the service-role key only at task runtime, mark the module server-only, never import it from routes/components, and expose only to the worker repository factory. Validate allowlist, organization, source, and adapter version before any privileged operation.

- [x] **Step 4: Implement the five pure runners.**

  Test appends connectivity/auth health; sync validates envelopes and invokes the sink once; CSV import validates object metadata/encoding/header/mapping and streams bounded batches; disconnect retries credential cleanup and records revoked/warning state; freshness appends an authoritative check without erasing history. Every catch normalizes the error and persists an explicit terminal state.

- [x] **Step 5: Register thin Trigger.dev tasks.**

  Use `task({ id, retry, maxDuration, run })` with exact IDs from the spec. Parse payloads again with Zod, construct worker dependencies server-side, and call one runner. Trigger retries reuse the persisted raw idempotency key; do not generate keys inside a retry.

- [x] **Step 6: Run focused tests and verify the pinned CLI/config load.**

  Run: `pnpm vitest run src/workflows/integrations/workers.test.ts && pnpm trigger.dev dev --help && pnpm typecheck && pnpm lint`

- [x] **Step 7: Commit with `git commit -m "feat(integrations): register durable worker tasks"`.**

  Implemented in `f9da1b1` with successive safety hardening through `9303842`, `848d6af`, `407a7a0`, `705e0e7`, `c98d17f`, `35e9f08`, `6a04acd`, `ade3186`, `f50cd89`, and `6b05e74`. Worker execution leases, token-fenced RPC writes, cancellation supersede, durable handoff leases, retry takeover, and bounded CSV/Trigger behavior are covered by focused tests. Supabase reset/pgTAP/type generation remain pending until a real runtime is available.

### Task 8: Expose read, catalog, fixture-connect, and operation APIs

**Files:**

- Create: `src/modules/integrations/application/api-schemas.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/catalog/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/connections/fixture/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/connections/[connectionId]/test/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/connections/[connectionId]/sync/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/connections/[connectionId]/mappings/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/connections/[connectionId]/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/routes.test.ts`

**Interfaces:**

- Consumes: organization context, application service, colocated Zod request schemas
- Produces: first seven exact integration endpoints from spec section 14 with safe public responses

- [x] **Step 1: Write failing route tests.**

  Cover unauthenticated `401`, tenant/permission denial, disabled feature, invalid UUID/body/idempotency, safe `404`, viewer read access, viewer mutation denial, duplicate connect, `202` for accepted work, mapping validation, disconnect confirmation, and response snapshots with no `credential_reference` or internal cause.

- [x] **Step 2: Run the route test and confirm missing handlers.**

  Run: `pnpm vitest run 'src/app/api/organizations/[organizationId]/integrations/routes.test.ts'`

- [x] **Step 3: Implement a shared route composition helper.**

  Resolve the authenticated user and route organization through existing context utilities, validate params/body, construct the RLS-backed service, map domain errors to stable HTTP/public codes, attach correlation IDs, and emit structured latency/failure logs. Never instantiate the worker service client.

- [x] **Step 4: Implement GET routes and fixture connection.**

  Return RSC/client-safe snapshot and deterministic catalog. Fixture connect returns `200` for the existing upserted connection or `201` for first creation, followed by queued initial test/discovery metadata.

- [x] **Step 5: Implement test, sync, mapping, and disconnect routes.**

  Require body `idempotencyKey` for background requests. Mapping replacement is atomic. Disconnect requires the exact current account label/phrase and returns `202` only after capabilities are synchronously disabled and cleanup is queued.

- [x] **Step 6: Run route tests, typecheck, and lint.**

  Run: `pnpm vitest run 'src/app/api/organizations/[organizationId]/integrations/routes.test.ts' && pnpm typecheck && pnpm lint`

- [x] **Step 7: Commit with `git commit -m "feat(integrations): expose connection APIs"`.**

  Implemented in `34368fc` with atomic RPC/policy hardening `b5704f5`, `e5c9130`, and `40aaad7`. Supabase runtime/pgTAP/type generation remain pending because Docker is unavailable.

### Task 9: Expose manual/CSV source registration, private upload, import, and archive APIs

**Files:**

- Create: `src/modules/integrations/application/csv.ts`
- Create: `src/modules/integrations/application/csv.test.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/data-sources/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/data-sources/[dataSourceId]/import/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/data-sources/[dataSourceId]/route.ts`
- Create: `src/app/api/organizations/[organizationId]/integrations/data-sources/data-source-routes.test.ts`

**Interfaces:**

- Consumes: authenticated Supabase Storage client, `csv-parse`, source/application service
- Produces: final three exact APIs, tenant-prefixed upload contract, metadata/header/mapping validation

- [x] **Step 1: Write failing CSV and route tests.**

  Cover manual source without file, `.csv`/`text/csv`, UTF-8 BOM handling, invalid UTF-8, over-10-MiB metadata, empty/duplicate headers, dangerous path segments, foreign branch/source, malformed mapping, archive blocking imports, partial/failure retention, retry with same run, and no raw cells in errors/logs.

- [x] **Step 2: Run both focused tests and confirm missing implementations.**

  Run: `pnpm vitest run src/modules/integrations/application/csv.test.ts 'src/app/api/organizations/[organizationId]/integrations/data-sources/data-source-routes.test.ts'`

- [x] **Step 3: Implement bounded CSV validation.**

  Use `csv-parse` streaming or bounded input, normalize BOM, require non-empty unique headers, cap row/column/error counts, validate mapping with Zod, and return safe row numbers/reason codes without copying cell values into logs or run metadata.

- [x] **Step 4: Implement source registration and private upload.**

  Create the source first, generate/validate `organizationId/dataSourceId/uploadId/filename`, upload through the authenticated RLS client, persist only safe metadata, and delete the new object if metadata persistence fails. Do not produce public URLs.

- [x] **Step 5: Implement import and patch routes.**

  Import validates the stored object belongs to the scoped source before creating/dispatching a run. Patch permits rename or archive only; archive preserves object/run/activity history and prevents future imports.

- [x] **Step 6: Run focused tests, typecheck, and lint.**

  Run: `pnpm vitest run src/modules/integrations/application/csv.test.ts 'src/app/api/organizations/[organizationId]/integrations/data-sources/data-source-routes.test.ts' && pnpm typecheck && pnpm lint`

- [x] **Step 7: Commit with `git commit -m "feat(integrations): add governed data-source imports"`.**

  Implemented in `fba4f56` with the idempotent data-source operation follow-up in `7310774` and the repair commit that restored `pnpm typecheck`, added static contract tests for `20260808033746_integration_data_source_operations.sql`, and covered archived-import refusal, safe cross-tenant `404`, retried-run replay, and no-raw-cell CSV rejection. Supabase Storage/RLS behavior remains unverified until a database runtime is available.

### Task 10: Wire the organization route, RSC snapshot, query layer, and route-aware navigation

**Files:**

- Create: `src/app/(platform)/organizations/[organizationId]/integrations/page.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/integrations/loading.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/integrations/error.tsx`
- Create: `src/components/integrations/integration-hub-client.tsx`
- Create: `src/components/integrations/query-options.ts`
- Create: `src/components/layout/route-context.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Create: `src/components/integrations/integration-hub-client.test.tsx`

**Interfaces:**

- Consumes: authenticated server snapshot, feature gate, safe API responses
- Produces: protected organization Integration Hub page, four-tab client shell, scoped query keys, truthful breadcrumbs/navigation

- [ ] **Step 1: Write failing component tests.**

  Assert the RSC denies disabled/foreign organizations, the shell defaults to Connections, four tabs are keyboard reachable, query keys begin `['organizations', organizationId, 'integrations']`, background refetch retains current data, and active sidebar/breadcrumb labels derive from pathname rather than hardcoded Overview.

- [ ] **Step 2: Run the focused component test and confirm missing components.**

  Run: `pnpm vitest run src/components/integrations/integration-hub-client.test.tsx`

- [ ] **Step 3: Implement the server boundary.**

  Resolve organization context and `integration.read`, enforce allowlist, fetch the snapshot through the application service, and pass dehydrated/safe initial data to the client boundary. Render `loading.tsx` with shadcn Skeleton and `error.tsx` with shadcn Alert/Button.

- [ ] **Step 4: Implement scoped TanStack Query options.**

  Define keys for snapshot, catalog, connection detail, health, sources, and activity. Mutations invalidate only affected keys; render a subtle background-refetch indicator without blanking data. Keep server data out of a global store.

- [ ] **Step 5: Implement route-aware app chrome.**

  Use the added shadcn Breadcrumb and existing Sidebar composition. The organization label and `Integrations` location must be correct on desktop/mobile; remove the current hardcoded active Overview behavior. Keep controls as shadcn components.

- [ ] **Step 6: Run component tests, typecheck, and lint.**

  Run: `pnpm vitest run src/components/integrations/integration-hub-client.test.tsx && pnpm typecheck && pnpm lint`

- [ ] **Step 7: Commit with `git commit -m "feat(integrations): add protected workspace shell"`.**

### Task 11: Build the health-first Connections experience

**Files:**

- Create: `src/components/integrations/health-summary.tsx`
- Create: `src/components/integrations/connections-tab.tsx`
- Create: `src/components/integrations/connection-list.tsx`
- Create: `src/components/integrations/connection-detail.tsx`
- Create: `src/components/integrations/capability-list.tsx`
- Create: `src/components/integrations/mapping-form.tsx`
- Create: `src/components/integrations/disconnect-dialog.tsx`
- Create: `src/components/integrations/connections-tab.test.tsx`

**Interfaces:**

- Consumes: snapshot/catalog/query mutations and TanStack Form
- Produces: desktop list/detail and narrow Sheet UI for health, actions, capabilities, mappings, sync/test, and governed disconnect

- [ ] **Step 1: Write failing UI-state tests.**

  Cover empty, pending, healthy, degraded, stale, revoked, queued/running, partial, recoverable failure, action-required summary, freshness/next sync, fixture copy, viewer-hidden actions, focus movement, disconnect cleanup warning, and status text/icons independent of color.

- [ ] **Step 2: Run the component test and confirm missing UI.**

  Run: `pnpm vitest run src/components/integrations/connections-tab.test.tsx`

- [ ] **Step 3: Build the health summary and responsive master/detail layout.**

  Compose full shadcn Card, Alert, Badge/StatusBadge, Tabs, Button/Spinner, Empty, Skeleton, Separator, Sheet, and Tooltip APIs. Connections lead with operational health/action required, not provider promotion. On narrow screens the selected detail opens in a Sheet.

- [ ] **Step 4: Build test/sync mutations without false optimism.**

  Buttons show pending locally; responses show queued/running; only refetched worker state may show success. Use Sonner for mutation acknowledgement/failure and targeted invalidation for connection, summary, and activity.

- [ ] **Step 5: Build the TanStack mapping form.**

  Use `FieldGroup`, `Field`, `Select`, `SelectGroup`, and Zod. Render unmapped/mapped/ignored resources, branch choices from the same organization, per-field errors, keyboard submission, and focus to the error summary after failure.

- [ ] **Step 6: Build governed disconnect.**

  Use shadcn AlertDialog naming provider/account, affected grants, retained history, and required phrase. After acceptance show capabilities disabled immediately and cleanup queued; failure remains a warning with retry/escalation.

- [ ] **Step 7: Run UI tests, typecheck, and lint; reserve the required 200%-zoom browser check for Task 14.**

  Run: `pnpm vitest run src/components/integrations/connections-tab.test.tsx && pnpm typecheck && pnpm lint`

- [ ] **Step 8: Commit with `git commit -m "feat(integrations): build health-first connections UI"`.**

### Task 12: Build Catalog, Data sources, and Activity experiences

**Files:**

- Create: `src/components/integrations/catalog-tab.tsx`
- Create: `src/components/integrations/data-sources-tab.tsx`
- Create: `src/components/integrations/data-source-form.tsx`
- Create: `src/components/integrations/csv-mapping-form.tsx`
- Create: `src/components/integrations/activity-tab.tsx`
- Create: `src/components/integrations/secondary-tabs.test.tsx`
- Modify: `src/components/integrations/integration-hub-client.tsx`

**Interfaces:**

- Consumes: catalog/source/activity APIs, TanStack Query/Form, private file input
- Produces: complete remaining tabs and accessible source/import workflow

- [ ] **Step 1: Write failing tests for all secondary-tab states.**

  Cover catalog fixture/available/pending/disabled labels; exact fixture copy; no write capability; manual source creation; CSV size/type/encoding/header/mapping errors; upload/import queued/running/succeeded/partial/failed/retry; archive; activity chronology; empty/background-refetch states; viewer read-only behavior.

- [ ] **Step 2: Run the focused test and confirm missing components.**

  Run: `pnpm vitest run src/components/integrations/secondary-tabs.test.tsx`

- [ ] **Step 3: Implement Catalog.**

  Render definitions from the server registry, not client constants. Use Card/Badge/Alert/Button and explain required access/capabilities/rollout. The Google action opens the fixture confirmation flow; real OAuth controls do not exist.

- [ ] **Step 4: Implement Data sources with TanStack Form.**

  Use shadcn Field/Input/Button/Progress/Alert/Empty composition. A native file input may exist only through the shadcn Input primitive. Display safe validation reasons, accepted/rejected counts, and retry/archive actions; never render raw rejected CSV cells.

- [ ] **Step 5: Implement Activity.**

  Render tests, syncs, imports, disconnects, and health checks newest-first with actor/time/correlation-safe state. Use semantic list markup inside shadcn Cards, status icons plus text, and organization-timezone display.

- [ ] **Step 6: Run UI tests, typecheck, lint, and format check.**

  Run: `pnpm vitest run src/components/integrations/secondary-tabs.test.tsx && pnpm typecheck && pnpm lint && pnpm format:check`

- [ ] **Step 7: Commit with `git commit -m "feat(integrations): complete catalog sources and activity UI"`.**

### Task 13: Prove end-to-end authorization, worker state, responsive UX, and recovery

**Files:**

- Create: `e2e/integration-hub.spec.ts`
- Create or Modify: the existing authenticated E2E fixture/helper under `e2e/`
- Modify: focused test fixtures only where required

**Interfaces:**

- Consumes: completed feature, authenticated owner/operator/viewer fixtures, deterministic provider scenarios
- Produces: browser evidence for acceptance criteria 1–17

- [ ] **Step 1: Add failing Playwright scenarios.**

  Cover protected/allowlisted route, no cross-tenant data, viewer controls/API denial, fixture connect and exact copy, initial test, mapping, manual sync transitions, CSV success/failure/retry, disconnect/retained activity/cleanup failure, status without color, reduced motion, desktop, and narrow Sheet behavior.

- [ ] **Step 2: Run `pnpm test:e2e -- e2e/integration-hub.spec.ts` and record the first concrete failure.**

- [ ] **Step 3: Fix only product defects exposed by the scenarios.**

  Keep deterministic task/provider test doubles behind test-only dependency injection; do not add browser-accessible fixture switches or weaken production authorization.

- [ ] **Step 4: Run the focused E2E file until green at desktop and narrow viewport.**

  Run: `pnpm test:e2e -- e2e/integration-hub.spec.ts`

- [ ] **Step 5: Run tenant/security regression tests.**

  Execute repository, route, pgTAP, storage, viewer, disconnect, and worker idempotency suites. Confirm no user-facing path imports the worker service client by searching `SUPABASE_SERVICE_ROLE_KEY` and `src/lib/supabase/service` imports.

  Run: `pnpm vitest run src/modules/integrations/infrastructure/repository.integration.test.ts 'src/app/api/organizations/[organizationId]/integrations/routes.test.ts' 'src/app/api/organizations/[organizationId]/integrations/data-sources/data-source-routes.test.ts' src/workflows/integrations/workers.test.ts && supabase test db supabase/tests/database/integration_hub_rls_test.sql`

- [ ] **Step 6: Commit with `git commit -m "test(integrations): verify governed end-to-end workflows"`.**

### Task 14: Apply staging migration, verify with Chrome DevTools, and close documentation

**Files:**

- Modify: `progress-tracker.md`
- Modify only if behavior changed: `specs/003-integration-hub.md`
- Modify only if architecture changed: `adrs/0010-fixture-first-integration-credential-boundary.md`
- Modify if operational setup changed: `README.md`

**Interfaces:**

- Consumes: all implementation outputs and required verification commands
- Produces: verified staging schema/UI, a current progress tracker, and an evidence-backed handoff

- [ ] **Step 1: Complete the staging security preconditions.**

  Rotate the previously exposed database password, update `.env.local` without printing it, and enable Supabase Auth leaked-password protection. Stop if either action lacks user authority or dashboard access; record it as an explicit release blocker.

- [ ] **Step 2: Apply and verify the migration safely.**

  Compare local/remote migration history, dry-run first, apply the CLI-generated migration, regenerate live types, run database lint/security/performance advisors, verify six tables and private bucket, verify forced RLS/explicit grants/zero anon privileges/FK indexes, and execute a transaction-safe two-tenant smoke test with cleanup.

- [ ] **Step 3: Run the full project gate.**

  ```bash
  pnpm install --frozen-lockfile
  pnpm format:check
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  pnpm test:e2e
  ```

  Record counts and failures honestly. Do not sign off with any known critical/high security, tenancy, integrity, or accessibility defect.

- [ ] **Step 4: Verify the frontend with Chrome DevTools before sign-off.**

  Start the app with the staged/fixture-safe configuration. Inspect desktop and narrow viewports for all four tabs; fixture connect; mapping validation; queued/running/success and error states; CSV validation/import; disconnect; keyboard/focus; 200% zoom; reduced motion; and background refetch. Inspect Console and Network for critical errors, secret/credential leakage, wrong-tenant requests, false success, layout overflow, and accessibility issues.

- [ ] **Step 5: Update documentation and tracker with evidence.**

  Mark the active plan, completed tasks, migration version, test counts, staging verification, Chrome DevTools findings, risks, blockers, and genuine remaining work. Preserve the Google/Vault external gates and state clearly that real OAuth/writes/webhooks remain absent.

- [ ] **Step 6: Run `git diff --check` and scan changed files for unfinished markers, stub handlers, raw feature controls, secrets, and provider-write/webhook code.**

- [ ] **Step 7: Commit with `git commit -m "docs(integrations): record implementation verification"`.**

## Spec Coverage Map

| Spec sections                             | Plan tasks                                   |
| ----------------------------------------- | -------------------------------------------- |
| 1–4 outcome, objective, scope, principles | Global constraints; Tasks 6, 10–14           |
| 5 permissions                             | Tasks 3, 5, 8–13                             |
| 6 domain language                         | Task 2                                       |
| 7–8 entities, database, tenancy           | Tasks 3–4, 14                                |
| 9 provider/ingestion contracts            | Tasks 2 and 6                                |
| 10 Google fixture                         | Task 6                                       |
| 11 credentials                            | Tasks 2, 6–7, 13–14                          |
| 12 application flows                      | Tasks 5, 7–9, 11–13                          |
| 13 Trigger.dev tasks                      | Tasks 1 and 7                                |
| 14 API surface                            | Tasks 8–9                                    |
| 15 events and audit                       | Tasks 3, 5, and 7                            |
| 16 health-first UX                        | Tasks 10–12 and 14                           |
| 17 errors/recovery                        | Tasks 2, 5–9, and 11–13                      |
| 18 security                               | Global constraints; Tasks 3–9, 13–14         |
| 19 observability                          | Tasks 5, 7–9, and 14                         |
| 20 rollout                                | Tasks 1, 5, 7–10, and 13                     |
| 21 tests                                  | Every task; Tasks 13–14 consolidate evidence |
| 22 acceptance criteria                    | Tasks 13–14                                  |
| 23 definition of done                     | Task 14                                      |
| 24 external gates                         | Global constraints and Task 14               |

## Plan Completion Review

- [ ] Every runtime file named in the file map is either created or consciously removed from this plan with the spec updated.
- [ ] Every external boundary has a Zod schema and at least one rejection test.
- [ ] Every repository and worker operation scopes both organization and entity IDs.
- [ ] Every mutation has permission, idempotency, audit/event, safe-error, and observability coverage.
- [ ] Every shadcn component uses its full composition API; no feature code contains raw buttons, selects, dialogs, cards, menus, or sidebars.
- [ ] Google remains fixture-only/read-only and the exact pending-access copy is present.
- [ ] No plan item or implementation contains unresolved work markers, false success, or silent failure.
- [ ] Chrome DevTools verification and the complete pnpm/Supabase command evidence are recorded before completion is claimed.
