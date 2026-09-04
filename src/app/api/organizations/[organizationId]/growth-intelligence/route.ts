import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createEventPublisher } from "@/domain/events/publisher";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileApiErrorResponse,
  marketProfileCorrelationState,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { buildMarketWatch } from "@/modules/growth-intelligence/application/market-watch";
import { createMarketProfileService } from "@/modules/growth-intelligence/application/profile-service";
import { createAuthenticatedGrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";
import { createAuthenticatedMarketProfileRepository } from "@/modules/growth-intelligence/infrastructure/profile-repository";
import type { MarketGeographicLayer } from "@/domain/growth-intelligence/types";

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(500).nullable().optional(),
    geography: z.enum(["trade_area", "city", "country"]).nullable().optional(),
  })
  .strict();

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

    const url = new URL(request.url);
    const query = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor"),
      geography: url.searchParams.get("geography"),
    });

    const service = createMarketProfileService({
      repository: createAuthenticatedMarketProfileRepository(context.supabase),
      events: createEventPublisher(),
    });
    const profile = await service.read(organizationId);
    const currentVersionId = profile.profile?.currentVersionId ?? null;

    const reads = createAuthenticatedGrowthIntelligenceReadRepository(context.supabase);
    const currentVersion = profile.versions.find((version) => version.id === currentVersionId);
    const allowBoundedQuotes = currentVersion?.document.sourcePolicy.allowBoundedQuotes ?? false;

    const claims = currentVersionId
      ? await reads.listClaimPage({
          organizationId,
          profileVersionId: currentVersionId,
          limit: query.limit,
          cursor: query.cursor,
        })
      : { claims: [], nextCursor: null };
    const claimIds = claims.claims.map((claim) => claim.id);
    const runIds = [...new Set(claims.claims.map((claim) => claim.runId))];
    const [sources, links, events, requests] = await Promise.all([
      reads.listSourcesByRuns({ organizationId, runIds }),
      reads.listLinksByClaims({ organizationId, claimIds }),
      reads.listEventsByClaims({ organizationId, claimIds }),
      reads.listRequests({ organizationId, limit: 50 }),
    ]);

    // Pagination follows the claim page: the builder shapes exactly the rows
    // this page resolved, so filtered pages may be short and the next cursor
    // is always the repository's keyset cursor, never a builder offset.
    const marketWatch = buildMarketWatch({
      profile,
      claims: claims.claims,
      sources,
      links,
      events,
      requests,
      limit: Math.max(claims.claims.length, 1),
      cursor: null,
      geography: (query.geography ?? null) as MarketGeographicLayer | null,
      now: new Date().toISOString(),
      allowBoundedQuotes,
    });

    const response = NextResponse.json({
      marketWatch: { ...marketWatch, nextCursor: claims.nextCursor },
      profile,
    });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.market_watch_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
