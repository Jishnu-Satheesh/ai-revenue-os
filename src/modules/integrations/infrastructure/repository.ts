import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProviderDefinition } from "@/domain/integrations/types";
import { IntegrationError } from "@/domain/integrations/errors";
import type { Database } from "@/lib/supabase/database.types";
import { buildIntegrationHubSnapshot } from "@/modules/integrations/application/read-model";
import type {
  IntegrationAuditEvent,
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

export function createIntegrationWorkerRepository(
  dependencies: Pick<RepositoryDependencies, "persistence"> & {
    transitions?: IntegrationRunTransitionPort;
  },
): IntegrationWorkerRepository {
  return {
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
    async resumeRun(input) {
      const result = await requiredRunTransitions(dependencies.transitions).resumeRun({
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
      const connection = await dependencies.persistence.findConnection({
        organizationId: input.organization_id,
        connectionId: input.connection_id,
      });
      if (!connection) return notFound("Integration connection");
      if (input.ingestion_run_id) {
        const ingestionRun = await dependencies.persistence.findRun({
          organizationId: input.organization_id,
          ingestionRunId: input.ingestion_run_id,
        });
        if (!ingestionRun || ingestionRun.connection_id !== input.connection_id) {
          throw new IntegrationError(
            "TENANT_SCOPE_ERROR",
            "The ingestion run does not belong to this connection.",
            false,
          );
        }
      }
      return dependencies.persistence.appendHealthCheck(input);
    },

    async loadGrantRecomputationInput(input) {
      const connection = await dependencies.persistence.findConnection(input);
      if (!connection) return notFound("Integration connection");
      return connection;
    },

    async scheduleConnection(input) {
      const connection = await dependencies.persistence.findConnection(input);
      if (!connection) return notFound("Integration connection");
      return dependencies.persistence.updateConnection({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        patch: {
          status: connection.status,
          last_tested_at: connection.last_tested_at,
          last_successful_sync_at: connection.last_successful_sync_at,
          next_scheduled_sync_at: input.nextScheduledSyncAt,
        },
      });
    },
    async setConnectionStatus(input) {
      const connection = await dependencies.persistence.findConnection(input);
      if (!connection) return notFound("Integration connection");
      return dependencies.persistence.updateConnection({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        patch: {
          status: input.status,
          last_tested_at: connection.last_tested_at,
          last_successful_sync_at: connection.last_successful_sync_at,
          next_scheduled_sync_at: null,
        },
      });
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
      name: "transition_integration_ingestion_run",
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
    });
    if (result.error)
      databaseError("Integration run transition could not be persisted.", result.error);
    return result.data
      ? { outcome: "transitioned" as const, run: result.data }
      : { outcome: "conflict" as const };
  };
  return {
    markRunRunning(input) {
      return transition({
        organizationId: input.organizationId,
        ingestionRunId: input.ingestionRunId,
        expectedStatuses: [input.expectedStatus],
        status: "running",
        recordsReceived: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
        startedAt: input.startedAt,
      });
    },
    resumeRun(input) {
      return transition({
        organizationId: input.organizationId,
        ingestionRunId: input.ingestionRunId,
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
      transactions: input.transactions,
      catalog: input.catalog,
      now: input.now,
    }),
    workerRepository: createIntegrationWorkerRepository({
      persistence,
      transitions: input.runTransitions,
    }),
  };
}
