import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { accountRoleSchema, organizationRoleRank, organizationRoleSchema,
  type OrganizationRole } from "@/domain/organizations/types";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

function readFailure(): never {
  throw new DomainError("INTEGRATION_ERROR", "Current research permissions could not be checked. Try again.");
}

/**
 * Legacy queued agent tasks have no turn lease for get_agent_turn_actor_role.
 * Resolve their exact current grant union from source memberships instead,
 * matching private.effective_organization_role and the existing role rank.
 * This does not trust the dispatch-time role or grant source-write authority.
 */
export async function assertWorkerWatchManageAuthority(
  client: Pick<SupabaseClient<Database>, "from">,
  input: { organizationId: string; actorId: string },
): Promise<OrganizationRole> {
  const scope = z.object({ organizationId: z.string().uuid(), actorId: z.string().uuid() })
    .strict().safeParse(input);
  if (!scope.success) throw new DomainError("AUTHORIZATION_ERROR", "Current research permissions are unavailable.");
  try {
    const [organization, membership] = await Promise.all([
      client.from("organizations").select("account_id").eq("id", scope.data.organizationId).maybeSingle(),
      client.from("organization_memberships").select("role")
        .eq("organization_id", scope.data.organizationId).eq("user_id", scope.data.actorId).maybeSingle(),
    ]);
    if (organization.error || membership.error) readFailure();
    if (!organization.data) throw new DomainError("AUTHORIZATION_ERROR", "You no longer have permission for this research action.");
    const accountId = z.string().uuid().safeParse(organization.data.account_id);
    if (!accountId.success) readFailure();
    const accountMembership = await client.from("account_memberships")
      .select("account_role,default_organization_role")
      .eq("account_id", accountId.data).eq("user_id", scope.data.actorId).maybeSingle();
    if (accountMembership.error) readFailure();
    const roles: OrganizationRole[] = [];
    if (membership.data) {
      const direct = organizationRoleSchema.safeParse(membership.data.role);
      if (!direct.success) readFailure();
      roles.push(direct.data);
    }
    if (accountMembership.data) {
      const inherited = z.object({ account_role: accountRoleSchema,
        default_organization_role: organizationRoleSchema.nullable() }).safeParse(accountMembership.data);
      if (!inherited.success) readFailure();
      const role = inherited.data.account_role === "owner" || inherited.data.account_role === "admin"
        ? inherited.data.account_role : inherited.data.default_organization_role;
      if (role !== null) roles.push(role);
    }
    const role = roles.sort((left, right) => organizationRoleRank(right) - organizationRoleRank(left))[0];
    if (!role || !hasOrganizationPermission(role, "growth_intelligence.manage")) {
      throw new DomainError("AUTHORIZATION_ERROR", "You no longer have permission for this research action.");
    }
    return role;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    readFailure();
  }
}
