import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/integrations/application/feature-access", () => ({
  assertIntegrationHubEnabled: () => undefined,
}));

import type { EventPublisher } from "@/domain/events/types";
import type { ProviderDefinition } from "@/domain/integrations/types";
import type {
  IntegrationAccountMappingRow,
  IntegrationCapabilityGrantRow,
  IntegrationConnectionRow,
  IntegrationDataSourceInsert,
  IntegrationDataSourceRow,
  IntegrationIngestionRunRow,
  IntegrationRepository,
} from "@/modules/integrations/application/ports";
import { createIntegrationService } from "@/modules/integrations/application/service";

const organizationA = "7e4402e6-283f-45a6-97e2-bde93fdf1bc9";
const organizationB = "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
const actorId = "c2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
const connectionId = "d2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
const branchId = "e2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
const dataSourceId = "f2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
const correlationId = "a2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";

const definition: ProviderDefinition = {
  key: "google_business_profile",
  displayName: "Google Business Profile",
  adapterVersion: "1",
  rolloutState: "fixture",
  supportedCapabilities: ["read_google_business_profile"],
  requiredScopes: ["business.manage"],
  syncIntervalMinutes: 30,
  staleAfterMinutes: 65,
  supportsWebhooks: false,
  supportsWrites: false,
};

