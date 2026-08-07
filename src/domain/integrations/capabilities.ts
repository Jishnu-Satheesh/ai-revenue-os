import type { CapabilityDerivationInput, CapabilityGrant } from "@/domain/integrations/types";

const disabledStatuses = new Set(["disconnected", "revoked"]);

export function deriveCapabilityGrants(input: CapabilityDerivationInput): CapabilityGrant[] {
  const capabilityKeys = input.requestedCapabilities ?? input.definition.supportedCapabilities;

  return capabilityKeys.map((capabilityKey) => {
    if (disabledStatuses.has(input.connection.status)) {
      return {
        capabilityKey,
        maturity: "read-only",
        availability: "disabled",
        reasonCodes: [
          input.connection.status === "revoked" ? "connection_revoked" : "connection_disconnected",
        ],
      };
    }
    if (!input.definition.supportedCapabilities.includes(capabilityKey)) {
      return {
        capabilityKey,
        maturity: "read-only",
        availability: "blocked",
        reasonCodes: ["capability_unsupported"],
      };
    }
    if (!input.platformPolicy.allowsIntegrationReads) {
      return {
        capabilityKey,
        maturity: "read-only",
        availability: "blocked",
        reasonCodes: ["platform_policy_denied"],
      };
    }
    if (input.accountMapping.status !== "mapped") {
      return {
        capabilityKey,
        maturity: "read-only",
        availability: "blocked",
        reasonCodes: ["account_unmapped"],
      };
    }
    const grantedScopes = new Set(input.connection.grantedScopes);
    if (input.definition.requiredScopes.some((scope) => !grantedScopes.has(scope))) {
      return {
        capabilityKey,
        maturity: "read-only",
        availability: "blocked",
        reasonCodes: ["required_scopes_missing"],
      };
    }
    return { capabilityKey, maturity: "read-only", availability: "available", reasonCodes: [] };
  });
}
