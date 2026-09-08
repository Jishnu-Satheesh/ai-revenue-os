import { NextResponse } from "next/server";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createEventPublisher } from "@/domain/events/publisher";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileApiErrorResponse,
  marketProfileCorrelationState,
  startBranchResearchBodySchema,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createMarketProfileService } from "@/modules/growth-intelligence/application/profile-service";
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
        "You do not have permission to start Market Research for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = startBranchResearchBodySchema.parse(await request.json().catch(() => ({})));
    if (body.document.branchId !== body.branchId) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "The reviewed scope does not match the selected branch.",
      );
    }
    const service = createMarketProfileService({
      repository: createAuthenticatedMarketProfileRepository(context.supabase),
      events: createEventPublisher(),
    });
    const research = await service.startBranchResearch({
      organizationId,
      actorId: context.user.id,
      branchId: body.branchId,
      document: body.document,
      expectedCurrentVersionId: body.expectedCurrentVersionId,
      idempotencyKey: body.idempotencyKey,
      correlationId,
    });
    const response = NextResponse.json(
      { research, correlationId },
      { status: research.outcome === "started" ? 201 : 200 },
    );
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    // Version and idempotency conflicts are typed outcomes, never success:
    // the client keeps the operator's edits and offers retry guidance.
    if (error instanceof GrowthIntelligenceError) {
      logger.warn("growth_intelligence.market_profile_research_conflict", {
        organizationId,
        correlationId,
        errorCode: error.code,
      });
      const response = NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 422 },
      );
      response.headers.set("x-correlation-id", correlationId);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    logger.warn("growth_intelligence.market_profile_research_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
