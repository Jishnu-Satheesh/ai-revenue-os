import { NextResponse } from "next/server";

import type { OrganizationRole } from "@/domain/organizations/types";
import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { revokeOrganizationInvitation } from "@/modules/organizations/application/invitations";

const teamManagerRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter(
  (role) =>
    hasOrganizationPermission(role, "organization.member.invite") ||
    hasOrganizationPermission(role, "organization.member.manage_role") ||
    hasOrganizationPermission(role, "organization.member.remove"),
);

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; id: string }> },
) {
  try {
    const context = await getOrganizationContext(params, teamManagerRoles);
    const { id } = await params;
    await revokeOrganizationInvitation(context.supabase, context.organizationId, id);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
