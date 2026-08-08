import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProviderDefinition } from "@/domain/integrations/types";
import { IntegrationError } from "@/domain/integrations/errors";
import type { Database } from "@/lib/supabase/database.types";
import { buildIntegrationHubSnapshot } from "@/modules/integrations/application/read-model";
import type {
  IntegrationAuditEvent,
  IntegrationAccountMappingRow,
  IntegrationCapabilityGrantRow,
  IntegrationConnectionRow,
  IntegrationDataSourceRow,
  IntegrationHealthCheckRow,
  IntegrationIngestionRunInsert,
  IntegrationIngestionRunRow,
  IntegrationPersistencePort,
  IntegrationRepository,
  IntegrationRunTransitionPort,
  IntegrationTransactionPort,
  IntegrationWorkerRepository,
} from "@/modules/integrations/application/ports";

type RepositoryDependencies = {
  persistence: IntegrationPersistencePort;
  transactions?: IntegrationTransactionPort;
  catalog?: readonly ProviderDefinition[];
  now?: () => Date;
};

function unavailableTransaction(): never {
  throw new IntegrationError(
    "CONFLICT",
    "The required atomic Integration Hub database operation is unavailable.",
    false,
  );
}

function requiredTransaction(
  transactions: IntegrationTransactionPort | undefined,
): IntegrationTransactionPort {
  return transactions ?? unavailableTransaction();
}

function notFound(entity: string): never {
  throw new IntegrationError("NOT_FOUND", `${entity} was not found for this organization.`, false);
}

function isUniqueConstraintError(error: unknown): boolean {
  if (
    !(error instanceof IntegrationError) ||
    !error.internalCause ||
    typeof error.internalCause !== "object"
  ) {
    return false;
  }
  return "code" in error.internalCause && error.internalCause.code === "23505";
}

export function createIntegrationRepository(
  dependencies: RepositoryDependencies,
): IntegrationRepository {
  const now = dependencies.now ?? (() => new Date());
  return {
    async getSnapshot({ organizationId }) {
      const [connections, dataSources, healthChecks, runs, auditEvents] = await Promise.all([
        dependencies.persistence.listConnections({ organizationId }),
        dependencies.persistence.listDataSources({ organizationId }),
        dependencies.persistence.listHealthChecks({ organizationId }),
        dependencies.persistence.listRuns({ organizationId }),
        dependencies.persistence.listAuditEvents({ organizationId }),
      ]);
      return buildIntegrationHubSnapshot({
        organizationId,
        now: now(),
        connections,
        dataSources,
        healthChecks,
        runs,
        auditEvents,
      });
    },

    listCatalog() {
      return dependencies.catalog ? [...dependencies.catalog] : [];
    },

    findConnection(input) {
      return dependencies.persistence.findConnection(input);
    },
    findDataSource(input) {
      return dependencies.persistence.findDataSource(input);
    },
    findRun(input) {
      return dependencies.persistence.findRun(input);
    },
    async upsertFixtureConnection(input) {
      return requiredTransaction(dependencies.transactions).upsertFixtureConnection(input);
    },
    async connectFixtureWithGrants(input) {
      const transaction = requiredTransaction(dependencies.transactions);
      if (!transaction.connectFixtureWithGrants) return unavailableTransaction();
      return transaction.connectFixtureWithGrants(input);
    },
    async replaceCapabilityGrants(input) {
      return requiredTransaction(dependencies.transactions).replaceCapabilityGrants(input);
    },
    async replaceMappings(input) {
      return requiredTransaction(dependencies.transactions).replaceMappings(input);
    },
    async replaceMappingsWithGrants(input) {
      const transaction = requiredTransaction(dependencies.transactions);
      if (!transaction.replaceMappingsWithGrants) return unavailableTransaction();
      return transaction.replaceMappingsWithGrants(input);
    },
    createDataSource(input) {
      return dependencies.persistence.createDataSource(input);
    },
    updateDataSource(input) {
      return dependencies.persistence.updateDataSource(input);
    },

    async findOrCreateRun(input) {
      const existing = await dependencies.persistence.findRunByIdempotencyKey({
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) return existing;
      if (Boolean(input.connectionId) === Boolean(input.dataSourceId)) {
        throw new IntegrationError(
          "VALIDATION_ERROR",
          "Exactly one ingestion source is required.",
          false,
        );
      }
      const row: IntegrationIngestionRunInsert = {
        organization_id: input.organizationId,
        connection_id: input.connectionId ?? null,
        data_source_id: input.dataSourceId ?? null,
        trigger_run_id: null,
        idempotency_key: input.idempotencyKey,
        status: "queued",
        started_at: null,
        completed_at: null,
        records_received: 0,
        records_accepted: 0,
        records_rejected: 0,
        normalized_error_code: null,
        safe_error_summary: null,
        correlation_id: input.correlationId,
      };
      try {
        return await dependencies.persistence.createRun(row);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const concurrentRun = await dependencies.persistence.findRunByIdempotencyKey({
            organizationId: input.organizationId,
            idempotencyKey: input.idempotencyKey,
          });
          if (concurrentRun) return concurrentRun;
        }
        throw error;
      }
    },
    updateRun(input) {
      return dependencies.persistence.updateRun(input);
    },
    async disconnect(input) {
      return requiredTransaction(dependencies.transactions).disconnectConnection(input);
    },
  };
}

