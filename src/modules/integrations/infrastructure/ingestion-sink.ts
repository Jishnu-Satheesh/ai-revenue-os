import "server-only";

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

function fingerprintRecords(records: readonly IntegrationRecordEnvelope[]): string {
  return records
    .map((record) =>
      [
        record.schemaVersion,
        record.organizationId,
        record.source.kind,
        record.source.id,
        record.externalRecordId,
        record.recordType,
        record.observedAt ?? "",
        record.fetchedAt,
      ].join("|"),
    )
    .join("\n");
}

function idempotencyCacheKey(input: {
  organizationId: string;
  ingestionRunId: string;
  idempotencyKey: string;
}): string {
  return `${input.organizationId}:${input.ingestionRunId}:${input.idempotencyKey}`;
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

function safeDownstreamReasons(reasons: readonly string[]): string[] {
  return reasons.map((reason) =>
    safeDownstreamReasonSchema.safeParse(reason).success ? reason : "DOWNSTREAM_REJECTION",
  );
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

  return {
    async accept(input) {
      const parsedInput = sinkInputSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new IntegrationError("VALIDATION_ERROR", "The ingestion handoff is invalid.", false);
      }
      const parsed = parsedInput.data;
      const validRecords: IntegrationRecordEnvelope[] = [];
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
        const externalRecordKey = `${candidate.data.source.kind}:${candidate.data.source.id}:${candidate.data.externalRecordId}`;
        if (seenExternalRecords.has(externalRecordKey)) {
          rejectionReasons.push("DUPLICATE_EXTERNAL_RECORD");
          continue;
        }
        seenExternalRecords.add(externalRecordKey);
        validRecords.push(candidate.data);
      }

      const fingerprint = fingerprintRecords(validRecords);
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
          handoff.data.accepted + handoff.data.rejected > validRecords.length
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
          rejectionReasons: safeDownstreamReasons(handoff.data.rejectionReasons),
        };
      }

      const result = {
        accepted: handoffResult.accepted,
        rejected: rejectionReasons.length + handoffResult.rejected,
        rejectionReasons: [...rejectionReasons, ...handoffResult.rejectionReasons],
      };
      cacheResult(cache, cacheKey, { fingerprint, result }, maxEntries);
      return result;
    },
  };
}
