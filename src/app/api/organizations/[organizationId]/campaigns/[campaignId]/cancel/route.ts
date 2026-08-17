import { NextResponse } from "next/server";

import { apiErrorResponse, publishOrganizationEvent } from "@/lib/api/organization-context";
import { cancelRequestSchema } from "@/modules/campaigns/application/api-schemas";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";

/**
 * Cancels a campaign's future work.
 *
 * Cancellation fences what has not happened yet. It never rewrites what has:
 * a version that was published stays published, and an approval that was
 * granted stays in the record with its own reason for ending.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.cancel");
    cancelRequestSchema.parse(await parseJsonBody(request));
    const campaignId = parseCampaignId(raw);

    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const campaign = await repository.getCampaign(context.organizationId, campaignId);
    if (!campaign) return apiErrorResponse(new Error("This campaign is not available."));

    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: "campaign.cancelled",
      payload: { campaignId },
    });

    return NextResponse.json({ campaignId, state: "cancelled" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
