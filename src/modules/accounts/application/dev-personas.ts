import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Test personas for local development sign-in (ADR 0073).
 *
 * One namespaced user per role, provisioned on demand through the dev-only
 * login route. Nothing here is reachable outside `pnpm dev`: the route 404s,
 * and this module has no other importer. Provisioning touches only
 * `dev.*@lunes.test` users and their membership rows — it never lists real
 * users to a caller and never alters them.
 */

export const devPersonaRoleSchema = z.enum(["owner", "admin", "operator", "viewer"]);
export type DevPersonaRole = z.infer<typeof devPersonaRoleSchema>;

export const DEV_PERSONA_EMAILS: Record<DevPersonaRole, string> = {
  owner: "dev.owner@lunes.test",
  admin: "dev.admin@lunes.test",
  operator: "dev.operator@lunes.test",
  viewer: "dev.viewer@lunes.test",
};

export type DevPersonaAdminClient = {
  listUsers(params: { page: number; perPage: number }): Promise<{
    data: { users: { id: string; email?: string }[] } | null;
    error: { message: string } | null;
  }>;
  createUser(params: {
    email: string;
    email_confirm: boolean;
    user_metadata: Record<string, unknown>;
  }): Promise<{ data: { user: { id: string } | null } | null; error: { message: string } | null }>;
  generateLink(params: {
    type: "magiclink";
    email: string;
    options: { redirectTo: string };
  }): Promise<{
    data: { properties: { hashed_token: string | null } | null } | null;
    error: { message: string } | null;
  }>;
};

export type DevPersonaMembershipStore = {
  upsertMembership(input: {
    organizationId: string;
    userId: string;
    role: DevPersonaRole;
  }): Promise<void>;
};

export type DevPersonaDependencies = {
  admin: DevPersonaAdminClient;
  memberships: DevPersonaMembershipStore;
};

/** Only ever constructed on the server: it holds the service-role key. */
export function createDevPersonaServiceClient(): DevPersonaDependencies {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new DomainError(
      "INTEGRATION_ERROR",
      "Dev personas cannot be provisioned without a service role key.",
    );
  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return {
    admin: {
      listUsers: (params) => client.auth.admin.listUsers(params),
      createUser: (params) => client.auth.admin.createUser(params),
      generateLink: (params) => client.auth.admin.generateLink(params),
    },
    memberships: {
      upsertMembership: async (input) => {
        // Service-role write, so no auth.uid: the role-ceiling trigger passes
        // system paths through, and RLS is bypassed. Dev-only caller.
        const { error } = await client.from("organization_memberships").upsert(
          {
            organization_id: input.organizationId,
            user_id: input.userId,
            role: input.role,
          },
          { onConflict: "organization_id,user_id" },
        );
        if (error)
          throw new DomainError(
            "INTEGRATION_ERROR",
            "The dev persona membership could not be saved.",
          );
      },
    },
  };
}

async function findDevUserId(admin: DevPersonaAdminClient, email: string): Promise<string | null> {
  // listUsers has no address filter; staging holds a handful of users, so a
  // bounded scan terminates fast. Five pages of a hundred is the backstop, not
  // the expectation.
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 100 });
    if (error) throw new DomainError("INTEGRATION_ERROR", "Dev personas could not be listed.");
    const users = data?.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found.id;
    if (users.length < 100) return null;
  }
  throw new DomainError("INTEGRATION_ERROR", "Dev personas could not be listed.");
}

export async function ensureDevPersona(
  deps: DevPersonaDependencies,
  input: { organizationId: string; role: DevPersonaRole },
): Promise<{ userId: string; email: string }> {
  const email = DEV_PERSONA_EMAILS[input.role];
  let userId = await findDevUserId(deps.admin, email);
  if (!userId) {
    const { data, error } = await deps.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { dev_persona: true },
    });
    if (error || !data?.user?.id)
      throw new DomainError("INTEGRATION_ERROR", "The dev persona could not be created.");
    userId = data.user.id;
  }
  // Exactly this role, every time: re-picking a persona converges rather
  // than multiplying rows, and a persona never drifts from its name.
  await deps.memberships.upsertMembership({
    organizationId: input.organizationId,
    userId,
    role: input.role,
  });
  return { userId, email };
}

export async function mintDevPersonaSignInUrl(
  deps: Pick<DevPersonaDependencies, "admin">,
  input: { email: string; next: string },
): Promise<string> {
  if (!(Object.values(DEV_PERSONA_EMAILS) as string[]).includes(input.email))
    throw new DomainError("INTEGRATION_ERROR", "The dev sign-in link could not be minted.");
  // generateLink mints a token and sends nothing. The address never leaves
  // the server: only the token travels, in the redirect the route returns.
  const { data, error } = await deps.admin.generateLink({
    type: "magiclink",
    email: input.email,
    options: {
      redirectTo: new URL(
        `/auth/callback?next=${encodeURIComponent(input.next)}`,
        env.NEXT_PUBLIC_APP_URL,
      ).toString(),
    },
  });
  const token = data?.properties?.hashed_token;
  if (error || !token)
    throw new DomainError("INTEGRATION_ERROR", "The dev sign-in link could not be minted.");
  // Assembled like mintInvitationSignInUrl: our own callback verifies the
  // token, so this never depends on Supabase's redirect allowlist.
  const url = new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set("token_hash", token);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", input.next);
  return url.toString();
}
