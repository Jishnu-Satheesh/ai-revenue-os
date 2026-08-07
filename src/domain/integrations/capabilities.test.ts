import { describe, expect, it } from "vitest";

import { deriveCapabilityGrants } from "@/domain/integrations/capabilities";

const definition = {
  key: "google_business_profile",
  displayName: "Google Business Profile",
  adapterVersion: "v1",
  rolloutState: "fixture" as const,
  supportedCapabilities: ["read_google_business_profile", "read_reviews"],
  requiredScopes: ["business.manage"],
  syncIntervalMinutes: 30,
  staleAfterMinutes: 65,
  supportsWebhooks: false,
  supportsWrites: false,
};

const baseInput = {
  definition,
  connection: {
    status: "active" as const,
    grantedScopes: ["business.manage"],
  },
  accountMapping: { status: "mapped" as const },
  platformPolicy: { allowsIntegrationReads: true },
};

describe("deriveCapabilityGrants", () => {
  it("blocks capabilities when required scopes are missing", () => {
    const [grant] = deriveCapabilityGrants({
      ...baseInput,
      connection: { status: "active", grantedScopes: [] },
    });

    expect(grant).toMatchObject({
      availability: "blocked",
      reasonCodes: ["required_scopes_missing"],
    });
  });

  it("blocks unsupported requested capabilities", () => {
    const [grant] = deriveCapabilityGrants({
      ...baseInput,
      requestedCapabilities: ["write_google_business_profile"],
    });

    expect(grant).toMatchObject({
      capabilityKey: "write_google_business_profile",
      availability: "blocked",
      reasonCodes: ["capability_unsupported"],
    });
  });

  it("blocks capabilities denied by platform policy", () => {
    const [grant] = deriveCapabilityGrants({
      ...baseInput,
      platformPolicy: { allowsIntegrationReads: false },
    });

    expect(grant).toMatchObject({
      availability: "blocked",
      reasonCodes: ["platform_policy_denied"],
    });
  });

  it("blocks branch-scoped capabilities when the account is unmapped", () => {
    const [grant] = deriveCapabilityGrants({
      ...baseInput,
      accountMapping: { status: "unmapped" },
    });

    expect(grant).toMatchObject({ availability: "blocked", reasonCodes: ["account_unmapped"] });
  });

  it("disables every grant for a disconnected connection", () => {
    const grants = deriveCapabilityGrants({
      ...baseInput,
      connection: { status: "disconnected", grantedScopes: ["business.manage"] },
    });

    expect(grants).toEqual([
      expect.objectContaining({
        availability: "disabled",
        reasonCodes: ["connection_disconnected"],
      }),
      expect.objectContaining({
        availability: "disabled",
        reasonCodes: ["connection_disconnected"],
      }),
    ]);
  });

  it("disables every grant for a revoked connection", () => {
    const grants = deriveCapabilityGrants({
      ...baseInput,
      connection: { status: "revoked", grantedScopes: ["business.manage"] },
    });

    expect(grants).toEqual([
      expect.objectContaining({ availability: "disabled", reasonCodes: ["connection_revoked"] }),
      expect.objectContaining({ availability: "disabled", reasonCodes: ["connection_revoked"] }),
    ]);
  });
});
