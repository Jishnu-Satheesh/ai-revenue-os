import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createProviderRegistry } from "@/domain/integrations/provider-registry";
import type {
  CapabilityAdapter,
  ProviderAdapterMaps,
  ProviderCapabilityDefinition,
  ProviderDefinition,
  ReadProviderAdapter,
} from "@/domain/integrations/types";

const capability = {
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
} as const satisfies ProviderCapabilityDefinition;

const definition: ProviderDefinition = {
  key: "test_provider",
  displayName: "Test provider",
  adapterVersion: "v1",
  contractVersion: "contract-v1",
  rolloutState: "fixture",
  characters: ["data_source"],
  capabilities: [capability],
  syncIntervalMinutes: 30,
  staleAfterMinutes: 65,
};

const readAdapter: ReadProviderAdapter = {
  providerKey: "test_provider",
  adapterVersion: "v1",
  adapterKind: "read",
  supportedCapabilityKeys: ["read_profile"],
  async testConnection() {
    return { outcome: "passed" };
  },
  async listExternalResources() {
    return [];
  },
  async sync() {
    return [];
  },
};

const capabilityAdapter = <TKind extends CapabilityAdapter["adapterKind"]>(
  adapterKind: TKind,
  supportedCapabilityKeys: readonly string[],
): CapabilityAdapter<TKind> => ({
  providerKey: "test_provider",
  adapterVersion: "v1",
  adapterKind,
  supportedCapabilityKeys,
});

const adapterMaps: ProviderAdapterMaps = { read: [readAdapter] };

