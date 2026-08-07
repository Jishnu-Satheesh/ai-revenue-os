import { NextResponse } from "next/server";
import { activateOrganization } from "@/domain/organizations/repository";
import {
  apiErrorResponse,
  getOrganizationContext,
  publishOrganizationEvent,
} from "@/lib/api/organization-context";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, ["owner", "admin"]);
    const organization = await activateOrganization(context.supabase, context.organizationId);
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: "organization.activated",
    });
    return NextResponse.json({ organization });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
