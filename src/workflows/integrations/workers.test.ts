import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { IntegrationError } from "@/domain/integrations/errors";
import type { IngestionSink, ProviderAdapter } from "@/domain/integrations/types";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import { runCheckFreshness } from "@/workflows/integrations/check-freshness";
import { runDisconnectConnection } from "@/workflows/integrations/disconnect-connection";
import { runImportDataSource } from "@/workflows/integrations/import-data-source";
import { runSyncConnection } from "@/workflows/integrations/sync-connection";
import { runTestConnection } from "@/workflows/integrations/test-connection";
import type {
  IntegrationConnectionRow,
  IntegrationDataSourceRow,
  IntegrationIngestionRunRow,
  IntegrationWorkerRepository,
} from "@/modules/integrations/application/ports";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222",
  dataSourceId: "33333333-3333-4333-8333-333333333333",
  ingestionRunId: "44444444-4444-4444-8444-444444444444",
  correlationId: "55555555-5555-4555-8555-555555555555",
};
const timestamp = "2026-08-08T01:00:00.000Z";

function runRow(overrides: Partial<IntegrationIngestionRunRow> = {}): IntegrationIngestionRunRow {
  return {
    id: ids.ingestionRunId,
    organization_id: ids.organizationId,
    connection_id: ids.connectionId,
    data_source_id: null,
    trigger_run_id: "trigger-run",
    idempotency_key: "dispatch:integration:11111111-1111-4111-8111-111111111111",
    status: "queued",
    started_at: null,
    completed_at: null,
    records_received: 0,
    records_accepted: 0,
    records_rejected: 0,
    normalized_error_code: null,
    safe_error_summary: null,
    correlation_id: ids.correlationId,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

const dataSource: IntegrationDataSourceRow = {
  id: ids.dataSourceId,
  organization_id: ids.organizationId,
  source_type: "csv_import",
  name: "Daily sales export",
  branch_id: null,
  status: "ready",
  storage_path: `${ids.organizationId}/${ids.dataSourceId}/66666666-6666-4666-8666-666666666666/sales.csv`,
  original_filename: "sales.csv",
  media_type: "text/csv",
  size_bytes: 30,
  schema_version: 1,
  column_mapping: { order_id: "order_id", gross_sales: "gross_sales" },
  last_successful_import_at: timestamp,
  created_by: "77777777-7777-4777-8777-777777777777",
  created_at: timestamp,
  updated_at: timestamp,
};

function fixtureAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    providerKey: "google_business_profile",
    adapterVersion: "1",
    testConnection: vi.fn().mockResolvedValue({ outcome: "passed", safeDetail: "Fixture passed." }),
    listExternalResources: vi.fn().mockResolvedValue([]),
    sync: vi.fn().mockResolvedValue([
      {
        schemaVersion: 1,
        organizationId: ids.organizationId,
        source: { kind: "connection", id: ids.connectionId },
        externalRecordId: "review-1",
        recordType: "google_business_profile.review",
        fetchedAt: timestamp,
        payload: { rating: 5 },
      },
    ]),
    ...overrides,
  };
}

function workerRepository(): IntegrationWorkerRepository & {
  health: unknown[];
  completions: unknown[];
} {
  const health: unknown[] = [];
  const completions: unknown[] = [];
  return {
    health,
    completions,
    markRunRunning: vi.fn(async () => runRow({ status: "running", started_at: timestamp })),
    completeRun: vi.fn(async (input) => {
      completions.push(input);
      return runRow({
        status: input.status,
        started_at: timestamp,
        completed_at: input.completedAt,
        records_received: input.recordsReceived,
        records_accepted: input.recordsAccepted,
        records_rejected: input.recordsRejected,
        normalized_error_code: input.normalizedErrorCode ?? null,
        safe_error_summary: input.safeErrorSummary ?? null,
      });
    }),
    requeueRun: vi.fn(async (input) =>
      runRow({
        status: "queued",
        records_received: input.recordsReceived,
        records_accepted: input.recordsAccepted,
        records_rejected: input.recordsRejected,
        normalized_error_code: input.normalizedErrorCode,
        safe_error_summary: input.safeErrorSummary,
      }),
    ),
    cancelRun: vi.fn(async () => runRow({ status: "cancelled" })),
    appendHealthCheck: vi.fn(async (input) => {
      health.push(input);
      return { id: "health", ...input };
    }),
    loadGrantRecomputationInput: vi.fn(
      async (): Promise<IntegrationConnectionRow> => ({
        id: ids.connectionId,
        organization_id: ids.organizationId,
        provider_key: "google_business_profile",
        adapter_version: "1",
        connection_mode: "fixture",
        status: "active",
        external_account_id: "fixture-account",
        external_account_label: "Fixture account",
        granted_scopes: [],
        token_expires_at: null,
        last_tested_at: timestamp,
        last_successful_sync_at: timestamp,
        next_scheduled_sync_at: timestamp,
        created_by: "77777777-7777-4777-8777-777777777777",
        created_at: timestamp,
        updated_at: timestamp,
      }),
    ),
    scheduleConnection: vi.fn(async () => ({
      id: ids.connectionId,
      organization_id: ids.organizationId,
    })) as never,
    setConnectionStatus: vi.fn(async () => ({
      id: ids.connectionId,
      organization_id: ids.organizationId,
    })) as never,
  };
}

