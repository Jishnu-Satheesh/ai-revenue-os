import { NextResponse } from "next/server";
import { archiveDraftOrganization, getDigitalTwin } from "@/domain/organizations/repository";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params);
    return NextResponse.json({
      digitalTwin: await getDigitalTwin(context.supabase, context.organizationId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, ["owner", "admin"]);
    return NextResponse.json({
      organization: await archiveDraftOrganization(context.supabase, context.organizationId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
