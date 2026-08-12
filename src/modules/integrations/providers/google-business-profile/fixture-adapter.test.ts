import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import {
  createGoogleBusinessProfileFixtureAdapter,
  type GoogleBusinessProfileFixtureScenario,
} from "@/modules/integrations/providers/google-business-profile/fixture-adapter";

const context = {
  organizationId: "organization-a",
  connectionId: "connection-a",
  adapterVersion: "1",
  correlationId: "correlation-a",
};

const syncContext = {
  ...context,
  ingestionRunId: "run-a",
  idempotencyKey: "sync-a",
};

describe("Google Business Profile fixture adapter", () => {
  it("defines the approved read-only fixture provider", () => {
    expect(googleBusinessProfileDefinition).toEqual({
      key: "google_business_profile",
      displayName: "Google Business Profile",
      adapterVersion: "1",
      contractVersion: "fixture-v1",
      rolloutState: "fixture",
      characters: ["data_source"],
      capabilities: [
        {
          key: "read_google_business_profile",
          character: "data_source",
          direction: "inbound",
          effect: "read",
          maturity: "read-only",
          requiredScopes: [],
          restrictionCodes: [],
          adapterKind: "read",
          prerequisites: ["account_mapped"],
          requiredWebhookEventKeys: [],
        },
        {
          key: "read_reviews",
          character: "data_source",
          direction: "inbound",
          effect: "read",
          maturity: "read-only",
          requiredScopes: [],
          restrictionCodes: [],
          adapterKind: "read",
          prerequisites: ["account_mapped"],
          requiredWebhookEventKeys: [],
        },
      ],
      syncIntervalMinutes: 30,
      staleAfterMinutes: 65,
      operatorCopy: "Fixture mode — Google API access pending.",
    });
    expect(createGoogleBusinessProfileFixtureAdapter()).toMatchObject({
      adapterKind: "read",
      supportedCapabilityKeys: ["read_google_business_profile", "read_reviews"],
    });
  });

  it("returns multiple stable external locations and deterministic records", async () => {
    const adapter = createGoogleBusinessProfileFixtureAdapter({
      now: () => new Date("2026-08-08T10:00:00.000Z"),
    });

    const firstLocations = await adapter.listExternalResources(context);
    const secondLocations = await adapter.listExternalResources(context);
    const firstRecords = await adapter.sync(syncContext);
    const secondRecords = await adapter.sync(syncContext);

    expect(firstLocations).toHaveLength(2);
    expect(firstLocations).toEqual(secondLocations);
    expect(firstLocations.map((location) => location.id)).toEqual([
      "locations/fixture-harbor-house",
      "locations/fixture-river-market",
    ]);
    expect(firstRecords).toEqual(secondRecords);
    expect(firstRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: context.organizationId,
          source: { kind: "connection", id: context.connectionId },
          fetchedAt: "2026-08-08T10:00:00.000Z",
          payload: expect.objectContaining({ correlationId: context.correlationId }),
        }),
      ]),
    );
    expect(firstRecords.map((record) => record.externalRecordId)).toEqual([
      "locations/fixture-harbor-house",
      "locations/fixture-river-market",
      "reviews/fixture-harbor-house-001",
      "reviews/fixture-river-market-001",
    ]);
  });

  it.each<[GoogleBusinessProfileFixtureScenario, string, boolean]>([
    ["authentication_failed", "AUTHENTICATION_FAILED", false],
    ["missing_scope", "AUTHORIZATION_SCOPE_MISSING", false],
    ["rate_limited", "RATE_LIMITED", true],
    ["unavailable", "PROVIDER_UNAVAILABLE", true],
    ["malformed_response", "INVALID_PROVIDER_RESPONSE", false],
    ["missing_resource", "RESOURCE_NOT_FOUND", false],
  ])("normalizes the injected %s scenario", async (scenario, code, retryable) => {
    const adapter = createGoogleBusinessProfileFixtureAdapter({ scenario });

    await expect(adapter.testConnection(context)).rejects.toMatchObject({ code, retryable });
  });

  it("returns a deterministic valid subset for partial ingestion", async () => {
    const adapter = createGoogleBusinessProfileFixtureAdapter({
      scenario: "partial_ingestion",
      now: () => new Date("2026-08-08T10:00:00.000Z"),
    });

    const records = await adapter.sync(syncContext);

    expect(records.map((record) => record.externalRecordId)).toEqual([
      "locations/fixture-harbor-house",
      "reviews/fixture-harbor-house-001",
    ]);
    expect(records.every((record) => record.organizationId === context.organizationId)).toBe(true);
  });

  it("rejects a mismatched adapter version before returning fixture data", async () => {
    const adapter = createGoogleBusinessProfileFixtureAdapter();

    await expect(
      adapter.listExternalResources({ ...context, adapterVersion: "2" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
