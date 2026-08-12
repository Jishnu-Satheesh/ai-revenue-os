import { DomainError } from "@/lib/errors";

import { IntegrationError } from "@/domain/integrations/errors";
import { providerDefinitionSchema } from "@/domain/integrations/schemas";
import type { ProviderAdapterKind } from "@/domain/integrations/schemas";
import type {
  CapabilityAdapter,
  ProviderAdapterMaps,
  ProviderDefinition,
  ReadProviderAdapter,
} from "@/domain/integrations/types";

type RegisteredCapabilityAdapter =
  | ReadProviderAdapter
  | import("@/domain/integrations/types").CapabilityAdapter;

export type ProviderRegistry = {
  listDefinitions(): readonly ProviderDefinition[];
  getDefinition(providerKey: string): ProviderDefinition;
  getAdapter(providerKey: string, adapterVersion: string, adapterKind: "read"): ReadProviderAdapter;
  getAdapter(
    providerKey: string,
    adapterVersion: string,
    adapterKind: Exclude<ProviderAdapterKind, "read">,
  ): CapabilityAdapter;
  hasAdapter(
    providerKey: string,
    adapterVersion: string,
    adapterKind: ProviderAdapterKind,
  ): boolean;
};

function adapterKey(providerKey: string, adapterVersion: string, adapterKind: ProviderAdapterKind) {
  return `${providerKey}:${adapterVersion}:${adapterKind}`;
}

function freezeDefinition(definition: ProviderDefinition): ProviderDefinition {
  return Object.freeze({
    ...definition,
    characters: Object.freeze([...definition.characters]),
    capabilities: Object.freeze(
      definition.capabilities.map((capability) =>
        Object.freeze({
          ...capability,
          requiredScopes: Object.freeze([...capability.requiredScopes]),
          restrictionCodes: Object.freeze([...capability.restrictionCodes]),
          prerequisites: Object.freeze([...capability.prerequisites]),
          requiredWebhookEventKeys: Object.freeze([...capability.requiredWebhookEventKeys]),
        }),
      ),
    ),
  });
}

export function createProviderRegistry(input: {
  definitions: readonly ProviderDefinition[];
  adapters: ProviderAdapterMaps;
}): ProviderRegistry {
  const definitionsByKey = new Map<string, ProviderDefinition>();
  const adaptersByIdentity = new Map<string, RegisteredCapabilityAdapter>();

  for (const unparsedDefinition of input.definitions) {
    const definition = providerDefinitionSchema.parse(unparsedDefinition) as ProviderDefinition;
    if (definitionsByKey.has(definition.key)) {
      throw new DomainError("VALIDATION_ERROR", `Duplicate provider key: ${definition.key}`);
    }

    const grantableKeys = new Set(definition.capabilities.map(({ key }) => key));
    for (const declaration of definition.declaredBlockedCapabilities ?? []) {
      // A key cannot be both grantable and declared-blocked: the UI would have
      // to choose which answer to show, and either choice misleads.
      if (grantableKeys.has(declaration.key)) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Blocked declaration ${declaration.key} shadows a grantable capability on ${definition.key}.`,
        );
      }
      // Without a stable reason, "blocked" is indistinguishable from "absent",
      // and an operator cannot tell whether to wait or to act.
      if (declaration.restrictionCodes.length === 0) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Blocked declaration ${declaration.key} needs at least one restriction code.`,
        );
      }
    }

    definitionsByKey.set(definition.key, freezeDefinition(definition));
  }

  for (const adapterKind of [
    "read",
    "publish",
    "advertise",
    "webhook",
    "operator_review",
  ] as const) {
    const adapters = input.adapters[adapterKind] ?? [];
    for (const adapter of adapters as readonly RegisteredCapabilityAdapter[]) {
      const definition = definitionsByKey.get(adapter.providerKey);
      if (!definition) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Provider is not registered: ${adapter.providerKey}`,
        );
      }
      if (adapter.adapterKind !== adapterKind) {
        throw new DomainError("VALIDATION_ERROR", "Provider adapter is in the wrong adapter map.");
      }
      if (definition.adapterVersion !== adapter.adapterVersion) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Provider adapter version does not match its definition.",
        );
      }
      const key = adapterKey(adapter.providerKey, adapter.adapterVersion, adapterKind);
      if (adaptersByIdentity.has(key)) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Duplicate ${adapterKind} provider adapter: ${key}`,
        );
      }
      adaptersByIdentity.set(key, adapter);
    }
  }

  for (const definition of definitionsByKey.values()) {
    for (const adapterKind of [
      "read",
      "publish",
      "advertise",
      "webhook",
      "operator_review",
    ] as const) {
      const expectedKeys = definition.capabilities
        .filter((capability) => capability.adapterKind === adapterKind)
        .map(({ key }) => key)
        .sort();
      const adapter = adaptersByIdentity.get(
        adapterKey(definition.key, definition.adapterVersion, adapterKind),
      );
      if (expectedKeys.length === 0 && adapter) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Provider ${definition.key} does not declare a ${adapterKind} capability for this adapter.`,
        );
      }
      if (expectedKeys.length === 0) continue;
      if (!adapter) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Capability ${expectedKeys[0]} requires a registered ${adapterKind} adapter.`,
        );
      }
      const claimedKeys = [...adapter.supportedCapabilityKeys].sort();
      if (
        claimedKeys.length !== new Set(claimedKeys).size ||
        claimedKeys.length !== expectedKeys.length ||
        claimedKeys.some((key, index) => key !== expectedKeys[index])
      ) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `${adapterKind} adapter must exactly claim its provider capability keys.`,
        );
      }
    }
  }

  function getAdapter(
    providerKey: string,
    adapterVersion: string,
    adapterKind: ProviderAdapterKind,
  ): RegisteredCapabilityAdapter {
    const adapter = adaptersByIdentity.get(adapterKey(providerKey, adapterVersion, adapterKind));
    if (!adapter) {
      throw new IntegrationError(
        "NOT_FOUND",
        `Provider ${adapterKind} adapter is not registered: ${providerKey}`,
        false,
      );
    }
    return adapter;
  }

  return {
    listDefinitions: () => [...definitionsByKey.values()],
    getDefinition(providerKey) {
      const definition = definitionsByKey.get(providerKey);
      if (!definition) {
        throw new IntegrationError("NOT_FOUND", "Provider definition is not registered.", false);
      }
      return definition;
    },
    getAdapter: getAdapter as ProviderRegistry["getAdapter"],
    hasAdapter(providerKey, adapterVersion, adapterKind) {
      return adaptersByIdentity.has(adapterKey(providerKey, adapterVersion, adapterKind));
    },
  };
}
