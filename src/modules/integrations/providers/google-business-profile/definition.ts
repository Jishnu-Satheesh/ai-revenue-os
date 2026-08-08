import type { ProviderDefinition } from "@/domain/integrations/types";

export const GOOGLE_BUSINESS_PROFILE_FIXTURE_COPY = "Fixture mode — Google API access pending.";

export type GoogleBusinessProfileDefinition = ProviderDefinition & {
  readonly operatorCopy: typeof GOOGLE_BUSINESS_PROFILE_FIXTURE_COPY;
};

export const googleBusinessProfileDefinition: GoogleBusinessProfileDefinition = Object.freeze({
  key: "google_business_profile",
  displayName: "Google Business Profile",
  adapterVersion: "1",
  rolloutState: "fixture",
  supportedCapabilities: Object.freeze(["read_google_business_profile", "read_reviews"]),
  requiredScopes: Object.freeze([]),
  syncIntervalMinutes: 30,
  staleAfterMinutes: 65,
  supportsWebhooks: false,
  supportsWrites: false,
  operatorCopy: GOOGLE_BUSINESS_PROFILE_FIXTURE_COPY,
});
