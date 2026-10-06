import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { createGoal } from "@/domain/organizations/repository";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import {
  evidenceRepairRequestSchema,
  repairCampaignEvidence,
} from "@/modules/campaigns/application/evidence-repair";
import {
  createEvidenceRepairAdapter,
  type EvidenceRepairPersistence,
} from "@/modules/campaigns/infrastructure/evidence-repair-repository";

/**
 * Supplies the evidence a campaign said it was missing, and re-pins it.
 *
 * Gated on `campaign.edit`, which is also what the underlying RPC checks. The
 * two are deliberately the same permission: the whole act is "change what this
 * campaign will be built from".
 *
 * Every write here runs through the caller's own session, so RLS decides what
 * may be written and there is no service-role path from the browser to an
 * organization's goals or brand profile.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.edit");
    const campaignId = parseCampaignId(raw);
    const body = evidenceRepairRequestSchema.parse(await parseJsonBody(request));

    const result = await repairCampaignEvidence(
      body,
      createEvidenceRepairAdapter({
        persistence: context.supabase as unknown as EvidenceRepairPersistence,
        organizationId: context.organizationId,
        campaignId,
        userId: context.user.id,
        // Passed in rather than imported inside the adapter, so the goal write
        // keeps going through the one audited path the goals route uses.
        createGoal,
      }),
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    // A repair that could not write or could not pin is a failure the operator
    // has to see, not a quiet 200 carrying a false "done".
    return apiErrorResponse(error);
  }
}
