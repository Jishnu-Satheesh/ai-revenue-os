import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { productionOAuthApplications } from "@/modules/integrations/application/oauth-applications";
import { createOAuthService } from "@/modules/integrations/application/oauth-service";
import { createVaultCredentialStore } from "@/modules/integrations/infrastructure/vault-credential-store";

const providerKeySchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/**
 * The provider redirect lands here.
 *
 * Nothing about the outcome is written into the URL beyond a stable, opaque
 * result code, and every failure shape returns the same kind of code, so a
 * probe cannot tell "wrong tenant" from "no such session" and map another
 * organization's connections. The authorization code and any token stay
 * server-side; only the credential reference is persisted.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ providerKey: string }> },
) {
  const appOrigin = new URL(env.NEXT_PUBLIC_APP_URL).origin;
  const redirectTo = (resultCode: string, organizationId?: string) => {
    const destination = new URL(
      organizationId ? `/organizations/${organizationId}/integrations` : "/overview",
      appOrigin,
    );
    destination.searchParams.set("result", resultCode);
    return NextResponse.redirect(destination);
  };

  const parsedProvider = providerKeySchema.safeParse((await params).providerKey);
  if (!parsedProvider.success) return redirectTo("oauth_not_configured");

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  // A provider-side denial arrives without a code. It is not an error to
  // report loudly, and its description is provider-controlled text that is
  // deliberately not echoed back into our URL.
  if (!state || !code) return redirectTo("oauth_provider_rejected");

  const correlationId = crypto.randomUUID();
  const supabase = await createClient();

  const service = createOAuthService({
    supabase,
    credentialStore: createVaultCredentialStore(supabase),
    applications: productionOAuthApplications,
    appOrigin,
  });

  const result = await service.completeCallback({
    providerKey: parsedProvider.data,
    state,
    code,
    correlationId,
  });

  return redirectTo(result.resultCode, result.organizationId);
}
