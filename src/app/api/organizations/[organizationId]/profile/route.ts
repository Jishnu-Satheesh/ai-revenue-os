import { NextResponse } from "next/server";
import { businessProfileInputSchema } from "@/domain/organizations/types";
import { updateBusinessProfile } from "@/domain/organizations/repository";
import {
  apiErrorResponse,
  getOrganizationContext,
  publishOrganizationEvent,
} from "@/lib/api/organization-context";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, ["owner", "admin", "operator"]);
    const input = businessProfileInputSchema.parse(await request.json());
    const profile = await updateBusinessProfile(
      context.supabase,
      context.organizationId,
      context.user.id,
      input,
    );
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: "business_profile.updated",
    });
    return NextResponse.json({ profile });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
