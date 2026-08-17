import type { ProviderDefinition } from "@/domain/integrations/types";

/**
 * Provisional schema boundary for Integration Hub tables.
 *
 * `src/lib/supabase/database.types.ts` predates the Integration Hub migration.
 * Keep these definitions local until `pnpm db:types` can regenerate the
 * authoritative Database type from a running Supabase instance.
 */
export type IntegrationConnectionRow = {
  id: string;
  organization_id: string;
  provider_key: string;
  adapter_version: string;
  connection_mode: "fixture" | "oauth";
  status: "pending" | "active" | "degraded" | "disconnected" | "revoked";
  external_account_id: string;
  external_account_label: string;
  /** Server-only and intentionally never selected by the authenticated repository. */
  credential_reference?: string | null;
  granted_scopes: string[];
  token_expires_at: string | null;
  last_tested_at: string | null;
  last_successful_sync_at: string | null;
  next_scheduled_sync_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationCapabilityGrantRow = {
  id: string;
  organization_id: string;
  connection_id: string;
  capability_key: string;
  maturity:
    | "manual"
    | "imported"
    | "read-only"
    | "draft-write"
    | "governed-write"
    | "bounded-autonomous";
  availability: "available" | "blocked" | "disabled";
  reason_codes: string[];
  restriction_codes: string[];
  derived_from_adapter_version: string;
  derived_from_contract_version: string;
  grant_version: number;
  created_at: string;
  updated_at: string;
};

export type IntegrationAccountMappingRow = {
  id: string;
  organization_id: string;
  connection_id: string;
  external_resource_id: string;
  external_resource_label: string;
  branch_id: string | null;
  status: "unmapped" | "mapped" | "ignored";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationDataSourceRow = {
  id: string;
  organization_id: string;
  source_type: "manual" | "csv_import";
  name: string;
  branch_id: string | null;
  status: "pending" | "ready" | "processing" | "failed" | "archived";
  storage_path: string | null;
  original_filename: string | null;
  media_type: string | null;
  size_bytes: number | null;
  schema_version: number;
  column_mapping: Record<string, unknown>;
  last_successful_import_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationIngestionRunRow = {
  id: string;
  organization_id: string;
  connection_id: string | null;
  data_source_id: string | null;
  trigger_run_id: string | null;
  idempotency_key: string;
  status: "queued" | "running" | "succeeded" | "partially_succeeded" | "failed" | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  records_received: number;
  records_accepted: number;
  records_rejected: number;
  normalized_error_code: string | null;
  safe_error_summary: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationHealthCheckRow = {
  id: string;
  organization_id: string;
  connection_id: string;
  ingestion_run_id: string | null;
  check_type: "connectivity" | "authentication" | "freshness" | "sync";
  outcome: "passed" | "warning" | "failed";
  latency_ms: number | null;
  normalized_error_code: string | null;
  safe_detail: string | null;
  checked_at: string;
  correlation_id: string;
};

export type IntegrationAuditEvent = {
  id: string;
  organization_id: string;
  event_name: string;
  actor_type: "user" | "system" | "ai";
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  correlation_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type IntegrationConnectionInsert = Omit<
  IntegrationConnectionRow,
  "id" | "created_at" | "updated_at"
>;
export type IntegrationDataSourceInsert = Omit<
  IntegrationDataSourceRow,
  "id" | "created_at" | "updated_at"
>;
export type IntegrationIngestionRunInsert = Omit<
  IntegrationIngestionRunRow,
  "id" | "created_at" | "updated_at"
>;
export type IntegrationHealthCheckInsert = Omit<IntegrationHealthCheckRow, "id">;
export type IntegrationCapabilityGrantInsert = Omit<
  IntegrationCapabilityGrantRow,
  "id" | "organization_id" | "connection_id" | "grant_version" | "created_at" | "updated_at"
>;
export type IntegrationAccountMappingInsert = Omit<
  IntegrationAccountMappingRow,
  "id" | "organization_id" | "connection_id" | "created_by" | "created_at" | "updated_at"
>;
export type FixtureConnectionUpsertInput = {
  organizationId: string;
  actorId: string;
  providerKey: string;
  adapterVersion: string;
  externalAccountId: string;
  externalAccountLabel: string;
  grantedScopes: readonly string[];
  idempotencyKey: string;
  correlationId: string;
};

/** Minimal branch identity the mapping form needs; no operational detail. */
export type IntegrationBranchOption = {
  id: string;
  organization_id: string;
  name: string;
};

export type IntegrationPersistencePort = {
  listConnections(input: { organizationId: string }): Promise<IntegrationConnectionRow[]>;
  listCapabilityGrants(input: { organizationId: string }): Promise<IntegrationCapabilityGrantRow[]>;
  listAccountMappings(input: { organizationId: string }): Promise<IntegrationAccountMappingRow[]>;
  listBranches(input: { organizationId: string }): Promise<IntegrationBranchOption[]>;
  listDataSources(input: { organizationId: string }): Promise<IntegrationDataSourceRow[]>;
  listHealthChecks(input: { organizationId: string }): Promise<IntegrationHealthCheckRow[]>;
  listRuns(input: { organizationId: string }): Promise<IntegrationIngestionRunRow[]>;
  listAuditEvents(input: { organizationId: string }): Promise<IntegrationAuditEvent[]>;
  findConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<IntegrationConnectionRow | null>;
  findDataSource(input: {
    organizationId: string;
    dataSourceId: string;
  }): Promise<IntegrationDataSourceRow | null>;
  findRun(input: {
    organizationId: string;
    ingestionRunId: string;
  }): Promise<IntegrationIngestionRunRow | null>;
  createDataSource(input: IntegrationDataSourceInsert): Promise<IntegrationDataSourceRow>;
  updateDataSource(input: {
    organizationId: string;
    dataSourceId: string;
    patch: Partial<IntegrationDataSourceInsert>;
  }): Promise<IntegrationDataSourceRow>;
  findRunByIdempotencyKey(input: {
    organizationId: string;
    idempotencyKey: string;
  }): Promise<IntegrationIngestionRunRow | null>;
  createRun(input: IntegrationIngestionRunInsert): Promise<IntegrationIngestionRunRow>;
  updateRun(input: {
    organizationId: string;
    ingestionRunId: string;
    patch: Partial<IntegrationIngestionRunInsert>;
  }): Promise<IntegrationIngestionRunRow>;
  appendHealthCheck(input: IntegrationHealthCheckInsert): Promise<IntegrationHealthCheckRow>;
  updateConnection(input: {
    organizationId: string;
    connectionId: string;
    patch: Pick<
      IntegrationConnectionRow,
      "status" | "last_tested_at" | "last_successful_sync_at" | "next_scheduled_sync_at"
    >;
  }): Promise<IntegrationConnectionRow>;
};

export type IntegrationTransactionPort = {
  upsertFixtureConnection(input: FixtureConnectionUpsertInput): Promise<IntegrationConnectionRow>;
  replaceCapabilityGrants(input: {
    organizationId: string;
    connectionId: string;
    grants: readonly IntegrationCapabilityGrantInsert[];
    correlationId: string;
  }): Promise<IntegrationCapabilityGrantRow[]>;
  replaceMappings(input: {
    organizationId: string;
    connectionId: string;
    actorId: string;
    mappings: readonly IntegrationAccountMappingInsert[];
    correlationId: string;
  }): Promise<IntegrationAccountMappingRow[]>;
  /** Atomic RPC boundary. Absence must fail closed for application connect flows. */
  connectFixtureWithGrants?: (
    input: FixtureConnectionUpsertInput & { grants: readonly IntegrationCapabilityGrantInsert[] },
  ) => Promise<{
    connection: IntegrationConnectionRow;
    grants: IntegrationCapabilityGrantRow[];
    created: boolean;
    deduplicated: boolean;
  }>;
  /** Atomic RPC boundary. Absence must fail closed for application mapping flows. */
  replaceMappingsWithGrants?: (input: {
    organizationId: string;
    connectionId: string;
    actorId: string;
    idempotencyKey: string;
    mappings: readonly IntegrationAccountMappingInsert[];
    grants: readonly IntegrationCapabilityGrantInsert[];
    correlationId: string;
  }) => Promise<{
    mappings: IntegrationAccountMappingRow[];
    grants: IntegrationCapabilityGrantRow[];
  }>;
  disconnectConnection(input: {
    organizationId: string;
    connectionId: string;
    actorId: string;
    correlationId: string;
  }): Promise<IntegrationConnectionRow>;
  createDataSourceWithIdempotency?: (input: {
    source: IntegrationDataSourceInsert;
    dataSourceId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    correlationId: string;
  }) => Promise<{
    source: IntegrationDataSourceRow;
    created: boolean;
    deduplicated: boolean;
  }>;
  updateDataSourceWithIdempotency?: (input: {
    organizationId: string;
    dataSourceId: string;
    actorId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    patch: Partial<Pick<IntegrationDataSourceInsert, "name" | "status">>;
    correlationId: string;
  }) => Promise<{ source: IntegrationDataSourceRow; deduplicated: boolean }>;
};

export type IntegrationRepository = {
  getSnapshot(input: {
    organizationId: string;
  }): Promise<import("@/modules/integrations/application/read-model").IntegrationHubSnapshot>;
  listCatalog(): readonly ProviderDefinition[];
  findConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<IntegrationConnectionRow | null>;
  findDataSource(input: {
    organizationId: string;
    dataSourceId: string;
  }): Promise<IntegrationDataSourceRow | null>;
  findRun(input: {
    organizationId: string;
    ingestionRunId: string;
  }): Promise<IntegrationIngestionRunRow | null>;
  upsertFixtureConnection(
    input: Parameters<IntegrationTransactionPort["upsertFixtureConnection"]>[0],
  ): Promise<IntegrationConnectionRow>;
  connectFixtureWithGrants(
    input: FixtureConnectionUpsertInput & { grants: readonly IntegrationCapabilityGrantInsert[] },
  ): Promise<{
    connection: IntegrationConnectionRow;
    grants: IntegrationCapabilityGrantRow[];
    created: boolean;
    deduplicated: boolean;
  }>;
  replaceCapabilityGrants(
    input: Parameters<IntegrationTransactionPort["replaceCapabilityGrants"]>[0],
  ): Promise<IntegrationCapabilityGrantRow[]>;
  replaceMappings(
    input: Parameters<IntegrationTransactionPort["replaceMappings"]>[0],
  ): Promise<IntegrationAccountMappingRow[]>;
  replaceMappingsWithGrants(input: {
    organizationId: string;
    connectionId: string;
    actorId: string;
    idempotencyKey: string;
    mappings: readonly IntegrationAccountMappingInsert[];
    grants: readonly IntegrationCapabilityGrantInsert[];
    correlationId: string;
  }): Promise<{
    mappings: IntegrationAccountMappingRow[];
    grants: IntegrationCapabilityGrantRow[];
  }>;
  createDataSource(input: IntegrationDataSourceInsert): Promise<IntegrationDataSourceRow>;
  updateDataSource(input: {
    organizationId: string;
    dataSourceId: string;
    patch: Partial<IntegrationDataSourceInsert>;
  }): Promise<IntegrationDataSourceRow>;
  findOrCreateRun(input: {
    organizationId: string;
    idempotencyKey: string;
    connectionId?: string;
    dataSourceId?: string;
    correlationId: string;
  }): Promise<IntegrationIngestionRunRow>;
  updateRun(input: {
    organizationId: string;
    ingestionRunId: string;
    patch: Partial<IntegrationIngestionRunInsert>;
  }): Promise<IntegrationIngestionRunRow>;
  disconnect(
    input: Parameters<IntegrationTransactionPort["disconnectConnection"]>[0],
  ): Promise<IntegrationConnectionRow>;
  createDataSourceWithIdempotency?(
    input: Parameters<
      NonNullable<IntegrationTransactionPort["createDataSourceWithIdempotency"]>
    >[0],
  ): Promise<{
    source: IntegrationDataSourceRow;
    created: boolean;
    deduplicated: boolean;
  }>;
  updateDataSourceWithIdempotency?(
    input: Parameters<
      NonNullable<IntegrationTransactionPort["updateDataSourceWithIdempotency"]>
    >[0],
  ): Promise<{
    source: IntegrationDataSourceRow;
    deduplicated: boolean;
  }>;
};

export type IntegrationRunTransitionPort = {
  acquireExecutionLease(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    claimToken: string;
  }): Promise<{ outcome: "acquired" | "in_progress" | "conflict" }>;
  cancelExecution(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    cancellationToken: string;
  }): Promise<{ outcome: "cancelled"; run: IntegrationIngestionRunRow } | { outcome: "conflict" }>;
  appendHealthCheckWithLease(
    input: IntegrationHealthCheckInsert & {
      idempotencyKey: string;
      claimToken: string;
    },
  ): Promise<
    { outcome: "written"; healthCheck: IntegrationHealthCheckRow } | { outcome: "conflict" }
  >;
  updateConnectionWithLease(input: {
    organizationId: string;
    connectionId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    claimToken: string;
    status?: "revoked";
    setNextScheduledSyncAt: boolean;
    nextScheduledSyncAt: string | null;
  }): Promise<
    { outcome: "written"; connection: IntegrationConnectionRow } | { outcome: "conflict" }
  >;
  markRunRunning(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
    expectedStatus: "queued";
    startedAt: string;
  }): Promise<
    { outcome: "transitioned"; run: IntegrationIngestionRunRow } | { outcome: "conflict" }
  >;
  resumeLeasedRun(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
    expectedStatus: "running";
  }): Promise<
    { outcome: "transitioned"; run: IntegrationIngestionRunRow } | { outcome: "conflict" }
  >;
  completeRun(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
    expectedStatus: "running";
    status: "succeeded" | "partially_succeeded" | "failed" | "cancelled";
    recordsReceived: number;
    recordsAccepted: number;
    recordsRejected: number;
    completedAt: string;
    normalizedErrorCode?: string | null;
    safeErrorSummary?: string | null;
  }): Promise<
    | { outcome: "transitioned"; run: IntegrationIngestionRunRow }
    | { outcome: "already_terminal"; run: IntegrationIngestionRunRow }
    | { outcome: "conflict" }
  >;
  requeueRun(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
    expectedStatus: "running";
    recordsReceived: number;
    recordsAccepted: number;
    recordsRejected: number;
    normalizedErrorCode: string;
    safeErrorSummary: string;
  }): Promise<
    { outcome: "transitioned"; run: IntegrationIngestionRunRow } | { outcome: "conflict" }
  >;
  cancelRun(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
  }): Promise<
    { outcome: "transitioned"; run: IntegrationIngestionRunRow } | { outcome: "conflict" }
  >;
};

