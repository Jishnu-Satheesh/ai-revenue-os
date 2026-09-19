import { NextResponse } from "next/server";

import type { OrganizationRole } from "@/domain/organizations/types";
import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import {
  createOrganizationInvitationInputSchema,
  type CreateOrganizationInvitationInput,
} from "@/domain/access/invitations";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import {
  createOrganizationInvitation,
  listPendingOrganizationInvitations,
  organizationNameFor,
} from "@/modules/organizations/application/invitations";

/**
 * Derived from the mirror rather than listed, so this route and the RLS policy
 * cannot come to disagree about who may manage the team.
 */
const teamManagerRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter(
  (role) =>
    hasOrganizationPermission(role, "organization.member.invite") ||
    hasOrganizationPermission(role, "organization.member.manage_role") ||
    hasOrganizationPermission(role, "organization.member.remove"),
);

async function inviterContext(context: Awaited<ReturnType<typeof getOrganizationContext>>) {
  const { data } = await context.supabase
    .from("profiles")
    .select("display_name")
    .eq("id", context.user.id)
    .maybeSingle();

  return {
    organizationName: await organizationNameFor(context.supabase, context.organizationId),
    inviterName: data?.display_name ?? context.user.email ?? null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, teamManagerRoles);
    return NextResponse.json({
      invitations: await listPendingOrganizationInvitations(
        context.supabase,
        context.organizationId,
      ),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * The response carries `acceptUrl`, which contains the raw token. It is the
 * only time that value exists outside the inviter's clipboard: nothing
 * persists it, and there is no route that can read it back.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, teamManagerRoles);
    const raw = (await request.json()) as unknown;
    const input: CreateOrganizationInvitationInput = createOrganizationInvitationInputSchema.parse(
      raw,
    );
    const invitation = await createOrganizationInvitation(
      context.supabase,
      context.organizationId,
      input,
      await inviterContext(context),
    );
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
