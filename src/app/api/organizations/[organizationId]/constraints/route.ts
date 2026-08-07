import { NextResponse } from "next/server";
import { constraintInputSchema } from "@/domain/organizations/types";
import { createConstraint } from "@/domain/organizations/repository";
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
    const input = constraintInputSchema.parse(await request.json());
    const constraint = await createConstraint(
      context.supabase,
      context.organizationId,
      context.user.id,
      input,
    );
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: "constraint.created",
      payload: { constraintType: constraint.constraint_type },
    });
    return NextResponse.json({ constraint }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
