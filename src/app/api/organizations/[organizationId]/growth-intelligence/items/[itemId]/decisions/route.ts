import { NextResponse } from "next/server";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createEventPublisher } from "@/domain/events/publisher";
import type { OrganizationRole } from "@/domain/organizations/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  itemDecisionBodySchema,
  itemDecisionRouteParamsSchema,
  type ItemDecisionBody,
  marketProfileCorrelationState,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createGrowthIntelligenceTriageService } from "@/modules/growth-intelligence/application/triage-service";
import { createSynthesisRepository } from "@/modules/growth-intelligence/infrastructure/synthesis-repository";
import type { SynthesisPersistence } from "@/modules/growth-intelligence/infrastructure/synthesis-repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; itemId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  let itemId: string | undefined;
  let decisionKind: ItemDecisionBody["decision"] | undefined;
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
        "You do not have permission to triage intelligence for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const routeParams = itemDecisionRouteParamsSchema.parse(rawParams);
    itemId = routeParams.itemId;
    const body = itemDecisionBodySchema.parse(await request.json().catch(() => ({})));
    decisionKind = body.decision;
    // The schema already guarantees a parseable instant; this only refuses one
    // that is not in the future, before the member RPC repeats the check.
    if (body.decision === "snoozed" && Date.parse(body.snoozedUntil) <= Date.now()) {
      throw new DomainError("VALIDATION_ERROR", "A snooze needs a future time to hide until.");
    }
    const service = createGrowthIntelligenceTriageService({
      triage: createSynthesisRepository(context.supabase as unknown as SynthesisPersistence),
      events: createEventPublisher(),
    });
    const outcome = await service.decideItem({
      organizationId,
      actorId: context.user.id,
      itemId,
      decision: body.decision,
      reason: body.decision === "dismissed" ? body.reason : null,
      snoozedUntil: body.decision === "snoozed" ? body.snoozedUntil : null,
      itemFingerprint: body.itemFingerprint,
      correlationId,
    });
    logger.info("growth_intelligence.item_decided", {
      organizationId,
      itemId,
      decisionKind,
      correlationId,
    });
    const response = NextResponse.json({ itemId, ...outcome, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.item_decision_api_failed", {
      organizationId,
      itemId,
      decisionKind,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    // A non-optimistic write: the response waits for the committed outcome,
    // so a success always means the answer is stored and the event emitted.
    const response = apiErrorResponse(error);
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
