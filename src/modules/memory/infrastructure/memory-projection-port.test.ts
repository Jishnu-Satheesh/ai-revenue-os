import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { IntegrationRecordEnvelope } from "@/domain/integrations/schemas";
import type { GoogleBusinessProfileProjectionWrite } from "@/modules/memory/application/ports";
import {
  createMemoryProjectionPort,
  type MemoryProjectionStore,
} from "@/modules/memory/infrastructure/memory-projection-port";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import { createGoogleBusinessProfileFixtureAdapter } from "@/modules/integrations/providers/google-business-profile/fixture-adapter";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const ingestionRunId = "33333333-3333-4333-8333-333333333333";
const connectionId = "44444444-4444-4444-8444-444444444444";
const observedAt = "2026-08-09T09:00:00.000Z";

function createStore() {
  const writes: GoogleBusinessProfileProjectionWrite[] = [];
  const store: MemoryProjectionStore = {
    async projectGoogleBusinessProfileRecord(input) {
      writes.push(input);
    },
  };
  return { store, writes };
}

function record(input: {
  organizationId?: string;
  recordType: "google_business_profile.location.v1" | "google_business_profile.review.v1";
  externalRecordId: string;
  data: Record<string, unknown>;
}): IntegrationRecordEnvelope {
  return {
    schemaVersion: 1,
    organizationId: input.organizationId ?? organizationId,
    source: { kind: "connection", id: connectionId },
    externalRecordId: input.externalRecordId,
    recordType: input.recordType,
    observedAt,
    fetchedAt: observedAt,
    payload: {
      fixture: true,
      correlationId: "55555555-5555-4555-8555-555555555555",
      data: input.data,
    },
  };
}

describe("createMemoryProjectionPort", () => {
  it("projects the fixture adapter's nested location and review data", async () => {
    const fixture = createStore();
    const adapter = createGoogleBusinessProfileFixtureAdapter({ now: () => new Date(observedAt) });
    const envelopes = await adapter.sync({
      organizationId,
      connectionId,
      ingestionRunId,
      idempotencyKey: "sync-fixture-0001",
      adapterVersion: googleBusinessProfileDefinition.adapterVersion,
      correlationId: "55555555-5555-4555-8555-555555555555",
    });
    const port = createMemoryProjectionPort({ store: fixture.store });

    await port.ingest({
      organizationId,
      ingestionRunId,
      idempotencyKey: "sync-fixture-0001",
      records: [
        {
          ...envelopes[0]!,
          payload: {
            fixture: true,
            correlationId: "55555555-5555-4555-8555-555555555555",
            data: { hours: "09:00-17:00", primaryCategory: "restaurant" },
          },
        },
        {
          ...envelopes[2]!,
          payload: {
            fixture: true,
            correlationId: "55555555-5555-4555-8555-855555555555",
            data: {
              reviewerDisplayName: "Ava Customer",
              comment: "Friendly staff and quick service.",
              rating: 5,
              sentiment: "positive",
            },
          },
        },
      ],
    });

    expect(fixture.writes).toHaveLength(2);
    expect(fixture.writes[0]).toMatchObject({
      ingestionRunId,
      locationFactValues: {
        "google_business_profile.location.hours": "09:00-17:00",
        "google_business_profile.location.primary_category": "restaurant",
      },
    });
    expect(fixture.writes[1]).toMatchObject({
      body: "Friendly staff and quick service.",
      structuredValue: { rating: 5, sentiment: "positive" },
      sensitivity: "customer_content",
      observedAt: envelopes[2]!.observedAt,
    });
    expect(JSON.stringify(fixture.writes[1])).not.toContain("Ava Customer");
  });

  it("rejects malformed supported data before the atomic projection can persist an episode", async () => {
    const fixture = createStore();
    const port = createMemoryProjectionPort({ store: fixture.store });

    await expect(
      port.ingest({
        organizationId,
        ingestionRunId,
        idempotencyKey: "sync-malformed-0001",
        records: [
          record({
            recordType: "google_business_profile.location.v1",
            externalRecordId: "locations/opaque-1",
            data: { hours: "09:00-17:00", phone: { arbitrary: "nested PII" } },
          }),
        ],
      }),
    ).resolves.toEqual({ accepted: 0, rejected: 1, rejectionReasons: ["INVALID_PAYLOAD"] });
    expect(fixture.writes).toEqual([]);
  });

  it("rejects an out-of-range review rating before persisting any provider content", async () => {
    const fixture = createStore();
    const port = createMemoryProjectionPort({ store: fixture.store });

    await expect(
      port.ingest({
        organizationId,
        ingestionRunId,
        idempotencyKey: "sync-invalid-rating-0001",
        records: [
          record({
            recordType: "google_business_profile.review.v1",
            externalRecordId: "reviews/opaque-1",
            data: { comment: "A review", rating: 6 },
          }),
        ],
      }),
    ).resolves.toEqual({ accepted: 0, rejected: 1, rejectionReasons: ["INVALID_PAYLOAD"] });
    expect(fixture.writes).toEqual([]);
  });

  it("keeps two tenants' colliding opaque source records and proposal keys separately scoped", async () => {
    const fixture = createStore();
    const port = createMemoryProjectionPort({ store: fixture.store });
    const records = [
      record({
        recordType: "google_business_profile.location.v1",
        externalRecordId: "locations/same-opaque-id",
        data: { hours: "09:00-17:00" },
      }),
      record({
        organizationId: otherOrganizationId,
        recordType: "google_business_profile.location.v1",
        externalRecordId: "locations/same-opaque-id",
        data: { hours: "10:00-18:00" },
      }),
    ];

    await port.ingest({
      organizationId,
      ingestionRunId,
      idempotencyKey: "sync-a",
      records: [records[0]!],
    });
    await port.ingest({
      organizationId: otherOrganizationId,
      ingestionRunId,
      idempotencyKey: "sync-b",
      records: [records[1]!],
    });

    expect(fixture.writes.map((write) => write.organizationId)).toEqual([
      organizationId,
      otherOrganizationId,
    ]);
    expect(fixture.writes.map((write) => write.sourceRecordId)).toEqual([
      "locations/same-opaque-id",
      "locations/same-opaque-id",
    ]);
  });

  it("returns accepted and rejected counts without silently acknowledging CSV", async () => {
    const fixture = createStore();
    const port = createMemoryProjectionPort({ store: fixture.store });

    await expect(
      port.ingest({
        organizationId,
        ingestionRunId,
        idempotencyKey: "sync-counts-0001",
        records: [
          record({
            recordType: "google_business_profile.location.v1",
            externalRecordId: "locations/opaque-1",
            data: { hours: "09:00-17:00" },
          }),
          record({
            recordType: "google_business_profile.review.v1",
            externalRecordId: "reviews/opaque-1",
            data: { rating: 5, sentiment: "positive" },
          }),
          {
            ...record({
              recordType: "google_business_profile.location.v1",
              externalRecordId: "csv/opaque-1",
              data: { hours: "09:00-17:00" },
            }),
            recordType: "csv_import.row",
          },
        ],
      }),
    ).resolves.toEqual({
      accepted: 2,
      rejected: 1,
      rejectionReasons: ["UNSUPPORTED_RECORD_TYPE"],
    });
  });
});
