import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { attestRequestSchema } from "@/modules/campaigns/application/api-schemas";
import { campaignRouteContext, parseJsonBody } from "@/modules/campaigns/application/route-context";
import { campaignServiceFor } from "@/modules/campaigns/infrastructure/service-factory";

/**
 * The operator's visual-truth attestation.
 *
 * The digest they saw is checked against the stored manifest, so an attestation
 * can only ever cover the exact document that was on screen.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const context = await campaignRouteContext(params, "campaign.attest");
    const body = attestRequestSchema.parse(await parseJsonBody(request));
    const service = campaignServiceFor(context);

    const attestationId = await service.attest(context.organizationId, context.user.id, body);

    return NextResponse.json({ attestationId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
