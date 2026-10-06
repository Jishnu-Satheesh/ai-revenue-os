import { NextResponse } from "next/server";

import type { OrganizationRole } from "@/domain/organizations/types";
import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { listOrganizationTeam } from "@/modules/organizations/application/invitations";

const teamManagerRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter(
  (role) =>
    hasOrganizationPermission(role, "organization.member.invite") ||
    hasOrganizationPermission(role, "organization.member.manage_role") ||
    hasOrganizationPermission(role, "organization.member.remove"),
);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, teamManagerRoles);
    return NextResponse.json({
      members: await listOrganizationTeam(context.supabase, context.organizationId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