function connection(overrides: Partial<IntegrationConnectionRow> = {}): IntegrationConnectionRow {
  return {
    id: connectionId,
    organization_id: organizationA,
    provider_key: definition.key,
    adapter_version: definition.adapterVersion,
    connection_mode: "fixture",
    status: "active",
    external_account_id: "account-1",
    external_account_label: "A label that must stay private",
    granted_scopes: ["business.manage"],
    token_expires_at: null,
    last_tested_at: null,
    last_successful_sync_at: null,
    next_scheduled_sync_at: null,
    created_by: actorId,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<IntegrationDataSourceRow> = {}): IntegrationDataSourceRow {
  return {
    id: dataSourceId,
    organization_id: organizationA,
    source_type: "csv_import",
    name: "August import",
    branch_id: branchId,
    status: "ready",
    storage_path: `${organizationA}/${dataSourceId}/upload.csv`,
    original_filename: "upload.csv",
    media_type: "text/csv",
    size_bytes: 1024,
    schema_version: 1,
    column_mapping: { amount: "revenue" },
    last_successful_import_at: null,
    created_by: actorId,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<IntegrationIngestionRunRow> = {}): IntegrationIngestionRunRow {
  return {
    id: "12ac5c0d-ae53-4e82-9f30-8c7c1de4d56f",
    organization_id: organizationA,
    connection_id: connectionId,
    data_source_id: null,
    trigger_run_id: null,
    idempotency_key: "integration.sync:retry-1",
    status: "queued",
    started_at: null,
    completed_at: null,
    records_received: 0,
    records_accepted: 0,
    records_rejected: 0,
    normalized_error_code: null,
    safe_error_summary: null,
    correlation_id: correlationId,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function createDependencies(
  options: {
    dispatchFails?: boolean;
    connectionStatus?: IntegrationConnectionRow["status"];
    atomicConnectFails?: boolean;
    atomicMappingFails?: boolean;
  } = {},
) {
  const connections = [
    connection(options.connectionStatus ? { status: options.connectionStatus } : {}),
  ];
  const sources = [source()];
  const runs: IntegrationIngestionRunRow[] = [];
  const published: Array<{ eventName: string; payload: Record<string, unknown> }> = [];
  const dispatches: Array<Record<string, unknown>> = [];
  const disabled: string[] = [];
  const repository: IntegrationRepository = {
    async getSnapshot() {
      return {
        summary: {
          totalConnections: 0,
          healthyConnections: 0,
          actionRequiredConnections: 0,
          dataSources: 0,
        },
        connections: [],
        dataSources: [],
        recentActivity: [],
        serverTime: "2026-08-08T00:00:00.000Z",
      };
    },
    listCatalog: () => [definition],
    async findConnection(input) {
      return (
        connections.find(
          (item) => item.id === input.connectionId && item.organization_id === input.organizationId,
        ) ?? null
      );
    },
    async findDataSource(input) {
      return (
        sources.find(
          (item) => item.id === input.dataSourceId && item.organization_id === input.organizationId,
        ) ?? null
      );
    },
    async findRun(input) {
      return (
        runs.find(
          (item) =>
            item.id === input.ingestionRunId && item.organization_id === input.organizationId,
        ) ?? null
      );
    },
    async upsertFixtureConnection(input) {
      const existing = connections.find(
        (item) =>
          item.organization_id === input.organizationId &&
          item.provider_key === input.providerKey &&
          item.external_account_id === input.externalAccountId,
      );
      if (existing) return existing;
      const created = connection({
        id: `new-${connections.length}`,
        organization_id: input.organizationId,
        provider_key: input.providerKey,
        adapter_version: input.adapterVersion,
        external_account_id: input.externalAccountId,
        external_account_label: input.externalAccountLabel,
        granted_scopes: [...input.grantedScopes],
      });
      connections.push(created);
      return created;
    },
    async replaceCapabilityGrants(input) {
      return input.grants.map((grant, index) => ({
        id: `grant-${index}`,
        organization_id: input.organizationId,
        connection_id: input.connectionId,
        created_at: "2026-08-08T00:00:00.000Z",
        updated_at: "2026-08-08T00:00:00.000Z",
        ...grant,
      })) as IntegrationCapabilityGrantRow[];
    },
    async replaceMappings(input) {
      return input.mappings.map((mapping, index) => ({
        id: `mapping-${index}`,
        organization_id: input.organizationId,
        connection_id: input.connectionId,
        created_by: input.actorId,
        created_at: "2026-08-08T00:00:00.000Z",
        updated_at: "2026-08-08T00:00:00.000Z",
        ...mapping,
      })) as IntegrationAccountMappingRow[];
    },
    async connectFixtureWithGrants(input) {
      if (options.atomicConnectFails) throw new Error("transaction rolled back");
      const existed = connections.some(
        (item) =>
          item.organization_id === input.organizationId &&
          item.provider_key === input.providerKey &&
          item.external_account_id === input.externalAccountId,
      );
      const connected = await repository.upsertFixtureConnection(input);
      const grants = await repository.replaceCapabilityGrants({
        organizationId: input.organizationId,
        connectionId: connected.id,
        grants: input.grants,
        correlationId: input.correlationId,
      });
      return { connection: connected, grants, created: !existed, deduplicated: existed };
    },
    async replaceMappingsWithGrants(input) {
      if (options.atomicMappingFails) throw new Error("transaction rolled back");
      const mappings = await repository.replaceMappings(input);
      const grants = await repository.replaceCapabilityGrants({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        grants: input.grants,
        correlationId: input.correlationId,
      });
      return { mappings, grants };
    },
    async createDataSource(input: IntegrationDataSourceInsert) {
      const created = source({ ...input, id: dataSourceId });
      sources.push(created);
      return created;
    },
    async updateDataSource(input) {
      const current = await repository.findDataSource(input);
      if (!current) throw new Error("source missing");
      const updated = { ...current, ...input.patch };
      sources.splice(sources.indexOf(current), 1, updated);
      return updated;
    },
    async findOrCreateRun(input) {
      const existing = runs.find(
        (item) =>
          item.organization_id === input.organizationId &&
          item.idempotency_key === input.idempotencyKey,
      );
      if (existing) return existing;
      const created = run({
        id: `run-${runs.length + 1}`,
        organization_id: input.organizationId,
        idempotency_key: input.idempotencyKey,
        connection_id: input.connectionId ?? null,
        data_source_id: input.dataSourceId ?? null,
        correlation_id: input.correlationId,
      });
      runs.push(created);
      return created;
    },
    async updateRun(input) {
      const current = runs.find(
        (item) => item.id === input.ingestionRunId && item.organization_id === input.organizationId,
      );
      if (!current) throw new Error("run missing");
      const updated = { ...current, ...input.patch };
      runs.splice(runs.indexOf(current), 1, updated);
      return updated;
    },
    async disconnect(input) {
      disabled.push(input.connectionId);
      const current = await repository.findConnection(input);
      if (!current) throw new Error("connection missing");
      const updated = { ...current, status: "disconnected" as const };
      connections.splice(connections.indexOf(current), 1, updated);
      return updated;
    },
  };
  const publisher: EventPublisher = {
    async publish(event) {
      published.push({
        eventName: event.eventName,
        payload: event.payload as Record<string, unknown>,
      });
    },
  };
  return {
    repository,
    publisher,
    runs,
    published,
    dispatches,
    disabled,
    service: createIntegrationService({
      repository,
      publisher,
      providers: {
        listDefinitions: () => [definition],
        getDefinition: () => definition,
        getAdapter: () => {
          throw new Error("not used");
        },
      },
      dispatcher: {
        async dispatch(input) {
          dispatches.push(input);
          if (options.dispatchFails) throw new Error("provider token: should never publish");
          return { triggerRunId: "trigger-1" };
        },
      },
      branchLookup: {
        async findBranch(input) {
          return input.organizationId === organizationA && input.branchId === branchId;
        },
      },
      assertFeatureEnabled: () => undefined,
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    }),
  };
}

const operator = {
  organizationId: organizationA,
  actorId,
  role: "operator" as const,
  correlationId,
};
const viewer = { ...operator, role: "viewer" as const };

describe("Integration application service", () => {
  it("allows viewers to read but not mutate", async () => {
    const { service } = createDependencies();
    await expect(service.getCatalog(viewer)).resolves.toEqual([definition]);
    await expect(
      service.requestSync({ ...viewer, connectionId, idempotencyKey: "retry-1" }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it.each([
    [
      "connect",
      (service: ReturnType<typeof createIntegrationService>) =>
        service.connectFixture({
          ...viewer,
          providerKey: definition.key,
          externalAccountId: "account-1",
          externalAccountLabel: "A label that must stay private",
          grantedScopes: ["business.manage"],
          idempotencyKey: "viewer-connect",
        }),
    ],
    [
      "test",
      (service: ReturnType<typeof createIntegrationService>) =>
        service.requestConnectionTest({ ...viewer, connectionId, idempotencyKey: "viewer-test" }),
    ],
    [
      "sync",
      (service: ReturnType<typeof createIntegrationService>) =>
        service.requestSync({ ...viewer, connectionId, idempotencyKey: "viewer-sync" }),
    ],
    [
      "mapping",
      (service: ReturnType<typeof createIntegrationService>) =>
        service.replaceMappings({
          ...viewer,
          connectionId,
          idempotencyKey: "viewer-map",
          mappings: [],
        }),
    ],
    [
      "create source",
      (service: ReturnType<typeof createIntegrationService>) =>
        service.createDataSource({ ...viewer, sourceType: "manual", name: "Manual source" }),
    ],
    [
      "update source",
      (service: ReturnType<typeof createIntegrationService>) =>
        service.updateDataSource({ ...viewer, dataSourceId, name: "Renamed source" }),
    ],
    [
      "import",
      (service: ReturnType<typeof createIntegrationService>) =>
        service.requestImport({ ...viewer, dataSourceId, idempotencyKey: "viewer-import" }),
    ],
    [
      "disconnect",
      (service: ReturnType<typeof createIntegrationService>) =>
        service.disconnectConnection({
          ...viewer,
          connectionId,
          idempotencyKey: "viewer-disconnect",
          confirmation: "A label that must stay private",
        }),
    ],
  ] as const)("denies viewers the %s mutation", async (_name, mutate) => {
    const { service } = createDependencies();
    await expect(mutate(service)).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("uses organization-scoped lookups before operators can mutate", async () => {
    const { service } = createDependencies();
    await expect(
      service.requestSync({
        ...operator,
        organizationId: organizationB,
        connectionId,
        idempotencyKey: "retry-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the same fixture connection on a duplicate connect", async () => {
    const { service, dispatches } = createDependencies();
    const input = {
      ...operator,
      providerKey: definition.key,
      externalAccountId: "account-1",
      externalAccountLabel: "A label that must stay private",
      grantedScopes: ["business.manage"],
      idempotencyKey: "connect-1",
    };
    const first = await service.connectFixture(input);
    const retry = await service.connectFixture(input);
    expect(retry.connection.id).toBe(first.connection.id);
    expect(first.initialTest).toEqual({ runId: retry.initialTest.runId, status: "queued" });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      taskName: "integration.test-connection",
      connectionId,
    });
  });

  it("reports whether the atomic fixture upsert inserted the connection", async () => {
    const { service } = createDependencies();
    const first = await service.connectFixture({
      ...operator,
      providerKey: definition.key,
      externalAccountId: "account-new",
      externalAccountLabel: "A label that must stay private",
      grantedScopes: ["business.manage"],
      idempotencyKey: "connect-created",
    });
    const retry = await service.connectFixture({
      ...operator,
      providerKey: definition.key,
      externalAccountId: "account-new",
      externalAccountLabel: "A label that must stay private",
      grantedScopes: ["business.manage"],
      idempotencyKey: "connect-created",
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
  });

  it("fails closed when the atomic fixture connection and grant transaction fails", async () => {
    const { service, dispatches } = createDependencies({ atomicConnectFails: true });
    await expect(
      service.connectFixture({
        ...operator,
        providerKey: definition.key,
        externalAccountId: "account-1",
        externalAccountLabel: "A label that must stay private",
        grantedScopes: ["business.manage"],
        idempotencyKey: "connect-fails",
      }),
    ).rejects.toThrow("transaction rolled back");
    expect(dispatches).toEqual([]);
  });

  it.each(["disconnected", "revoked"] as const)(
    "rejects %s connections before connection testing or synchronization",
    async (status) => {
      const { service } = createDependencies({ connectionStatus: status });
      await expect(
        service.requestConnectionTest({ ...operator, connectionId, idempotencyKey: "test-1" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        service.requestSync({ ...operator, connectionId, idempotencyKey: "sync-1" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    },
  );

  it("creates one queued run for a duplicate idempotency key and never reports success", async () => {
    const { service, dispatches } = createDependencies();
    const input = { ...operator, connectionId, idempotencyKey: "retry-1" };
    const first = await service.requestSync(input);
    const retry = await service.requestSync(input);
    expect(first).toEqual({ runId: retry.runId, status: "queued" });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      taskName: "integration.sync-connection",
      idempotencyKey: `integration.sync:${organizationA}:${connectionId}:${first.runId}`,
    });
  });

  it("rejects account mappings that name a branch from another organization", async () => {
    const { service } = createDependencies();
    await expect(
      service.replaceMappings({
        ...operator,
        connectionId,
        idempotencyKey: "foreign-map",
        mappings: [
          {
            externalResourceId: "location-1",
            externalResourceLabel: "private label",
            branchId: organizationB,
            status: "mapped",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it("fails closed when the atomic mapping and grant transaction fails", async () => {
    const { service } = createDependencies({ atomicMappingFails: true });
    await expect(
      service.replaceMappings({
        ...operator,
        connectionId,
        idempotencyKey: "atomic-map",
        mappings: [
          {
            externalResourceId: "location-1",
            externalResourceLabel: "private label",
            branchId,
            status: "mapped",
          },
        ],
      }),
    ).rejects.toThrow("transaction rolled back");
  });

  it("disconnects synchronously before it dispatches credential cleanup", async () => {
    const { service, disabled, dispatches } = createDependencies();
    const result = await service.disconnectConnection({
      ...operator,
      connectionId,
      idempotencyKey: "disconnect-1",
      confirmation: "A label that must stay private",
    });
    expect(disabled).toEqual([connectionId]);
    expect(result.status).toBe("queued");
    expect(dispatches[0]).toMatchObject({
      taskName: "integration.disconnect-connection",
      connectionId,
    });
  });

  it("requires exact authoritative account-label confirmation before disconnect", async () => {
    const { service, disabled } = createDependencies();
    await expect(
      service.disconnectConnection({
        ...operator,
        connectionId,
        idempotencyKey: "disconnect-1",
        confirmation: "a label that must stay private",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(disabled).toEqual([]);
  });

  it("marks a run failed with safe output when dispatch fails", async () => {
    const { service, published, runs } = createDependencies({ dispatchFails: true });
    await expect(
      service.requestConnectionTest({ ...operator, connectionId, idempotencyKey: "test-1" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_PROVIDER_ERROR" });
    expect(runs[0]).toMatchObject({
      status: "failed",
      normalized_error_code: "UNKNOWN_PROVIDER_ERROR",
    });
    expect(published.at(-1)).toMatchObject({ eventName: "integration.sync_failed" });
    expect(JSON.stringify(published)).not.toContain("token");
  });

  it("publishes only safe identifiers, never the connected account label", async () => {
    const { service, published } = createDependencies();
    await service.connectFixture({
      ...operator,
      providerKey: definition.key,
      externalAccountId: "account-2",
      externalAccountLabel: "A label that must stay private",
      grantedScopes: ["business.manage"],
      idempotencyKey: "connect-safe-event",
    });
    expect(published.at(-1)).toMatchObject({ eventName: "integration.connected" });
    expect(JSON.stringify(published)).not.toContain("A label that must stay private");
  });
});
