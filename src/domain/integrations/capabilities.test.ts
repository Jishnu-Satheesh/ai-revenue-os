import { describe, expect, it } from "vitest";

import {
  capabilityRecoveryActions,
  deriveCapabilityGrants,
} from "@/domain/integrations/capabilities";
import type {
  CapabilityDerivationInput,
  ProviderContractProjection,
  ProviderCapabilityDefinition,
  ProviderDefinition,
} from "@/domain/integrations/types";

const capabilities = [
  {
    key: "read_insights",
    character: "data_source",
    direction: "inbound",
    effect: "read",
    maturity: "read-only",
    requiredScopes: ["insights.read"],
    restrictionCodes: [],
    adapterKind: "read",
    prerequisites: ["organization_entitled", "account_mapped", "credential_current"],
    requiredWebhookEventKeys: [],
  },
  {
    key: "publish_post",
    character: "publishing_destination",
    direction: "outbound",
    effect: "public_write",
    maturity: "bounded-autonomous",
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
  },
  {
    key: "start_ad",
    character: "advertising_account",
    direction: "outbound",
    effect: "money_moving",
    maturity: "bounded-autonomous",
    requiredScopes: ["ads.manage"],
    restrictionCodes: ["daily_spend_cap_required"],
    adapterKind: "advertise",
    prerequisites: [
      "organization_entitled",
      "account_eligible",
      "account_mapped",
      "credential_current",
      "controlled_account_evidence",
      "tracking_ready",
    ],
    requiredWebhookEventKeys: [],
  },
  {
    key: "receive_status",
    character: "data_source",
    direction: "inbound",
    effect: "read",
    maturity: "read-only",
    requiredScopes: ["webhooks.receive"],
    restrictionCodes: [],
    adapterKind: "webhook",
    prerequisites: [
      "organization_entitled",
      "account_mapped",
      "credential_current",
      "webhook_configured",
    ],
    requiredWebhookEventKeys: ["status.changed"],
  },
  {
    key: "review_campaign",
    character: "operator_review",
    direction: "inbound",
    effect: "operator_control",
    maturity: "governed-write",
    requiredScopes: [],
    restrictionCodes: ["linked_operator_required"],
    adapterKind: "operator_review",
    prerequisites: ["organization_entitled", "linked_operator"],
    requiredWebhookEventKeys: [],
  },
] as const satisfies readonly ProviderCapabilityDefinition[];

const definition: ProviderDefinition = {
  key: "test_provider",
  displayName: "Test provider",
  adapterVersion: "v1",
  contractVersion: "contract-v1",
  rolloutState: "available",
  characters: ["data_source", "publishing_destination", "advertising_account", "operator_review"],
  capabilities,
  syncIntervalMinutes: 30,
  staleAfterMinutes: 65,
};

const baseInput: CapabilityDerivationInput = {
  definition,
  connection: {
    status: "active",
    grantedScopes: ["insights.read", "content.publish", "ads.manage", "webhooks.receive"],
  },
  capabilityEvidence: Object.fromEntries(
    capabilities.map(({ key }) => [
      key,
      {
        evidence: {
          reference: `evidence:${key}:v1`,
          checkedAt: "2026-08-11T00:00:00.000Z",
          validUntil: "2026-08-20T00:00:00.000Z",
        },
        accountEligibility: "eligible",
        capabilityHealth: "usable",
        organizationEntitlement: "entitled",
        accountMapping: "mapped",
        credentialStatus: "current",
        controlledAccountEvidence: "verified",
        tracking: "ready",
        linkedOperator: "verified",
        webhookConfiguration: "verified",
        verifiedProviderPrerequisiteKeys: ["controlled_account_ready"],
      },
    ]),
  ),
  providerContract: {
    verification: "verified_live",
    providerKey: "test_provider",
    version: "contract-v1",
    expiresAt: "2026-09-01T00:00:00.000Z",
    actions: capabilities.map((capability) => ({
      key: capability.key,
      effect: capability.effect,
      requiredScopes: capability.requiredScopes,
      controlledAccountEvidenceVerified: true,
      requiredPrerequisiteKeys:
        capability.effect === "public_write" || capability.effect === "money_moving"
          ? ["controlled_account_ready"]
          : [],
      placementVerification:
        capability.effect === "public_write" || capability.effect === "money_moving"
          ? "verified"
          : "not_required",
      reconciliationVerification:
        capability.effect === "public_write" || capability.effect === "money_moving"
          ? "verified"
          : "not_required",
    })),
    webhook: {
      capabilityKey: "receive_status",
      eventKeys: ["status.changed"],
      signatureVerification: "verified",
      replayProtection: "verified",
    },
  },
  installedAdapterKinds: ["read", "publish", "advertise", "webhook", "operator_review"],
  platformPolicy: {
    permittedEffects: ["read", "public_write", "money_moving", "operator_control"],
    publicWriteMode: "approval_required",
    spendMode: "approval_required",
  },
  now: new Date("2026-08-12T00:00:00.000Z"),
};

