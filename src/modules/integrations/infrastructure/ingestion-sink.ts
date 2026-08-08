import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { IntegrationError } from "@/domain/integrations/errors";
import {
  integrationRecordEnvelopeSchema,
  type IntegrationRecordEnvelope,
} from "@/domain/integrations/schemas";
import type { IngestionSink } from "@/domain/integrations/types";

const sinkInputSchema = z.object({
  organizationId: z.string().trim().min(1).max(200),
  ingestionRunId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(1).max(200),
  records: z.array(z.unknown()).max(1_000),
});

const sourceSchema = z.object({
  kind: z.enum(["connection", "data_source"]),
  id: z.string().trim().min(1),
});

const safeDownstreamReasonSchema = z.enum([
  "UNSUPPORTED_RECORD_TYPE",
  "INVALID_PAYLOAD",
  "DUPLICATE_RECORD",
  "POLICY_BLOCKED",
]);

const handoffResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  rejectionReasons: z.array(z.string()).max(50),
});

const MAX_RECORD_SERIALIZED_BYTES = 64 * 1024;
const MAX_PAYLOAD_SERIALIZED_BYTES = 48 * 1024;
const MAX_PAYLOAD_STRING_BYTES = 16 * 1024;
const MAX_PAYLOAD_NESTING = 12;
const MAX_PAYLOAD_ARRAY_ITEMS = 500;
const MAX_PAYLOAD_OBJECT_PROPERTIES = 100;
const MAX_ENVELOPE_TEXT_BYTES = 4 * 1024;

export type DataIngestionPort = {
  ingest(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    records: readonly IntegrationRecordEnvelope[];
  }): Promise<{
    accepted: number;
    rejected: number;
    rejectionReasons: readonly string[];
  }>;
};

export type IngestionSourceResolver = {
  resolve(input: {
    organizationId: string;
    ingestionRunId: string;
  }): Promise<{ kind: "connection" | "data_source"; id: string } | null>;
};

export type DurableIngestionHandoffLedger = {
  claim(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    fingerprint: string;
    claimToken: string;
  }): Promise<
    | { outcome: "claimed" }
    | { outcome: "in_progress" }
    | { outcome: "conflict" }
    | {
        outcome: "completed";
        accepted: number;
        rejected: number;
        rejectionReasons: readonly string[];
      }
  >;
  complete(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    fingerprint: string;
    claimToken: string;
    accepted: number;
    rejected: number;
    rejectionReasons: readonly string[];
  }): Promise<
    | { accepted: number; rejected: number; rejectionReasons: readonly string[] }
    | { outcome: "stale_lease" }
  >;
};

function durableFingerprint(input: Parameters<IngestionSink["accept"]>[0]): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("base64url");
}

/** Persists idempotency state outside the worker process before a downstream handoff. */
export function createDurableIngestionSink(input: {
  sink: IngestionSink;
  ledger: DurableIngestionHandoffLedger;
}): IngestionSink {
  return {
    async accept(request) {
      const fingerprint = durableFingerprint(request);
      const claimToken = crypto.randomUUID();
      const claimed = await input.ledger.claim({ ...request, fingerprint, claimToken });
      if (claimed.outcome === "completed") {
        return {
          accepted: claimed.accepted,
          rejected: claimed.rejected,
          rejectionReasons: claimed.rejectionReasons,
        };
      }
      if (claimed.outcome === "conflict") {
        throw new IntegrationError("CONFLICT", "The ingestion idempotency key was reused.", false);
      }
      if (claimed.outcome === "in_progress") {
        throw new IntegrationError(
          "CONFLICT",
          "The ingestion handoff is already in progress.",
          true,
        );
      }
      const result = await input.sink.accept(request);
      const completed = await input.ledger.complete({
        ...request,
        fingerprint,
        claimToken,
        ...result,
      });
      if ("outcome" in completed) {
        throw new IntegrationError(
          "CONFLICT",
          "The ingestion handoff lease was superseded.",
          false,
          { staleLease: true },
        );
      }
      return completed;
    },
  };
}

/**
 * Temporary downstream boundary until the Data Ingestion module owns typed
 * record schemas. It deliberately acknowledges only the current bounded batch.
 */
export function createAcknowledgingDataIngestionPort(): DataIngestionPort {
  return {
    async ingest(input) {
      return {
        accepted: input.records.length,
        rejected: 0,
        rejectionReasons: [],
      };
    },
  };
}

type ValidatedIngestionSinkDependencies = {
  handoff: DataIngestionPort;
  sourceResolver: IngestionSourceResolver;
  maxIdempotencyEntries?: number;
};

type CachedResult = {
  fingerprint: string;
  result: { accepted: number; rejected: number; rejectionReasons: readonly string[] };
};

type InFlightResult = {
  fingerprint: string;
  promise: Promise<{ accepted: number; rejected: number; rejectionReasons: readonly string[] }>;
};

