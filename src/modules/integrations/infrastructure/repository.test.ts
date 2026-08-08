import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  IntegrationAuditEvent,
  IntegrationConnectionRow,
  IntegrationDataSourceRow,
  IntegrationHealthCheckRow,
  IntegrationIngestionRunRow,
  IntegrationPersistencePort,
  IntegrationRunTransitionPort,
  IntegrationTransactionPort,
} from "@/modules/integrations/application/ports";
import {
  createIntegrationRepository,
  createIntegrationWorkerRepository,
} from "@/modules/integrations/infrastructure/repository";

const organizationA = "7e4402e6-283f-45a6-97e2-bde93fdf1bc9";
const organizationB = "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
const actorId = "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
const connectionId = "12d32f7e-283f-45a6-97e2-bde93fdf1bc9";
const dataSourceId = "22d32f7e-283f-45a6-97e2-bde93fdf1bc9";
const runId = "32d32f7e-283f-45a6-97e2-bde93fdf1bc9";

function connection(overrides: Partial<IntegrationConnectionRow> = {}): IntegrationConnectionRow {
  return {
    id: connectionId,
    organization_id: organizationA,
    provider_key: "google_business_profile",
    adapter_version: "v1",
    connection_mode: "fixture",
    status: "active",
    external_account_id: "account-a",
    external_account_label: "Restaurant A",
    credential_reference: "00000000-0000-4000-8000-000000000001",
    granted_scopes: ["business.manage"],
    token_expires_at: null,
    last_tested_at: "2026-08-08T11:30:00.000Z",
    last_successful_sync_at: "2026-08-08T11:45:00.000Z",
    next_scheduled_sync_at: "2026-08-08T12:15:00.000Z",
    created_by: actorId,
    created_at: "2026-08-08T10:00:00.000Z",
    updated_at: "2026-08-08T11:45:00.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<IntegrationDataSourceRow> = {}): IntegrationDataSourceRow {
  return {
    id: dataSourceId,
    organization_id: organizationA,
    source_type: "manual",
    name: "Operator export",
    branch_id: null,
    status: "ready",
    storage_path: null,
    original_filename: null,
    media_type: null,
    size_bytes: null,
    schema_version: 1,
    column_mapping: {},
    last_successful_import_at: null,
    created_by: actorId,
    created_at: "2026-08-08T10:10:00.000Z",
    updated_at: "2026-08-08T10:10:00.000Z",
    ...overrides,
  };
}

function health(overrides: Partial<IntegrationHealthCheckRow> = {}): IntegrationHealthCheckRow {
  return {
    id: "42d32f7e-283f-45a6-97e2-bde93fdf1bc9",
    organization_id: organizationA,
    connection_id: connectionId,
    ingestion_run_id: null,
    check_type: "connectivity",
    outcome: "passed",
    latency_ms: 80,
    normalized_error_code: null,
    safe_detail: null,
    checked_at: "2026-08-08T11:30:00.000Z",
    correlation_id: "52d32f7e-283f-45a6-97e2-bde93fdf1bc9",
    ...overrides,
  };
}

function run(overrides: Partial<IntegrationIngestionRunRow> = {}): IntegrationIngestionRunRow {
  return {
    id: runId,
    organization_id: organizationA,
    connection_id: connectionId,
    data_source_id: null,
    trigger_run_id: null,
    idempotency_key: "sync-2026-08-08-0001",
    status: "queued",
    started_at: null,
    completed_at: null,
    records_received: 0,
    records_accepted: 0,
    records_rejected: 0,
    normalized_error_code: null,
    safe_error_summary: null,
    correlation_id: "62d32f7e-283f-45a6-97e2-bde93fdf1bc9",
    created_at: "2026-08-08T11:00:00.000Z",
    updated_at: "2026-08-08T11:00:00.000Z",
    ...overrides,
  };
}

function audit(overrides: Partial<IntegrationAuditEvent> = {}): IntegrationAuditEvent {
  return {
    id: "72d32f7e-283f-45a6-97e2-bde93fdf1bc9",
    organization_id: organizationA,
    event_name: "integration.connected",
    actor_type: "user",
    actor_id: actorId,
    entity_type: "integration_connection",
    entity_id: connectionId,
    correlation_id: "82d32f7e-283f-45a6-97e2-bde93fdf1bc9",
    payload: {},
    occurred_at: "2026-08-08T11:20:00.000Z",
    ...overrides,
  };
}

function createMemoryPort(
  seed: {
    connections?: IntegrationConnectionRow[];
    sources?: IntegrationDataSourceRow[];
    healthChecks?: IntegrationHealthCheckRow[];
    runs?: IntegrationIngestionRunRow[];
    audits?: IntegrationAuditEvent[];
  } = {},
) {
  const calls: Array<{ method: string; organizationId: string }> = [];
  const connections = seed.connections ?? [connection()];
  const sources = seed.sources ?? [source()];
  const healthChecks = seed.healthChecks ?? [health()];
  const runs = seed.runs ?? [run()];
  const audits = seed.audits ?? [audit()];
  const port: IntegrationPersistencePort = {
    async listConnections(input) {
      calls.push({ method: "listConnections", ...input });
      return connections.filter((row) => row.organization_id === input.organizationId);
    },
    async listDataSources(input) {
      calls.push({ method: "listDataSources", ...input });
      return sources.filter((row) => row.organization_id === input.organizationId);
    },
    async listHealthChecks(input) {
      calls.push({ method: "listHealthChecks", ...input });
      return healthChecks.filter((row) => row.organization_id === input.organizationId);
    },
    async listRuns(input) {
      calls.push({ method: "listRuns", ...input });
      return runs.filter((row) => row.organization_id === input.organizationId);
    },
    async listAuditEvents(input) {
      calls.push({ method: "listAuditEvents", ...input });
      return audits.filter((row) => row.organization_id === input.organizationId);
    },
    async findConnection(input) {
      calls.push({ method: "findConnection", ...input });
      return (
        connections.find(
          (row) => row.organization_id === input.organizationId && row.id === input.connectionId,
        ) ?? null
      );
    },
    async findDataSource(input) {
      calls.push({ method: "findDataSource", ...input });
      return (
        sources.find(
          (row) => row.organization_id === input.organizationId && row.id === input.dataSourceId,
        ) ?? null
      );
    },
    async findRun(input) {
      calls.push({ method: "findRun", ...input });
      return (
        runs.find(
          (row) => row.organization_id === input.organizationId && row.id === input.ingestionRunId,
        ) ?? null
      );
    },
    async createDataSource(input) {
      calls.push({ method: "createDataSource", organizationId: input.organization_id });
      return input as IntegrationDataSourceRow;
    },
    async updateDataSource(input) {
      calls.push({ method: "updateDataSource", organizationId: input.organizationId });
      return source({
        ...input.patch,
        id: input.dataSourceId,
        organization_id: input.organizationId,
      });
    },
    async findRunByIdempotencyKey(input) {
      calls.push({ method: "findRunByIdempotencyKey", ...input });
      return (
        runs.find(
          (row) =>
            row.organization_id === input.organizationId &&
            row.idempotency_key === input.idempotencyKey,
        ) ?? null
      );
    },
    async createRun(input) {
      calls.push({ method: "createRun", organizationId: input.organization_id });
      return input as IntegrationIngestionRunRow;
    },
    async updateRun(input) {
      calls.push({ method: "updateRun", organizationId: input.organizationId });
      return run({
        ...input.patch,
        id: input.ingestionRunId,
        organization_id: input.organizationId,
      });
    },
    async appendHealthCheck(input) {
      calls.push({ method: "appendHealthCheck", organizationId: input.organization_id });
      return input as IntegrationHealthCheckRow;
    },
    async updateConnection(input) {
      calls.push({ method: "updateConnection", organizationId: input.organizationId });
      return connection({
        ...input.patch,
        id: input.connectionId,
        organization_id: input.organizationId,
      });
    },
  };
  return { port, calls };
}

describe("Integration repositories", () => {
  it("builds a newest-first health snapshot without credential references", async () => {
    const { port } = createMemoryPort({
      connections: [
        connection({ updated_at: "2026-08-08T10:00:00.000Z" }),
        connection({
          id: "92d32f7e-283f-45a6-97e2-bde93fdf1bc9",
          updated_at: "2026-08-08T11:00:00.000Z",
          credential_reference: "sensitive-reference",
        }),
      ],
      healthChecks: [
        health({ outcome: "warning", checked_at: "2026-08-08T10:00:00.000Z" }),
        health({
          connection_id: "92d32f7e-283f-45a6-97e2-bde93fdf1bc9",
          outcome: "passed",
          checked_at: "2026-08-08T11:00:00.000Z",
        }),
      ],
      runs: [run({ status: "succeeded", completed_at: "2026-08-08T11:10:00.000Z" })],
      audits: [audit({ occurred_at: "2026-08-08T11:20:00.000Z" })],
    });

    const snapshot = await createIntegrationRepository({
      persistence: port,
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    }).getSnapshot({ organizationId: organizationA });

    expect(snapshot.connections.map((row) => row.id)).toEqual([
      "92d32f7e-283f-45a6-97e2-bde93fdf1bc9",
      connectionId,
    ]);
    expect(snapshot.connections[0]).not.toHaveProperty("credentialReference");
    expect(snapshot.connections[0]).toMatchObject({ latestHealth: { outcome: "passed" } });
    expect(snapshot.recentActivity.map((event) => event.occurredAt)).toEqual([
      "2026-08-08T11:20:00.000Z",
      "2026-08-08T11:10:00.000Z",
      "2026-08-08T11:00:00.000Z",
      "2026-08-08T10:00:00.000Z",
    ]);
    expect(snapshot.summary).toMatchObject({ totalConnections: 2, healthyConnections: 1 });
  });

  it("scopes every repository lookup and worker update by organization", async () => {
    const { port, calls } = createMemoryPort();
    const repository = createIntegrationRepository({ persistence: port });
    const worker = createIntegrationWorkerRepository({ persistence: port });

    await repository.findConnection({ organizationId: organizationA, connectionId });
    await repository.findDataSource({ organizationId: organizationA, dataSourceId });
    await repository.findRun({ organizationId: organizationA, ingestionRunId: runId });
    await worker.scheduleConnection({
      organizationId: organizationA,
      connectionId,
      nextScheduledSyncAt: "2026-08-08T12:30:00.000Z",
    });
    await expect(
      repository.findConnection({ organizationId: organizationB, connectionId }),
    ).resolves.toBeNull();

    expect(calls).not.toContainEqual(expect.objectContaining({ organizationId: undefined }));
    expect(calls.filter((call) => call.method === "findConnection")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "findConnection", organizationId: organizationA }),
        expect.objectContaining({ method: "findConnection", organizationId: organizationB }),
      ]),
    );
    expect(calls).toContainEqual({ method: "updateConnection", organizationId: organizationA });
  });

  it("uses the atomic reconnect port and fails closed when the RPC port is unavailable", async () => {
    const { port } = createMemoryPort();
    const input = {
      organizationId: organizationA,
      actorId,
      providerKey: "google_business_profile",
      adapterVersion: "v1",
      externalAccountId: "account-a",
      externalAccountLabel: "Restaurant A",
      grantedScopes: ["business.manage"],
      correlationId: "82d32f7e-283f-45a6-97e2-bde93fdf1bc9",
    };
    await expect(
      createIntegrationRepository({ persistence: port }).upsertFixtureConnection(input),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const transactionCalls: string[] = [];
    const transactions: IntegrationTransactionPort = {
      async upsertFixtureConnection(value) {
        transactionCalls.push(value.organizationId);
        return connection({ status: "active" });
      },
      async replaceCapabilityGrants() {
        return [];
      },
      async replaceMappings() {
        return [];
      },
      async disconnectConnection(value) {
        return connection({ id: value.connectionId, status: "disconnected" });
      },
    };
    await expect(
      createIntegrationRepository({ persistence: port, transactions }).upsertFixtureConnection(
        input,
      ),
    ).resolves.toMatchObject({ status: "active" });
    expect(transactionCalls).toEqual([organizationA]);
  });

  it("uses an atomic mapping replacement and disconnect that keeps historical reads available", async () => {
    const { port } = createMemoryPort({
      runs: [run({ status: "succeeded", completed_at: "2026-08-08T11:10:00.000Z" })],
    });
    const transactionCalls: string[] = [];
    const transactions: IntegrationTransactionPort = {
      async upsertFixtureConnection() {
        return connection();
      },
      async replaceCapabilityGrants() {
        return [];
      },
      async replaceMappings(input) {
        transactionCalls.push(`mapping:${input.organizationId}:${input.connectionId}`);
        return [];
      },
      async disconnectConnection(input) {
        transactionCalls.push(`disconnect:${input.organizationId}:${input.connectionId}`);
        return connection({ status: "disconnected" });
      },
    };
    const repository = createIntegrationRepository({ persistence: port, transactions });

    await repository.replaceMappings({
      organizationId: organizationA,
      connectionId,
      actorId,
      mappings: [],
      correlationId: "82d32f7e-283f-45a6-97e2-bde93fdf1bc9",
    });
    await repository.disconnect({
      organizationId: organizationA,
      connectionId,
      actorId,
      correlationId: "82d32f7e-283f-45a6-97e2-bde93fdf1bc9",
    });

    expect(transactionCalls).toEqual([
      `mapping:${organizationA}:${connectionId}`,
      `disconnect:${organizationA}:${connectionId}`,
    ]);
    await expect(
      repository.findRun({ organizationId: organizationA, ingestionRunId: runId }),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("returns an existing run for the same organization idempotency key", async () => {
    const existing = run();
    const { port } = createMemoryPort({ runs: [existing] });
    const result = await createIntegrationRepository({ persistence: port }).findOrCreateRun({
      organizationId: organizationA,
      idempotencyKey: existing.idempotency_key,
      connectionId,
      correlationId: existing.correlation_id,
    });
    expect(result).toBe(existing);
  });

  it("fails closed when atomic worker run transitions are unavailable", async () => {
    const { port } = createMemoryPort();
    const worker = createIntegrationWorkerRepository({ persistence: port });

    await expect(
      worker.markRunRunning({
        organizationId: organizationA,
        ingestionRunId: runId,
        startedAt: "2026-08-08T11:05:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      worker.completeRun({
        organizationId: organizationA,
        ingestionRunId: runId,
        status: "succeeded",
        recordsReceived: 1,
        recordsAccepted: 1,
        recordsRejected: 0,
        completedAt: "2026-08-08T11:10:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("uses atomic compare-and-set transitions when stale workers interleave", async () => {
    const initial = run();
    const { port } = createMemoryPort({ runs: [initial] });
    let current = initial;
    const transitions: IntegrationRunTransitionPort = {
      async markRunRunning(input) {
        if (current.status !== "queued") return { outcome: "conflict" };
        current = { ...current, status: "running", started_at: input.startedAt };
        return { outcome: "transitioned", run: current };
      },
      async completeRun(input) {
        if (current.status === "running") {
          current = {
            ...current,
            status: input.status,
            records_received: input.recordsReceived,
            records_accepted: input.recordsAccepted,
            records_rejected: input.recordsRejected,
            completed_at: input.completedAt,
            normalized_error_code: input.normalizedErrorCode ?? null,
            safe_error_summary: input.safeErrorSummary ?? null,
          };
          return { outcome: "transitioned", run: current };
        }
        if (
          current.status === input.status &&
          current.records_received === input.recordsReceived &&
          current.records_accepted === input.recordsAccepted &&
          current.records_rejected === input.recordsRejected &&
          current.completed_at === input.completedAt
        ) {
          return { outcome: "already_terminal", run: current };
        }
        return { outcome: "conflict" };
      },
      async requeueRun() {
        return { outcome: "conflict" };
      },
      async cancelRun() {
        return { outcome: "conflict" };
      },
    };
    const worker = createIntegrationWorkerRepository({ persistence: port, transitions });
    const start = {
      organizationId: organizationA,
      ingestionRunId: runId,
      startedAt: "2026-08-08T11:05:00.000Z",
    };
    const firstStart = await worker.markRunRunning(start);
    await expect(worker.markRunRunning(start)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(firstStart.status).toBe("running");

    const completion = {
      organizationId: organizationA,
      ingestionRunId: runId,
      status: "succeeded" as const,
      recordsReceived: 4,
      recordsAccepted: 4,
      recordsRejected: 0,
      completedAt: "2026-08-08T11:10:00.000Z",
    };
    await expect(worker.completeRun(completion)).resolves.toMatchObject({ status: "succeeded" });
    await expect(
      worker.completeRun({ ...completion, status: "failed", safeErrorSummary: "stale overwrite" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(worker.completeRun(completion)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("returns an atomic idempotent terminal result while rejecting a conflicting one", async () => {
    const completed = run({
      status: "succeeded",
      completed_at: "2026-08-08T11:10:00.000Z",
      records_received: 4,
      records_accepted: 4,
    });
    const { port } = createMemoryPort({ runs: [completed] });
    const transitions: IntegrationRunTransitionPort = {
      async markRunRunning() {
        return { outcome: "conflict" };
      },
      async completeRun(input) {
        if (input.status === "succeeded") return { outcome: "already_terminal", run: completed };
        return { outcome: "conflict" };
      },
      async requeueRun() {
        return { outcome: "conflict" };
      },
      async cancelRun() {
        return { outcome: "conflict" };
      },
    };
    const worker = createIntegrationWorkerRepository({ persistence: port, transitions });
    const terminal = {
      organizationId: organizationA,
      ingestionRunId: runId,
      status: "succeeded" as const,
      recordsReceived: 4,
      recordsAccepted: 4,
      recordsRejected: 0,
      completedAt: "2026-08-08T11:10:00.000Z",
    };

    await expect(worker.completeRun(terminal)).resolves.toBe(completed);
    await expect(
      worker.completeRun({ ...terminal, status: "failed", safeErrorSummary: "safe failure" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