function dependencies(
  input: {
    adapter?: ProviderAdapter;
    worker?: ReturnType<typeof workerRepository>;
    sink?: IngestionSink;
    dataSource?: IntegrationDataSourceRow | null;
    cancelled?: boolean;
  } = {},
) {
  const worker = input.worker ?? workerRepository();
  const adapter = input.adapter ?? fixtureAdapter();
  const sink =
    input.sink ??
    ({
      accept: vi.fn().mockResolvedValue({ accepted: 1, rejected: 0, rejectionReasons: [] }),
    } satisfies IngestionSink);
  return {
    worker,
    sink,
    providers: {
      getAdapter: vi.fn(() => adapter),
      getDefinition: vi.fn(() => googleBusinessProfileDefinition),
    },
    findDataSource: vi.fn(async () => input.dataSource ?? dataSource),
    assertFeatureEnabled: vi.fn(),
    isCancelled: vi.fn(async () => input.cancelled ?? false),
    now: () => new Date(timestamp),
    csvObjects: {
      stat: vi.fn(async () => ({ contentType: "text/csv", size: 30, encoding: "utf-8" })),
      open: vi.fn(async () =>
        (async function* () {
          yield Buffer.from("order_id,gross_sales\norder-1,42\n", "utf8");
        })(),
      ),
    },
    credentialCleanup: { revoke: vi.fn().mockResolvedValue(undefined) },
  };
}

const connectionPayload = {
  taskName: "integration.test-connection" as const,
  organizationId: ids.organizationId,
  connectionId: ids.connectionId,
  ingestionRunId: ids.ingestionRunId,
  correlationId: ids.correlationId,
  idempotencyKey: "dispatch:integration:11111111-1111-4111-8111-111111111111",
  adapterVersion: "1",
};

