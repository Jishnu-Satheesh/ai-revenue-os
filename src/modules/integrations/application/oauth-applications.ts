import "server-only";

import type { OAuthProviderApplication } from "@/modules/integrations/application/oauth-service";

/**
 * Providers that can actually complete an OAuth handshake in production.
 *
 * This registry is intentionally empty. Registering a provider here is a claim
 * that its authorization endpoint, scopes, and code exchange have been verified
 * against current official documentation and exercised on a controlled account.
 * The checked-in Meta contract proves none of that yet, so Meta is absent and
 * every attempt to connect it fails closed before a session is created.
 *
 * Holding `META_APP_ID` and `META_APP_SECRET` does not change this. Application
 * credentials are an identity, not an entitlement.
 */
export const productionOAuthApplications: Readonly<Record<string, OAuthProviderApplication>> =
  Object.freeze({});
