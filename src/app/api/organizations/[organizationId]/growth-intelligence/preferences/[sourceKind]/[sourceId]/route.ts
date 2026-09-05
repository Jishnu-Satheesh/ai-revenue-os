import { NextResponse } from "next/server";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createEventPublisher } from "@/domain/events/publisher";
import type { OrganizationRole } from "@/domain/organizations/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileCorrelationState,
  preferenceBodySchema,
  preferenceRouteParamsSchema,
  type PreferenceRouteParams,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createGrowthIntelligenceTriageService } from "@/modules/growth-intelligence/application/triage-service";
import { createSynthesisRepository } from "@/modules/growth-intelligence/infrastructure/synthesis-repository";
import type { SynthesisPersistence } from "@/modules/growth-intelligence/infrastructure/synthesis-repository";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; sourceKind: string; sourceId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  let sourceKind: PreferenceRouteParams["sourceKind"] | undefined;
  let sourceId: string | undefined;
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
        "You do not have permission to save preferences for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const routeParams = preferenceRouteParamsSchema.parse(rawParams);
    sourceKind = routeParams.sourceKind;
    sourceId = routeParams.sourceId;
    const body = preferenceBodySchema.parse(await request.json().catch(() => ({})));
    // Channel preference rows are the only ones with a horizon column; the
    // other kinds store pins alone, so a horizon for them is refused here
    // before storage repeats the refusal.
    if (body.snoozedUntil !== null && routeParams.sourceKind !== "channel_recommendation") {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Only channel recommendations accept a snooze horizon.",
      );
    }
    const service = createGrowthIntelligenceTriageService({
      triage: createSynthesisRepository(context.supabase as unknown as SynthesisPersistence),
      events: createEventPublisher(),
    });
    const outcome = await service.setPreference({
      organizationId,
      actorId: context.user.id,
      sourceKind: routeParams.sourceKind,
      sourceId,
      pinned: body.pinned,
      snoozedUntil: body.snoozedUntil,
    });
    logger.info("growth_intelligence.preference_saved", {
      organizationId,
      sourceKind,
      sourceId,
      correlationId,
    });
    const response = NextResponse.json({ sourceId, ...outcome, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.preference_api_failed", {
      organizationId,
      sourceKind,
      sourceId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    const response = apiErrorResponse(error);
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
