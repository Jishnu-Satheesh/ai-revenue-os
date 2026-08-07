import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createProviderRegistry } from "@/domain/integrations/provider-registry";

const definition = {
  key: "google_business_profile",
  displayName: "Google Business Profile",
  adapterVersion: "v1",
  rolloutState: "fixture" as const,
  supportedCapabilities: ["read_google_business_profile"],
  requiredScopes: [],
  syncIntervalMinutes: 30,
  staleAfterMinutes: 65,
  supportsWebhooks: false,
  supportsWrites: false,
};

const adapter = {
  providerKey: "google_business_profile",
  adapterVersion: "v1",
  async testConnection() {
    return { outcome: "passed" as const };
  },
  async listExternalResources() {
    return [];
  },
  async sync() {
    return [];
  },
};

describe("createProviderRegistry", () => {
  it("rejects duplicate provider keys", () => {
    expect(() => createProviderRegistry([definition, definition], [adapter])).toThrow(
      "Duplicate provider key",
    );
  });

  it("rejects adapters whose version does not match their definition", () => {
    expect(() =>
      createProviderRegistry([definition], [{ ...adapter, adapterVersion: "v2" }]),
    ).toThrow("does not match");
  });

  it("rejects duplicate provider adapter registrations", () => {
    expect(() => createProviderRegistry([definition], [adapter, adapter])).toThrow(
      "Duplicate provider adapter",
    );
  });

  it("rejects webhook and write provider definitions in V1", () => {
    expect(() =>
      createProviderRegistry([{ ...definition, supportsWebhooks: true }], [adapter]),
    ).toThrow("webhooks");
    expect(() =>
      createProviderRegistry([{ ...definition, supportsWrites: true }], [adapter]),
    ).toThrow("writes");
  });

  it("rejects lookup of an unregistered provider", () => {
    const registry = createProviderRegistry([definition], [adapter]);

    expect(() => registry.getAdapter("not_registered", "v1")).toThrow("not registered");
  });

  it("snapshots provider definitions before exposing them", () => {
    const mutableDefinition = { ...definition, displayName: "Original name" };
    const registry = createProviderRegistry([mutableDefinition], [adapter]);
    mutableDefinition.displayName = "Mutated name";
    mutableDefinition.supportedCapabilities.push("unexpected_capability");

    const [registeredDefinition] = registry.listDefinitions();
    expect(registeredDefinition).toMatchObject({
      displayName: "Original name",
      supportedCapabilities: ["read_google_business_profile"],
    });
    expect(Object.isFrozen(registeredDefinition)).toBe(true);
  });
});
