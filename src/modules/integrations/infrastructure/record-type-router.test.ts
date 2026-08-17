import { describe, expect, it, vi } from "vitest";

import type { DataIngestionPort } from "@/modules/integrations/infrastructure/ingestion-sink";
import { createRecordTypeRouter } from "@/modules/integrations/infrastructure/record-type-router";

vi.mock("server-only", () => ({}));

function record(recordType: string, index: number) {
  return {
    schemaVersion: 1,
    organizationId: "org-1",
    source: { kind: "data_source" as const, id: "source-1" },
    externalRecordId: `record-${index}`,
    recordType,
    fetchedAt: "2026-08-04T00:00:00.000Z",
    payload: {},
  };
}

function acceptingPort(): DataIngestionPort & { seen: string[][] } {
  const seen: string[][] = [];
  return {
    seen,
    async ingest(input) {
      seen.push(input.records.map((entry) => entry.recordType));
      return { accepted: input.records.length, rejected: 0, rejectionReasons: [] };
    },
  };
}

const input = (records: ReturnType<typeof record>[]) => ({
  organizationId: "org-1",
  ingestionRunId: "run-1",
  idempotencyKey: "key-1",
  records,
});

describe("record type router", () => {
  it("sends each consumer only the records it owns", async () => {
    const memory = acceptingPort();
    const metrics = acceptingPort();

    const router = createRecordTypeRouter([
      { recordTypes: ["gbp.review.v1"], port: memory },
      { recordTypes: ["csv_import.row"], port: metrics },
    ]);

    await router.ingest(
      input([record("gbp.review.v1", 1), record("csv_import.row", 2), record("gbp.review.v1", 3)]),
    );

    expect(memory.seen).toEqual([["gbp.review.v1", "gbp.review.v1"]]);
    expect(metrics.seen).toEqual([["csv_import.row"]]);
  });

  it("keeps counts disjoint so the run's constraint holds", async () => {
    const memory = acceptingPort();
    const metrics = acceptingPort();

    const router = createRecordTypeRouter([
      { recordTypes: ["gbp.review.v1"], port: memory },
      { recordTypes: ["csv_import.row"], port: metrics },
    ]);

    const records = [record("gbp.review.v1", 1), record("csv_import.row", 2)];
    const result = await router.ingest(input(records));

    // Broadcasting instead of routing would report 2 accepted and 2 rejected
    // for a two-record batch, and integration_ingestion_runs checks that
    // accepted plus rejected never exceeds received.
    expect(result).toMatchObject({ accepted: 2, rejected: 0 });
    expect(result.accepted + result.rejected).toBeLessThanOrEqual(records.length);
  });

  it("counts an unowned record type once, without calling any consumer", async () => {
    const memory = acceptingPort();

    const router = createRecordTypeRouter([{ recordTypes: ["gbp.review.v1"], port: memory }]);
    const result = await router.ingest(input([record("provider.unknown.v9", 1)]));

    expect(memory.seen).toEqual([]);
    expect(result).toMatchObject({ accepted: 0, rejected: 1 });
    expect(result.rejectionReasons).toEqual(["UNSUPPORTED_RECORD_TYPE"]);
  });

  it("passes a consumer's own rejections through", async () => {
    const failing: DataIngestionPort = {
      async ingest() {
        return { accepted: 0, rejected: 1, rejectionReasons: ["INVALID_PAYLOAD"] };
      },
    };

    const router = createRecordTypeRouter([{ recordTypes: ["csv_import.row"], port: failing }]);
    const result = await router.ingest(input([record("csv_import.row", 1)]));

    expect(result).toMatchObject({ accepted: 0, rejected: 1 });
    expect(result.rejectionReasons).toEqual(["INVALID_PAYLOAD"]);
  });

  it("refuses a composition where two consumers claim one record type", () => {
    expect(() =>
      createRecordTypeRouter([
        { recordTypes: ["csv_import.row"], port: acceptingPort() },
        { recordTypes: ["csv_import.row"], port: acceptingPort() },
      ]),
    ).toThrow(/csv_import\.row/);
  });

  it("does not invoke a consumer that has no records in the batch", async () => {
    const memory = acceptingPort();
    const metrics = acceptingPort();

    const router = createRecordTypeRouter([
      { recordTypes: ["gbp.review.v1"], port: memory },
      { recordTypes: ["csv_import.row"], port: metrics },
    ]);

    await router.ingest(input([record("csv_import.row", 1)]));

    expect(memory.seen).toEqual([]);
    expect(metrics.seen).toEqual([["csv_import.row"]]);
  });
});