function requiredRunTransitions(
  transitions: IntegrationRunTransitionPort | undefined,
): IntegrationRunTransitionPort {
  if (transitions) return transitions;
  throw new IntegrationError(
    "CONFLICT",
    "The required atomic ingestion-run database operation is unavailable.",
    false,
  );
}

function staleExecutionLeaseError(): IntegrationError {
  return new IntegrationError(
    "CONFLICT",
    "This integration worker no longer holds the execution lease.",
    false,
    { staleLease: true },
  );
}

export function createIntegrationWorkerRepository(
  dependencies: Pick<RepositoryDependencies, "persistence"> & {
    transitions?: IntegrationRunTransitionPort;
  },
): IntegrationWorkerRepository {
  return {
    async acquireExecutionLease(input) {
      const claimToken = crypto.randomUUID();
      const result = await requiredRunTransitions(dependencies.transitions).acquireExecutionLease({
        ...input,
        claimToken,
      });
      if (result.outcome === "conflict") {
        throw new IntegrationError("CONFLICT", "The execution lease is invalid.", false);
      }
      if (result.outcome === "acquired") return { outcome: "acquired", claimToken };
      return { outcome: "in_progress" };
    },
    async assertExecutionLease(input) {
      const result = await requiredRunTransitions(dependencies.transitions).acquireExecutionLease(
        input,
      );
      if (result.outcome === "acquired") return;
      throw new IntegrationError(
        "CONFLICT",
        "This integration worker no longer holds the execution lease.",
        false,
        { staleLease: true },
      );
    },
    async cancelExecution(input) {
      const result = await requiredRunTransitions(dependencies.transitions).cancelExecution({
        ...input,
        cancellationToken: crypto.randomUUID(),
      });
      if (result.outcome === "conflict") {
        throw new IntegrationError("CONFLICT", "The ingestion run cannot be cancelled.", false);
      }
      return result.run;
    },
    async markRunRunning(input) {
      const result = await requiredRunTransitions(dependencies.transitions).markRunRunning({
        ...input,
        expectedStatus: "queued",
      });
      if (result.outcome === "conflict") {
        throw new IntegrationError(
          "CONFLICT",
          "The ingestion run was changed by another worker.",
          false,
        );
      }
      return result.run;
    },
    async resumeLeasedRun(input) {
      const result = await requiredRunTransitions(dependencies.transitions).resumeLeasedRun({
        ...input,
        expectedStatus: "running",
      });
      if (result.outcome === "conflict") {
        throw new IntegrationError("CONFLICT", "The ingestion run cannot be resumed.", false);
      }
      return result.run;
    },

    async completeRun(input) {
      const result = await requiredRunTransitions(dependencies.transitions).completeRun({
        ...input,
        expectedStatus: "running",
      });
      if (result.outcome === "conflict") {
        throw new IntegrationError(
          "CONFLICT",
          "The ingestion run was changed by another worker.",
          false,
        );
      }
      return result.run;
    },
    async requeueRun(input) {
      const result = await requiredRunTransitions(dependencies.transitions).requeueRun({
        ...input,
        expectedStatus: "running",
      });
      if (result.outcome === "conflict") {
        throw new IntegrationError("CONFLICT", "The ingestion run cannot be retried.", false);
      }
      return result.run;
    },
    async cancelRun(input) {
      const result = await requiredRunTransitions(dependencies.transitions).cancelRun(input);
      if (result.outcome === "conflict") {
        throw new IntegrationError("CONFLICT", "The ingestion run cannot be cancelled.", false);
      }
      return result.run;
    },

    async appendHealthCheck(input) {
      const result = await requiredRunTransitions(
        dependencies.transitions,
      ).appendHealthCheckWithLease(input);
      if (result.outcome === "conflict") throw staleExecutionLeaseError();
      return result.healthCheck;
    },

    async loadGrantRecomputationInput(input) {
      const connection = await dependencies.persistence.findConnection(input);
      if (!connection) return notFound("Integration connection");
      return connection;
    },

    async scheduleConnection(input) {
      const result = await requiredRunTransitions(
        dependencies.transitions,
      ).updateConnectionWithLease({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        ingestionRunId: input.ingestionRunId,
        idempotencyKey: input.idempotencyKey,
        claimToken: input.claimToken,
        setNextScheduledSyncAt: true,
        nextScheduledSyncAt: input.nextScheduledSyncAt,
      });
      if (result.outcome === "conflict") throw staleExecutionLeaseError();
      return result.connection;
    },
    async setConnectionStatus(input) {
      const result = await requiredRunTransitions(
        dependencies.transitions,
      ).updateConnectionWithLease({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        ingestionRunId: input.ingestionRunId,
        idempotencyKey: input.idempotencyKey,
        claimToken: input.claimToken,
        status: input.status,
        setNextScheduledSyncAt: true,
        nextScheduledSyncAt: null,
      });
      if (result.outcome === "conflict") throw staleExecutionLeaseError();
      return result.connection;
    },
  };
}

