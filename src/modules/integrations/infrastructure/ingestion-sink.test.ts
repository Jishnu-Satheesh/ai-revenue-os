import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAcknowledgingDataIngestionPort,
  createValidatedIngestionSink,
  type DataIngestionPort,
} from "@/modules/integrations/infrastructure/ingestion-sink";

const organizationId = "organization-a";
const source = { kind: "connection" as const, id: "connection-a" };
const baseRecord = {
  schemaVersion: 1,
  organizationId,
  source,
  externalRecordId: "locations/fixture-harbor-house",
  recordType: "google_business_profile.location.v1",
  fetchedAt: "2026-08-08T10:00:00.000Z",
  payload: { locationName: "Harbor House" },
};

function createHandoff() {
  const handoff: DataIngestionPort = {
    ingest: vi.fn(async (input) => ({
      accepted: input.records.length,
      rejected: 0,
      rejectionReasons: [],
    })),
  };
  return handoff;
}

describe("validated integration ingestion sink", () => {
  it("provides an explicit temporary Data Ingestion acknowledgement port", async () => {
    const handoff = createAcknowledgingDataIngestionPort();

    await expect(
      handoff.ingest({
        organizationId,
        ingestionRunId: "run-a",
        idempotencyKey: "sync-a",
        records: [baseRecord],
      }),
    ).resolves.toEqual({ accepted: 1, rejected: 0, rejectionReasons: [] });
  });

  it("passes matching Zod-validated envelopes to the Data Ingestion port", async () => {
    const handoff = createHandoff();
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });

    const result = await sink.accept({
      organizationId,
      ingestionRunId: "run-a",
      idempotencyKey: "sync-a",
      records: [baseRecord],
    });

    expect(result).toEqual({ accepted: 1, rejected: 0, rejectionReasons: [] });
    expect(handoff.ingest).toHaveBeenCalledWith({
      organizationId,
      ingestionRunId: "run-a",
      idempotencyKey: "sync-a",
      records: [baseRecord],
    });
  });

  it("rejects malformed, cross-tenant, and wrong-source records with safe reasons", async () => {
    const handoff = createHandoff();
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });

    const result = await sink.accept({
      organizationId,
      ingestionRunId: "run-a",
      idempotencyKey: "sync-a",
      records: [
        baseRecord,
        { ...baseRecord, externalRecordId: "malformed", fetchedAt: "not-a-date" },
        { ...baseRecord, externalRecordId: "other-tenant", organizationId: "organization-b" },
        {
          ...baseRecord,
          externalRecordId: "wrong-source",
          source: { kind: "connection", id: "connection-b" },
        },
      ],
    });

    expect(result).toEqual({
      accepted: 1,
      rejected: 3,
      rejectionReasons: ["INVALID_ENVELOPE", "ORGANIZATION_MISMATCH", "SOURCE_MISMATCH"],
    });
    expect(handoff.ingest).toHaveBeenCalledTimes(1);
  });

  it("does not hand off the same idempotency key twice and rejects conflicting reuse", async () => {
    const handoff = createHandoff();
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });
    const input = {
      organizationId,
      ingestionRunId: "run-a",
      idempotencyKey: "sync-a",
      records: [baseRecord],
    };

    await expect(sink.accept(input)).resolves.toEqual({
      accepted: 1,
      rejected: 0,
      rejectionReasons: [],
    });
    await expect(sink.accept(input)).resolves.toEqual({
      accepted: 1,
      rejected: 0,
      rejectionReasons: [],
    });
    await expect(
      sink.accept({
        ...input,
        records: [{ ...baseRecord, externalRecordId: "different-record" }],
      }),
    ).resolves.toEqual({
      accepted: 0,
      rejected: 1,
      rejectionReasons: ["IDEMPOTENCY_KEY_REUSED"],
    });
    expect(handoff.ingest).toHaveBeenCalledTimes(1);
  });

  it("accounts for downstream partial ingestion without retaining records", async () => {
    const handoff: DataIngestionPort = {
      ingest: vi.fn(async () => ({
        accepted: 1,
        rejected: 1,
        rejectionReasons: ["UNSUPPORTED_RECORD_TYPE"],
      })),
    };
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });

    await expect(
      sink.accept({
        organizationId,
        ingestionRunId: "run-a",
        idempotencyKey: "sync-a",
        records: [
          baseRecord,
          { ...baseRecord, externalRecordId: "reviews/fixture-harbor-house-001" },
        ],
      }),
    ).resolves.toEqual({
      accepted: 1,
      rejected: 1,
      rejectionReasons: ["UNSUPPORTED_RECORD_TYPE"],
    });
  });
});
