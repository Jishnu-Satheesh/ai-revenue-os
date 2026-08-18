import "server-only";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { DomainError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { hasAccountPermission, type AccountPermission } from "@/domain/access/permissions";
import { accountRoleSchema, organizationRoleSchema } from "@/domain/organizations/types";

/**
 * The caller's agency, mirroring `getOrganizationContext`.
 *
 * A user belongs to exactly one account today. The membership table already
 * admits several, so this resolves the earliest rather than assuming there is
 * only one -- an assumption that would fail silently the first time it stopped
 * being true.
 */
export async function getAccountContext(requiredPermission?: AccountPermission) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // A dropped packet is not a missing session. Calling it one signs a working
  // operator out; see the same guard in `getOrganizationContext`.
  if (isAuthRetryableFetchError(authError))
    throw new DomainError(
      "INTEGRATION_ERROR",
      "The authentication service could not be reached. Try again.",
      authError,
    );
  if (!user) throw new DomainError("AUTHENTICATION_ERROR", "Authentication is required.");

  const { data, error } = await supabase
    .from("account_memberships")
    .select("account_id, account_role, default_organization_role, accounts(id, name, slug)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data)
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not belong to an agency yet.",
      error ?? undefined,
    );

  const account = Array.isArray(data.accounts) ? data.accounts[0] : data.accounts;
  if (!account) throw new DomainError("AUTHORIZATION_ERROR", "You do not belong to an agency yet.");

  const accountRole = accountRoleSchema.parse(data.account_role);
  const defaultOrganizationRole = data.default_organization_role
    ? organizationRoleSchema.parse(data.default_organization_role)
    : null;

  // Defence in depth and a readable message. RLS and the account triggers are
  // the boundary; this only stops a request earlier and more legibly.
  if (requiredPermission && !hasAccountPermission(accountRole, requiredPermission))
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission for this agency action.",
    );

  return {
    supabase,
    user,
    accountId: account.id,
    accountName: account.name,
    accountSlug: account.slug,
    accountRole,
    defaultOrganizationRole,
  };
}

export type AccountContext = Awaited<ReturnType<typeof getAccountContext>>;
