import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import { organizationRoleSchema, type OrganizationRole } from "@/domain/organizations/types";

type OrganizationClient = SupabaseClient<Database>;

/**
 * The shape callers have always received. Only `role` is read anywhere, but the
 * identifiers are kept so this stayed a change of source rather than a change of
 * contract when access moved from a membership row to a resolved grant.
 */
export type OrganizationAccess = {
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
};

/**
 * Authorization is no longer a row lookup. A user reaches an organization either
 * through an explicit membership or through the account that owns it, and only
 * `private.effective_organization_role` knows how those combine -- the same
 * function every RLS policy in the schema resolves through. Reading
 * `organization_memberships` directly here would answer a narrower question than
 * the database answers, and the two would disagree for every invited teammate.
 *
 * This check is defence in depth, not the boundary. RLS is the boundary.
 */
export async function requireOrganizationAccess(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
  allowedRoles?: readonly OrganizationRole[],
): Promise<OrganizationAccess> {
  const { data, error } = await supabase.rpc("current_organization_role", {
    target_organization_id: organizationId,
  });

  // A null role and a failed call are both "no access" to the caller, but only
  // one of them is worth a cause in the error chain.
  if (error || data === null)
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have access to this organization.",
      error ?? undefined,
    );

  const parsed = organizationRoleSchema.safeParse(data);
  if (!parsed.success)
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have access to this organization.",
      parsed.error,
    );

  if (allowedRoles && !allowedRoles.includes(parsed.data))
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission for this organization action.",
    );

  return { organization_id: organizationId, user_id: userId, role: parsed.data };
}

export async function requireOrganizationWriteAccess(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
) {
  return requireOrganizationAccess(supabase, organizationId, userId, [
    "owner",
    "admin",
    "operator",
  ]);
}

export async function requireOrganizationAdminAccess(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
) {
  return requireOrganizationAccess(supabase, organizationId, userId, ["owner", "admin"]);
}
