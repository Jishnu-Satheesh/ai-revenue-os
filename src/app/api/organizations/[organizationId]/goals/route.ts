import { NextResponse } from "next/server";
import { goalInputSchema } from "@/domain/organizations/types";
import { createGoal } from "@/domain/organizations/repository";
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
    const input = goalInputSchema.parse(await request.json());
    const goal = await createGoal(context.supabase, context.organizationId, context.user.id, input);
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      branchId: goal.scope_branch_id ?? undefined,
      eventName: "goal.created",
      payload: { metric: goal.metric },
    });
    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
