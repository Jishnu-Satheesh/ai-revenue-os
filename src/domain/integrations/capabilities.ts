import type {
  CapabilityDerivationInput,
  CapabilityEvidence,
  CapabilityGrant,
  ProviderCapabilityDefinition,
  VerifiedContractActionProjection,
} from "@/domain/integrations/types";

type GrantState = Pick<CapabilityGrant, "availability" | "reasonCodes">;

function exactValues(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function pushUnique(reasonCodes: string[], reasonCode: string): void {
  if (!reasonCodes.includes(reasonCode)) reasonCodes.push(reasonCode);
}

function validateEvidenceFreshness(
  evidence: CapabilityEvidence["evidence"],
  now: Date,
  reasonCodes: string[],
): void {
  if (!evidence) {
    pushUnique(reasonCodes, "organization_evidence_missing");
    return;
  }
  const checkedAt = new Date(evidence.checkedAt);
  const validUntil = new Date(evidence.validUntil);
  const safeReference = /^[a-z][a-z0-9._:-]{2,199}$/i.test(evidence.reference);
  if (
    !safeReference ||
    !Number.isFinite(checkedAt.getTime()) ||
    !Number.isFinite(validUntil.getTime()) ||
    checkedAt > now ||
    validUntil <= checkedAt
  ) {
    pushUnique(reasonCodes, "organization_evidence_invalid");
    return;
  }
  if (validUntil <= now) pushUnique(reasonCodes, "organization_evidence_expired");
}

function collectPrerequisiteBlockers(
  capability: ProviderCapabilityDefinition,
  evidence: CapabilityEvidence | undefined,
  reasonCodes: string[],
): void {
  if (!evidence) {
    if (capability.prerequisites.length > 0) {
      pushUnique(reasonCodes, "capability_evidence_missing");
    }
    return;
  }
  for (const prerequisite of capability.prerequisites) {
    switch (prerequisite) {
      case "organization_entitled":
        if (evidence.organizationEntitlement !== "entitled") {
          pushUnique(reasonCodes, "organization_not_entitled");
        }
        break;
      case "account_eligible":
        if (evidence.accountEligibility !== "eligible") {
          pushUnique(reasonCodes, "account_ineligible");
        }
        break;
      case "account_mapped":
        if (evidence.accountMapping !== "mapped") pushUnique(reasonCodes, "account_unmapped");
        break;
      case "credential_current":
        if (evidence.credentialStatus === "missing" || evidence.credentialStatus === "not_required")
          pushUnique(reasonCodes, "credential_missing");
        if (evidence.credentialStatus === "expired") pushUnique(reasonCodes, "credential_expired");
        if (evidence.credentialStatus === "revoked") pushUnique(reasonCodes, "credential_revoked");
        break;
      case "controlled_account_evidence":
        if (evidence.controlledAccountEvidence !== "verified") {
          pushUnique(reasonCodes, "controlled_account_evidence_missing");
        }
        break;
      case "tracking_ready":
        if (evidence.tracking !== "ready") pushUnique(reasonCodes, "tracking_missing");
        break;
      case "linked_operator":
        if (evidence.linkedOperator === "revoked") {
          pushUnique(reasonCodes, "linked_operator_revoked");
        } else if (evidence.linkedOperator !== "verified") {
          pushUnique(reasonCodes, "linked_operator_missing");
        }
        break;
      case "webhook_configured":
        if (evidence.webhookConfiguration === "revoked") {
          pushUnique(reasonCodes, "webhook_configuration_revoked");
        } else if (evidence.webhookConfiguration !== "verified") {
          pushUnique(reasonCodes, "webhook_configuration_missing");
        }
        break;
    }
  }
}

function collectActionContractBlockers(
  capability: ProviderCapabilityDefinition,
  action: VerifiedContractActionProjection | undefined,
  evidence: CapabilityEvidence | undefined,
  reasonCodes: string[],
): void {
  if (!action) {
    pushUnique(reasonCodes, "contract_action_unverified");
    return;
  }
  if (
    action.effect !== capability.effect ||
    !exactValues(action.requiredScopes, capability.requiredScopes)
  ) {
    pushUnique(reasonCodes, "contract_action_mismatch");
  }
  if (!action.controlledAccountEvidenceVerified) {
    pushUnique(reasonCodes, "contract_controlled_evidence_unverified");
  }
  if (
    !evidence ||
    action.requiredPrerequisiteKeys.some(
      (key) => !evidence.verifiedProviderPrerequisiteKeys.includes(key),
    )
  ) {
    pushUnique(reasonCodes, "contract_prerequisite_unverified");
  }
  if (
    ["public_write", "money_moving"].includes(capability.effect) &&
    action.placementVerification !== "verified"
  ) {
    pushUnique(reasonCodes, "contract_placement_unverified");
  }
  if (
    ["public_write", "money_moving"].includes(capability.effect) &&
    action.reconciliationVerification !== "verified"
  ) {
    pushUnique(reasonCodes, "contract_reconciliation_unverified");
  }
}

function stateFor(
  input: CapabilityDerivationInput,
  capability: ProviderCapabilityDefinition,
): GrantState {
  if (input.connection.status === "disconnected" || input.connection.status === "revoked") {
    return {
      availability: "disabled",
      reasonCodes: [
        input.connection.status === "revoked" ? "connection_revoked" : "connection_disconnected",
      ],
    };
  }

  const reasonCodes: string[] = [];
  const evidence = input.capabilityEvidence[capability.key];
  const now = input.now ?? new Date();

  if (input.connection.status === "pending") pushUnique(reasonCodes, "connection_not_ready");
  if (input.connection.status === "degraded" && evidence?.capabilityHealth !== "usable") {
    pushUnique(reasonCodes, "capability_health_degraded");
  }
  if (evidence?.capabilityHealth === "unusable") {
    pushUnique(reasonCodes, "capability_health_unusable");
  }
  if (input.definition.rolloutState === "disabled") {
    pushUnique(reasonCodes, "provider_rollout_disabled");
  }
  if (!input.installedAdapterKinds.includes(capability.adapterKind)) {
    pushUnique(reasonCodes, "adapter_unavailable");
  }

  const contractIdentityMatches =
    input.providerContract.providerKey === input.definition.key &&
    input.providerContract.version === input.definition.contractVersion;
  if (!contractIdentityMatches) pushUnique(reasonCodes, "provider_contract_mismatch");

  if (input.providerContract.verification === "fixture") {
    if (input.definition.rolloutState !== "fixture") {
      pushUnique(reasonCodes, "provider_contract_invalid");
    }
  } else {
    if (input.definition.rolloutState === "fixture") {
      pushUnique(reasonCodes, "provider_contract_invalid");
    }
    const expiresAt =
      typeof input.providerContract.expiresAt === "string"
        ? new Date(input.providerContract.expiresAt)
        : null;
    if (!expiresAt || !Number.isFinite(expiresAt.getTime())) {
      pushUnique(reasonCodes, "provider_contract_invalid");
    } else if (expiresAt <= now) {
      pushUnique(reasonCodes, "provider_contract_expired");
    }

    validateEvidenceFreshness(evidence?.evidence ?? null, now, reasonCodes);
    if (capability.adapterKind === "webhook") {
      const webhook = input.providerContract.webhook;
      if (!webhook || webhook.capabilityKey !== capability.key) {
        pushUnique(reasonCodes, "contract_webhook_unverified");
      } else {
        if (!exactValues(capability.requiredWebhookEventKeys, webhook.eventKeys)) {
          pushUnique(reasonCodes, "contract_webhook_event_unverified");
        }
        if (webhook.signatureVerification !== "verified") {
          pushUnique(reasonCodes, "contract_webhook_signature_unverified");
        }
        if (webhook.replayProtection !== "verified") {
          pushUnique(reasonCodes, "contract_webhook_replay_unverified");
        }
      }
    } else {
      collectActionContractBlockers(
        capability,
        input.providerContract.actions.find(({ key }) => key === capability.key),
        evidence,
        reasonCodes,
      );
    }
  }

  collectPrerequisiteBlockers(capability, evidence, reasonCodes);
  if (!input.platformPolicy.permittedEffects.includes(capability.effect)) {
    pushUnique(reasonCodes, "platform_policy_denied");
  }
  if (capability.effect === "public_write" && input.platformPolicy.publicWriteMode === "disabled") {
    pushUnique(reasonCodes, "public_write_policy_denied");
  }
  if (capability.effect === "money_moving" && input.platformPolicy.spendMode === "disabled") {
    pushUnique(reasonCodes, "spend_policy_denied");
  }
  const grantedScopes = new Set(input.connection.grantedScopes);
  if (capability.requiredScopes.some((scope) => !grantedScopes.has(scope))) {
    pushUnique(reasonCodes, "required_scopes_missing");
  }

  return {
    availability: reasonCodes.length === 0 ? "available" : "blocked",
    reasonCodes,
  };
}

function effectiveMaturity(
  capability: ProviderCapabilityDefinition,
  input: CapabilityDerivationInput,
): ProviderCapabilityDefinition["maturity"] {
  if (capability.maturity !== "bounded-autonomous") return capability.maturity;
  if (
    (capability.effect === "public_write" &&
      input.platformPolicy.publicWriteMode === "approval_required") ||
    (capability.effect === "money_moving" && input.platformPolicy.spendMode === "approval_required")
  ) {
    return "governed-write";
  }
  return capability.maturity;
}

export function deriveCapabilityGrants(input: CapabilityDerivationInput): CapabilityGrant[] {
  const capabilityKeys =
    input.requestedCapabilities ?? input.definition.capabilities.map(({ key }) => key);
  const capabilities = new Map(
    input.definition.capabilities.map((capability) => [capability.key, capability]),
  );

  return capabilityKeys.map((capabilityKey) => {
    const capability = capabilities.get(capabilityKey);
    if (!capability) {
      return {
        capabilityKey,
        definition: null,
        availability: "blocked",
        reasonCodes: ["capability_unsupported"],
        restrictionCodes: [],
        derivedFromContractVersion: input.providerContract.version,
      };
    }
    return {
      capabilityKey,
      definition: {
        character: capability.character,
        effect: capability.effect,
        maturity: effectiveMaturity(capability, input),
        requiredScopes: [...capability.requiredScopes],
      },
      ...stateFor(input, capability),
      restrictionCodes: [...capability.restrictionCodes],
      derivedFromContractVersion: input.providerContract.version,
    };
  });
}

const recoveryActionsByCode: Readonly<Record<string, string>> = {
  adapter_unavailable: "Install and verify the matching provider adapter.",
  provider_contract_mismatch: "Reverify the checked provider contract before enabling this action.",
  provider_contract_invalid: "Install a valid checked provider contract.",
  provider_contract_expired: "Reverify the provider contract against current official sources.",
  contract_action_unverified: "Verify the exact action in the checked provider contract.",
  contract_action_mismatch: "Align the action effect and exact scopes with the checked contract.",
  contract_controlled_evidence_unverified: "Verify controlled-account contract evidence.",
  contract_prerequisite_unverified: "Verify every action-specific provider prerequisite.",
  contract_placement_unverified: "Verify the exact provider placement and its limits.",
  contract_reconciliation_unverified: "Verify an unknown-outcome reconciliation lookup.",
  contract_webhook_unverified: "Verify the webhook contract for this exact capability.",
  contract_webhook_event_unverified: "Allowlist every exact webhook event in the contract.",
  contract_webhook_signature_unverified: "Verify the webhook signature contract.",
  contract_webhook_replay_unverified: "Verify webhook replay protection.",
  organization_evidence_missing: "Verify current organization evidence for this capability.",
  organization_evidence_invalid:
    "Replace malformed organization evidence with a current safe reference.",
  organization_evidence_expired: "Recheck organization evidence for this capability.",
  organization_not_entitled: "Enable this capability for the organization before using it.",
  capability_evidence_missing:
    "Verify current evidence for every declared capability prerequisite.",
  controlled_account_evidence_missing: "Capture controlled-account evidence for this action.",
  account_ineligible: "Use an eligible provider account and verify its prerequisites.",
  platform_policy_denied: "Ask an organization owner to review the integration policy.",
  public_write_policy_denied: "Enable governed public writes in organization policy.",
  spend_policy_denied: "Enable governed spend in organization policy with an approved ceiling.",
  account_unmapped: "Map the provider resource to an organization branch.",
  credential_missing: "Connect a current provider credential.",
  credential_expired: "Reconnect the provider credential.",
  credential_revoked: "Reconnect the provider credential.",
  tracking_missing: "Verify tracking for this advertising capability.",
  linked_operator_missing: "Link and verify an operator for this review capability.",
  linked_operator_revoked: "Relink the operator for this review capability.",
  webhook_configuration_missing: "Configure and verify this organization webhook.",
  webhook_configuration_revoked: "Reconnect the organization webhook.",
  required_scopes_missing: "Reconnect with every exact required scope.",
  connection_not_ready: "Finish connection setup before using this capability.",
  capability_health_degraded: "Verify current capability health before using this action.",
  capability_health_unusable: "Restore capability health before using this capability.",
  connection_disconnected: "Reconnect the integration before using this capability.",
  connection_revoked: "Reconnect the integration before using this capability.",
  provider_rollout_disabled: "Wait for the provider rollout gate to enable this capability.",
  capability_unsupported: "Choose a capability declared by the provider contract.",
};

export function capabilityRecoveryActions(reasonCodes: readonly string[]): string[] {
  return reasonCodes.map(
    (code) =>
      recoveryActionsByCode[code] ??
      "Review the provider restriction and complete its documented prerequisite.",
  );
}
