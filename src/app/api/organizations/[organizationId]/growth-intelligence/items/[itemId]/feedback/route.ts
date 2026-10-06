import { NextResponse } from "next/server";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createEventPublisher } from "@/domain/events/publisher";
import type { OrganizationRole } from "@/domain/organizations/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  itemDecisionRouteParamsSchema,
  itemFeedbackBodySchema,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createGrowthIntelligenceTriageService } from "@/modules/growth-intelligence/application/triage-service";
import {
  createSynthesisRepository,
  type SynthesisPersistence,
} from "@/modules/growth-intelligence/infrastructure/synthesis-repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; itemId: string }> },
) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  let organizationId: string | undefined;
  let itemId: string | undefined;
  try {
    const routeParams = itemDecisionRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: routeParams.organizationId }),
    );
    organizationId = context.organizationId;
    itemId = routeParams.itemId;
    assertGrowthIntelligenceAccess(organizationId, "market");
    if (
      !hasOrganizationPermission(
        context.membership.role as OrganizationRole,
        "growth_intelligence.read",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to read intelligence for this organization.",
      );
    }
    const body = itemFeedbackBodySchema.parse(await request.json().catch(() => ({})));
    const service = createGrowthIntelligenceTriageService({
      triage: createSynthesisRepository(context.supabase as unknown as SynthesisPersistence),
      events: createEventPublisher(),
    });
    const outcome = await service.recordFeedback({
      organizationId,
      actorId: context.user.id,
      itemId,
      helpful: body.helpful,
    });
    logger.info("growth_intelligence.item_feedback_recorded", {
      organizationId,
      itemId,
      correlationId,
    });
    const response = NextResponse.json({ ...outcome, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.item_feedback_api_failed", {
      organizationId,
      itemId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    const response = apiErrorResponse(error);
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
