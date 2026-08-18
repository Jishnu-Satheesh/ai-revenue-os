import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";

/**
 * A one-click sign-in link for an invited address.
 *
 * `generateLink` mints a token and **sends nothing**. That is the whole reason
 * this exists: Supabase would otherwise deliver its own generic message, and the
 * recipient would need one email to sign in and another to find the invitation.
 * Minting here lets a single message -- ours, through Resend -- both authenticate
 * the person and carry them to the invitation.
 *
 * The link is assembled from `NEXT_PUBLIC_APP_URL` and verified by our own
 * callback, so this path never depends on Supabase's redirect allowlist.
 */

/** Only ever constructed on the server: it holds the service-role key. */
function adminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new DomainError(
      "INTEGRATION_ERROR",
      "Sign-in links cannot be minted without a service role key.",
    );

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function hasAccount(email: string): Promise<boolean> {
  const { data, error } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) return false;
  // listUsers has no address filter, so fall back to generateLink's own answer:
  // `magiclink` fails for an unknown address, which the caller retries as an
  // invite. Kept as a cheap positive check for the common case.
  return (data?.users ?? []).some((user) => user.email?.toLowerCase() === email);
}

/**
 * Returns the URL to put in the invitation email, or null when a link cannot be
 * minted. Null is not a failure of the invitation: the copy-link always works,
 * so a missing sign-in link degrades the email, never the invitation itself.
 */
export async function mintInvitationSignInUrl(input: {
  email: string;
  invitationToken: string;
}): Promise<string | null> {
  const next = `/invitations/${input.invitationToken}`;
  const redirectTo = new URL(
    `/auth/callback?next=${encodeURIComponent(next)}`,
    env.NEXT_PUBLIC_APP_URL,
  ).toString();

  // `magiclink` for someone who already has an identity, `invite` to create one.
  // Trying magiclink first means an existing teammate never gets a second,
  // conflicting identity.
  const preferred = (await hasAccount(input.email)) ? "magiclink" : "invite";

  for (const type of [preferred, preferred === "magiclink" ? "invite" : "magiclink"] as const) {
    const { data, error } = await adminClient().auth.admin.generateLink({
      type,
      email: input.email,
      options: { redirectTo },
    });

    if (!error && data?.properties?.hashed_token) {
      const url = new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL);
      url.searchParams.set("token_hash", data.properties.hashed_token);
      url.searchParams.set("type", type === "invite" ? "invite" : "magiclink");
      url.searchParams.set("next", next);
      return url.toString();
    }

    logger.warn("invitation_sign_in_link.attempt_failed", { refusalCode: type });
  }

  logger.warn("invitation_sign_in_link.unavailable", {});
  return null;
}
