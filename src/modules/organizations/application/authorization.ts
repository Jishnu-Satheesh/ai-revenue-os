import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import type { OrganizationRole } from "@/domain/organizations/types";

type OrganizationClient = SupabaseClient<Database>;

export async function requireOrganizationAccess(
  supabase: OrganizationClient,
  organizationId: string,
  userId: string,
  allowedRoles?: readonly OrganizationRole[],
) {
  const { data: membership, error } = await supabase
    .from("organization_memberships")
    .select("organization_id, user_id, role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !membership)
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have access to this organization.",
      error,
    );
  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission for this organization action.",
    );
  }
  return membership;
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