/**
 * Worker-only CAS transition adapter. It is backed by the imperative
 * migration RPC so retries cannot overwrite a terminal run with stale data.
 */
export function createSupabaseIntegrationRunTransitionPort(
  serviceSupabase: SupabaseClient<Database>,
): IntegrationRunTransitionPort {
  type RpcClient = {
    rpc(
      name:
        | "transition_integration_ingestion_run"
        | "claim_integration_worker_execution_lease"
        | "cancel_integration_worker_execution"
        | "append_integration_health_check_with_execution_lease"
        | "update_integration_connection_with_execution_lease",
      args: Record<string, unknown>,
    ): PromiseLike<{ data: IntegrationIngestionRunRow | null; error: unknown }>;
  };
  const rpc = serviceSupabase as unknown as RpcClient;
  const transition = async (input: {
    organizationId: string;
    ingestionRunId: string;
    expectedStatuses: readonly string[];
    status: "queued" | "running" | "succeeded" | "partially_succeeded" | "failed" | "cancelled";
    recordsReceived: number;
    recordsAccepted: number;
    recordsRejected: number;
    completedAt?: string | null;
    normalizedErrorCode?: string | null;
    safeErrorSummary?: string | null;
    startedAt?: string | null;
    claimToken: string;
  }) => {
    const result = await rpc.rpc("transition_integration_ingestion_run", {
      p_organization_id: input.organizationId,
      p_ingestion_run_id: input.ingestionRunId,
      p_expected_statuses: [...input.expectedStatuses],
      p_status: input.status,
      p_records_received: input.recordsReceived,
      p_records_accepted: input.recordsAccepted,
      p_records_rejected: input.recordsRejected,
      p_completed_at: input.completedAt ?? null,
      p_normalized_error_code: input.normalizedErrorCode ?? null,
      p_safe_error_summary: input.safeErrorSummary ?? null,
      p_started_at: input.startedAt ?? null,
      p_execution_claim_token: input.claimToken,
    });
    if (result.error)
      databaseError("Integration run transition could not be persisted.", result.error);
    return result.data
      ? { outcome: "transitioned" as const, run: result.data }
      : { outcome: "conflict" as const };
  };
  return {
    async acquireExecutionLease(input) {
      const result = await rpc.rpc("claim_integration_worker_execution_lease", {
        p_organization_id: input.organizationId,
        p_ingestion_run_id: input.ingestionRunId,
        p_idempotency_key: input.idempotencyKey,
        p_claim_token: input.claimToken,
      });
      if (result.error)
        databaseError("Integration execution lease could not be acquired.", result.error);
      const outcome = (result.data as { outcome?: string } | null)?.outcome;
      if (outcome === "acquired") return { outcome };
      if (outcome === "in_progress") return { outcome };
      return { outcome: "conflict" };
    },
    async cancelExecution(input) {
      const result = await rpc.rpc("cancel_integration_worker_execution", {
        p_organization_id: input.organizationId,
        p_ingestion_run_id: input.ingestionRunId,
        p_idempotency_key: input.idempotencyKey,
        p_cancellation_token: input.cancellationToken,
      });
      if (result.error)
        databaseError("Integration execution could not be cancelled.", result.error);
      return result.data
        ? { outcome: "cancelled" as const, run: result.data }
        : { outcome: "conflict" as const };
    },
    async appendHealthCheckWithLease(input) {
      const result = await rpc.rpc("append_integration_health_check_with_execution_lease", {
        p_organization_id: input.organization_id,
        p_connection_id: input.connection_id,
        p_ingestion_run_id: input.ingestion_run_id,
        p_idempotency_key: input.idempotencyKey,
        p_claim_token: input.claimToken,
        p_check_type: input.check_type,
        p_outcome: input.outcome,
        p_latency_ms: input.latency_ms,
        p_normalized_error_code: input.normalized_error_code,
        p_safe_detail: input.safe_detail,
        p_checked_at: input.checked_at,
        p_correlation_id: input.correlation_id,
      });
      if (result.error)
        databaseError("Integration health check could not be persisted.", result.error);
      return result.data
        ? {
            outcome: "written" as const,
            healthCheck: result.data as unknown as IntegrationHealthCheckRow,
          }
        : { outcome: "conflict" as const };
    },
    async updateConnectionWithLease(input) {
      const result = await rpc.rpc("update_integration_connection_with_execution_lease", {
        p_organization_id: input.organizationId,
        p_connection_id: input.connectionId,
        p_ingestion_run_id: input.ingestionRunId,
        p_idempotency_key: input.idempotencyKey,
        p_claim_token: input.claimToken,
        p_status: input.status ?? null,
        p_set_next_scheduled_sync_at: input.setNextScheduledSyncAt,
        p_next_scheduled_sync_at: input.nextScheduledSyncAt,
      });
      if (result.error) databaseError("Integration connection could not be updated.", result.error);
      return result.data
        ? {
            outcome: "written" as const,
            connection: result.data as unknown as IntegrationConnectionRow,
          }
        : { outcome: "conflict" as const };
    },
    markRunRunning(input) {
      return transition({
        organizationId: input.organizationId,
        ingestionRunId: input.ingestionRunId,
        claimToken: input.claimToken,
        expectedStatuses: [input.expectedStatus],
        status: "running",
        recordsReceived: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
        startedAt: input.startedAt,
      });
    },
    resumeLeasedRun(input) {
      return transition({
        organizationId: input.organizationId,
        ingestionRunId: input.ingestionRunId,
        claimToken: input.claimToken,
        expectedStatuses: [input.expectedStatus],
        status: "running",
        recordsReceived: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
      });
    },
    completeRun(input) {
      return transition({
        organizationId: input.organizationId,
        ingestionRunId: input.ingestionRunId,
        claimToken: input.claimToken,
        expectedStatuses: [input.expectedStatus],
        status: input.status,
        recordsReceived: input.recordsReceived,
        recordsAccepted: input.recordsAccepted,
        recordsRejected: input.recordsRejected,
        completedAt: input.completedAt,
        normalizedErrorCode: input.normalizedErrorCode,
        safeErrorSummary: input.safeErrorSummary,
      });
    },
    requeueRun(input) {
      return transition({
        organizationId: input.organizationId,
        ingestionRunId: input.ingestionRunId,
        claimToken: input.claimToken,
        expectedStatuses: [input.expectedStatus],
        status: "queued",
        recordsReceived: input.recordsReceived,
        recordsAccepted: input.recordsAccepted,
        recordsRejected: input.recordsRejected,
        normalizedErrorCode: input.normalizedErrorCode,
        safeErrorSummary: input.safeErrorSummary,
      });
    },
    cancelRun(input) {
      return transition({
        organizationId: input.organizationId,
        ingestionRunId: input.ingestionRunId,
        claimToken: input.claimToken,
        expectedStatuses: ["queued", "running"],
        status: "cancelled",
        recordsReceived: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
        completedAt: new Date().toISOString(),
        normalizedErrorCode: "CANCELLED",
        safeErrorSummary: "The integration task was cancelled.",
      });
    },
  };
}

