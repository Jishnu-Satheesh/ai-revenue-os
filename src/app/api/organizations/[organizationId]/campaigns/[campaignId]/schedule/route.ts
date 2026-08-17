import { NextResponse } from "next/server";

import { apiErrorResponse, publishOrganizationEvent } from "@/lib/api/organization-context";
import { scheduleRequestSchema } from "@/modules/campaigns/application/api-schemas";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";

type ScheduleRpc = {
  rpc(
    name: "schedule_campaign_actions",
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code?: string } | null }>;
};

/**
 * Materialises one action run per approved action.
 *
 * The database refuses unless a live, unexpired approval covers this exact
 * version and digest, so scheduling can never become a way around approval. The
 * digest is re-checked here too, because a stale tab would otherwise send a
 * version the operator is no longer looking at.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.schedule");
    const body = scheduleRequestSchema.parse(await parseJsonBody(request));
    const campaignId = parseCampaignId(raw);

    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const version = await repository.getVersion(context.organizationId, body.bundleVersionId);
    if (!version || version.campaignId !== campaignId) {
      return apiErrorResponse(new Error("This version is not available."));
    }
    if (version.digest !== body.bundleDigest) {
      return apiErrorResponse(
        new Error("This proposal changed since you read it. Reload and try again."),
      );
    }

    const { data, error } = await (context.supabase as unknown as ScheduleRpc).rpc(
      "schedule_campaign_actions",
      {
        target_organization_id: context.organizationId,
        input_schedule: {
          organization_id: context.organizationId,
          bundle_version_id: body.bundleVersionId,
        },
      },
    );
    if (error || !data) {
      return apiErrorResponse(new Error("The campaign could not be scheduled."));
    }

    const scheduled = data as { created_count: number; total_count: number };

    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: "campaign.scheduled",
      payload: {
        campaignId,
        bundleVersionId: body.bundleVersionId,
        actionCount: scheduled.total_count,
      },
    });

    return NextResponse.json(scheduled, { status: scheduled.created_count > 0 ? 201 : 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
