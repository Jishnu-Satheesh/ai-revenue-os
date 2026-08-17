import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFixtureCredentialStore } from "@/modules/integrations/infrastructure/fixture-credential-store";

// Correlation and idempotency are part of every credential operation, so the
// fixture store is exercised with the same context a production caller sends.
const context = { correlationId: "88888888-8888-4888-8888-888888888888" };
const writeContext = { ...context, idempotencyKey: "fixture-connect-1" };

describe("FixtureCredentialStore", () => {
  it("issues an opaque non-serializable handle without retaining a secret", async () => {
    const store = createFixtureCredentialStore();
    const handle = await store.create({
      organizationId: "organization-a",
      providerKey: "google_business_profile",
      secret: "not-a-real-token",
      ...writeContext,
    });

    expect(handle.reference).toMatch(/^fixture:/);
    expect(() => JSON.stringify(handle)).toThrow("must not be serialized");
    await expect(
      store.resolve({
        organizationId: "organization-a",
        providerKey: "google_business_profile",
        handle,
        ...context,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_NOT_AVAILABLE" });
  });

  it("requires both organization and provider context for every operation", async () => {
    const store = createFixtureCredentialStore();

    await expect(
      store.create({
        organizationId: "",
        providerKey: "google_business_profile",
        secret: "ignored",
        ...writeContext,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      store.create({
        organizationId: "organization-a",
        providerKey: "",
        secret: "ignored",
        ...writeContext,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not implement real credential replacement or revocation", async () => {
    const store = createFixtureCredentialStore();
    const handle = await store.create({
      organizationId: "organization-a",
      providerKey: "google_business_profile",
      secret: "ignored",
      ...writeContext,
    });

    await expect(
      store.replace({
        organizationId: "organization-a",
        providerKey: "google_business_profile",
        secret: "ignored",
        handle,
        ...writeContext,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_NOT_AVAILABLE" });
    await expect(
      store.revoke({
        organizationId: "organization-a",
        providerKey: "google_business_profile",
        handle,
        ...context,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_NOT_AVAILABLE" });
  });
});