const connectionColumns =
  "id,organization_id,provider_key,adapter_version,connection_mode,status,external_account_id,external_account_label,granted_scopes,token_expires_at,last_tested_at,last_successful_sync_at,next_scheduled_sync_at,created_by,created_at,updated_at";
const dataSourceColumns =
  "id,organization_id,source_type,name,branch_id,status,storage_path,original_filename,media_type,size_bytes,schema_version,column_mapping,last_successful_import_at,created_by,created_at,updated_at";
const runColumns =
  "id,organization_id,connection_id,data_source_id,trigger_run_id,idempotency_key,status,started_at,completed_at,records_received,records_accepted,records_rejected,normalized_error_code,safe_error_summary,correlation_id,created_at,updated_at";
const healthColumns =
  "id,organization_id,connection_id,ingestion_run_id,check_type,outcome,latency_ms,normalized_error_code,safe_detail,checked_at,correlation_id";
const auditColumns =
  "id,organization_id,event_name,actor_type,actor_id,entity_type,entity_id,correlation_id,payload,occurred_at";

function databaseError(message: string, error: unknown): never {
  throw new IntegrationError("UNKNOWN_PROVIDER_ERROR", message, false, {}, error);
}

function authenticatedOperationError(message: string, error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  if (code === "42501") {
    throw new IntegrationError(
      "AUTHORIZATION_ERROR",
      "You do not have permission for this integration action.",
      false,
    );
  }
  if (code === "P0002") {
    throw new IntegrationError(
      "NOT_FOUND",
      "Integration connection was not found for this organization.",
      false,
    );
  }
  if (code === "23505") {
    throw new IntegrationError(
      "CONFLICT",
      "This integration request conflicts with existing state.",
      false,
    );
  }
  if (code === "23514" || code === "22023") {
    throw new IntegrationError("VALIDATION_ERROR", "Please check the submitted fields.", false);
  }
  databaseError(message, error);
}

