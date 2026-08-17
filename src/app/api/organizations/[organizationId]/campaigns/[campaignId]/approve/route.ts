import { NextResponse } from "next/server";

import { apiErrorResponse, publishOrganizationEvent } from "@/lib/api/organization-context";
import { approveRequestSchema } from "@/modules/campaigns/application/api-schemas";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";

/**
 * Approval, bound to an exact version and digest.
 *
 * Everything that decides whether this is allowed is re-evaluated inside the
 * database: the caller's role, the attestation, the version not being
 * superseded, and the spend ceiling matching the version under review.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId } = await params;
    const context = await campaignRouteContext(params, "campaign.approve");
    const body = approveRequestSchema.parse(await parseJsonBody(request));
    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );

    const version = await repository.getVersion(context.organizationId, body.bundleVersionId);
    if (!version || version.campaignId !== parseCampaignId(campaignId)) {
      return apiErrorResponse(new Error("This version is not available."));
    }

    const approvalId = await repository.approve({
      organizationId: context.organizationId,
      bundleVersionId: body.bundleVersionId,
      bundleDigest: body.bundleDigest,
      attestationId: body.attestationId,
      expiresAt: body.expiresAt,
      capabilityGrantVersions: {},
      policyVersionIds: [],
      actionKeys: body.actionKeys,
      totalSpendCeiling: version.manifest.totalSpendCeiling,
    });

    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: "campaign.approved",
      payload: {
        campaignId: version.campaignId,
        bundleVersionId: body.bundleVersionId,
        approvalId,
      },
    });

    return NextResponse.json({ approvalId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
