import { NextResponse } from "next/server";
import { z } from "zod";

import type { OrganizationRole } from "@/domain/organizations/types";
import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import { organizationRoleSchema } from "@/domain/organizations/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import {
  listOrganizationTeam,
  removeOrganizationMember,
  updateOrganizationMemberRole,
} from "@/modules/organizations/application/invitations";

const teamManagerRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter(
  (role) =>
    hasOrganizationPermission(role, "organization.member.invite") ||
    hasOrganizationPermission(role, "organization.member.manage_role") ||
    hasOrganizationPermission(role, "organization.member.remove"),
);

const userIdSchema = z.string().uuid();

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

const updateMemberSchema = z.object({ role: organizationRoleSchema });

/**
 * Role changes write the membership row directly: the RLS policy admits owners
 * and admins, and the ceiling trigger refuses anything at or above the actor's
 * own role plus any attempt on the last owner.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; userId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, teamManagerRoles);
    const { userId: rawUserId } = await params;
    const parsedUserId = userIdSchema.safeParse(rawUserId);
    if (!parsedUserId.success)
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Member ID is invalid." } },
        { status: 400 },
      );
    const { role } = updateMemberSchema.parse(await request.json());
    await updateOrganizationMemberRole(
      context.supabase,
      context.organizationId,
      parsedUserId.data,
      role,
    );
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; userId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, teamManagerRoles);
    const { userId: rawUserId } = await params;
    const parsedUserId = userIdSchema.safeParse(rawUserId);
    if (!parsedUserId.success)
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Member ID is invalid." } },
        { status: 400 },
      );
    await removeOrganizationMember(context.supabase, context.organizationId, parsedUserId.data);
    return NextResponse.json({ removed: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
