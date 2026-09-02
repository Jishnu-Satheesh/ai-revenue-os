import { z } from "zod";

import { NextResponse } from "next/server";

import { DomainError } from "@/lib/errors";
import { apiErrorResponse } from "@/lib/api/organization-context";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";

/**
 * The operator's decision on a learning proposal, and nothing more.
 *
 * A proposal is drafted by the evidence loop and then waits. This route is the
 * whole human surface: dismiss it, keep it campaign-only, or submit it as a
 * separate reusable-recipe proposal under ADR 0013. Submitting sets the target
 * artifact type and status only — it promotes nothing and never mutates the
 * source campaign.
 *
 * The role is approving, exactly like resume: deciding a lesson is a governance
 * act, so a viewer may read a proposal but may not decide it.
 */

const decisionSchema = z.enum(["dismiss", "keep_campaign_only", "submit_for_promotion"]);

const decisionBodySchema = z.strictObject({ decision: decisionSchema });

const proposalIdSchema = z.string().uuid();

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ organizationId: string; campaignId: string; proposalId: string }>;
  },
) {
  try {
    const { campaignId: rawCampaignId, proposalId: rawProposalId } = await params;
    const context = await campaignRouteContext(params, "campaign.approve");
    parseCampaignId(rawCampaignId);

    const proposalId = proposalIdSchema.safeParse(rawProposalId);
    if (!proposalId.success) {
      throw new DomainError("VALIDATION_ERROR", "Proposal ID is invalid.");
    }

    const body = await parseJsonBody(request);
    const parsed = decisionBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_ERROR", "Decision is not one of the allowed choices.");
    }
    const { decision } = parsed.data;

    const client = context.supabase as unknown as {
      rpc(
        name: "decide_campaign_learning_proposal",
        args: Record<string, unknown>,
      ): Promise<{
        data: { outcome?: string; proposal_id?: string; status?: string } | null;
        error: unknown;
      }>;
    };

    const { data, error } = await client.rpc("decide_campaign_learning_proposal", {
      target_organization_id: context.organizationId,
      input_decision: {
        organization_id: context.organizationId,
        proposal_id: proposalId.data,
        decision,
      },
    });

    if (error) return apiErrorResponse(new Error("The learning proposal could not be decided."));

    return NextResponse.json({
      outcome: data?.outcome ?? "decided",
      proposalId: data?.proposal_id ?? proposalId.data,
      status: data?.status ?? null,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