export type IntegrationWorkerRepository = {
  acquireExecutionLease(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
  }): Promise<{ outcome: "acquired"; claimToken: string } | { outcome: "in_progress" }>;
  assertExecutionLease(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    claimToken: string;
  }): Promise<void>;
  cancelExecution(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
  }): Promise<IntegrationIngestionRunRow>;
  markRunRunning(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
    startedAt: string;
  }): Promise<IntegrationIngestionRunRow>;
  /**
   * Stamps the data source with the moment records last arrived from it.
   *
   * Separate from the run row because it answers a different question. A run
   * says what one attempt did; this says when the source last delivered, which
   * is what an operator reads to tell a working import from a silent one.
   */
  markDataSourceImported(input: {
    organizationId: string;
    dataSourceId: string;
    importedAt: string;
  }): Promise<void>;
  resumeLeasedRun(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
  }): Promise<IntegrationIngestionRunRow>;
  completeRun(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
    status: "succeeded" | "partially_succeeded" | "failed" | "cancelled";
    recordsReceived: number;
    recordsAccepted: number;
    recordsRejected: number;
    completedAt: string;
    normalizedErrorCode?: string | null;
    safeErrorSummary?: string | null;
  }): Promise<IntegrationIngestionRunRow>;
  requeueRun(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
    recordsReceived: number;
    recordsAccepted: number;
    recordsRejected: number;
    normalizedErrorCode: string;
    safeErrorSummary: string;
  }): Promise<IntegrationIngestionRunRow>;
  cancelRun(input: {
    organizationId: string;
    ingestionRunId: string;
    claimToken: string;
  }): Promise<IntegrationIngestionRunRow>;
  appendHealthCheck(
    input: IntegrationHealthCheckInsert & {
      idempotencyKey: string;
      claimToken: string;
    },
  ): Promise<IntegrationHealthCheckRow>;
  loadGrantRecomputationInput(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<IntegrationConnectionRow>;
  scheduleConnection(input: {
    organizationId: string;
    connectionId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    claimToken: string;
    nextScheduledSyncAt: string | null;
  }): Promise<IntegrationConnectionRow>;
  setConnectionStatus(input: {
    organizationId: string;
    connectionId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    claimToken: string;
    status: "revoked";
  }): Promise<IntegrationConnectionRow>;
};
