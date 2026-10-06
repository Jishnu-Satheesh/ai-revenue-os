import { NextResponse } from "next/server";

import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";

/**
 * The caller's effective role in this organization: explicit grant and
 * account-derived access resolved the same way every policy resolves them.
 * The UI derives offered controls from the permission mirror; the server
 * re-checks everything, so this answer only ever hides or shows buttons.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params);
    return NextResponse.json({ role: context.membership.role });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
