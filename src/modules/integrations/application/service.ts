import { z } from "zod";

import type {
  EventPublisher,
  IntegrationDomainEvent,
  IntegrationEventName,
  IntegrationEventPayloads,
} from "@/domain/events/types";
import { deriveCapabilityGrants } from "@/domain/integrations/capabilities";
import { IntegrationError } from "@/domain/integrations/errors";
import type { ProviderRegistry } from "@/domain/integrations/provider-registry";
import type { ProviderDefinition } from "@/domain/integrations/types";
import { assertIntegrationHubEnabled } from "@/modules/integrations/application/feature-access";
import {
  assertIntegrationPermission,
  type IntegrationPermission,
} from "@/modules/integrations/application/authorization";
import type {
  IntegrationConnectionRow,
  IntegrationDataSourceInsert,
  IntegrationDataSourceRow,
  IntegrationRepository,
} from "@/modules/integrations/application/ports";
import type { OrganizationRole } from "@/domain/organizations/types";

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

export type AuthenticatedIntegrationContext = {
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
  correlationId: string;
  causationId?: string;
};

export type OrganizationBranchLookup = {
  findBranch(input: { organizationId: string; branchId: string }): Promise<boolean>;
};

type ServiceDependencies = {
  repository: IntegrationRepository;
  providers: ProviderRegistry;
  dispatcher: IntegrationTaskDispatcher;
  publisher: EventPublisher;
  branchLookup: OrganizationBranchLookup;
  assertFeatureEnabled?: (organizationId: string) => void;
  now?: () => Date;
};

const idSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(1).max(200);
const connectFixtureSchema = z.object({
  providerKey: z.string().trim().min(1).max(120),
  externalAccountId: z.string().trim().min(1).max(500),
  externalAccountLabel: z.string().trim().min(1).max(500),
  grantedScopes: z.array(z.string().trim().min(1).max(300)).max(50),
});
const mappingSchema = z.object({
  externalResourceId: z.string().trim().min(1).max(500),
  externalResourceLabel: z.string().trim().min(1).max(500),
  branchId: idSchema.nullable().optional(),
  status: z.enum(["unmapped", "mapped", "ignored"]),
});
const createDataSourceSchema = z
  .object({
    sourceType: z.enum(["manual", "csv_import"]),
    name: z.string().trim().min(1).max(200),
    branchId: idSchema.nullable().optional(),
    storagePath: z.string().trim().min(1).max(1024).nullable().optional(),
    originalFilename: z.string().trim().min(1).max(512).nullable().optional(),
    mediaType: z.literal("text/csv").nullable().optional(),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(10 * 1024 * 1024)
      .nullable()
      .optional(),
    columnMapping: z.record(z.string(), z.string()).default({}),
  })
  .superRefine((value, context) => {
    if (
      value.sourceType === "manual" &&
      (value.storagePath || value.originalFilename || value.mediaType)
    ) {
      context.addIssue({
        code: "custom",
        message: "Manual data sources cannot include an import file.",
      });
    }
  });
const updateDataSourceSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  branchId: idSchema.nullable().optional(),
  status: z.enum(["archived"]).optional(),
  columnMapping: z.record(z.string(), z.string()).optional(),
});

type SafeRunResponse = { runId: string; status: "queued" };

function notFound(entity: string): never {
  throw new IntegrationError("NOT_FOUND", `${entity} was not found for this organization.`, false);
}

function taskIdempotencyKey(operation: string, idempotencyKey: string): string {
  return `${operation}:${idempotencyKey}`;
}

function dispatchIdempotencyKey(
  operation: string,
  organizationId: string,
  sourceId: string,
  runId: string,
): string {
  return `${operation}:${organizationId}:${sourceId}:${runId}`;
}

function capabilityRows(input: {
  definition: ProviderDefinition;
  connection: IntegrationConnectionRow;
  mappingStatus: "unmapped" | "mapped" | "ignored";
}) {
  return deriveCapabilityGrants({
    definition: input.definition,
    connection: {
      status: input.connection.status,
      grantedScopes: input.connection.granted_scopes,
    },
    accountMapping: { status: input.mappingStatus },
    platformPolicy: { allowsIntegrationReads: true },
  }).map((grant) => ({
    capability_key: grant.capabilityKey,
    maturity: grant.maturity,
    availability: grant.availability,
    reason_codes: [...grant.reasonCodes],
    derived_from_adapter_version: input.connection.adapter_version,
  }));
}