const liveContract = baseInput.providerContract as Extract<
  ProviderContractProjection,
  { verification: "verified_live" }
>;

function grantFor(capabilityKey: string, patch: Partial<CapabilityDerivationInput> = {}) {
  return deriveCapabilityGrants({
    ...baseInput,
    ...patch,
    requestedCapabilities: [capabilityKey],
  })[0];
}

describe("deriveCapabilityGrants", () => {
  it.each([
    ["read_insights", "read", "read-only"],
    ["publish_post", "public_write", "governed-write"],
    ["start_ad", "money_moving", "governed-write"],
    ["receive_status", "read", "read-only"],
    ["review_campaign", "operator_control", "governed-write"],
  ] as const)(
    "derives %s from its exact typed definition and contract action",
    (key, effect, maturity) => {
      expect(grantFor(key)).toMatchObject({
        capabilityKey: key,
        definition: { effect, maturity },
        availability: "available",
        reasonCodes: [],
        derivedFromContractVersion: "contract-v1",
      });
    },
  );

  it("fails closed when the exact capability action is absent from the verified contract", () => {
    expect(
      grantFor("publish_post", {
        providerContract: { ...liveContract, actions: [] },
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["contract_action_unverified"] });
  });

  it("fails closed when contract action effect or exact scopes differ from the definition", () => {
    const contractAction = liveContract.actions.find(({ key }) => key === "publish_post")!;
    expect(
      grantFor("publish_post", {
        providerContract: {
          ...liveContract,
          actions: [{ ...contractAction, effect: "read" }],
        },
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["contract_action_mismatch"] });
    expect(
      grantFor("publish_post", {
        providerContract: {
          ...liveContract,
          actions: [{ ...contractAction, requiredScopes: ["content.publish.extra"] }],
        },
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["contract_action_mismatch"] });
  });

  it("requires verified controlled evidence, prerequisites, placement, and reconciliation for writes", () => {
    const contractAction = liveContract.actions.find(({ key }) => key === "publish_post")!;
    for (const action of [
      { ...contractAction, controlledAccountEvidenceVerified: false },
      { ...contractAction, requiredPrerequisiteKeys: ["missing_prerequisite"] },
      { ...contractAction, placementVerification: "unverified" as const },
      { ...contractAction, reconciliationVerification: "unverified" as const },
    ]) {
      expect(
        grantFor("publish_post", {
          providerContract: { ...liveContract, actions: [action] },
        }),
      ).toMatchObject({ availability: "blocked" });
    }
  });

  it("requires a verified exact webhook facet rather than treating a webhook as an action", () => {
    expect(
      grantFor("receive_status", {
        providerContract: { ...liveContract, webhook: null },
      }),
    ).toMatchObject({ reasonCodes: expect.arrayContaining(["contract_webhook_unverified"]) });
    expect(
      grantFor("receive_status", {
        providerContract: {
          ...liveContract,
          webhook: { ...liveContract.webhook!, eventKeys: ["unknown.event"] },
        },
      }),
    ).toMatchObject({
      reasonCodes: expect.arrayContaining(["contract_webhook_event_unverified"]),
    });
  });

  it.each([
    ["an undocumented extra event", ["status.changed", "status.deleted"]],
    ["a duplicate event", ["status.changed", "status.changed"]],
  ])("rejects %s in the verified webhook event set", (_case, eventKeys) => {
    expect(
      grantFor("receive_status", {
        providerContract: {
          ...liveContract,
          webhook: { ...liveContract.webhook!, eventKeys },
        },
      }),
    ).toMatchObject({
      availability: "blocked",
      reasonCodes: expect.arrayContaining(["contract_webhook_event_unverified"]),
    });
  });

  it("blocks only the capability whose declared runtime prerequisite is missing", () => {
    const capabilityEvidence = {
      ...baseInput.capabilityEvidence,
      publish_post: {
        ...baseInput.capabilityEvidence.publish_post!,
        accountMapping: "unmapped" as const,
        verifiedProviderPrerequisiteKeys: ["controlled_account_ready"],
      },
    };

    const grants = deriveCapabilityGrants({ ...baseInput, capabilityEvidence });
    expect(grants.find(({ capabilityKey }) => capabilityKey === "publish_post")).toMatchObject({
      availability: "blocked",
      reasonCodes: ["account_unmapped"],
    });
    expect(grants.find(({ capabilityKey }) => capabilityKey === "review_campaign")).toMatchObject({
      availability: "available",
    });
  });

  it.each(["not_required", "expired"] as const)(
    "requires a genuinely current credential instead of accepting %s",
    (credentialStatus) => {
      expect(
        grantFor("publish_post", {
          capabilityEvidence: {
            ...baseInput.capabilityEvidence,
            publish_post: {
              ...baseInput.capabilityEvidence.publish_post!,
              credentialStatus,
            },
          },
        }),
      ).toMatchObject({
        availability: "blocked",
        reasonCodes: [credentialStatus === "expired" ? "credential_expired" : "credential_missing"],
      });
    },
  );

  it("blocks a live capability without organization entitlement", () => {
    expect(
      grantFor("read_insights", {
        capabilityEvidence: {
          ...baseInput.capabilityEvidence,
          read_insights: {
            ...baseInput.capabilityEvidence.read_insights!,
            organizationEntitlement: "not_entitled",
          },
        },
      }),
    ).toMatchObject({
      availability: "blocked",
      reasonCodes: expect.arrayContaining(["organization_not_entitled"]),
    });
  });

  it("blocks declared fixture prerequisites when capability evidence is absent", () => {
    expect(
      deriveCapabilityGrants({
        ...baseInput,
        definition: {
          ...definition,
          rolloutState: "fixture",
          capabilities: [
            {
              ...capabilities[0],
              prerequisites: ["account_mapped"],
            },
          ],
        },
        providerContract: {
          verification: "fixture",
          providerKey: definition.key,
          version: definition.contractVersion,
          expiresAt: null,
        },
        capabilityEvidence: {},
        requestedCapabilities: ["read_insights"],
      })[0],
    ).toMatchObject({
      availability: "blocked",
      reasonCodes: expect.arrayContaining(["capability_evidence_missing"]),
    });
  });

  it("does not require account mapping for operator review unless its definition declares it", () => {
    expect(
      grantFor("review_campaign", {
        capabilityEvidence: {
          ...baseInput.capabilityEvidence,
          review_campaign: {
            ...baseInput.capabilityEvidence.review_campaign!,
            accountMapping: "unmapped",
            verifiedProviderPrerequisiteKeys: [],
          },
        },
      }),
    ).toMatchObject({ availability: "available", reasonCodes: [] });
  });

  it.each([
    [null, "organization_evidence_missing"],
    [
      {
        reference: "evidence:publish:v1",
        checkedAt: "not-a-date",
        validUntil: "2026-08-20T00:00:00.000Z",
      },
      "organization_evidence_invalid",
    ],
    [
      {
        reference: "evidence:publish:v1",
        checkedAt: "2026-08-01T00:00:00.000Z",
        validUntil: "2026-08-12T00:00:00.000Z",
      },
      "organization_evidence_expired",
    ],
  ] as const)(
    "blocks only the capability with missing, malformed, or stale org evidence",
    (evidence, reasonCode) => {
      const grants = deriveCapabilityGrants({
        ...baseInput,
        capabilityEvidence: {
          ...baseInput.capabilityEvidence,
          publish_post: { ...baseInput.capabilityEvidence.publish_post!, evidence },
        },
      });
      expect(grants.find(({ capabilityKey }) => capabilityKey === "publish_post")).toMatchObject({
        availability: "blocked",
        reasonCodes: [reasonCode],
      });
      expect(grants.find(({ capabilityKey }) => capabilityKey === "review_campaign")).toMatchObject(
        {
          availability: "available",
        },
      );
    },
  );

  it("blocks only the capability whose matching adapter is unavailable", () => {
    expect(
      grantFor("publish_post", {
        installedAdapterKinds: ["read", "advertise", "webhook", "operator_review"],
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["adapter_unavailable"] });
  });

  it("blocks a capability when any exact required scope is missing", () => {
    expect(
      grantFor("publish_post", {
        connection: { status: "active", grantedScopes: ["content.read"] },
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["required_scopes_missing"] });
  });

  it("blocks effects and explicit write/spend modes denied by organization policy", () => {
    expect(
      grantFor("publish_post", {
        platformPolicy: {
          ...baseInput.platformPolicy,
          permittedEffects: ["read", "operator_control"],
        },
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["platform_policy_denied"] });
    expect(
      grantFor("publish_post", {
        platformPolicy: { ...baseInput.platformPolicy, publicWriteMode: "disabled" },
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["public_write_policy_denied"] });
    expect(
      grantFor("start_ad", {
        platformPolicy: { ...baseInput.platformPolicy, spendMode: "disabled" },
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["spend_policy_denied"] });
  });

  it("caps bounded-autonomous publish and spend definitions at governed-write under approval policy", () => {
    expect(grantFor("publish_post")).toMatchObject({
      definition: { maturity: "governed-write" },
    });
    expect(grantFor("start_ad")).toMatchObject({
      definition: { maturity: "governed-write" },
    });
  });

  it("binds live contracts to the exact provider identity", () => {
    expect(
      grantFor("publish_post", {
        providerContract: { ...liveContract, providerKey: "wrong_provider" },
      }),
    ).toMatchObject({ reasonCodes: expect.arrayContaining(["provider_contract_mismatch"]) });
  });

  it("rejects a verified-live contract projection for a fixture definition", () => {
    expect(
      grantFor("read_insights", {
        definition: { ...definition, rolloutState: "fixture" },
      }),
    ).toMatchObject({
      availability: "blocked",
      reasonCodes: expect.arrayContaining(["provider_contract_invalid"]),
    });
  });

  it("blocks pending connections and requires explicit usable health for degraded connections", () => {
    expect(
      grantFor("read_insights", {
        connection: { ...baseInput.connection, status: "pending" },
      }),
    ).toMatchObject({ reasonCodes: expect.arrayContaining(["connection_not_ready"]) });
    expect(
      grantFor("publish_post", {
        connection: { ...baseInput.connection, status: "degraded" },
        capabilityEvidence: {
          ...baseInput.capabilityEvidence,
          publish_post: {
            ...baseInput.capabilityEvidence.publish_post!,
            capabilityHealth: "degraded",
          },
        },
      }),
    ).toMatchObject({ reasonCodes: expect.arrayContaining(["capability_health_degraded"]) });
  });

  it.each([
    {
      reference: "",
      checkedAt: "2026-08-11T00:00:00.000Z",
      validUntil: "2026-08-20T00:00:00.000Z",
    },
    {
      reference: "evidence:future",
      checkedAt: "2026-08-13T00:00:00.000Z",
      validUntil: "2026-08-20T00:00:00.000Z",
    },
    {
      reference: "evidence:range",
      checkedAt: "2026-08-11T00:00:00.000Z",
      validUntil: "2026-08-10T00:00:00.000Z",
    },
  ])("rejects malformed evidence envelope %#", (evidence) => {
    expect(
      grantFor("publish_post", {
        capabilityEvidence: {
          ...baseInput.capabilityEvidence,
          publish_post: { ...baseInput.capabilityEvidence.publish_post!, evidence },
        },
      }),
    ).toMatchObject({ reasonCodes: expect.arrayContaining(["organization_evidence_invalid"]) });
  });

  it.each([null, "not-a-date"])("fails closed for invalid contract expiry %s", (expiresAt) => {
    expect(
      grantFor("publish_post", {
        providerContract: { ...liveContract, expiresAt },
      }),
    ).toMatchObject({ availability: "blocked", reasonCodes: ["provider_contract_invalid"] });
  });

  it("fails closed after the checked provider contract expires", () => {
    expect(grantFor("publish_post", { now: new Date("2026-09-01T00:00:00.000Z") })).toMatchObject({
      availability: "blocked",
      reasonCodes: expect.arrayContaining([
        "provider_contract_expired",
        "organization_evidence_expired",
      ]),
    });
  });

  it.each([
    ["disconnected", "connection_disconnected"],
    ["revoked", "connection_revoked"],
  ] as const)("disables every grant for a %s connection", (status, reasonCode) => {
    expect(
      grantFor("publish_post", { connection: { ...baseInput.connection, status } }),
    ).toMatchObject({ availability: "disabled", reasonCodes: [reasonCode] });
  });

  it("preserves stable provider restriction codes while blocked", () => {
    expect(
      grantFor("start_ad", {
        platformPolicy: { ...baseInput.platformPolicy, spendMode: "disabled" },
      }),
    ).toMatchObject({ restrictionCodes: ["daily_spend_cap_required"] });
  });

  it("does not invent definition metadata for an unsupported requested capability", () => {
    expect(grantFor("unknown_action")).toEqual({
      capabilityKey: "unknown_action",
      definition: null,
      availability: "blocked",
      reasonCodes: ["capability_unsupported"],
      restrictionCodes: [],
      derivedFromContractVersion: "contract-v1",
    });
  });

  it("uses a safe recovery fallback for an unknown stable code", () => {
    expect(capabilityRecoveryActions(["provider.unknown_restriction"])).toEqual([
      "Review the provider restriction and complete its documented prerequisite.",
    ]);
  });
});
