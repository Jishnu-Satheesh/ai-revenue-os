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
import { updateOrganizationCompetitorBodySchema } from "@/modules/growth-intelligence/application/organization-competitors";
import { createAuthenticatedOrganizationCompetitorRepository } from "@/modules/growth-intelligence/infrastructure/organization-competitor-repository";

/**
 * Single organisation competitor (Track C1 P2).
 *
 * PATCH updates one row and DELETE removes one row, both pinned to the
 * caller's own organisation: an unknown id or another organisation's row
 * updates zero rows and reads as not-found (404). Managers only; viewers are
 * refused before touching persistence.
 */

const paramsSchema = z
  .object({ organizationId: z.string().uuid(), competitorId: z.string().uuid() })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; competitorId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const parsedParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: parsedParams.organizationId }),
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
        "You do not have permission to update Market Intelligence research.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = updateOrganizationCompetitorBodySchema.parse(
      await request.json().catch(() => ({})),
    );

    const repository = createAuthenticatedOrganizationCompetitorRepository(context.supabase);
    const competitor = await repository.updateCompetitor({
      organizationId,
      competitorId: parsedParams.competitorId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.website !== undefined ? { website: body.website } : {}),
      ...(body.locationHint !== undefined ? { locationHint: body.locationHint } : {}),
    });

    logger.info("growth_intelligence.organization_competitor_updated", {
      organizationId,
      correlationId,
    });
    const response = NextResponse.json({ competitor, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.organization_competitors_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; competitorId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const parsedParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: parsedParams.organizationId }),
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
        "You do not have permission to update Market Intelligence research.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const repository = createAuthenticatedOrganizationCompetitorRepository(context.supabase);
    await repository.deleteCompetitor({
      organizationId,
      competitorId: parsedParams.competitorId,
    });

    logger.info("growth_intelligence.organization_competitor_deleted", {
      organizationId,
      correlationId,
    });
    const response = NextResponse.json({ deleted: true, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.organization_competitors_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
