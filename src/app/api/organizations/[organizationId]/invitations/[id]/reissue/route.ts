import { NextResponse } from "next/server";

import type { OrganizationRole } from "@/domain/organizations/types";
import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import {
  organizationNameFor,
  reissueOrganizationInvitation,
} from "@/modules/organizations/application/invitations";

const teamManagerRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter(
  (role) =>
    hasOrganizationPermission(role, "organization.member.invite") ||
    hasOrganizationPermission(role, "organization.member.manage_role") ||
    hasOrganizationPermission(role, "organization.member.remove"),
);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; id: string }> },
) {
  try {
    const context = await getOrganizationContext(params, teamManagerRoles);
    const { id } = await params;
    const { data } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", context.user.id)
      .maybeSingle();
    const invitation = await reissueOrganizationInvitation(
      context.supabase,
      context.organizationId,
      id,
      {
        organizationName: await organizationNameFor(context.supabase, context.organizationId),
        inviterName: data?.display_name ?? context.user.email ?? null,
      },
    );
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
