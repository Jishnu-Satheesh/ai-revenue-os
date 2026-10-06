import { NextResponse } from "next/server";

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
import {
  createOrganizationCompetitorBodySchema,
} from "@/modules/growth-intelligence/application/organization-competitors";
import { createAuthenticatedOrganizationCompetitorRepository } from "@/modules/growth-intelligence/infrastructure/organization-competitor-repository";

/**
 * Organisation competitors for the New research dialog (Track C1 P2).
 *
 * GET lists the organisation's saved competitors for the caller's own
 * organisation (RLS plus explicit organisation pins on every read). POST
 * saves one competitor permanently, de-duplicated by normalized name: a
 * duplicate name fails closed with VALIDATION_ERROR rather than forking the
 * row. The dialog's edit/delete (Track C2) mutates these rows, never session
 * data. Cross-organisation ids read as not-found (404), never as a leak.
 */

export async function GET(
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
        "growth_intelligence.read",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to read Market Intelligence for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const repository = createAuthenticatedOrganizationCompetitorRepository(context.supabase);
    const competitors = await repository.listCompetitors({ organizationId });

    const response = NextResponse.json({ competitors, correlationId });
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
        "You do not have permission to update Market Intelligence research.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = createOrganizationCompetitorBodySchema.parse(
      await request.json().catch(() => ({})),
    );

    const repository = createAuthenticatedOrganizationCompetitorRepository(context.supabase);
    const competitor = await repository.createCompetitor({
      organizationId,
      name: body.name,
      ...(body.website !== undefined ? { website: body.website } : {}),
      ...(body.locationHint !== undefined ? { locationHint: body.locationHint } : {}),
      actorId: context.user.id,
    });

    logger.info("growth_intelligence.organization_competitor_created", {
      organizationId,
      correlationId,
    });
    const response = NextResponse.json({ competitor, correlationId }, { status: 201 });
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
