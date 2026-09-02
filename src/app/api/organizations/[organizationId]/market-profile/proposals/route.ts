import { NextResponse } from "next/server";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createEventPublisher } from "@/domain/events/publisher";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileApiErrorResponse,
  marketProfileCorrelationState,
  marketProfileProposalBodySchema,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createMarketProfileService } from "@/modules/growth-intelligence/application/profile-service";
import { createMarketProfileProposalProvider } from "@/modules/growth-intelligence/infrastructure/profile-proposal-provider";
import { createAuthenticatedMarketProfileRepository } from "@/modules/growth-intelligence/infrastructure/profile-repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = await params;
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;

    assertGrowthIntelligenceAccess(organizationId, "market");
    if (
      !hasOrganizationPermission(
        context.membership.role as OrganizationRole,
        "growth_intelligence.manage",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to propose Market Profile changes for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = marketProfileProposalBodySchema.parse(await request.json().catch(() => ({})));
    const service = createMarketProfileService({
      repository: createAuthenticatedMarketProfileRepository(context.supabase),
      proposalProvider: body.source === "ai" ? createMarketProfileProposalProvider() : undefined,
      events: createEventPublisher(),
    });
    const proposal = await service.propose(
      body.source === "ai"
        ? {
            organizationId,
            actorId: context.user.id,
            source: "ai",
            idempotencyKey: body.idempotencyKey,
            correlationId,
          }
        : {
            organizationId,
            actorId: context.user.id,
            source: "operator",
            document: body.profileDocument,
            idempotencyKey: body.idempotencyKey,
            correlationId,
          },
    );
    const response = NextResponse.json(
      { proposal, correlationId },
      { status: proposal.replayed ? 200 : 201 },
    );
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.market_profile_proposal_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