function fingerprintRecords(
  records: readonly IntegrationRecordEnvelope[],
  payloadDigests: readonly string[],
  rejectionReasons: readonly string[],
): string {
  return JSON.stringify({
    records: records.map((record, index) => ({
      schemaVersion: record.schemaVersion,
      organizationId: record.organizationId,
      source: record.source,
      externalRecordId: record.externalRecordId,
      recordType: record.recordType,
      observedAt: record.observedAt,
      fetchedAt: record.fetchedAt,
      payloadDigest: payloadDigests[index],
    })),
    rejectionReasons,
  });
}

function idempotencyCacheKey(input: {
  organizationId: string;
  ingestionRunId: string;
  idempotencyKey: string;
}): string {
  return JSON.stringify([input.organizationId, input.ingestionRunId, input.idempotencyKey]);
}

function cacheResult(
  cache: Map<string, CachedResult>,
  key: string,
  value: CachedResult,
  maxEntries: number,
): void {
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) return;
    cache.delete(oldestKey);
  }
}

function safeDownstreamReasons(reasons: readonly string[], rejected: number): string[] {
  const safeReasons = reasons.map((reason) =>
    safeDownstreamReasonSchema.safeParse(reason).success ? reason : "DOWNSTREAM_REJECTION",
  );
  return [
    ...safeReasons.slice(0, rejected),
    ...Array.from(
      { length: Math.max(0, rejected - safeReasons.length) },
      () => "DOWNSTREAM_REJECTION" as const,
    ),
  ];
}

class PayloadLimitError extends Error {}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalPayloadDigest(payload: unknown): { digest: string; serializedBytes: number } {
  const chunks: string[] = [];
  let bytes = 0;
  const write = (value: string): void => {
    bytes += Buffer.byteLength(value, "utf8");
    if (bytes > MAX_PAYLOAD_SERIALIZED_BYTES) throw new PayloadLimitError();
    chunks.push(value);
  };
  const serialize = (value: unknown, depth: number): void => {
    if (depth > MAX_PAYLOAD_NESTING) throw new PayloadLimitError();
    if (value === null) {
      write("null");
      return;
    }
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > MAX_PAYLOAD_STRING_BYTES)
        throw new PayloadLimitError();
      write(JSON.stringify(value));
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new PayloadLimitError();
      write(JSON.stringify(value));
      return;
    }
    if (typeof value === "boolean") {
      write(value ? "true" : "false");
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_PAYLOAD_ARRAY_ITEMS) throw new PayloadLimitError();
      write("[");
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !("value" in descriptor)) throw new PayloadLimitError();
        if (index > 0) write(",");
        serialize(descriptor.value, depth + 1);
      }
      write("]");
      return;
    }
    if (typeof value !== "object" || !isPlainObject(value)) throw new PayloadLimitError();
    const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value));
    if (descriptors.some(([, descriptor]) => !("value" in descriptor)))
      throw new PayloadLimitError();
    const entries = descriptors
      .map(([key, descriptor]) => [key, descriptor.value] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    if (entries.length > MAX_PAYLOAD_OBJECT_PROPERTIES) throw new PayloadLimitError();
    write("{");
    entries.forEach(([key, item], index) => {
      if (index > 0) write(",");
      write(JSON.stringify(key));
      write(":");
      serialize(item, depth + 1);
    });
    write("}");
  };

  serialize(payload, 0);
  return {
    digest: createHash("sha256").update(chunks.join(""), "utf8").digest("base64url"),
    serializedBytes: bytes,
  };
}

function hasBoundedPayload(record: IntegrationRecordEnvelope): string | null {
  try {
    const textFields = [
      record.organizationId,
      record.source.id,
      record.externalRecordId,
      record.recordType,
      record.observedAt,
      record.fetchedAt,
    ];
    if (
      textFields.some(
        (value) =>
          value !== undefined && Buffer.byteLength(value, "utf8") > MAX_ENVELOPE_TEXT_BYTES,
      )
    ) {
      return null;
    }
    const payload = canonicalPayloadDigest(record.payload);
    const withNullPayload = JSON.stringify({
      schemaVersion: record.schemaVersion,
      organizationId: record.organizationId,
      source: record.source,
      externalRecordId: record.externalRecordId,
      recordType: record.recordType,
      ...(record.observedAt ? { observedAt: record.observedAt } : {}),
      fetchedAt: record.fetchedAt,
      payload: null,
    });
    const serializedBytes =
      Buffer.byteLength(withNullPayload, "utf8") -
      Buffer.byteLength("null", "utf8") +
      payload.serializedBytes;
    if (serializedBytes > MAX_RECORD_SERIALIZED_BYTES) return null;
    return payload.digest;
  } catch {
    return null;
  }
}

/**
 * Validates and forwards a bounded batch. It caches only a small idempotency
 * result fingerprint; provider records and payloads are never persisted here.
 */
