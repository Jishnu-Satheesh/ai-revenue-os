import { describe, expect, it } from "vitest";

import { hasUsableIntegrationGrant } from "@/domain/integrations/permissions";

describe("hasUsableIntegrationGrant", () => {
  it("never lets cached availability override pending or inactive connection state", () => {
    expect(
      hasUsableIntegrationGrant({ availability: "available", connectionStatus: "active" }),
    ).toBe(true);
    for (const connectionStatus of ["pending", "disconnected", "revoked"] as const) {
      expect(hasUsableIntegrationGrant({ availability: "available", connectionStatus })).toBe(
        false,
      );
    }
  });

  it("never treats blocked or disabled grants as usable", () => {
    expect(hasUsableIntegrationGrant({ availability: "blocked", connectionStatus: "active" })).toBe(
      false,
    );
    expect(
      hasUsableIntegrationGrant({ availability: "disabled", connectionStatus: "active" }),
    ).toBe(false);
  });
});
