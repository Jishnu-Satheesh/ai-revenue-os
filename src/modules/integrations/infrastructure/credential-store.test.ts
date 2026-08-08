import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFixtureCredentialStore } from "@/modules/integrations/infrastructure/fixture-credential-store";

describe("FixtureCredentialStore", () => {
  it("issues an opaque non-serializable handle without retaining a secret", async () => {
    const store = createFixtureCredentialStore();
    const handle = await store.create({
      organizationId: "organization-a",
      providerKey: "google_business_profile",
      secret: "not-a-real-token",
    });

    expect(handle.reference).toMatch(/^fixture:/);
    expect(() => JSON.stringify(handle)).toThrow("must not be serialized");
    await expect(
      store.resolve({
        organizationId: "organization-a",
        providerKey: "google_business_profile",
        handle,
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
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      store.create({ organizationId: "organization-a", providerKey: "", secret: "ignored" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not implement real credential replacement or revocation", async () => {
    const store = createFixtureCredentialStore();
    const handle = await store.create({
      organizationId: "organization-a",
      providerKey: "google_business_profile",
      secret: "ignored",
    });

    await expect(
      store.replace({
        organizationId: "organization-a",
        providerKey: "google_business_profile",
        secret: "ignored",
        handle,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_NOT_AVAILABLE" });
    await expect(
      store.revoke({
        organizationId: "organization-a",
        providerKey: "google_business_profile",
        handle,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_NOT_AVAILABLE" });
  });
});
