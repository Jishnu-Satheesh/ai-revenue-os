import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import {
  campaignRouteContext,
  parseCampaignId,
} from "@/modules/campaigns/application/route-context";
import { campaignServiceFor } from "@/modules/campaigns/infrastructure/service-factory";

/** The campaign, its version chain, and whether an approval still covers it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId } = await params;
    const context = await campaignRouteContext(params, "campaign.read");
    const service = campaignServiceFor(context);
    const timeline = await service.timeline(context.organizationId, parseCampaignId(campaignId));
    return NextResponse.json(timeline);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
