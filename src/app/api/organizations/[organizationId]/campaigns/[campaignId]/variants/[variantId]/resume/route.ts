import { z } from "zod";

import { NextResponse } from "next/server";

import { DomainError } from "@/lib/errors";
import { apiErrorResponse } from "@/lib/api/organization-context";
import {
  campaignRouteContext,
  parseCampaignId,
} from "@/modules/campaigns/application/route-context";

/**
 * The only way a paused variant ever starts again.
 *
 * The loop may pause; it may never resume. Restarting a variant re-grants spend
 * authority, so this is an approving-role action, and the database records who
 * did it and when before the variant returns to `published`. There is no other
 * resume path anywhere in the codebase, by design.
 */

const variantIdSchema = z.string().uuid();

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ organizationId: string; campaignId: string; variantId: string }> },
) {
  try {
    const { campaignId: rawCampaignId, variantId: rawVariantId } = await params;
    // Approving roles only: resume is the mirror image of approve, because it
    // re-grants the authority the loop took away.
    const context = await campaignRouteContext(params, "campaign.approve");
    parseCampaignId(rawCampaignId);

    const variantId = variantIdSchema.safeParse(rawVariantId);
    if (!variantId.success) {
      throw new DomainError("VALIDATION_ERROR", "Variant ID is invalid.");
    }

    const client = context.supabase as unknown as {
      rpc(
        name: "resume_campaign_variant",
        args: Record<string, unknown>,
      ): Promise<{ data: { outcome?: string } | null; error: unknown }>;
    };

    const { data, error } = await client.rpc("resume_campaign_variant", {
      target_organization_id: context.organizationId,
      input_resume: {
        organization_id: context.organizationId,
        variant_id: variantId.data,
      },
    });

    if (error) return apiErrorResponse(new Error("The variant could not be resumed."));

    return NextResponse.json({ outcome: data?.outcome ?? "resumed" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
