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
  marketProfileDecisionBodySchema,
  marketProfileDecisionRouteParamsSchema,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createMarketProfileService } from "@/modules/growth-intelligence/application/profile-service";
import { createAuthenticatedMarketProfileRepository } from "@/modules/growth-intelligence/infrastructure/profile-repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; versionId: string }> },
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
        "You do not have permission to decide Market Profile changes for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const routeParams = marketProfileDecisionRouteParamsSchema.parse(rawParams);
    const body = marketProfileDecisionBodySchema.parse(await request.json().catch(() => ({})));
    const service = createMarketProfileService({
      repository: createAuthenticatedMarketProfileRepository(context.supabase),
      events: createEventPublisher(),
    });
    const decision = await service.decide({
      organizationId,
      actorId: context.user.id,
      profileVersionId: routeParams.versionId,
      ...body,
      correlationId,
    });
    const response = NextResponse.json({ decision, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.market_profile_decision_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