export function createValidatedIngestionSink(
  dependencies: ValidatedIngestionSinkDependencies,
): IngestionSink {
  const maxEntries = dependencies.maxIdempotencyEntries ?? 256;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new IntegrationError("VALIDATION_ERROR", "Idempotency cache size is invalid.", false);
  }
  const cache = new Map<string, CachedResult>();
  const inFlight = new Map<string, InFlightResult>();

  return {
    async accept(input) {
      const parsedInput = sinkInputSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new IntegrationError("VALIDATION_ERROR", "The ingestion handoff is invalid.", false);
      }
      const parsed = parsedInput.data;
      const validRecords: IntegrationRecordEnvelope[] = [];
      const payloadDigests: string[] = [];
      const rejectionReasons: string[] = [];
      const seenExternalRecords = new Set<string>();

      const expectedSource = await dependencies.sourceResolver.resolve({
        organizationId: parsed.organizationId,
        ingestionRunId: parsed.ingestionRunId,
      });
      const parsedSource = sourceSchema.safeParse(expectedSource);
      if (!parsedSource.success) {
        return {
          accepted: 0,
          rejected: parsed.records.length,
          rejectionReasons: parsed.records.length ? ["SOURCE_NOT_FOUND"] : [],
        };
      }

      for (const record of parsed.records) {
        const candidate = integrationRecordEnvelopeSchema.safeParse(record);
        if (!candidate.success) {
          rejectionReasons.push("INVALID_ENVELOPE");
          continue;
        }
        if (candidate.data.organizationId !== parsed.organizationId) {
          rejectionReasons.push("ORGANIZATION_MISMATCH");
          continue;
        }
        if (
          candidate.data.source.kind !== parsedSource.data.kind ||
          candidate.data.source.id !== parsedSource.data.id
        ) {
          rejectionReasons.push("SOURCE_MISMATCH");
          continue;
        }
        const payloadDigest = hasBoundedPayload(candidate.data);
        if (!payloadDigest) {
          rejectionReasons.push("INVALID_PAYLOAD");
          continue;
        }
        const externalRecordKey = `${candidate.data.source.kind}:${candidate.data.source.id}:${candidate.data.externalRecordId}`;
        if (seenExternalRecords.has(externalRecordKey)) {
          rejectionReasons.push("DUPLICATE_EXTERNAL_RECORD");
          continue;
        }
        seenExternalRecords.add(externalRecordKey);
        validRecords.push(candidate.data);
        payloadDigests.push(payloadDigest);
      }

      const fingerprint = fingerprintRecords(validRecords, payloadDigests, rejectionReasons);
      const cacheKey = idempotencyCacheKey(parsed);
      const cached = cache.get(cacheKey);
      if (cached) {
        if (cached.fingerprint === fingerprint) return cached.result;
        return {
          accepted: 0,
          rejected: validRecords.length + rejectionReasons.length,
          rejectionReasons: ["IDEMPOTENCY_KEY_REUSED"],
        };
      }
      const pending = inFlight.get(cacheKey);
      if (pending) {
        if (pending.fingerprint === fingerprint) return pending.promise;
        return {
          accepted: 0,
          rejected: validRecords.length + rejectionReasons.length,
          rejectionReasons: ["IDEMPOTENCY_KEY_REUSED"],
        };
      }

      let resolveResult!: (value: {
        accepted: number;
        rejected: number;
        rejectionReasons: readonly string[];
      }) => void;
      let rejectResult!: (reason?: unknown) => void;
      const resultPromise = new Promise<{
        accepted: number;
        rejected: number;
        rejectionReasons: readonly string[];
      }>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      inFlight.set(cacheKey, { fingerprint, promise: resultPromise });

      void Promise.resolve()
        .then(async () => {
          let handoffResult = { accepted: 0, rejected: 0, rejectionReasons: [] as string[] };
          if (validRecords.length > 0) {
            const handoff = handoffResultSchema.safeParse(
              await dependencies.handoff.ingest({
                organizationId: parsed.organizationId,
                ingestionRunId: parsed.ingestionRunId,
                idempotencyKey: parsed.idempotencyKey,
                records: validRecords,
              }),
            );
            if (
              !handoff.success ||
              handoff.data.accepted + handoff.data.rejected !== validRecords.length
            ) {
              throw new IntegrationError(
                "VALIDATION_ERROR",
                "Data Ingestion returned an invalid handoff result.",
                false,
              );
            }
            handoffResult = {
              accepted: handoff.data.accepted,
              rejected: handoff.data.rejected,
              rejectionReasons: safeDownstreamReasons(
                handoff.data.rejectionReasons,
                handoff.data.rejected,
              ),
            };
          }

          return {
            accepted: handoffResult.accepted,
            rejected: rejectionReasons.length + handoffResult.rejected,
            rejectionReasons: [...rejectionReasons, ...handoffResult.rejectionReasons],
          };
        })
        .then(
          (result) => {
            cacheResult(cache, cacheKey, { fingerprint, result }, maxEntries);
            resolveResult(result);
          },
          (error: unknown) => rejectResult(error),
        )
        .finally(() => {
          if (inFlight.get(cacheKey)?.promise === resultPromise) inFlight.delete(cacheKey);
        });

      return resultPromise;
    },
  };
}
