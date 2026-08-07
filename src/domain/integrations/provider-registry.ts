import { DomainError } from "@/lib/errors";

import { IntegrationError } from "@/domain/integrations/errors";
import type { ProviderAdapter, ProviderDefinition } from "@/domain/integrations/types";

export type ProviderRegistry = {
  listDefinitions(): readonly ProviderDefinition[];
  getAdapter(providerKey: string, adapterVersion: string): ProviderAdapter;
};

export function createProviderRegistry(
  definitions: readonly ProviderDefinition[],
  adapters: readonly ProviderAdapter[],
): ProviderRegistry {
  const definitionsByKey = new Map<string, ProviderDefinition>();
  const adaptersByProviderAndVersion = new Map<string, ProviderAdapter>();

  for (const definition of definitions) {
    if (definitionsByKey.has(definition.key)) {
      throw new DomainError("VALIDATION_ERROR", `Duplicate provider key: ${definition.key}`);
    }
    if (definition.supportsWebhooks) {
      throw new DomainError("FEATURE_NOT_AVAILABLE", "Provider webhooks are not supported in V1.");
    }
    if (definition.supportsWrites) {
      throw new DomainError("FEATURE_NOT_AVAILABLE", "Provider writes are not supported in V1.");
    }
    definitionsByKey.set(
      definition.key,
      Object.freeze({
        ...definition,
        supportedCapabilities: Object.freeze([...definition.supportedCapabilities]),
        requiredScopes: Object.freeze([...definition.requiredScopes]),
      }),
    );
  }

  for (const adapter of adapters) {
    const definition = definitionsByKey.get(adapter.providerKey);
    if (!definition) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Provider is not registered: ${adapter.providerKey}`,
      );
    }
    if (definition.adapterVersion !== adapter.adapterVersion) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Provider adapter version does not match its definition.",
      );
    }
    const adapterKey = `${adapter.providerKey}:${adapter.adapterVersion}`;
    if (adaptersByProviderAndVersion.has(adapterKey)) {
      throw new DomainError("VALIDATION_ERROR", `Duplicate provider adapter: ${adapterKey}`);
    }
    adaptersByProviderAndVersion.set(adapterKey, adapter);
  }

  return {
    listDefinitions: () => [...definitionsByKey.values()],
    getAdapter(providerKey, adapterVersion) {
      const adapter = adaptersByProviderAndVersion.get(`${providerKey}:${adapterVersion}`);
      if (!adapter) {
        throw new IntegrationError(
          "NOT_FOUND",
          `Provider adapter is not registered: ${providerKey}`,
          false,
        );
      }
      return adapter;
    },
  };
}
