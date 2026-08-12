import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CredentialStore } from "@/domain/integrations/credential-store.server";
import { IntegrationError } from "@/domain/integrations/errors";
import {
  buildAuthorizationRequest,
  createOAuthState,
  digestOAuthState,
  type OAuthCallbackResultCode,
} from "@/domain/integrations/oauth-session";
import type { Database } from "@/lib/supabase/database.types";

/**
 * A provider becomes connectable only by appearing here with a verified
 * authorization endpoint and a working code exchange. Meta is deliberately
 * absent: the checked-in Meta contract proves no OAuth endpoint or
 * controlled-account behaviour, so there is nothing honest to register.
 */
export type OAuthProviderApplication = {
  providerKey: string;
  authorizationEndpoint: string;
  clientId: string;
  requestedScopes: readonly string[];
  exchangeCode(input: {
    code: string;
    callbackUrl: string;
    correlationId: string;
  }): Promise<{ secret: string }>;
};

export type OAuthServiceDependencies = {
  supabase: SupabaseClient<Database>;
  credentialStore: CredentialStore;
  applications: Readonly<Record<string, OAuthProviderApplication>>;
  appOrigin: string;
  sessionTtlSeconds?: number;
};

export type StartOAuthInput = {
  organizationId: string;
  providerKey: string;
  actorId: string;
  correlationId: string;
};

export type StartOAuthResult = {
  sessionId: string;
  authorizationUrl: string;
};

export type CompleteCallbackInput = {
  providerKey: string;
  state: string;
  code: string;
  correlationId: string;
};

export type CompleteCallbackResult = {
  resultCode: OAuthCallbackResultCode;
  organizationId?: string;
};

const consumedSessionSchema = z.object({
  session_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  requested_scopes: z.array(z.string()),
  callback_url: z.string(),
});

const DEFAULT_TTL_SECONDS = 600;

type Rpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export function createOAuthService(dependencies: OAuthServiceDependencies) {
  const client = dependencies.supabase as unknown as Rpc;
  const ttlSeconds = dependencies.sessionTtlSeconds ?? DEFAULT_TTL_SECONDS;

  function callbackUrlFor(providerKey: string): string {
    return `${dependencies.appOrigin}/api/integrations/oauth/${providerKey}/callback`;
  }

  function applicationFor(providerKey: string): OAuthProviderApplication | undefined {
    return dependencies.applications[providerKey];
  }

  return {
    async start(input: StartOAuthInput): Promise<StartOAuthResult> {
      const application = applicationFor(input.providerKey);

      // Resolved before anything is persisted: an unconfigured provider must
      // not leave a pending session behind that can never be completed.
      if (!application) {
        throw new IntegrationError(
          "FEATURE_NOT_AVAILABLE",
          "This provider cannot be connected yet.",
          false,
        );
      }

      const state = createOAuthState();
      const callbackUrl = callbackUrlFor(application.providerKey);

      const authorization = buildAuthorizationRequest({
        authorizationEndpoint: application.authorizationEndpoint,
        clientId: application.clientId,
        requestedScopes: application.requestedScopes,
        callbackUrl,
        state,
        expectedCallbackOrigin: dependencies.appOrigin,
      });

      const { data, error } = await client.rpc("start_integration_oauth_session", {
        p_organization_id: input.organizationId,
        p_provider_key: application.providerKey,
        // Only the digest crosses this boundary. The state itself travels to
        // the provider in the URL and is never written down.
        p_state_digest: digestOAuthState(state),
        p_requested_scopes: application.requestedScopes,
        p_callback_url: callbackUrl,
        p_correlation_id: input.correlationId,
        p_ttl_seconds: ttlSeconds,
      });

      if (error) {
        throw new IntegrationError(
          "AUTHORIZATION_ERROR",
          "The connection could not be started.",
          false,
          {},
          error,
        );
      }

      const sessionId = z.string().uuid().safeParse(data);
      if (!sessionId.success) {
        throw new IntegrationError(
          "VALIDATION_ERROR",
          "The connection could not be started.",
          false,
        );
      }

      return { sessionId: sessionId.data, authorizationUrl: authorization.authorizationUrl };
    },

    async completeCallback(input: CompleteCallbackInput): Promise<CompleteCallbackResult> {
      const application = applicationFor(input.providerKey);
      if (!application) return { resultCode: "oauth_not_configured" };

      // Consumption is atomic in the database and re-checks the actor's current
      // membership and role. Nothing is exchanged until it succeeds.
      const { data, error } = await client.rpc("consume_integration_oauth_session", {
        p_state_digest: digestOAuthState(input.state),
        p_provider_key: application.providerKey,
        p_correlation_id: input.correlationId,
      });

      if (error) return { resultCode: "oauth_session_not_authorized" };

      const rows = Array.isArray(data) ? data : [];
      const session = consumedSessionSchema.safeParse(rows[0]);
      if (!session.success) return { resultCode: "oauth_session_not_authorized" };

      let secret: string;
      try {
        const exchanged = await application.exchangeCode({
          code: input.code,
          callbackUrl: session.data.callback_url,
          correlationId: input.correlationId,
        });
        secret = exchanged.secret;
      } catch {
        // The provider's message can quote the code; none of it is surfaced.
        return { resultCode: "oauth_provider_rejected" };
      }

      try {
        await dependencies.credentialStore.create({
          organizationId: session.data.organization_id,
          providerKey: application.providerKey,
          secret,
          correlationId: input.correlationId,
          idempotencyKey: session.data.session_id,
        });
      } catch {
        return { resultCode: "oauth_provider_unavailable" };
      }

      return { resultCode: "oauth_connected", organizationId: session.data.organization_id };
    },
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
