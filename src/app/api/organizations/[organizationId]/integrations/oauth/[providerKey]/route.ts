import { z } from "zod";

import {
  organizationRouteParamsSchema,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";
import { env } from "@/lib/env";
import { productionOAuthApplications } from "@/modules/integrations/application/oauth-applications";
import { createOAuthService } from "@/modules/integrations/application/oauth-service";
import { createVaultCredentialStore } from "@/modules/integrations/infrastructure/vault-credential-store";

const oauthStartParamsSchema = organizationRouteParamsSchema.extend({
  providerKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
});

/**
 * Starts a provider handshake for one organization.
 *
 * The route only opens a session and returns a URL for the browser to follow.
 * Authorization is enforced twice: `runIntegrationRoute` resolves the caller's
 * membership, and the `start_integration_oauth_session` RPC independently
 * re-checks that the caller still holds an owner, admin, or operator role.
 *
 * With no provider registered as connectable, this currently fails closed for
 * every provider, before any session row is written.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; providerKey: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema: oauthStartParamsSchema,
    handler: async ({ context, params: routeParams }) => {
      const service = createOAuthService({
        supabase: context.supabase,
        credentialStore: createVaultCredentialStore(context.supabase),
        applications: productionOAuthApplications,
        appOrigin: new URL(env.NEXT_PUBLIC_APP_URL).origin,
      });

      const started = await service.start({
        organizationId: context.organizationId,
        providerKey: routeParams.providerKey,
        actorId: context.actorId,
        correlationId: context.correlationId,
      });

      // The session id is safe to return; the state is not, and stays inside
      // the authorization URL the browser is about to follow.
      return { body: { authorizationUrl: started.authorizationUrl, sessionId: started.sessionId } };
    },
  });
}
