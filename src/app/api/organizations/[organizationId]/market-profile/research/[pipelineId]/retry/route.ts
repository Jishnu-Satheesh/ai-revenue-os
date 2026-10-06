import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileApiErrorResponse,
  marketProfileCorrelationState,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { resolveRetryEligibility } from "@/modules/growth-intelligence/application/research-read-model";
import { createAuthenticatedResearchReadRepository } from "@/modules/growth-intelligence/infrastructure/research-read-repository";

const paramsSchema = z
  .object({ organizationId: z.string().uuid(), pipelineId: z.string().uuid() })
  .strict();

// The client supplies nothing but the idempotency key: scope, actor,
// correlation and every research input stay server-owned, and the governed
// retry RPC reuses the pipeline's own scope and evidence.
const bodySchema = z.object({ idempotencyKey: z.string().trim().min(16).max(200) }).strict();

/**
 * Operator-only analysis retry. Only an actually failed analysis may reclaim
 * its child through the governed RPC; every other stage is refused before
 * any RPC crosses, with the operator's next step in the message.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; pipelineId: string }> },
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
        "You do not have permission to retry Market Intelligence work.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const routeParams = paramsSchema.parse(rawParams);
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const reads = createAuthenticatedResearchReadRepository(context.supabase);
    const pipeline = await reads.readPipeline({
      organizationId: context.organizationId,
      pipelineId: routeParams.pipelineId,
    });
    if (!pipeline) {
      throw new DomainError("TENANT_SCOPE_ERROR", "The requested research was not found.");
    }
    const eligibility = resolveRetryEligibility(pipeline.stage);
    if (!eligibility.eligible) {
      throw new DomainError(
        "DOMAIN_ERROR",
        eligibility.reason ?? "This analysis cannot be retried in its current state.",
      );
    }
    const outcome = await reads.retrySynthesis({
      organizationId: context.organizationId,
      pipelineId: routeParams.pipelineId,
      actorId: context.user.id,
      idempotencyKey: body.idempotencyKey,
      correlationId,
    });
    const response = NextResponse.json({
      retry: { pipelineId: routeParams.pipelineId, ...outcome },
      correlationId,
    });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.research_pipeline_retry_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
