# Feature Specification: Integration Hub

**Status:** Approved product and architecture design; implementation not started

**Primary user:** Agency operator

**Route:** `/organizations/[organizationId]/integrations`

**Package manager:** **pnpm** (`pnpm@11.20.0`); do not use npm or Yarn

**Approved visual direction:** Health-first operator workspace

**Reference design:** [Superdesign health-first draft](https://p.superdesign.dev/draft/035fe2fe-c036-4158-afb8-972e4222c075)

## 1. Business outcome

Give an agency operator one trustworthy place to discover, connect, inspect, test, synchronize, and disconnect organization data sources. The operator must immediately understand which data is usable, stale, degraded, awaiting access, or blocked before the platform uses it for decisions.

Success is measured by reliable and explainable data availability, not by the number of integrations connected.

## 2. V1 objective

Deliver the smallest production-complete Integration Hub vertical slice:

- A provider-agnostic integration domain and adapter contract.
- Google Business Profile as the reference read-only provider.
- A deterministic Google Business Profile fixture adapter while Google API access is pending.
- Manual and CSV data sources represented separately from provider connections.
- Organization and branch/account mapping.
- Test, manual sync, scheduled sync, freshness, health, disconnect, and audit flows.
- A health-first organization workspace built from shadcn/ui components.
- Tenant isolation at both application and database boundaries.

The slice must prove the Integration Hub control plane and its handoff to the Data Ingestion module without enabling real provider writes.

## 3. Scope

### 3.1 Included

- Provider catalog with availability, required access, capabilities, and rollout state.
- Connection list and detail views.
- One fixture-backed Google Business Profile connection per external account and organization.
- Connection testing and on-demand read-only synchronization.
- Scheduled read-only synchronization and freshness evaluation through Trigger.dev.
- Capability grants derived from adapter support, granted scopes, mapped account type, and platform policy.
- Manual data-source registration.
- UTF-8 CSV upload, validation, column mapping, import-run status, and retry.
- External account/location to organization branch mapping.
- Health summaries, normalized provider errors, activity history, and recovery actions.
- Governed disconnect with immediate capability disablement and asynchronous credential revocation/cleanup.
- Feature rollout restricted by a server-only organization allowlist.

### 3.2 Explicitly excluded from the fixture runtime

- Google Business Profile fixture write operations, including draft-write, governed-write, and bounded-autonomous execution.
- Publishing Google Business Profile posts or review responses.
- Google Business Profile webhooks or webhook health. The fixture uses scheduled and operator-triggered reads only.
- A production Google OAuth flow before Google approves API access.
- n8n connector execution.
- AI-selected credentials, scopes, accounts, mappings, or recovery actions.
- Cross-provider normalized business schemas beyond the typed `IngestionSink` handoff.
- XLSX, PDF, email-report, or spreadsheet-provider imports.
- Automatic deletion of historical ingestion, activity, or audit records on disconnect.

## 4. Product principles

- Health and required action appear before catalog promotion.
- Organization scope is visible on every screen and mutation.
- Manual entry and file imports are `DataSource` records, never fake provider connections.
- Capability availability is deterministic and explainable.
- A connection never implies permission to write.
- Stale, imported, inferred, and verified data are visually distinct.
- Failures state what was affected, whether retry is safe, and what the operator can do next.
- Historical data remains available according to organization retention policy after a connection is disabled.

## 5. Users and permissions

Application services must evaluate permissions in addition to relying on RLS.

| Action                                                        | Allowed organization roles                         |
| ------------------------------------------------------------- | -------------------------------------------------- |
| View catalog, connections, data sources, health, and activity | owner, admin, operator, viewer                     |
| Create a fixture connection                                   | owner, admin, operator                             |
| Test or synchronize a connection                              | owner, admin, operator                             |
| Create, map, retry, or archive a data source                  | owner, admin, operator                             |
| Change branch/account mappings                                | owner, admin, operator                             |
| Disconnect a connection                                       | owner, admin, operator, with explicit confirmation |
| Write health checks and ingestion results                     | validated background worker only                   |

Required permission names are `integration.read`, `integration.connect`, `integration.test`, `integration.sync`, `integration.map`, `integration.import`, and `integration.disconnect`. The V1 role mapping above implements those permissions; services must consume permission checks rather than scattering role comparisons through UI code.

## 6. Domain language

### 6.1 Connection maturity

The only allowed maturity values are:

1. `manual` — user-entered source metadata.
2. `imported` — periodic file import.
3. `read-only` — API synchronization without provider changes.
4. `draft-write` — provider draft creation without publication.
5. `governed-write` — an approved action can be executed.
6. `bounded-autonomous` — allowlisted actions can run within deterministic policy.

The Google Business Profile fixture can create only `manual`, `imported`, and `read-only` availability. A campaign provider may grant a higher maturity only for a typed capability with an installed exact adapter, a current verified provider contract, fresh capability-specific organization evidence, exact scopes and mapping, and a permitting organization policy. A derived grant must never exceed its definition.

### 6.2 Connection status

`pending`, `active`, `degraded`, `disconnected`, or `revoked`.

- `pending`: created but not successfully tested.
- `active`: usable under its current grants.
- `degraded`: usable with a known retryable or partial failure.
- `disconnected`: disabled locally; no new use is permitted.
- `revoked`: credential revocation/cleanup is confirmed.

### 6.3 Operator health state

`pending`, `healthy`, `degraded`, `stale`, or `revoked`.

Health is derived in this priority order:

1. `revoked` when the connection is disconnected or revoked.
2. `stale` when no successful sync exists after the first scheduled window, or the last successful sync is older than the provider definition's `staleAfterMinutes`.
3. `degraded` when the connection is active but the latest test/sync has a retryable or partial failure.
4. `pending` before the first successful test.
5. `healthy` when the connection is active, the latest test passed, and freshness is within target.

The Google Business Profile fixture uses a 30-minute schedule and a 65-minute stale threshold, allowing one missed interval plus a five-minute grace period.

## 7. Core entities

Every tenant-owned table includes `organization_id uuid not null`, RLS, explicit authenticated grants, and indexes for foreign keys and policy predicates. All timestamps use `timestamptz` in UTC.

### 7.1 `IntegrationConnection`

Represents one provider account connection.

Required fields:

- `id`
- `organization_id`
- `provider_key`
- `adapter_version`
- `connection_mode`: `fixture` or `oauth`
- `status`
- `external_account_id`
- `external_account_label`
- `credential_reference` nullable opaque UUID
- `granted_scopes` text array
- `token_expires_at` nullable
- `last_tested_at`, `last_successful_sync_at`, and `next_scheduled_sync_at` nullable
- `created_by`, `created_at`, and `updated_at`

Rules:

- `(organization_id, provider_key, external_account_id)` is unique.
- Reconnecting the same external account reactivates the existing record; it does not create duplicate history.
- `credential_reference` is never returned to the browser, even though it is opaque.
- Fixture connections have no credential reference and no real external token.
- A disconnected or revoked connection cannot grant usable capabilities.

### 7.2 `IntegrationCapabilityGrant`

Materializes the explainable result of capability derivation.

Required fields:

- `id`
- `organization_id`
- `connection_id`
- `capability_key`
- `maturity`
- `availability`: `available`, `blocked`, or `disabled`
- `reason_codes` text array
- `restriction_codes` text array
- `derived_from_adapter_version`
- `derived_from_contract_version`
- `grant_version`: server-managed monotonic authorization version
- `created_at` and `updated_at`

Rules:

- `(organization_id, connection_id, capability_key)` is unique.
- Task 2 invokes grant recomputation after fixture connect/reconnect, account-mapping replacement, and disconnect. Scope, contract, organization-entitlement, evidence, and policy changes must invoke the same deterministic derivation when their production mutation paths are introduced; declaring those inputs does not by itself recompute persisted rows.
- Adapter definitions and deterministic policy are the source of truth; a model cannot create or elevate a grant.
- `grant_version` is forced to `1` on insert, increments once for a material authorization change, and stays stable for a no-op recomputation. Callers cannot supply or win a version race.

### 7.3 `IntegrationAccountMapping`

Maps a provider account or location to an organization branch.

Required fields:

- `id`
- `organization_id`
- `connection_id`
- `external_resource_id`
- `external_resource_label`
- `branch_id` nullable
- `status`: `unmapped`, `mapped`, or `ignored`
- `created_by`, `created_at`, and `updated_at`

Rules:

- `(organization_id, connection_id, external_resource_id)` is unique.
- Composite foreign keys enforce that the mapping, connection, and optional branch belong to the same organization.
- An unmapped resource may be synchronized into quarantine metadata but cannot update a branch-scoped canonical fact.

### 7.4 `DataSource`

Represents manual or imported data independently of provider connections.

Required fields:

- `id`
- `organization_id`
- `source_type`: `manual` or `csv_import`
- `name`
- `branch_id` nullable
- `status`: `pending`, `ready`, `processing`, `failed`, or `archived`
- `storage_path` nullable
- `original_filename` nullable
- `media_type` nullable
- `size_bytes` nullable
- `schema_version`
- `column_mapping` JSON object
- `last_successful_import_at` nullable
- `created_by`, `created_at`, and `updated_at`

Rules:

- CSV files must be UTF-8, at most 10 MiB, and stored in a private `integration-imports` bucket.
- Storage paths use `organizationId/dataSourceId/uploadId/filename`.
- A non-null branch uses a composite foreign key so the source and branch must belong to the same organization.
- `column_mapping` contains only validated field mappings, never imported row payloads.
- Archiving prevents future imports but retains prior run history according to retention policy.

### 7.5 `IngestionRun`

Tracks one provider sync or data-source import.

Required fields:

- `id`
- `organization_id`
- exactly one of `connection_id` or `data_source_id`
- `trigger_run_id` nullable
- `idempotency_key`
- `status`: `queued`, `running`, `succeeded`, `partially_succeeded`, `failed`, or `cancelled`
- `started_at` and `completed_at` nullable
- `records_received`, `records_accepted`, and `records_rejected`
- `normalized_error_code` nullable
- `safe_error_summary` nullable
- `correlation_id`
- `created_at`

Rules:

- `(organization_id, idempotency_key)` is unique.
- Retried work reuses the same idempotency key and cannot duplicate the ingestion handoff.
- Exactly one source foreign key is enforced by a check constraint.
- Provider payloads are passed as validated envelopes to the Data Ingestion module; the Integration Hub stores run metadata, not an unbounded provider-data JSON blob.

### 7.6 `IntegrationHealthCheck`

Records a point-in-time test or freshness evaluation.

Required fields:

- `id`
- `organization_id`
- `connection_id`
- `ingestion_run_id` nullable
- `check_type`: `connectivity`, `authentication`, `freshness`, or `sync`
- `outcome`: `passed`, `warning`, or `failed`
- `latency_ms` nullable
- `normalized_error_code` nullable
- `safe_detail` nullable
- `checked_at`
- `correlation_id`

Rules:

- Health checks are append-only.
- Secret values, token fragments, provider response bodies, and unnecessary customer PII are prohibited in `safe_detail`.
- The latest derived health may be cached in the connection read model, but health-check history remains authoritative.

## 8. Database and tenancy requirements

- Use an imperative Supabase migration created with `supabase migration new <descriptive-name>`; do not invent a migration timestamp.
- Use UUID primary keys, `text` for provider identifiers, `timestamptz` for time, booleans for flags, and check constraints or stable enums for bounded states.
- Add `(organization_id, id)` uniqueness where composite tenant-safe foreign keys require it.
- Index every foreign key and every `organization_id` RLS predicate.
- Add composite indexes that match health-first queries, including connection status/update time, latest health by connection, activity by organization/time, and ingestion status/time.
- Consider partial indexes for active connections and queued/running ingestion runs after verifying the query shape.
- Enable and force RLS on all six tenant-owned tables.
- `SELECT` is available to organization members. Mutations require owner/admin/operator membership. `UPDATE` policies require both `USING` and tenant-preserving `WITH CHECK` clauses.
- Reuse `private.is_organization_member` and `private.has_organization_role`; wrap `auth.uid()` in `select` inside RLS helpers and index lookup columns.
- Explicitly grant only required table operations to `authenticated`; grant nothing to `anon`. Do not assume new public tables are automatically exposed through the Data API.
- Background workers may use privileged credentials only after validating `organizationId` and source ID and only through repositories that scope every query by organization.
- User-facing routes must not use a service-role client to bypass RLS.
- Migration verification must include Supabase database lint/advisors, missing-foreign-key-index checks, and two-tenant pgTAP coverage.

## 9. Provider registry and adapter contract

Provider definitions are versioned in TypeScript, not editable database rows.

```ts
type ProviderDefinition = {
  key: string;
  displayName: string;
  adapterVersion: string;
  contractVersion: string;
  rolloutState: "fixture" | "available" | "disabled";
  characters: readonly IntegrationCharacter[];
  capabilities: readonly ProviderCapabilityDefinition[];
  syncIntervalMinutes: number;
  staleAfterMinutes: number;
};

type ProviderCapabilityDefinition = {
  key: string;
  character: IntegrationCharacter;
  direction: "inbound" | "outbound";
  effect: "read" | "public_write" | "money_moving" | "operator_control";
  maturity: ConnectionMaturity;
  requiredScopes: readonly string[];
  restrictionCodes: readonly string[];
  adapterKind: "read" | "publish" | "advertise" | "webhook" | "operator_review";
  prerequisites: readonly CapabilityPrerequisite[];
  requiredWebhookEventKeys: readonly string[];
};

type ReadProviderAdapter = {
  providerKey: string;
  adapterVersion: string;
  adapterKind: "read";
  supportedCapabilityKeys: readonly string[];
  testConnection(input: AdapterContext): Promise<ConnectionTestResult>;
  listExternalResources(input: AdapterContext): Promise<ExternalResource[]>;
  sync(input: AdapterSyncContext): Promise<IntegrationRecordEnvelope[]>;
};

type IntegrationRecordEnvelope = {
  schemaVersion: number;
  organizationId: string;
  source: { kind: "connection" | "data_source"; id: string };
  externalRecordId: string;
  recordType: string;
  observedAt?: string;
  fetchedAt: string;
  payload: unknown;
};

type IngestionSink = {
  accept(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    records: IntegrationRecordEnvelope[];
  }): Promise<{
    accepted: number;
    rejected: number;
    rejectionReasons: readonly string[];
  }>;
};
```

`AdapterContext` includes the validated `organizationId`, `connectionId`, adapter version, correlation ID, and a server-only credential handle. It never exposes raw secrets to UI or domain objects.

Every non-fixture capability declares `organization_entitled` plus its adapter-kind prerequisites. Live reads require current credentials and an account mapping; publish and advertise also require eligible controlled-account evidence; advertise requires tracking; webhook requires verified configuration; operator review requires a linked operator. Fixture definitions are an explicit read-only exception, but still require their declared mapping evidence. Provider characters exactly match the unique character set represented by their capabilities.

The Data Ingestion module validates each envelope's `recordType` and `payload` against its own versioned schema. `payload: unknown` is an explicit boundary type, not permission to persist unvalidated JSON.

All adapter results and provider responses cross Zod schemas before persistence or ingestion. Provider errors normalize to:

- `AUTHENTICATION_FAILED`
- `AUTHORIZATION_SCOPE_MISSING`
- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `INVALID_PROVIDER_RESPONSE`
- `RESOURCE_NOT_FOUND`
- `UNKNOWN_PROVIDER_ERROR`

Each normalized error includes `retryable`, safe operator copy, and an internal cause that is excluded from client responses.

## 10. Google Business Profile reference provider

- Provider key: `google_business_profile`.
- V1 rollout state: `fixture`.
- The fixture connect transaction seeds exactly `locations/fixture-harbor-house` and `locations/fixture-river-market` as unmapped resources. Reconnect preserves existing tenant-scoped mapping state; only those exact resource IDs and labels can be submitted to the fixture mapping RPC.
- V1 capabilities: `read_google_business_profile` and `read_reviews`, both `read-only`.
- Fixture data is deterministic, organization-neutral, and contains multiple external locations so mapping behavior can be tested.
- The UI copy is: **“Fixture mode — Google API access pending.”**
- Real OAuth, account discovery, and provider calls remain disabled until Google approves API access and the credential implementation passes security review.
- Google provides no general sandbox for this API; fixture mode is the supported V1 development and demonstration path.

## 11. Credential boundary

All credential operations use a server-only `CredentialStore` interface:

```ts
type CredentialStore = {
  create(input: CreateCredentialInput): Promise<CredentialHandle>;
  resolve(input: ResolveCredentialInput): Promise<SensitiveCredential>;
  replace(input: ReplaceCredentialInput): Promise<void>;
  revoke(input: RevokeCredentialInput): Promise<void>;
};
```

- Every credential input includes the validated organization ID and provider key; a handle alone is insufficient authority.
- The production implementation target is Supabase Vault.
- Application tables persist only an opaque Vault secret UUID plus non-secret scopes, provider account identifiers, expiry, and health metadata.
- `vault.decrypted_secrets` must never be granted to `anon` or `authenticated`, exposed through the browser, selected by general repositories, or logged.
- Credential types must not implement accidental JSON serialization, and logger contexts must reject credential-shaped fields.
- V1 fixture connections use a `FixtureCredentialStore` that requires no secret.
- Supabase Vault is currently Public Alpha. Real OAuth cannot be enabled until a documented security review confirms least-privilege runtime access, backup/restore key handling, rotation, revocation, incident recovery, and an alternative credential-store migration path.
- A generic Supabase service-role client is prohibited in user-facing OAuth callbacks. The production OAuth design must preserve authenticated tenant authorization without widening Vault access.

## 12. Application flow

### 12.1 Initial page load

1. The React Server Component resolves the authenticated organization context.
2. The application service verifies `integration.read`.
3. Repositories load an organization-scoped health summary, connections, data sources, and recent activity.
4. The server renders the first meaningful state; client interactivity starts only inside the Integration Hub workspace.

### 12.2 Fixture connection

1. Operator chooses Google Business Profile from the catalog.
2. UI explains fixture mode and read-only capabilities.
3. Operator confirms connection.
4. Server validates organization scope and `integration.connect`.
5. Service upserts the fixture connection, derives grants, writes an audit event, and emits `integration.connected`.
6. Service enqueues an initial connection test and resource discovery.

### 12.3 Test connection

1. Operator selects **Test connection**.
2. API creates or reuses an idempotent test request and enqueues `integration.test-connection`.
3. UI shows queued/running state; it does not optimistically report success.
4. Worker validates organization and connection again, calls the adapter, appends a health check, updates derived status, and emits a tested event.
5. TanStack Query refreshes only the connection, health summary, and activity queries.

### 12.4 Synchronize

1. Manual or scheduled trigger creates an idempotent `IngestionRun` in `queued` state.
2. `integration.sync-connection` marks the run `running`, resolves the adapter, and obtains typed records.
3. Zod validates every `IntegrationRecordEnvelope`.
4. Valid records are handed to `IngestionSink`; rejected records are counted with safe reasons.
5. Worker records terminal counts, health, freshness, audit state, and domain events.
6. Retry uses bounded exponential backoff and the original idempotency key.

### 12.5 CSV import

1. Operator registers a CSV data source.
2. Server returns a private, tenant-scoped upload path.
3. Storage RLS permits only authorized members of that organization path.
4. Worker validates type, size, encoding, and headers before accepting column mapping.
5. TanStack Form and Zod validate mapping; submission creates an idempotent import run.
6. Valid rows pass to `IngestionSink`; rejected rows remain visible through counts and safe row-level reasons.
7. Failure preserves the data-source record and offers retry or archive.

### 12.6 Disconnect

1. Operator opens a shadcn `AlertDialog` that names the provider, account, affected capabilities, and retained history.
2. Confirmation requires the exact displayed account label or a deterministic confirmation phrase.
3. Service validates `integration.disconnect` and idempotency.
4. One transaction sets connection status to `disconnected`, disables grants, cancels future schedules, and appends audit state.
5. `integration.disconnect-connection` attempts credential revocation and cleanup.
6. Success sets `revoked`; failure keeps the connection `disconnected`, keeps capabilities disabled, shows a recoverable credential-cleanup warning, and alerts operators.

## 13. Trigger.dev tasks

- `integration.test-connection`
- `integration.sync-connection`
- `integration.import-data-source`
- `integration.disconnect-connection`
- `integration.check-freshness`

Every task requires organization ID, source ID, correlation ID, idempotency key, adapter version where relevant, timeout, bounded retry policy, cancellation support, and an explicit terminal state. Trigger.dev is an executor, not the source of business state.

## 14. API surface

All inputs and responses have colocated Zod schemas and typed public errors.

| Method and route                                                                         | Purpose                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /api/organizations/:organizationId/integrations`                                    | Health summary, connections, data sources, and recent activity |
| `GET /api/organizations/:organizationId/integrations/catalog`                            | Provider definitions and deterministic availability            |
| `POST /api/organizations/:organizationId/integrations/connections/fixture`               | Upsert the Google fixture connection                           |
| `POST /api/organizations/:organizationId/integrations/connections/:connectionId/test`    | Enqueue an idempotent test                                     |
| `POST /api/organizations/:organizationId/integrations/connections/:connectionId/sync`    | Enqueue an idempotent sync                                     |
| `PUT /api/organizations/:organizationId/integrations/connections/:connectionId/mappings` | Replace validated branch mappings transactionally              |
| `DELETE /api/organizations/:organizationId/integrations/connections/:connectionId`       | Governed disconnect                                            |
| `POST /api/organizations/:organizationId/integrations/data-sources`                      | Register manual or CSV source                                  |
| `POST /api/organizations/:organizationId/integrations/data-sources/:dataSourceId/import` | Enqueue a validated import                                     |
| `PATCH /api/organizations/:organizationId/integrations/data-sources/:dataSourceId`       | Rename or archive a source                                     |

Mutation requests include `idempotencyKey`. Accepted background work returns `202` with a run identifier and status; it never returns a false success result.

The snapshot endpoint is the single authenticated read behind the whole workspace. Its payload is
`summary`, `connections`, `dataSources`, `branches`, `recentActivity`, and `serverTime`. Each
connection carries its derived `health`, its latest health check, its `capabilities` (capability
grants), and its `mappings` (account mappings), so the selected-connection detail in section 16.1
renders without a per-connection endpoint outside this surface. `branches` carries branch identity
only — `id`, `organization_id`, and `name` — for the mapping and data-source forms.
`credential_reference` is never selected and never returned.

## 15. Events and audit

Use the repository event envelope with organization, actor, correlation, causation, schema version, and typed payload.

Required events:

- `integration.connected`
- `integration.connection_tested`
- `integration.sync_started`
- `integration.sync_completed`
- `integration.sync_failed`
- `integration.degraded`
- `integration.disconnected`
- `integration.credential_revoked`
- `data_source.created`
- `data_source.import_completed`
- `data_source.import_failed`

Connect, scope/grant change, mapping change, import, disconnect, revocation, and failed cleanup also append immutable `audit_events`. Audit payloads contain safe identifiers and before/after state, never credentials or raw provider responses.

## 16. Health-first user experience

### 16.1 Information architecture

The organization Integration Hub has four tabs:

1. **Connections** — default; health summary, connection list, selected detail, maturity, mappings, and actions.
2. **Catalog** — available, fixture, pending-access, and disabled provider definitions.
3. **Data sources** — manual sources, CSV imports, mapping, validation, and run history.
4. **Activity** — test, sync, import, disconnect, and health events.

The default Connections tab leads with:

- Operational health.
- Action required.
- Data freshness and next scheduled sync.
- Connection list with status/maturity.
- Selected connection details, capability grants, mappings, and recent activity.

### 16.2 shadcn/ui requirement

All user-facing controls and surfaces must compose installed shadcn/ui primitives. Bare HTML controls in feature code are prohibited.

- `Sidebar` and `Breadcrumb` for scope/navigation.
- `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` for the four views.
- Full `Card` composition for health summaries and connection details.
- `Badge` or the project `StatusBadge` for health and maturity.
- `Button` with `Spinner` for pending actions.
- `Alert` for actionable degraded/stale conditions.
- `Empty` for no connections, no sources, and no activity.
- `Skeleton` for initial loading.
- `AlertDialog` for disconnect.
- `Sheet` for narrow-screen connection details.
- `FieldGroup`, `Field`, `Select`, and related field primitives for mappings and data-source forms.
- `Separator` instead of raw horizontal rules.
- Sonner for mutation success/failure notifications because this is a Radix project.

If a primitive is missing, add it with `pnpm dlx shadcn@latest add <component>`. Use the installed component API, full composition, semantic CSS tokens, built-in variants, `gap-*` layout, `cn()` for conditional classes, project-configured Lucide icons, and `data-icon` inside Buttons.

### 16.3 Server and client state

- React Server Components own authenticated initial reads.
- TanStack Query v5 owns interactive client server-state with organization-scoped keys such as `['organizations', organizationId, 'integrations', 'connections']`.
- Mutations use targeted invalidation; no optimistic health, sync success, capability, or disconnect state.
- TanStack Form v1 with Zod owns branch mapping and CSV column-mapping forms.
- Server data must not be copied into a global client store.

### 16.4 Required states

Every tab and action supports:

- Initial loading.
- Empty.
- Permission denied.
- Provider/API access pending.
- Queued and running.
- Success.
- Partial success.
- Degraded.
- Stale.
- Background refetch without blanking current data.
- Recoverable failure.
- Revoked/disconnected.

Status must never rely on color alone. Focus moves to the relevant heading or error summary after navigation and failed submission. The page targets WCAG 2.2 AA and remains usable at 200% zoom and keyboard-only navigation.

## 17. Errors and recovery

Use domain-specific errors and typed public codes. Provider internals remain server-only.

| Condition                        | Public behavior                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Authorization or tenant mismatch | Return `AUTHORIZATION_ERROR` or `TENANT_SCOPE_ERROR`; perform no work            |
| Duplicate connect request        | Return the existing connection; do not duplicate grants or events                |
| Rate limit                       | Mark retryable, retain current data, show next retry                             |
| Expired/revoked credential       | Disable affected grants and show reconnect action                                |
| Invalid provider response        | Reject the boundary payload, preserve previous good data, record degraded health |
| Partial ingestion                | Show accepted/rejected counts and safe reasons; do not claim complete success    |
| Stale source                     | Keep historical data visible with a stale warning and safe retry                 |
| Disconnect cleanup failure       | Keep all grants disabled, retain history, and expose retry/escalation            |
| CSV validation failure           | Preserve source and upload status; show actionable encoding/header/size error    |

No error path may silently discard an event, mark uncertain data verified, or imply an external change occurred when it did not.

## 18. Security requirements

- Verify the authenticated session, organization membership, permission, route organization ID, and body entity organization before every mutation.
- Never trust provider account IDs, connection IDs, branch IDs, storage paths, or idempotency keys from the client without tenant-scoped lookup.
- Do not use JWT `user_metadata` for authorization.
- Do not expose service-role/secret keys through `NEXT_PUBLIC_*`, client bundles, logs, or analytics.
- Treat provider payloads and uploaded CSV cells as untrusted content.
- Never place credentials or untrusted provider text in model prompts.
- Require deterministic capability and policy checks before any future provider write.
- Use private storage and tenant-prefixed paths for CSV uploads.
- Redact secrets and unnecessary PII from logs, events, test snapshots, and error messages.
- Review Vault grants, Postgres function privileges, RLS, Storage policies, and Supabase security advisors before enabling real OAuth.

## 19. Observability

Structured logs include `organizationId`, `connectionId` or `dataSourceId`, `runId`, `workerId`, `correlationId`, adapter version, duration, normalized error code, and retry count when available.

Track:

- Connections by status and maturity.
- Health test success/failure and latency.
- Sync/import success, partial success, failure, retry, and duration.
- Provider authentication, authorization, rate-limit, and availability errors.
- Data freshness age and stale-source count.
- Records received, accepted, and rejected.
- Disconnect and credential-cleanup failures.

Never use provider account labels or customer PII as metric dimensions.

## 20. Feature rollout

- The server-only environment variable `INTEGRATION_HUB_V1_ORGANIZATION_IDS` contains a comma-separated, Zod-validated list of enabled organization UUIDs.
- The variable is never prefixed with `NEXT_PUBLIC_`.
- Page loaders, APIs, and Trigger.dev tasks all enforce the allowlist; hiding navigation alone is insufficient.
- Fixture mode is enabled only for allowlisted organizations.
- Removing an organization from the allowlist stops new operations but does not delete history.
- Real Google access additionally requires Google API approval and the Vault security gate.

## 21. Testing requirements

### 21.1 Unit tests

- Provider definition and adapter schemas.
- Capability derivation for scopes, account type, platform policy, and disconnected state.
- Health derivation priority and freshness thresholds.
- Provider-error normalization and retryability.
- Idempotency-key behavior.
- CSV metadata and column-mapping validation.
- Credential redaction and non-serialization.

### 21.2 Database and repository tests

- RLS read/write isolation for every new table across two organizations.
- Viewer read-only behavior and operator mutation behavior.
- Tenant-safe composite foreign keys for mappings.
- Unique provider account and idempotency constraints.
- Exactly-one-source constraint on ingestion runs.
- Authenticated grants and zero anonymous table privileges.
- Storage isolation for `integration-imports`.
- Every foreign key has a supporting index.
- Disconnect transaction disables every capability without deleting history.

### 21.3 Adapter and worker contract tests

- Deterministic Google fixture connection test, resource discovery, and sync.
- Malformed, rate-limited, unauthorized, unavailable, and partial provider responses.
- Trigger.dev retry with the same idempotency key.
- Cancellation and terminal-state persistence.
- `IngestionSink` receives validated envelopes exactly once.

### 21.4 Component and end-to-end tests

- Health-first desktop and narrow-screen layouts.
- Loading, empty, background-refetch, stale, degraded, partial, and revoked states.
- Catalog fixture connection through initial health test.
- Branch mapping with keyboard and validation errors.
- Manual sync queued/running/succeeded states.
- CSV upload, mapping, import failure, and retry.
- Disconnect confirmation, disabled grants, retained activity, and cleanup failure.
- Viewer cannot see mutation controls or call mutation APIs.
- Status is understandable without color.

### 21.5 Required commands

Run with Node 22 and pnpm:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Also run Supabase migration reset/tests when Docker/Postgres is available, remote database lint/advisors against staging, and Chrome DevTools UI/UX verification before declaring implementation complete.

## 22. Acceptance criteria

1. An allowlisted organization member can open a health-first Integration Hub without seeing another organization's data.
2. A viewer can inspect health, capabilities, mappings, data sources, and activity but cannot mutate them through UI or API.
3. An operator can create the deterministic Google Business Profile fixture connection and sees **“Fixture mode — Google API access pending.”**
4. The fixture exposes only `read_google_business_profile` and `read_reviews` at `read-only` maturity.
5. The system represents all six maturity levels. The Google fixture grants only the three fixture-safe levels; capability-gated campaign providers may derive higher grants only when the exact adapter, contract, organization evidence, scopes, mapping, and policy prove them usable.
6. Test and sync actions return queued/running states and update health only after worker results.
7. Health deterministically distinguishes pending, healthy, degraded, stale, and revoked.
8. External accounts/locations can be mapped only to branches in the same organization.
9. An operator can register a manual source and import a valid UTF-8 CSV through private tenant-scoped storage.
10. Invalid or partial imports retain the source, show safe reasons and counts, and support retry.
11. Disconnect immediately disables capabilities, preserves history, emits audit/events, and schedules revocation/cleanup.
12. Provider errors are normalized, retryability is explicit, and previous good data is not erased by a failed check.
13. No credential, token fragment, Vault reference, raw provider response, or unnecessary PII appears in client responses, logs, analytics, or audit payloads.
14. All new tenant tables and storage objects pass two-tenant RLS tests, explicit-grant checks, and foreign-key-index checks.
15. Every UI control uses shadcn/ui composition; loading, empty, stale, degraded, background-refetch, and error states are accessible.
16. Google fixture webhooks and provider writes remain absent. Campaign-provider webhooks and actions are unavailable unless a typed current grant satisfies ADR 0016; the checked-in Meta and Telegram contracts currently verify no usable actions.
17. Chrome DevTools verification confirms the health-first UI works at desktop and narrow viewport sizes with no critical console, network, accessibility, or interaction failure.

## 23. Definition of done

- All acceptance criteria pass.
- Migration, generated database types, fixture adapter, services, API routes, workers, UI, tests, and documentation are included.
- Staging migrations and RLS are verified without exposing credentials.
- Sensitive changes emit audit events and typed domain events.
- Failure latency and normalized-error observability exist.
- No critical or high-severity security, tenancy, accessibility, or data-integrity issue remains.
- Google OAuth remains disabled until both external approval and the documented credential security gate pass.

## 24. External dependencies and gates

- Google Business Profile API access must be requested and approved before real provider calls are enabled: <https://developers.google.com/my-business/content/prereqs>.
- Google Business Profile has no general sandbox, so V1 uses the fixture adapter: <https://developers.google.com/my-business/content/basic-setup>.
- Supabase Vault stores secrets encrypted on disk and exposes decrypted values through a protected database view: <https://supabase.com/docs/guides/database/vault>.
- Supabase currently labels Vault **Public Alpha**; production enablement requires the security gate in this spec: <https://supabase.com/features/vault>.
