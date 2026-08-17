import { NextResponse } from "next/server";
import { constraintInputSchema } from "@/domain/organizations/types";
import { saveConstraintVersion } from "@/domain/organizations/repository";
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
    const constraint = await saveConstraintVersion(context.supabase, context.organizationId, input);
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: constraint.version > 1 ? "constraint.superseded" : "constraint.created",
      payload: {
        constraintKey: constraint.constraint_key,
        constraintType: constraint.constraint_type,
        scopeKind: constraint.scope_kind,
        version: constraint.version,
      },
    });
    return NextResponse.json({ constraint }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
