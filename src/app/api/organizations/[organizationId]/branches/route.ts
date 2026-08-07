import { NextResponse } from "next/server";
import { branchInputSchema } from "@/domain/organizations/types";
import { createBranch } from "@/domain/organizations/repository";
import {
  apiErrorResponse,
  getOrganizationContext,
  publishOrganizationEvent,
} from "@/lib/api/organization-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, ["owner", "admin", "operator"]);
    const input = branchInputSchema.parse(await request.json());
    const branch = await createBranch(context.supabase, context.organizationId, input);
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      branchId: branch.id,
      eventName: "branch.created",
      payload: { slug: branch.slug },
    });
    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
