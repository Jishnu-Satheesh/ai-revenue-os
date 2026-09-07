import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createCampaignDraftService } from "@/modules/decisions/application/campaign-draft-service";

const routeParamsSchema = z
  .object({
    organizationId: z.string().uuid(),
    opportunityId: z.string().uuid(),
  })
  .strict();

const assertionSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    expectedOutcome: z.string().trim().min(1).max(200),
  })
  .strict();

const requestBodySchema = z
  .object({
    opportunityVersion: z.number().int().positive(),
    objective: z.string().trim().min(1).max(500),
    audience: z.string().trim().min(1).max(500),
    assertions: z.array(assertionSchema).min(1).max(50),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

/**
 * Ask for a governed Campaign draft of one Opportunity. The action is Create
 * governed draft, never Approve: the response waits for the committed
 * request outcome, so a success always means the answer is stored. A retry
 * posts the same version and identity and receives the linked request back.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; opportunityId: string }> },
) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  let organizationId: string | undefined;
  let opportunityId: string | undefined;
  try {
    const rawParams = await params;
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;

    if (
      !hasOrganizationPermission(context.membership.role as OrganizationRole, "campaign.create")
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to request a governed draft for this organization.",
      );
    }

    const routeParams = routeParamsSchema.parse(rawParams);
    organizationId = routeParams.organizationId;
    opportunityId = routeParams.opportunityId;
    const body = requestBodySchema.parse(await request.json().catch(() => ({})));

    const service = createCampaignDraftService({
      rpc: async (name, args) => {
        const { data, error } = await context.supabase.rpc(name, args);
        return {
          data: data as {
            requestId: string;
            status: string;
            draftRequestStatus: string;
          } | null,
          error: error as { code: string | null; message: string } | null,
        };
      },
    });
    const outcome = await service.requestDraft({
      organizationId,
      actorId: context.user.id,
      opportunityId,
      opportunityVersion: body.opportunityVersion,
      actionKey: "campaign.governed_draft_v1",
      objective: body.objective,
      audience: body.audience,
      assertions: body.assertions,
      idempotencyKey: body.idempotencyKey,
      correlationId,
    });
    logger.info("campaign.draft_requested", {
      organizationId,
      opportunityId,
      correlationId,
    });
    const response = NextResponse.json({ opportunityId, ...outcome, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("campaign.draft_request_api_failed", {
      organizationId,
      opportunityId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    const response = apiErrorResponse(error);
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
