import { NextResponse } from "next/server";
import { policyInputSchema } from "@/domain/organizations/types";
import { savePolicy } from "@/domain/organizations/repository";
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
    const context = await getOrganizationContext(params, ["owner", "admin"]);
    const input = policyInputSchema.parse(await request.json());
    const policy = await savePolicy(
      context.supabase,
      context.organizationId,
      context.user.id,
      input,
    );
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: "policy.updated",
      payload: { policyType: policy.policy_type, version: policy.version },
    });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