describe("Integration Hub workers", () => {
  it("validates the organization, source, and adapter before starting privileged work", async () => {
    const deps = dependencies();
    deps.providers.getAdapter.mockImplementation(() => {
      throw new Error("adapter must not be read");
    });
    await expect(
      runTestConnection({ ...connectionPayload, organizationId: "not-a-uuid" }, deps),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deps.assertFeatureEnabled).not.toHaveBeenCalled();
    expect(deps.worker.loadGrantRecomputationInput).not.toHaveBeenCalled();
    expect(deps.providers.getAdapter).not.toHaveBeenCalled();
  });

  it("marks a test run running, appends health, and persists its terminal state", async () => {
    const deps = dependencies();
    await runTestConnection(connectionPayload, deps);
    expect(deps.worker.markRunRunning).toHaveBeenCalledOnce();
    expect(deps.worker.health).toHaveLength(1);
    expect(deps.worker.completions).toContainEqual(
      expect.objectContaining({ status: "succeeded", recordsReceived: 0 }),
    );
  });

  it("reuses the persisted idempotency key and sends a valid sync handoff once", async () => {
    const deps = dependencies();
    await runSyncConnection(
      { ...connectionPayload, taskName: "integration.sync-connection" },
      deps,
    );
    expect(deps.sink.accept).toHaveBeenCalledOnce();
    expect(deps.sink.accept).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: connectionPayload.idempotencyKey }),
    );
    expect(deps.worker.completions).toContainEqual(
      expect.objectContaining({ status: "succeeded", recordsReceived: 1, recordsAccepted: 1 }),
    );
  });

  it("does not send a second handoff when an idempotent retry sees a terminal run", async () => {
    const worker = workerRepository();
    vi.mocked(worker.markRunRunning)
      .mockResolvedValueOnce(runRow({ status: "running", started_at: timestamp }))
      .mockRejectedValueOnce(new IntegrationError("CONFLICT", "terminal", false));
    const deps = dependencies({ worker });
    const payload = { ...connectionPayload, taskName: "integration.sync-connection" as const };
    await runSyncConnection(payload, deps);
    await expect(runSyncConnection(payload, deps)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(deps.sink.accept).toHaveBeenCalledOnce();
    expect(deps.sink.accept).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: connectionPayload.idempotencyKey }),
    );
  });

  it("persists partial sync counts without reporting a full success", async () => {
    const deps = dependencies({
      sink: {
        accept: vi
          .fn()
          .mockResolvedValue({ accepted: 1, rejected: 1, rejectionReasons: ["INVALID_PAYLOAD"] }),
      },
      adapter: fixtureAdapter({
        sync: vi.fn().mockResolvedValue([
          {
            schemaVersion: 1,
            organizationId: ids.organizationId,
            source: { kind: "connection", id: ids.connectionId },
            externalRecordId: "review-1",
            recordType: "review",
            fetchedAt: timestamp,
            payload: {},
          },
          {
            schemaVersion: 1,
            organizationId: ids.organizationId,
            source: { kind: "connection", id: ids.connectionId },
            externalRecordId: "review-2",
            recordType: "review",
            fetchedAt: timestamp,
            payload: {},
          },
        ]),
      }),
    });
    await runSyncConnection(
      { ...connectionPayload, taskName: "integration.sync-connection" },
      deps,
    );
    expect(deps.worker.completions).toContainEqual(
      expect.objectContaining({
        status: "partially_succeeded",
        recordsReceived: 2,
        recordsRejected: 1,
      }),
    );
  });

  it("records a cancelled run without calling the provider", async () => {
    const adapter = fixtureAdapter();
    const deps = dependencies({ cancelled: true, adapter });
    await runSyncConnection(
      { ...connectionPayload, taskName: "integration.sync-connection" },
      deps,
    );
    expect(adapter.sync).not.toHaveBeenCalled();
    expect(deps.worker.completions).toContainEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("keeps prior good data and atomically requeues a retryable adapter failure", async () => {
    const deps = dependencies({
      adapter: fixtureAdapter({
        testConnection: vi
          .fn()
          .mockRejectedValue(new IntegrationError("PROVIDER_UNAVAILABLE", "safe", true)),
      }),
    });
    await expect(runTestConnection(connectionPayload, deps)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    expect(deps.worker.scheduleConnection).not.toHaveBeenCalled();
    expect(deps.worker.requeueRun).toHaveBeenCalledWith(
      expect.objectContaining({ normalizedErrorCode: "PROVIDER_UNAVAILABLE" }),
    );
    expect(deps.worker.health).toContainEqual(
      expect.objectContaining({ outcome: "failed", normalized_error_code: "PROVIDER_UNAVAILABLE" }),
    );
  });

  it("maps a failed connection test result to a failed terminal run", async () => {
    const deps = dependencies({
      adapter: fixtureAdapter({
        testConnection: vi
          .fn()
          .mockResolvedValue({ outcome: "failed", safeDetail: "Fixture failed." }),
      }),
    });
    await runTestConnection(connectionPayload, deps);
    expect(deps.worker.completions).toContainEqual(
      expect.objectContaining({ status: "failed", normalizedErrorCode: "UNKNOWN_PROVIDER_ERROR" }),
    );
  });

  it("imports UTF-8 CSV data in bounded batches", async () => {
    const deps = dependencies();
    await runImportDataSource(
      {
        taskName: "integration.import-data-source",
        organizationId: ids.organizationId,
        dataSourceId: ids.dataSourceId,
        ingestionRunId: ids.ingestionRunId,
        correlationId: ids.correlationId,
        idempotencyKey: connectionPayload.idempotencyKey,
      },
      deps,
    ).catch((error: IntegrationError) => {
      throw error.internalCause;
    });
    expect(deps.sink.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [
          expect.objectContaining({ source: { kind: "data_source", id: ids.dataSourceId } }),
        ],
      }),
    );
  });

  it("appends an authoritative stale freshness warning without deleting history", async () => {
    const deps = dependencies();
    await runCheckFreshness(
      { ...connectionPayload, taskName: "integration.check-freshness" },
      deps,
    );
    expect(deps.worker.health).toContainEqual(
      expect.objectContaining({ check_type: "freshness", outcome: "passed" }),
    );
  });

  it("marks a connection stale once its configured freshness window has elapsed", async () => {
    const worker = workerRepository();
    vi.mocked(worker.loadGrantRecomputationInput).mockResolvedValueOnce({
      ...(await worker.loadGrantRecomputationInput({
        organizationId: ids.organizationId,
        connectionId: ids.connectionId,
      })),
      last_successful_sync_at: "2026-08-07T23:00:00.000Z",
    });
    const deps = dependencies({ worker });
    await runCheckFreshness(
      { ...connectionPayload, taskName: "integration.check-freshness" },
      deps,
    );
    expect(deps.worker.health).toContainEqual(
      expect.objectContaining({ check_type: "freshness", outcome: "warning" }),
    );
  });

  it("uses the provider-defined freshness threshold instead of the Google fixture default", async () => {
    const deps = dependencies({
      adapter: fixtureAdapter({ providerKey: "short-window-provider" }),
    });
    deps.providers.getDefinition.mockReturnValue({
      ...googleBusinessProfileDefinition,
      key: "short-window-provider",
      staleAfterMinutes: 5,
    });
    vi.mocked(deps.worker.loadGrantRecomputationInput).mockResolvedValueOnce({
      ...(await deps.worker.loadGrantRecomputationInput({
        organizationId: ids.organizationId,
        connectionId: ids.connectionId,
      })),
      provider_key: "short-window-provider",
      last_successful_sync_at: "2026-08-08T00:54:00.000Z",
    });
    await runCheckFreshness(
      { ...connectionPayload, taskName: "integration.check-freshness" },
      deps,
    );
    expect(deps.worker.health).toContainEqual(
      expect.objectContaining({ check_type: "freshness", outcome: "warning" }),
    );
  });

  it("rejects CSV streams that contain invalid UTF-8", async () => {
    const deps = dependencies();
    deps.csvObjects.open.mockResolvedValueOnce(
      (async function* () {
        yield Buffer.from([0xc3, 0x28]);
      })(),
    );
    await expect(
      runImportDataSource(
        {
          taskName: "integration.import-data-source",
          organizationId: ids.organizationId,
          dataSourceId: ids.dataSourceId,
          ingestionRunId: ids.ingestionRunId,
          correlationId: ids.correlationId,
          idempotencyKey: connectionPayload.idempotencyKey,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN_PROVIDER_ERROR" });
    expect(deps.sink.accept).not.toHaveBeenCalled();
  });

  it("leaves capabilities disabled and records a warning when credential cleanup fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.worker.loadGrantRecomputationInput).mockResolvedValueOnce({
      ...(await deps.worker.loadGrantRecomputationInput({
        organizationId: ids.organizationId,
        connectionId: ids.connectionId,
      })),
      connection_mode: "oauth",
    });
    deps.credentialCleanup.revoke.mockRejectedValueOnce(new Error("not logged"));
    await expect(
      runDisconnectConnection(
        { ...connectionPayload, taskName: "integration.disconnect-connection" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN_PROVIDER_ERROR" });
    expect(deps.worker.scheduleConnection).toHaveBeenCalledWith(
      expect.objectContaining({ nextScheduledSyncAt: null }),
    );
    expect(deps.worker.health).toContainEqual(
      expect.objectContaining({ outcome: "warning", check_type: "authentication" }),
    );
  });

  it("marks a fixture connection revoked after its cleanup-free disconnect completes", async () => {
    const deps = dependencies();
    await runDisconnectConnection(
      { ...connectionPayload, taskName: "integration.disconnect-connection" },
      deps,
    );
    expect(deps.worker.setConnectionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "revoked" }),
    );
  });
});
