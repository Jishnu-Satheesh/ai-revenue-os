import type { ProviderDefinition } from "@/domain/integrations/types";

export const GOOGLE_BUSINESS_PROFILE_FIXTURE_COPY = "Fixture mode — Google API access pending.";

export type GoogleBusinessProfileDefinition = ProviderDefinition & {
  readonly operatorCopy: typeof GOOGLE_BUSINESS_PROFILE_FIXTURE_COPY;
};

const definition = {
  key: "google_business_profile",
  displayName: "Google Business Profile",
  adapterVersion: "1",
  contractVersion: "fixture-v1",
  rolloutState: "fixture",
  characters: Object.freeze(["data_source"]),
  capabilities: Object.freeze([
    Object.freeze({
      key: "read_google_business_profile",
      character: "data_source",
      direction: "inbound",
      effect: "read",
      maturity: "read-only",
      requiredScopes: Object.freeze([]),
      restrictionCodes: Object.freeze([]),
      adapterKind: "read",
      prerequisites: ["account_mapped"] as const,
      requiredWebhookEventKeys: [] as const,
    }),
    Object.freeze({
      key: "read_reviews",
      character: "data_source",
      direction: "inbound",
      effect: "read",
      maturity: "read-only",
      requiredScopes: Object.freeze([]),
      restrictionCodes: Object.freeze([]),
      adapterKind: "read",
      prerequisites: ["account_mapped"] as const,
      requiredWebhookEventKeys: [] as const,
    }),
  ]),
  syncIntervalMinutes: 30,
  staleAfterMinutes: 65,
  operatorCopy: GOOGLE_BUSINESS_PROFILE_FIXTURE_COPY,
} as const satisfies GoogleBusinessProfileDefinition;

export const googleBusinessProfileDefinition: GoogleBusinessProfileDefinition =
  Object.freeze(definition);