/**
 * Authenticated Supabase adapter. Its single cast is isolated because the
 * generated `Database` type has not yet been regenerated after Task 3.
 */
export function createSupabaseIntegrationPersistencePort(
  authenticatedSupabase: SupabaseClient<Database>,
): IntegrationPersistencePort {
  const supabase = authenticatedSupabase as unknown as {
    from(
      table:
        | "integration_connections"
        | "integration_data_sources"
        | "integration_ingestion_runs"
        | "integration_health_checks"
        | "audit_events",
    ): {
      select(columns: string): ReturnType<SupabaseClient["from"]>;
      insert(values: unknown): ReturnType<SupabaseClient["from"]>;
      update(values: unknown): ReturnType<SupabaseClient["from"]>;
    };
  };
  // The generated query types cannot describe the pending tables. Keep all
  // table strings and safe column lists in this adapter until regeneration.
  const scoped = (
    table:
      | "integration_connections"
      | "integration_data_sources"
      | "integration_ingestion_runs"
      | "integration_health_checks"
      | "audit_events",
    columns: string,
    organizationId: string,
  ) =>
    (
      supabase.from(table).select(columns) as unknown as {
        eq(column: string, value: string): unknown;
      }
    ).eq("organization_id", organizationId);
  const query = async <T>(
    operation: PromiseLike<{ data: T | null; error: unknown }>,
    message: string,
  ): Promise<T> => {
    const result = await operation;
    if (result.error || result.data === null) databaseError(message, result.error);
    return result.data;
  };
  const rows = async <T>(
    operation: PromiseLike<{ data: T[] | null; error: unknown }>,
    message: string,
  ): Promise<T[]> => {
    const result = await operation;
    if (result.error) databaseError(message, result.error);
    return result.data ?? [];
  };
  // Supabase's fluent types are unavailable with the stale generated schema;
  // dynamic adapter methods remain confined to this function.
  type FluentQuery = {
    eq(column: string, match: string): FluentQuery;
    order(column: string, options?: { ascending?: boolean }): FluentQuery;
    limit(count: number): FluentQuery;
    maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
    single(): PromiseLike<{ data: unknown; error: unknown }>;
    select(columns: string): FluentQuery;
  };
  const fluent = (value: unknown): FluentQuery => value as FluentQuery;
  return {
    async listConnections({ organizationId }) {
      return rows<IntegrationConnectionRow>(
        fluent(scoped("integration_connections", connectionColumns, organizationId)).order(
          "updated_at",
          { ascending: false },
        ) as unknown as PromiseLike<{ data: IntegrationConnectionRow[] | null; error: unknown }>,
        "Integration connections could not be loaded.",
      );
    },
    async listDataSources({ organizationId }) {
      return rows<IntegrationDataSourceRow>(
        fluent(scoped("integration_data_sources", dataSourceColumns, organizationId)).order(
          "updated_at",
          { ascending: false },
        ) as unknown as PromiseLike<{ data: IntegrationDataSourceRow[] | null; error: unknown }>,
        "Integration data sources could not be loaded.",
      );
    },
    async listHealthChecks({ organizationId }) {
      return rows<IntegrationHealthCheckRow>(
        fluent(scoped("integration_health_checks", healthColumns, organizationId)).order(
          "checked_at",
          { ascending: false },
        ) as unknown as PromiseLike<{ data: IntegrationHealthCheckRow[] | null; error: unknown }>,
        "Integration health checks could not be loaded.",
      );
    },
    async listRuns({ organizationId }) {
      return rows<IntegrationIngestionRunRow>(
        fluent(scoped("integration_ingestion_runs", runColumns, organizationId)).order(
          "created_at",
          { ascending: false },
        ) as unknown as PromiseLike<{ data: IntegrationIngestionRunRow[] | null; error: unknown }>,
        "Integration runs could not be loaded.",
      );
    },
    async listAuditEvents({ organizationId }) {
      return rows<IntegrationAuditEvent>(
        fluent(scoped("audit_events", auditColumns, organizationId))
          .order("occurred_at", { ascending: false })
          .limit(50) as unknown as PromiseLike<{
          data: IntegrationAuditEvent[] | null;
          error: unknown;
        }>,
        "Integration activity could not be loaded.",
      );
    },
    async findConnection({ organizationId, connectionId }) {
      const result = await fluent(
        scoped("integration_connections", connectionColumns, organizationId),
      )
        .eq("id", connectionId)
        .maybeSingle();
      if (result.error) databaseError("Integration connection could not be loaded.", result.error);
      return result.data as IntegrationConnectionRow | null;
    },
    async findDataSource({ organizationId, dataSourceId }) {
      const result = await fluent(
        scoped("integration_data_sources", dataSourceColumns, organizationId),
      )
        .eq("id", dataSourceId)
        .maybeSingle();
      if (result.error) databaseError("Integration data source could not be loaded.", result.error);
      return result.data as IntegrationDataSourceRow | null;
    },
    async findRun({ organizationId, ingestionRunId }) {
      const result = await fluent(scoped("integration_ingestion_runs", runColumns, organizationId))
        .eq("id", ingestionRunId)
        .maybeSingle();
      if (result.error) databaseError("Integration run could not be loaded.", result.error);
      return result.data as IntegrationIngestionRunRow | null;
    },
    async createDataSource(input) {
      return query<IntegrationDataSourceRow>(
        fluent(supabase.from("integration_data_sources").insert(input))
          .select(dataSourceColumns)
          .single() as unknown as PromiseLike<{
          data: IntegrationDataSourceRow | null;
          error: unknown;
        }>,
        "Integration data source could not be created.",
      );
    },
    async updateDataSource({ organizationId, dataSourceId, patch }) {
      return query<IntegrationDataSourceRow>(
        fluent(
          fluent(supabase.from("integration_data_sources").update(patch)).eq(
            "organization_id",
            organizationId,
          ),
        )
          .eq("id", dataSourceId)
          .select(dataSourceColumns)
          .single() as unknown as PromiseLike<{
          data: IntegrationDataSourceRow | null;
          error: unknown;
        }>,
        "Integration data source could not be updated.",
      );
    },
    async findRunByIdempotencyKey({ organizationId, idempotencyKey }) {
      const result = await fluent(scoped("integration_ingestion_runs", runColumns, organizationId))
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (result.error) databaseError("Integration run could not be loaded.", result.error);
      return result.data as IntegrationIngestionRunRow | null;
    },
    async createRun(input) {
      return query<IntegrationIngestionRunRow>(
        fluent(supabase.from("integration_ingestion_runs").insert(input))
          .select(runColumns)
          .single() as unknown as PromiseLike<{
          data: IntegrationIngestionRunRow | null;
          error: unknown;
        }>,
        "Integration run could not be created.",
      );
    },
    async updateRun({ organizationId, ingestionRunId, patch }) {
      return query<IntegrationIngestionRunRow>(
        fluent(
          fluent(supabase.from("integration_ingestion_runs").update(patch)).eq(
            "organization_id",
            organizationId,
          ),
        )
          .eq("id", ingestionRunId)
          .select(runColumns)
          .single() as unknown as PromiseLike<{
          data: IntegrationIngestionRunRow | null;
          error: unknown;
        }>,
        "Integration run could not be updated.",
      );
    },
    async appendHealthCheck(input) {
      return query<IntegrationHealthCheckRow>(
        fluent(supabase.from("integration_health_checks").insert(input))
          .select(healthColumns)
          .single() as unknown as PromiseLike<{
          data: IntegrationHealthCheckRow | null;
          error: unknown;
        }>,
        "Integration health check could not be appended.",
      );
    },
    async updateConnection({ organizationId, connectionId, patch }) {
      return query<IntegrationConnectionRow>(
        fluent(
          fluent(supabase.from("integration_connections").update(patch)).eq(
            "organization_id",
            organizationId,
          ),
        )
          .eq("id", connectionId)
          .select(connectionColumns)
          .single() as unknown as PromiseLike<{
          data: IntegrationConnectionRow | null;
          error: unknown;
        }>,
        "Integration connection could not be updated.",
      );
    },
  };
}

