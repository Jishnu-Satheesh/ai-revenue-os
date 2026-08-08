import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAcknowledgingDataIngestionPort,
  createDurableIngestionSink,
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

  it("returns the durable stored handoff result across separate worker sink instances", async () => {
    const handoff = createHandoff();
    const stored = new Map<
      string,
      {
        fingerprint: string;
        result?: { accepted: number; rejected: number; rejectionReasons: readonly string[] };
      }
    >();
    const ledger = {
      async claim(input: {
        organizationId: string;
        ingestionRunId: string;
        idempotencyKey: string;
        fingerprint: string;
        claimToken: string;
      }) {
        const key = `${input.organizationId}:${input.ingestionRunId}:${input.idempotencyKey}`;
        const current = stored.get(key);
        if (!current) {
          stored.set(key, { fingerprint: input.fingerprint });
          return { outcome: "claimed" as const };
        }
        if (current.fingerprint !== input.fingerprint) return { outcome: "conflict" as const };
        if (current.result) return { outcome: "completed" as const, ...current.result };
        return { outcome: "in_progress" as const };
      },
      async complete(input: {
        organizationId: string;
        ingestionRunId: string;
        idempotencyKey: string;
        fingerprint: string;
        claimToken: string;
        accepted: number;
        rejected: number;
        rejectionReasons: readonly string[];
      }) {
        const key = `${input.organizationId}:${input.ingestionRunId}:${input.idempotencyKey}`;
        const result = {
          accepted: input.accepted,
          rejected: input.rejected,
          rejectionReasons: input.rejectionReasons,
        };
        stored.set(key, { fingerprint: input.fingerprint, result });
        return result;
      },
    };
    const request = {
      organizationId,
      ingestionRunId: "run-durable",
      idempotencyKey: "sync-durable-a",
      records: [baseRecord],
    };
    const first = createDurableIngestionSink({
      sink: createValidatedIngestionSink({
        handoff,
        sourceResolver: { resolve: async () => source },
      }),
      ledger,
    });
    const second = createDurableIngestionSink({
      sink: createValidatedIngestionSink({
        handoff,
        sourceResolver: { resolve: async () => source },
      }),
      ledger,
    });
    await expect(first.accept(request)).resolves.toEqual({
      accepted: 1,
      rejected: 0,
      rejectionReasons: [],
    });
    await expect(second.accept(request)).resolves.toEqual({
      accepted: 1,
      rejected: 0,
      rejectionReasons: [],
    });
    expect(handoff.ingest).toHaveBeenCalledOnce();
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

  it("rejects same-key reuse when only the payload changes", async () => {
    const handoff = createHandoff();
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });
    const input = {
      organizationId,
      ingestionRunId: "run-a",
      idempotencyKey: "sync-payload-a",
      records: [baseRecord],
    };

    await sink.accept(input);

    await expect(
      sink.accept({
        ...input,
        records: [{ ...baseRecord, payload: { locationName: "Changed fixture location" } }],
      }),
    ).resolves.toEqual({
      accepted: 0,
      rejected: 1,
      rejectionReasons: ["IDEMPOTENCY_KEY_REUSED"],
    });
    expect(handoff.ingest).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight handoff between identical concurrent calls", async () => {
    let releaseHandoff: (() => void) | undefined;
    const handoff: DataIngestionPort = {
      ingest: vi.fn(
        () =>
          new Promise<{ accepted: number; rejected: number; rejectionReasons: string[] }>(
            (resolve) => {
              releaseHandoff = () => resolve({ accepted: 1, rejected: 0, rejectionReasons: [] });
            },
          ),
      ),
    };
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });
    const input = {
      organizationId,
      ingestionRunId: "run-a",
      idempotencyKey: "sync-concurrent-a",
      records: [baseRecord],
    };

    const first = sink.accept(input);
    await vi.waitFor(() => expect(handoff.ingest).toHaveBeenCalledTimes(1));
    const second = sink.accept(input);
    await vi.waitFor(() => expect(handoff.ingest).toHaveBeenCalledTimes(1));
    await expect(
      sink.accept({
        ...input,
        records: [{ ...baseRecord, payload: { locationName: "Conflicting in-flight payload" } }],
      }),
    ).resolves.toEqual({
      accepted: 0,
      rejected: 1,
      rejectionReasons: ["IDEMPOTENCY_KEY_REUSED"],
    });
    releaseHandoff?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { accepted: 1, rejected: 0, rejectionReasons: [] },
      { accepted: 1, rejected: 0, rejectionReasons: [] },
    ]);
  });

  it("rejects oversized and deeply nested payloads before they reach Data Ingestion", async () => {
    const handoff = createHandoff();
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });
    let deepPayload: unknown = "leaf";
    for (let depth = 0; depth < 13; depth += 1) {
      deepPayload = { child: deepPayload };
    }

    await expect(
      sink.accept({
        organizationId,
        ingestionRunId: "run-a",
        idempotencyKey: "sync-bounded-a",
        records: [
          { ...baseRecord, externalRecordId: "oversized", payload: "x".repeat(16_385) },
          { ...baseRecord, externalRecordId: "deep", payload: deepPayload },
        ],
      }),
    ).resolves.toEqual({
      accepted: 0,
      rejected: 2,
      rejectionReasons: ["INVALID_PAYLOAD", "INVALID_PAYLOAD"],
    });
    expect(handoff.ingest).not.toHaveBeenCalled();
  });

  it("rejects sparse arrays and treats same-key sparse reuse as a conflict", async () => {
    const handoff = createHandoff();
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });
    const sparsePayload: unknown[] = [];
    sparsePayload[1] = "fixture";

    await expect(
      sink.accept({
        organizationId,
        ingestionRunId: "run-a",
        idempotencyKey: "sync-sparse-a",
        records: [{ ...baseRecord, payload: sparsePayload }],
      }),
    ).resolves.toEqual({
      accepted: 0,
      rejected: 1,
      rejectionReasons: ["INVALID_PAYLOAD"],
    });
    await sink.accept({
      organizationId,
      ingestionRunId: "run-a",
      idempotencyKey: "sync-sparse-conflict-a",
      records: [{ ...baseRecord, payload: [] }],
    });
    await expect(
      sink.accept({
        organizationId,
        ingestionRunId: "run-a",
        idempotencyKey: "sync-sparse-conflict-a",
        records: [{ ...baseRecord, payload: sparsePayload }],
      }),
    ).resolves.toEqual({
      accepted: 0,
      rejected: 1,
      rejectionReasons: ["IDEMPOTENCY_KEY_REUSED"],
    });
    expect(handoff.ingest).toHaveBeenCalledTimes(1);
  });

  it.each([
    { accepted: 0, rejected: 0, label: "under-counts" },
    { accepted: 2, rejected: 0, label: "over-counts" },
  ])("fails closed when the downstream handoff $label records", async ({ accepted, rejected }) => {
    const handoff: DataIngestionPort = {
      ingest: vi.fn(async () => ({ accepted, rejected, rejectionReasons: [] })),
    };
    const sink = createValidatedIngestionSink({
      handoff,
      sourceResolver: { resolve: async () => source },
    });

    await expect(
      sink.accept({
        organizationId,
        ingestionRunId: "run-a",
        idempotencyKey: "sync-undercount-a",
        records: [baseRecord],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
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

  it.each([
    {
      expectedReasons: ["INVALID_PAYLOAD", "DOWNSTREAM_REJECTION"],
      rejectionReasons: ["INVALID_PAYLOAD"],
    },
    {
      expectedReasons: ["DOWNSTREAM_REJECTION", "DOWNSTREAM_REJECTION"],
      rejectionReasons: [],
    },
  ])(
    "pads missing downstream rejection reasons with a safe deterministic code",
    async ({ rejectionReasons, expectedReasons }) => {
      const handoff: DataIngestionPort = {
        ingest: vi.fn(async () => ({
          accepted: 0,
          rejected: 2,
          rejectionReasons,
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
          idempotencyKey: "sync-short-reasons-a",
          records: [
            baseRecord,
            { ...baseRecord, externalRecordId: "reviews/fixture-harbor-house-001" },
          ],
        }),
      ).resolves.toEqual({
        accepted: 0,
        rejected: 2,
        rejectionReasons: expectedReasons,
      });
    },
  );
});