describe("createProviderRegistry", () => {
  it("accepts read, publish, advertise, webhook, and operator-review definitions with matching adapter maps", () => {
    const actionCapabilities = [
      {
        ...capability,
        prerequisites: ["organization_entitled", "account_mapped", "credential_current"],
      },
      {
        ...capability,
        key: "publish",
        character: "publishing_destination",
        direction: "outbound",
        adapterKind: "publish",
        effect: "public_write",
        maturity: "governed-write",
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
        ...capability,
        key: "advertise",
        character: "advertising_account",
        direction: "outbound",
        adapterKind: "advertise",
        effect: "money_moving",
        maturity: "governed-write",
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
        ...capability,
        key: "webhook",
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
        ...capability,
        key: "review",
        adapterKind: "operator_review",
        effect: "operator_control",
        character: "operator_review",
        maturity: "governed-write",
        prerequisites: ["organization_entitled", "linked_operator"],
        requiredWebhookEventKeys: [],
      },
    ] as const satisfies readonly ProviderCapabilityDefinition[];

    expect(() =>
      createProviderRegistry({
        definitions: [
          {
            ...definition,
            rolloutState: "available",
            characters: [
              "data_source",
              "publishing_destination",
              "advertising_account",
              "operator_review",
            ],
            capabilities: actionCapabilities,
          },
        ],
        adapters: {
          read: [readAdapter],
          publish: [capabilityAdapter("publish", ["publish"])],
          advertise: [capabilityAdapter("advertise", ["advertise"])],
          webhook: [capabilityAdapter("webhook", ["webhook"])],
          operator_review: [capabilityAdapter("operator_review", ["review"])],
        },
      }),
    ).not.toThrow();
  });

  it.each([
    ["publish", { ...capability, adapterKind: "publish" }],
    ["advertise", { ...capability, adapterKind: "advertise" }],
    [
      "webhook",
      {
        ...capability,
        adapterKind: "webhook",
        direction: "outbound",
        requiredWebhookEventKeys: ["status.changed"],
      },
    ],
    [
      "operator review",
      {
        ...capability,
        adapterKind: "operator_review",
        character: "operator_review",
        effect: "read",
      },
    ],
  ] as const)("rejects an incoherent %s capability definition", (_name, incoherent) => {
    expect(() =>
      createProviderRegistry({
        definitions: [
          {
            ...definition,
            characters: [
              "data_source",
              "publishing_destination",
              "advertising_account",
              "operator_review",
            ],
            capabilities: [incoherent],
          },
        ],
        adapters: {
          read: [readAdapter],
          publish: [capabilityAdapter("publish", [incoherent.key])],
          advertise: [capabilityAdapter("advertise", [incoherent.key])],
          webhook: [capabilityAdapter("webhook", [incoherent.key])],
          operator_review: [capabilityAdapter("operator_review", [incoherent.key])],
        },
      }),
    ).toThrow(/compatible|invalid/i);
  });

  it.each([
    { ...capability, key: "fixture_publish", adapterKind: "publish", effect: "public_write" },
    { ...capability, key: "fixture_advertise", adapterKind: "advertise", effect: "money_moving" },
    {
      ...capability,
      key: "fixture_webhook",
      adapterKind: "webhook",
      requiredWebhookEventKeys: ["status.changed"],
    },
    {
      ...capability,
      key: "fixture_review",
      character: "operator_review",
      adapterKind: "operator_review",
      effect: "operator_control",
    },
  ] as const)("rejects $key on a fixture provider", (fixtureCapability) => {
    expect(() =>
      createProviderRegistry({
        definitions: [
          {
            ...definition,
            characters: ["data_source", "operator_review"],
            capabilities: [fixtureCapability],
          },
        ],
        adapters: {
          read: [readAdapter],
          publish: [capabilityAdapter("publish", [fixtureCapability.key])],
          advertise: [capabilityAdapter("advertise", [fixtureCapability.key])],
          webhook: [capabilityAdapter("webhook", [fixtureCapability.key])],
          operator_review: [capabilityAdapter("operator_review", [fixtureCapability.key])],
        },
      }),
    ).toThrow(/fixture.*read/i);
  });

  it("rejects an adapter that does not explicitly and exactly claim its capability keys", () => {
    expect(() =>
      createProviderRegistry({
        definitions: [definition],
        adapters: { read: [{ ...readAdapter, supportedCapabilityKeys: [] }] },
      }),
    ).toThrow(/exactly claim/i);
    expect(() =>
      createProviderRegistry({
        definitions: [definition],
        adapters: {
          read: [{ ...readAdapter, supportedCapabilityKeys: ["read_profile", "invented_read"] }],
        },
      }),
    ).toThrow(/exactly claim/i);
  });

  it("rejects an adapter kind that the provider declares no capabilities for", () => {
    expect(() =>
      createProviderRegistry({
        definitions: [definition],
        adapters: {
          read: [readAdapter],
          publish: [capabilityAdapter("publish", [])],
        },
      }),
    ).toThrow(/does not declare.*publish|extraneous.*publish/i);
  });

  it("rejects duplicate provider keys", () => {
    expect(() =>
      createProviderRegistry({ definitions: [definition, definition], adapters: adapterMaps }),
    ).toThrow("Duplicate provider key");
  });

  it("rejects definitions whose typed capability has no matching adapter kind", () => {
    expect(() =>
      createProviderRegistry({
        definitions: [
          {
            ...definition,
            rolloutState: "available",
            characters: ["publishing_destination"],
            capabilities: [
              {
                ...capability,
                key: "publish_post",
                character: "publishing_destination",
                direction: "outbound",
                effect: "public_write",
                maturity: "governed-write",
                adapterKind: "publish" as const,
                prerequisites: [
                  "organization_entitled",
                  "account_eligible",
                  "account_mapped",
                  "credential_current",
                  "controlled_account_evidence",
                ],
              },
            ],
          },
        ],
        adapters: {},
      }),
    ).toThrow("publish adapter");
  });

  it("rejects adapters whose version does not match their definition", () => {
    expect(() =>
      createProviderRegistry({
        definitions: [definition],
        adapters: { read: [{ ...readAdapter, adapterVersion: "v2" }] },
      }),
    ).toThrow("does not match");
  });

  it("rejects duplicate adapter registrations within an adapter-kind map", () => {
    expect(() =>
      createProviderRegistry({
        definitions: [definition],
        adapters: { read: [readAdapter, readAdapter] },
      }),
    ).toThrow("Duplicate read provider adapter");
  });

  it("keeps fixture provider admission strict while allowing typed action definitions", () => {
    const registry = createProviderRegistry({ definitions: [definition], adapters: adapterMaps });

    expect(registry.getAdapter("test_provider", "v1", "read")).toBe(readAdapter);
    expect(() => registry.getAdapter("not_registered", "v1", "read")).toThrow("not registered");
  });

  it("snapshots nested provider definitions before exposing them", () => {
    const mutableDefinition = {
      ...definition,
      characters: [...definition.characters],
      capabilities: [
        { ...capability, requiredScopes: [] as string[], restrictionCodes: [] as string[] },
      ],
    };
    const registry = createProviderRegistry({
      definitions: [mutableDefinition],
      adapters: adapterMaps,
    });
    mutableDefinition.characters.push("advertising_account");
    mutableDefinition.capabilities[0]?.requiredScopes.push("unexpected.scope");

    const [registeredDefinition] = registry.listDefinitions();
    expect(registeredDefinition).toMatchObject({
      characters: ["data_source"],
      capabilities: [{ key: "read_profile", requiredScopes: [] }],
    });
    expect(Object.isFrozen(registeredDefinition)).toBe(true);
    expect(Object.isFrozen(registeredDefinition?.capabilities[0])).toBe(true);
  });
});
