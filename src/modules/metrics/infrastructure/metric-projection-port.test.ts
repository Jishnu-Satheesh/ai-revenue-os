import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMetricProjectionPort } from "@/modules/metrics/infrastructure/metric-projection-port";
import type {
  MetricDefinitionRecord,
  MetricObservationWrite,
  MetricProjectionStore,
} from "@/modules/metrics/application/ports";

vi.mock("server-only", () => ({}));

const definitions = new Map<string, MetricDefinitionRecord>([
  [
    "revenue.gross",
    {
      id: "def-revenue",
      key: "revenue.gross",
      valueKind: "money",
      aggregation: "sum",
      percentileP: null,
      isActive: true,
    },
  ],
  [
    "transactions.count",
    {
      id: "def-orders",
      key: "transactions.count",
      valueKind: "count",
      aggregation: "sum",
      percentileP: null,
      isActive: true,
    },
  ],
]);

function stubStore(overrides: Partial<MetricProjectionStore> = {}) {
  const written: MetricObservationWrite[] = [];

  const store: MetricProjectionStore = {
    loadProjectionContext: async () => ({
      branchId: "branch-1",
      timeZone: "Asia/Dubai",
      defaultCurrency: "AED",
    }),
    loadDefinitionsByKey: async () => definitions,
    writeObservations: async (observations) => {
      written.push(...observations);
      return { written: observations.length, duplicates: 0 };
    },
    ...overrides,
  };

  return { store, written };
}

type CsvRecord = {
  schemaVersion: number;
  organizationId: string;
  source: { kind: "data_source"; id: string };
  externalRecordId: string;
  recordType: string;
  fetchedAt: string;
  payload: { values: Record<string, string>; columnMapping: Record<string, string> };
};

function csvRecord(values: Record<string, string>, index: number): CsvRecord {
  return {
    schemaVersion: 1,
    organizationId: "org-1",
    source: { kind: "data_source" as const, id: "source-1" },
    externalRecordId: `row-${index}`,
    recordType: "csv_import.row",
    fetchedAt: "2026-08-04T00:00:00.000Z",
    payload: {
      values,
      columnMapping: {
        period: "Date",
        channel: "Channel",
        "revenue.gross": "Total",
        "transactions.count": "Orders",
      },
    },
  };
}

const ingestInput = (records: CsvRecord[]) => ({
  organizationId: "org-1",
  ingestionRunId: "run-1",
  idempotencyKey: "key-1",
  records,
});

describe("metric projection port", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("writes one observation per mapped metric and accepts the row once", async () => {
    const { store, written } = stubStore();
    const port = createMetricProjectionPort({ store });

    const result = await port.ingest(
      ingestInput([
        csvRecord({ Date: "2026-08-01", Channel: "talabat", Total: "1250.50", Orders: "42" }, 1),
      ]),
    );

    // Two observations, but one row: the sink reconciles counters against rows.
    expect(written).toHaveLength(2);
    expect(result).toMatchObject({ accepted: 1, rejected: 0 });

    const revenue = written.find((entry) => entry.metricDefinitionId === "def-revenue");
    expect(revenue).toMatchObject({
      organizationId: "org-1",
      branchId: "branch-1",
      numerator: 125050,
      currency: "AED",
      channel: "talabat",
      periodGrain: "day",
      periodTimezone: "Asia/Dubai",
      qualityTier: "measured",
      sourceIngestionRunId: "run-1",
    });
    expect(revenue?.periodStart.toISOString()).toBe("2026-07-31T20:00:00.000Z");
  });

  it("accepts a row where only some cells projected", async () => {
    const { store, written } = stubStore();
    const port = createMetricProjectionPort({ store });

    const result = await port.ingest(
      ingestInput([csvRecord({ Date: "2026-08-01", Total: "10.00", Orders: "not-a-number" }, 1)]),
    );

    expect(written).toHaveLength(1);
    expect(result).toMatchObject({ accepted: 1, rejected: 0 });
  });

  it("rejects a row whose every cell failed", async () => {
    const { store, written } = stubStore();
    const port = createMetricProjectionPort({ store });

    const result = await port.ingest(
      ingestInput([csvRecord({ Date: "2026-08-01", Total: "oops", Orders: "oops" }, 1)]),
    );

    expect(written).toEqual([]);
    expect(result).toMatchObject({ accepted: 0, rejected: 1 });
    expect(result.rejectionReasons).toEqual(["INVALID_PAYLOAD"]);
  });

  it("leaves record types it does not own to another consumer", async () => {
    const { store, written } = stubStore();
    const port = createMetricProjectionPort({ store });

    const result = await port.ingest(
      ingestInput([
        {
          ...csvRecord({ Date: "2026-08-01", Total: "1.00", Orders: "1" }, 1),
          recordType: "google_business_profile.review.v1",
        },
      ]),
    );

    expect(written).toEqual([]);
    expect(result.rejectionReasons).toEqual(["UNSUPPORTED_RECORD_TYPE"]);
  });

  it("reports a mapping that carries no metric key once, not once per row", async () => {
    const { store, written } = stubStore();
    const port = createMetricProjectionPort({ store });

    const records = [1, 2, 3].map((index) => ({
      ...csvRecord({ Date: "2026-08-01" }, index),
      payload: { values: { Date: "2026-08-01" }, columnMapping: { period: "Date" } },
    }));

    const result = await port.ingest(ingestInput(records));

    expect(written).toEqual([]);
    expect(result).toMatchObject({ accepted: 0, rejected: 3 });
    // One log line for the misconfiguration, not one per row.
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("does not treat a duplicate period as malformed input", async () => {
    const { store } = stubStore({
      writeObservations: async (observations) => ({
        written: 0,
        duplicates: observations.length,
      }),
    });
    const port = createMetricProjectionPort({ store });

    const result = await port.ingest(
      ingestInput([csvRecord({ Date: "2026-08-01", Total: "10.00", Orders: "1" }, 1)]),
    );

    // The row parsed correctly; its period already holds a current revision.
    // Restating it is a governed act, not a parsing failure.
    expect(result).toMatchObject({ accepted: 1, rejected: 0 });
  });

  it("blocks the batch when the import has no resolvable branch context", async () => {
    const { store, written } = stubStore({ loadProjectionContext: async () => null });
    const port = createMetricProjectionPort({ store });

    const result = await port.ingest(
      ingestInput([csvRecord({ Date: "2026-08-01", Total: "10.00", Orders: "1" }, 1)]),
    );

    expect(written).toEqual([]);
    expect(result.rejectionReasons).toEqual(["POLICY_BLOCKED"]);
  });
});
