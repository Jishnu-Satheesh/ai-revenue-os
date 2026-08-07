import { describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  connectionStatusSchema,
  connectionMaturitySchema,
  ingestionRunSourceSchema,
  integrationRecordEnvelopeSchema,
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