/**
 * User-request transaction boundary. These security-definer RPCs verify the
 * authenticated actor and tenant role internally, so RLS-backed routes retain
 * atomic reconnect, mapping, and disconnect invariants without a service key.
 */
export function createSupabaseAuthenticatedIntegrationTransactionPort(
  authenticatedSupabase: SupabaseClient<Database>,
): IntegrationTransactionPort {
  type RpcClient = {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
  const rpc = authenticatedSupabase as unknown as RpcClient;
  const invoke = async <T>(name: string, args: Record<string, unknown>, message: string) => {
    const result = await rpc.rpc(name, args);
    if (result.error || result.data === null) authenticatedOperationError(message, result.error);
    return result.data as T;
  };

  return {
    async upsertFixtureConnection() {
      return unavailableTransaction();
    },
    async replaceCapabilityGrants() {
      return unavailableTransaction();
    },
    async replaceMappings() {
      return unavailableTransaction();
    },
    async connectFixtureWithGrants(input) {
      return invoke<{
        connection: IntegrationConnectionRow;
        grants: IntegrationCapabilityGrantRow[];
        created: boolean;
        deduplicated: boolean;
      }>(
        "connect_fixture_integration_with_grants",
        {
          p_organization_id: input.organizationId,
          p_actor_id: input.actorId,
          p_provider_key: input.providerKey,
          p_adapter_version: input.adapterVersion,
          p_external_account_id: input.externalAccountId,
          p_external_account_label: input.externalAccountLabel,
          p_granted_scopes: [...input.grantedScopes],
          p_idempotency_key: input.idempotencyKey,
          p_correlation_id: input.correlationId,
          p_grants: input.grants,
        },
        "Integration fixture connection could not be committed.",
      );
    },
    async replaceMappingsWithGrants(input) {
      return invoke<{
        mappings: IntegrationAccountMappingRow[];
        grants: IntegrationCapabilityGrantRow[];
      }>(
        "replace_integration_mappings_with_grants",
        {
          p_organization_id: input.organizationId,
          p_connection_id: input.connectionId,
          p_actor_id: input.actorId,
          p_correlation_id: input.correlationId,
          p_idempotency_key: input.idempotencyKey,
          p_mappings: input.mappings,
          p_grants: input.grants,
        },
        "Integration mappings could not be committed.",
      );
    },
    async disconnectConnection(input) {
      return invoke<IntegrationConnectionRow>(
        "disconnect_integration_connection",
        {
          p_organization_id: input.organizationId,
          p_connection_id: input.connectionId,
          p_actor_id: input.actorId,
          p_correlation_id: input.correlationId,
        },
        "Integration disconnect could not be committed.",
      );
    },
  };
}

export function createAuthenticatedIntegrationRepository(input: {
  supabase: SupabaseClient<Database>;
  transactions?: IntegrationTransactionPort;
  runTransitions?: IntegrationRunTransitionPort;
  catalog?: readonly ProviderDefinition[];
  now?: () => Date;
}): { repository: IntegrationRepository; workerRepository: IntegrationWorkerRepository } {
  const persistence = createSupabaseIntegrationPersistencePort(input.supabase);
  return {
    repository: createIntegrationRepository({
      persistence,
      transactions:
        input.transactions ?? createSupabaseAuthenticatedIntegrationTransactionPort(input.supabase),
      catalog: input.catalog,
      now: input.now,
    }),
    workerRepository: createIntegrationWorkerRepository({
      persistence,
      transitions: input.runTransitions,
    }),
  };
}