export function createIntegrationService({
  repository,
  providers,
  dispatcher,
  publisher,
  branchLookup,
  assertFeatureEnabled = assertIntegrationHubEnabled,
  now = () => new Date(),
}: ServiceDependencies) {
  function authorize(
    context: AuthenticatedIntegrationContext,
    permission: IntegrationPermission,
  ): void {
    assertFeatureEnabled(context.organizationId);
    assertIntegrationPermission(context.role, permission);
  }

  async function publish<TName extends IntegrationEventName>(
    context: AuthenticatedIntegrationContext,
    eventName: TName,
    payload: IntegrationEventPayloads[TName],
  ): Promise<void> {
    const event: IntegrationDomainEvent<TName> = {
      eventId: crypto.randomUUID(),
      eventName,
      occurredAt: now().toISOString(),
      organizationId: context.organizationId,
      actorType: "user",
      actorId: context.actorId,
      correlationId: context.correlationId,
      causationId: context.causationId,
      schemaVersion: 1,
      payload,
    };
    await publisher.publish(event);
  }

  async function requireConnection(context: AuthenticatedIntegrationContext, connectionId: string) {
    const connection = await repository.findConnection({
      organizationId: context.organizationId,
      connectionId: idSchema.parse(connectionId),
    });
    return connection ?? notFound("Integration connection");
  }

  async function requireDataSource(context: AuthenticatedIntegrationContext, dataSourceId: string) {
    const source = await repository.findDataSource({
      organizationId: context.organizationId,
      dataSourceId: idSchema.parse(dataSourceId),
    });
    return source ?? notFound("Integration data source");
  }

  async function ensureBranchScope(organizationId: string, branchId: string | null | undefined) {
    if (!branchId) return;
    if (!(await branchLookup.findBranch({ organizationId, branchId }))) {
      throw new IntegrationError(
        "TENANT_SCOPE_ERROR",
        "The branch is not available for this organization.",
        false,
      );
    }
  }

  async function getSnapshot(context: AuthenticatedIntegrationContext) {
    authorize(context, "integration.read");
    return repository.getSnapshot({ organizationId: context.organizationId });
  }

  async function getCatalog(context: AuthenticatedIntegrationContext) {
    authorize(context, "integration.read");
    return providers.listDefinitions();
  }

  async function connectFixture(
    input: AuthenticatedIntegrationContext & z.input<typeof connectFixtureSchema>,
  ) {
    authorize(input, "integration.connect");
    const parsed = connectFixtureSchema.parse(input);
    const definition = providers
      .listDefinitions()
      .find((candidate) => candidate.key === parsed.providerKey);
    if (!definition || definition.rolloutState !== "fixture") {
      throw new IntegrationError(
        "FEATURE_NOT_AVAILABLE",
        "This fixture provider is not available.",
        false,
      );
    }
    const connection = await repository.upsertFixtureConnection({
      organizationId: input.organizationId,
      actorId: input.actorId,
      providerKey: definition.key,
      adapterVersion: definition.adapterVersion,
      externalAccountId: parsed.externalAccountId,
      externalAccountLabel: parsed.externalAccountLabel,
      grantedScopes: parsed.grantedScopes,
      correlationId: input.correlationId,
    });
    const grants = await repository.replaceCapabilityGrants({
      organizationId: input.organizationId,
      connectionId: connection.id,
      grants: capabilityRows({ definition, connection, mappingStatus: "unmapped" }),
      correlationId: input.correlationId,
    });
    await publish(input, "integration.connected", {
      connectionId: connection.id,
      providerKey: connection.provider_key,
      status: connection.status,
      capabilityCount: grants.length,
    });
    return connection;
  }

  async function replaceMappings(
    input: AuthenticatedIntegrationContext & {
      connectionId: string;
      mappings: z.input<typeof mappingSchema>[];
    },
  ) {
    authorize(input, "integration.map");
    const connection = await requireConnection(input, input.connectionId);
    const mappings = z.array(mappingSchema).max(100).parse(input.mappings);
    for (const mapping of mappings) {
      if (mapping.status === "mapped" && !mapping.branchId) {
        throw new IntegrationError("VALIDATION_ERROR", "Mapped resources require a branch.", false);
      }
      await ensureBranchScope(input.organizationId, mapping.branchId);
    }
    const saved = await repository.replaceMappings({
      organizationId: input.organizationId,
      connectionId: connection.id,
      actorId: input.actorId,
      mappings: mappings.map((mapping) => ({
        external_resource_id: mapping.externalResourceId,
        external_resource_label: mapping.externalResourceLabel,
        branch_id: mapping.branchId ?? null,
        status: mapping.status,
      })),
      correlationId: input.correlationId,
    });
    const definition = providers
      .listDefinitions()
      .find(
        (candidate) =>
          candidate.key === connection.provider_key &&
          candidate.adapterVersion === connection.adapter_version,
      );
    if (!definition)
      throw new IntegrationError("NOT_FOUND", "The provider definition is unavailable.", false);
    await repository.replaceCapabilityGrants({
      organizationId: input.organizationId,
      connectionId: connection.id,
      grants: capabilityRows({
        definition,
        connection,
        mappingStatus: saved.some((mapping) => mapping.status === "mapped") ? "mapped" : "unmapped",
      }),
      correlationId: input.correlationId,
    });
    return saved;
  }

  async function createDataSource(
    input: AuthenticatedIntegrationContext & z.input<typeof createDataSourceSchema>,
  ) {
    authorize(input, "integration.import");
    const parsed = createDataSourceSchema.parse(input);
    await ensureBranchScope(input.organizationId, parsed.branchId);
    const record: IntegrationDataSourceInsert = {
      organization_id: input.organizationId,
      source_type: parsed.sourceType,
      name: parsed.name,
      branch_id: parsed.branchId ?? null,
      status: parsed.sourceType === "manual" ? "ready" : "pending",
      storage_path: parsed.storagePath ?? null,
      original_filename: parsed.originalFilename ?? null,
      media_type: parsed.mediaType ?? null,
      size_bytes: parsed.sizeBytes ?? null,
      schema_version: 1,
      column_mapping: parsed.columnMapping,
      last_successful_import_at: null,
      created_by: input.actorId,
    };
    const source = await repository.createDataSource(record);
    await publish(input, "data_source.created", {
      dataSourceId: source.id,
      sourceType: source.source_type,
      status: source.status,
      ...(source.branch_id ? { branchId: source.branch_id } : {}),
    });
    return source;
  }

  async function updateDataSource(
    input: AuthenticatedIntegrationContext & { dataSourceId: string } & z.input<
        typeof updateDataSourceSchema
      >,
  ) {
    authorize(input, "integration.import");
    const source = await requireDataSource(input, input.dataSourceId);
    const parsed = updateDataSourceSchema.parse(input);
    await ensureBranchScope(input.organizationId, parsed.branchId);
    return repository.updateDataSource({
      organizationId: input.organizationId,
      dataSourceId: source.id,
      patch: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.branchId !== undefined ? { branch_id: parsed.branchId } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.columnMapping !== undefined ? { column_mapping: parsed.columnMapping } : {}),
      },
    });
  }

  async function dispatchRun(input: {
    context: AuthenticatedIntegrationContext;
    operation:
      | "integration.test"
      | "integration.sync"
      | "integration.import"
      | "integration.disconnect";
    taskName: IntegrationTaskName;
    source: { connection?: IntegrationConnectionRow; dataSource?: IntegrationDataSourceRow };
    idempotencyKey: string;
  }): Promise<SafeRunResponse> {
    const sourceId = input.source.connection?.id ?? input.source.dataSource?.id;
    if (!sourceId)
      throw new IntegrationError("VALIDATION_ERROR", "An integration source is required.", false);
    const persistedIdempotencyKey = taskIdempotencyKey(
      input.operation,
      idempotencyKeySchema.parse(input.idempotencyKey),
    );
    const run = await repository.findOrCreateRun({
      organizationId: input.context.organizationId,
      idempotencyKey: persistedIdempotencyKey,
      connectionId: input.source.connection?.id,
      dataSourceId: input.source.dataSource?.id,
      correlationId: input.context.correlationId,
    });
    if (run.trigger_run_id) return { runId: run.id, status: "queued" };
    const dispatchKey = dispatchIdempotencyKey(
      input.operation,
      input.context.organizationId,
      sourceId,
      run.id,
    );
    let dispatched: { triggerRunId: string };
    try {
      dispatched = await dispatcher.dispatch({
        taskName: input.taskName,
        organizationId: input.context.organizationId,
        ...(input.source.connection ? { connectionId: input.source.connection.id } : {}),
        ...(input.source.dataSource ? { dataSourceId: input.source.dataSource.id } : {}),
        ingestionRunId: run.id,
        correlationId: input.context.correlationId,
        idempotencyKey: dispatchKey,
        ...(input.source.connection
          ? { adapterVersion: input.source.connection.adapter_version }
          : {}),
      });
    } catch {
      await repository.updateRun({
        organizationId: input.context.organizationId,
        ingestionRunId: run.id,
        patch: {
          status: "failed",
          completed_at: now().toISOString(),
          normalized_error_code: "UNKNOWN_PROVIDER_ERROR",
          safe_error_summary: "The background task could not be queued. Try again later.",
        },
      });
      const payload = {
        runId: run.id,
        sourceId,
        status: "failed" as const,
        normalizedErrorCode: "UNKNOWN_PROVIDER_ERROR",
        recordsReceived: 0,
        recordsAccepted: 0,
        recordsRejected: 0,
      };
      if (input.source.dataSource) {
        await publish(input.context, "data_source.import_failed", {
          ...payload,
          dataSourceId: input.source.dataSource.id,
        });
      } else {
        await publish(input.context, "integration.sync_failed", {
          ...payload,
          connectionId: input.source.connection?.id,
        });
      }
      throw new IntegrationError(
        "UNKNOWN_PROVIDER_ERROR",
        "The background task could not be queued. Try again later.",
        true,
      );
    }
    await repository.updateRun({
      organizationId: input.context.organizationId,
      ingestionRunId: run.id,
      patch: { trigger_run_id: dispatched.triggerRunId },
    });
    return { runId: run.id, status: "queued" };
  }

  async function requestConnectionTest(
    input: AuthenticatedIntegrationContext & { connectionId: string; idempotencyKey: string },
  ) {
    authorize(input, "integration.test");
    const connection = await requireConnection(input, input.connectionId);
    return dispatchRun({
      context: input,
      operation: "integration.test",
      taskName: "integration.test-connection",
      source: { connection },
      idempotencyKey: input.idempotencyKey,
    });
  }

  async function requestSync(
    input: AuthenticatedIntegrationContext & { connectionId: string; idempotencyKey: string },
  ) {
    authorize(input, "integration.sync");
    const connection = await requireConnection(input, input.connectionId);
    return dispatchRun({
      context: input,
      operation: "integration.sync",
      taskName: "integration.sync-connection",
      source: { connection },
      idempotencyKey: input.idempotencyKey,
    });
  }

  async function requestImport(
    input: AuthenticatedIntegrationContext & { dataSourceId: string; idempotencyKey: string },
  ) {
    authorize(input, "integration.import");
    const dataSource = await requireDataSource(input, input.dataSourceId);
    if (dataSource.status === "archived") {
      throw new IntegrationError("CONFLICT", "Archived data sources cannot be imported.", false);
    }
    return dispatchRun({
      context: input,
      operation: "integration.import",
      taskName: "integration.import-data-source",
      source: { dataSource },
      idempotencyKey: input.idempotencyKey,
    });
  }

  async function disconnectConnection(
    input: AuthenticatedIntegrationContext & { connectionId: string; idempotencyKey: string },
  ) {
    authorize(input, "integration.disconnect");
    const connection = await requireConnection(input, input.connectionId);
    const persistedKey = taskIdempotencyKey(
      "integration.disconnect",
      idempotencyKeySchema.parse(input.idempotencyKey),
    );
    const run = await repository.findOrCreateRun({
      organizationId: input.organizationId,
      idempotencyKey: persistedKey,
      connectionId: connection.id,
      correlationId: input.correlationId,
    });
    if (connection.status !== "disconnected" && connection.status !== "revoked") {
      await repository.disconnect({
        organizationId: input.organizationId,
        connectionId: connection.id,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      await publish(input, "integration.disconnected", {
        connectionId: connection.id,
        status: "disconnected",
      });
    }
    if (run.trigger_run_id) return { runId: run.id, status: "queued" };
    return dispatchRun({
      context: input,
      operation: "integration.disconnect",
      taskName: "integration.disconnect-connection",
      source: { connection },
      idempotencyKey: input.idempotencyKey,
    });
  }

  return {
    getSnapshot,
    getCatalog,
    connectFixture,
    requestConnectionTest,
    requestSync,
    replaceMappings,
    createDataSource,
    updateDataSource,
    requestImport,
    disconnectConnection,
  };
}
