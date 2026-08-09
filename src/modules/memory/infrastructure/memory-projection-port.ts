import "server-only";

import { z } from "zod";

import type { IntegrationRecordEnvelope } from "@/domain/integrations/schemas";
import type { DataIngestionPort } from "@/modules/integrations/infrastructure/ingestion-sink";
import type { GoogleBusinessProfileProjectionWrite } from "@/modules/memory/application/ports";

const GOOGLE_BUSINESS_PROFILE_SOURCE_SYSTEM = "google_business_profile" as const;
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const locationDataSchema = z
  .object({
    hours: boundedText(500).optional(),
    primaryCategory: boundedText(160).optional(),
    address: boundedText(500).optional(),
    phone: boundedText(40).optional(),
  })
  .refine(
    (value) =>
      value.hours !== undefined ||
      value.primaryCategory !== undefined ||
      value.address !== undefined ||
      value.phone !== undefined,
    "A location record needs at least one tracked field.",
  );
const reviewDataSchema = z
  .object({
    comment: boundedText(8_000).optional(),
    commentText: boundedText(8_000).optional(),
    reviewText: boundedText(8_000).optional(),
    text: boundedText(8_000).optional(),
    rating: z.number().int().min(1).max(5).optional(),
    sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  })
  .refine(
    (value) =>
      value.comment !== undefined ||
      value.commentText !== undefined ||
      value.reviewText !== undefined ||
      value.text !== undefined ||
      value.rating !== undefined ||
      value.sentiment !== undefined,
    "A review record needs content, rating, or sentiment.",
  );

const fixturePayload = <T extends z.ZodType>(data: T) =>
  z
    .object({
      fixture: z.literal(true),
      correlationId: z.string().uuid(),
      data,
    })
    .strict();

const locationPayloadSchema = fixturePayload(locationDataSchema);
const reviewPayloadSchema = fixturePayload(reviewDataSchema);

const trackedLocationFacts = [
  ["hours", "google_business_profile.location.hours"],
  ["primaryCategory", "google_business_profile.location.primary_category"],
  ["address", "google_business_profile.location.address"],
  ["phone", "google_business_profile.location.phone"],
] as const;

export type MemoryProjectionStore = {
  projectGoogleBusinessProfileRecord(input: GoogleBusinessProfileProjectionWrite): Promise<void>;
};

export type MemoryProjectionDependencies = { store: MemoryProjectionStore };

function reviewBody(payload: z.infer<typeof reviewDataSchema>): string | null {
  return payload.comment ?? payload.commentText ?? payload.reviewText ?? payload.text ?? null;
}

function reviewDetails(payload: z.infer<typeof reviewDataSchema>): Record<string, unknown> | null {
  const details: Record<string, unknown> = {};
  if (payload.rating !== undefined) details.rating = payload.rating;
  if (payload.sentiment !== undefined) details.sentiment = payload.sentiment;
  return Object.keys(details).length > 0 ? details : null;
}

function baseProjection(record: IntegrationRecordEnvelope): Omit<GoogleBusinessProfileProjectionWrite, "title" | "body" | "structuredValue" | "sensitivity" | "locationFactValues"> {
  return {
    organizationId: record.organizationId,
    ingestionRunId: "",
    sourceConnectionId: record.source.id,
    sourceSystem: GOOGLE_BUSINESS_PROFILE_SOURCE_SYSTEM,
    sourceRecordId: record.externalRecordId,
    observedAt: record.observedAt ?? record.fetchedAt,
  };
}

export function createMemoryProjectionPort(
  dependencies: MemoryProjectionDependencies,
): DataIngestionPort {
  return {
    async ingest(input) {
      let accepted = 0;
      const rejectionReasons: string[] = [];

      for (const record of input.records) {
        if (record.recordType === "google_business_profile.location.v1") {
          const parsed = locationPayloadSchema.safeParse(record.payload);
          if (!parsed.success) {
            rejectionReasons.push("INVALID_PAYLOAD");
            continue;
          }
          const locationFactValues = Object.fromEntries(
            trackedLocationFacts
              .filter(([payloadKey]) => parsed.data.data[payloadKey] !== undefined)
              .map(([payloadKey, factKey]) => [factKey, parsed.data.data[payloadKey]]),
          );
          await dependencies.store.projectGoogleBusinessProfileRecord({
            ...baseProjection(record),
            ingestionRunId: input.ingestionRunId,
            title: "Google Business Profile location observed",
            body: null,
            structuredValue: { observedFields: Object.keys(locationFactValues) },
            sensitivity: "internal",
            locationFactValues,
          });
          accepted += 1;
          continue;
        }

        if (record.recordType === "google_business_profile.review.v1") {
          const parsed = reviewPayloadSchema.safeParse(record.payload);
          if (!parsed.success) {
            rejectionReasons.push("INVALID_PAYLOAD");
            continue;
          }
          await dependencies.store.projectGoogleBusinessProfileRecord({
            ...baseProjection(record),
            ingestionRunId: input.ingestionRunId,
            title: "Google Business Profile review observed",
            body: reviewBody(parsed.data.data),
            structuredValue: reviewDetails(parsed.data.data),
            sensitivity: "customer_content",
            locationFactValues: {},
          });
          accepted += 1;
          continue;
        }

        rejectionReasons.push("UNSUPPORTED_RECORD_TYPE");
      }

      return { accepted, rejected: rejectionReasons.length, rejectionReasons };
    },
  };
}
