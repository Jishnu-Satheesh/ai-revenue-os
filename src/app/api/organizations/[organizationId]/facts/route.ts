import { NextResponse } from "next/server";
import { businessFactInputSchema } from "@/domain/organizations/types";
import { saveBusinessFact } from "@/domain/organizations/repository";
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
    const input = businessFactInputSchema.parse(await request.json());
    const fact = await saveBusinessFact(
      context.supabase,
      context.organizationId,
      context.user.id,
      input,
    );
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      branchId: fact.branch_id ?? undefined,
      eventName: fact.status === "verified" ? "business_fact.verified" : "business_fact.updated",
      payload: { factKey: fact.fact_key, status: fact.status },
    });
    return NextResponse.json({ fact }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
