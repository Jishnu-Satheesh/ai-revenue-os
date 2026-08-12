import { describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  capabilityEffectSchema,
  connectionStatusSchema,
  connectionMaturitySchema,
  ingestionRunSourceSchema,
  integrationCharacterSchema,
  integrationRecordEnvelopeSchema,
  providerCapabilityDefinitionSchema,
  providerDefinitionSchema,
  v1AvailableMaturitySchema,
} from "@/domain/integrations/schemas";
import { normalizeProviderError } from "@/domain/integrations/errors";

describe("integration schemas", () => {
  it("parses every approved connection maturity", () => {
    expect(connectionMaturitySchema.options).toEqual([
      "manual",
      "imported",
      "read-only",
      "draft-write",
      "governed-write",
      "bounded-autonomous",
    ]);
  });

  it("limits V1 availability to manual, imported, and read-only maturities", () => {
    expect(v1AvailableMaturitySchema.safeParse("read-only").success).toBe(true);
    expect(v1AvailableMaturitySchema.safeParse("governed-write").success).toBe(false);
  });

  it("parses every approved connection status", () => {
    expect(connectionStatusSchema.options).toEqual([
      "pending",
      "active",
      "degraded",
      "disconnected",
      "revoked",
    ]);
  });

  it("parses the stable integration characters and capability effects", () => {
    expect(integrationCharacterSchema.options).toEqual([
      "data_source",
      "publishing_destination",
      "advertising_account",
      "operator_review",
    ]);
    expect(capabilityEffectSchema.options).toEqual([
      "read",
      "public_write",
      "money_moving",
      "operator_control",
    ]);
  });

  it("parses a complete typed action-capability definition", () => {
    const capability = {
      key: "publish_post",
      character: "publishing_destination",
      direction: "outbound",
      effect: "public_write",
      maturity: "governed-write",
      requiredScopes: ["content.publish"],
      restrictionCodes: ["feed_image_only"],
      adapterKind: "publish",
      prerequisites: [
        "organization_entitled",
        "account_eligible",
        "account_mapped",
        "credential_current",
        "controlled_account_evidence",
      ],
      requiredWebhookEventKeys: [],
    };

    expect(providerCapabilityDefinitionSchema.safeParse(capability).success).toBe(true);
    expect(
      providerDefinitionSchema.safeParse({
        key: "test_provider",
        displayName: "Test provider",
        adapterVersion: "v1",
        contractVersion: "contract-v1",
        rolloutState: "available",
        characters: ["data_source"],
        capabilities: [capability],
        syncIntervalMinutes: 30,
        staleAfterMinutes: 65,
      }).success,
    ).toBe(false);

    expect(
      providerDefinitionSchema.safeParse({
        key: "test_provider",
        displayName: "Test provider",
        adapterVersion: "v1",
        contractVersion: "contract-v1",
        rolloutState: "available",
        characters: ["publishing_destination"],
        capabilities: [capability],
        syncIntervalMinutes: 30,
        staleAfterMinutes: 65,
      }).success,
    ).toBe(true);
  });

  it("rejects a provider character that has no declared capability", () => {
    expect(
      providerDefinitionSchema.safeParse({
        key: "test_provider",
        displayName: "Test provider",
        adapterVersion: "v1",
        contractVersion: "contract-v1",
        rolloutState: "fixture",
        characters: ["data_source", "advertising_account"],
        capabilities: [
          {
            key: "read_profile",
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
      }).success,
    ).toBe(false);
  });

  it.each([
    ["read", ["organization_entitled", "account_mapped"]],
    [
      "publish",
      ["organization_entitled", "account_eligible", "account_mapped", "credential_current"],
    ],
    [
      "advertise",
      [
        "organization_entitled",
        "account_eligible",
        "account_mapped",
        "credential_current",
        "controlled_account_evidence",
      ],
    ],
    ["webhook", ["organization_entitled", "account_mapped", "credential_current"]],
    ["operator_review", []],
  ] as const)(
    "rejects a live %s capability missing mandatory prerequisites",
    (adapterKind, prerequisites) => {
      const shape = {
        read: {
          character: "data_source",
          direction: "inbound",
          effect: "read",
          maturity: "read-only",
          requiredWebhookEventKeys: [],
        },
        publish: {
          character: "publishing_destination",
          direction: "outbound",
          effect: "public_write",
          maturity: "governed-write",
          requiredWebhookEventKeys: [],
        },
        advertise: {
          character: "advertising_account",
          direction: "outbound",
          effect: "money_moving",
          maturity: "governed-write",
          requiredWebhookEventKeys: [],
        },
        webhook: {
          character: "data_source",
          direction: "inbound",
          effect: "read",
          maturity: "read-only",
          requiredWebhookEventKeys: ["status.changed"],
        },
        operator_review: {
          character: "operator_review",
          direction: "inbound",
          effect: "operator_control",
          maturity: "governed-write",
          requiredWebhookEventKeys: [],
        },
      }[adapterKind];

      expect(
        providerDefinitionSchema.safeParse({
          key: "test_provider",
          displayName: "Test provider",
          adapterVersion: "v1",
          contractVersion: "contract-v1",
          rolloutState: "available",
          characters: [shape.character],
          capabilities: [
            {
              key: `${adapterKind}_action`,
              ...shape,
              requiredScopes: ["provider.scope"],
              restrictionCodes: [],
              adapterKind,
              prerequisites,
            },
          ],
          syncIntervalMinutes: 30,
          staleAfterMinutes: 65,
        }).success,
      ).toBe(false);
    },
  );

  it("rejects malformed integration record envelopes", () => {
    expect(
      integrationRecordEnvelopeSchema.safeParse({
        schemaVersion: 1,
        organizationId: "organization-1",
        source: { kind: "connection", id: "connection-1" },
        externalRecordId: "listing-1",
        recordType: "business_profile",
        fetchedAt: "not-a-timestamp",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("requires exactly one ingestion-run source identifier", () => {
    expect(ingestionRunSourceSchema.safeParse({ connectionId: "connection-1" }).success).toBe(true);
    expect(ingestionRunSourceSchema.safeParse({ dataSourceId: "source-1" }).success).toBe(true);
    expect(ingestionRunSourceSchema.safeParse({}).success).toBe(false);
    expect(
      ingestionRunSourceSchema.safeParse({ connectionId: "connection-1", dataSourceId: "source-1" })
        .success,
    ).toBe(false);
  });

  it("omits internal causes and credential-shaped metadata from public provider errors", () => {
    const internalCause = new Error("token=private-value");
    const error = normalizeProviderError({
      code: "RATE_LIMITED",
      message: "Retry later.",
      metadata: { retryAfterSeconds: 60, authorization: "private-value" },
      cause: internalCause,
    });

    expect(error.internalCause).toEqual({
      providerMessage: "Retry later.",
      cause: internalCause,
    });
    expect(error.toJSON()).toEqual({
      code: "RATE_LIMITED",
      message: "The provider rate limit was reached. Retry later.",
      retryable: true,
      metadata: { retryAfterSeconds: 60 },
    });
  });

  it("uses fixed safe copy instead of hostile provider error text", () => {
    const hostileMessage = "token=private-value authorization=https://provider.example/private";
    const error = normalizeProviderError({
      code: "AUTHENTICATION_FAILED",
      message: hostileMessage,
    });

    expect(error.toJSON().message).toBe(
      "Authentication with the provider failed. Reconnect to continue.",
    );
    expect(JSON.stringify(error)).not.toContain(hostileMessage);
    expect(error.internalCause).toEqual({ providerMessage: hostileMessage, cause: undefined });
  });
});
