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
import { createAuthenticatedResearchReadRepository } from "@/modules/growth-intelligence/infrastructure/research-read-repository";

const paramsSchema = z
  .object({ organizationId: z.string().uuid(), pipelineId: z.string().uuid() })
  .strict();

/**
 * Authenticated pipeline status for the research observer (viewer and up).
 * A pipeline hidden by RLS reads as missing, so a foreign tenant receives
 * 404 without learning whether the id exists.
 */
export async function GET(
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
        "growth_intelligence.read",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to read Market Intelligence for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const routeParams = paramsSchema.parse(rawParams);
    const reads = createAuthenticatedResearchReadRepository(context.supabase);
    // Tenant scope stays server-owned: routeParams only validates shape,
    // while the repository receives the context organization the session proved.
    const pipeline = await reads.readPipeline({
      organizationId: context.organizationId,
      pipelineId: routeParams.pipelineId,
    });
    if (!pipeline) {
      throw new DomainError("TENANT_SCOPE_ERROR", "The requested research was not found.");
    }
    const response = NextResponse.json({ pipeline, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.research_pipeline_status_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
