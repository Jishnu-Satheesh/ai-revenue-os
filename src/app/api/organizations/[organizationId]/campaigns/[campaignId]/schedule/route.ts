import { NextResponse } from "next/server";

import { apiErrorResponse, publishOrganizationEvent } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
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
  ): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
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
      // Fail closed, visibly: without a live launch authority nothing is
      // queued, and the operator is told the one act that unblocks it rather
      // than a generic failure that invites retrying the same call.
      if (error?.message?.includes("campaign_schedule_requires_launch_authority")) {
        return apiErrorResponse(
          new DomainError(
            "DOMAIN_ERROR",
            "Publication has not been authorized for these exact outputs yet. Authorize publication first, then schedule again.",
          ),
        );
      }
      // A partial authority schedules only what it covers. When it covers
      // none of the approved actions, scheduling stops here rather than
      // recording a silent zero-create that reads as done.
      if (error?.message?.includes("campaign_schedule_launch_authority_covers_nothing")) {
        return apiErrorResponse(
          new DomainError(
            "DOMAIN_ERROR",
            "The publication authority does not cover any of these scheduled actions yet. Authorize the missing outputs first, then schedule again.",
          ),
        );
      }
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
