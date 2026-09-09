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
import {
  createGrowthIntelligenceReadService,
  type GrowthIntelligenceWorkspaceRepository,
} from "@/modules/growth-intelligence/application/read-service";
import type { GrowthIntelligenceSection } from "@/modules/growth-intelligence/application/read-model";
import { createAuthenticatedGrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";
import { createAuthenticatedResearchReadRepository } from "@/modules/growth-intelligence/infrastructure/research-read-repository";
import { createAuthenticatedMarketProfileRepository } from "@/modules/growth-intelligence/infrastructure/profile-repository";
import type { DecisionPersistence } from "@/modules/decisions/infrastructure/repository";
import { createDecisionRepository } from "@/modules/decisions/infrastructure/repository";
import type { MarketGeographicLayer } from "@/domain/growth-intelligence/types";

const WORKSPACE_SECTIONS: readonly GrowthIntelligenceSection[] = [
  "opportunities",
  "recommendations",
  "insights",
  "data_gaps",
  "timeline",
];

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(500).nullable().optional(),
    geography: z.enum(["trade_area", "city", "country"]).nullable().optional(),
    month: z
      .string()
      .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "The activity month must be canonical YYYY-MM.")
      .nullable()
      .optional(),
    branchId: z.string().uuid().nullable().optional(),
    historyLimit: z.coerce.number().int().min(1).max(50).default(10),
    historyCursor: z.string().min(1).max(500).nullable().optional(),
    sections: z
      .string()
      .min(1)
      .max(200)
      .nullable()
      .optional()
      .transform((value, context) => {
        if (value === null || value === undefined) return undefined;
        const sections = value
          .split(",")
          .map((section) => section.trim())
          .filter((section) => section.length > 0);
        const unknown = sections.filter(
          (section) => !(WORKSPACE_SECTIONS as readonly string[]).includes(section),
        );
        if (unknown.length > 0) {
          context.addIssue({
            code: "custom",
            message: `Unknown workspace sections: ${unknown.join(", ")}.`,
          });
          return z.NEVER;
        }
        return sections as GrowthIntelligenceSection[];
      }),
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
      month: url.searchParams.get("month"),
      branchId: url.searchParams.get("branchId"),
      historyLimit: url.searchParams.get("historyLimit") ?? undefined,
      historyCursor: url.searchParams.get("historyCursor"),
      sections: url.searchParams.get("sections"),
    });

    const service = createMarketProfileService({
      repository: createAuthenticatedMarketProfileRepository(context.supabase),
      events: createEventPublisher(),
    });
    // Legacy organization scope: this read surface predates branch profiles.
    const profile = await service.read({ organizationId, branchId: null });
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

    // The composed workspace reads through the owning modules only and
    // starts no work. A failure here must not take down Market Watch: the
    // page still renders and the workspace simply arrives as null.
    // Research provenance rides the same workspace read; an annotation
    // failure degrades to unattributed cards and is logged, never hidden.
    const researchReads = createAuthenticatedResearchReadRepository(context.supabase);
    let workspace = null;
    try {
      const workspaceService = createGrowthIntelligenceReadService({
        workspace: reads as unknown as GrowthIntelligenceWorkspaceRepository,
        opportunities: createDecisionRepository(
          context.supabase as unknown as DecisionPersistence,
        ),
        research: researchReads,
        onResearchError: (researchError) => {
          logger.warn("growth_intelligence.research_provenance_degraded", {
            organizationId,
            correlationId,
            errorCode: toPublicError(researchError).code,
          });
        },
      });
      workspace = await workspaceService.getWorkspace({
        organizationId,
        actorId: context.user.id,
        activityMonth: query.month,
        sections: query.sections,
        branchId: query.branchId ?? null,
      });
    } catch (workspaceError) {
      logger.warn("growth_intelligence.workspace_degraded", {
        organizationId,
        correlationId,
        errorCode: toPublicError(workspaceError).code,
      });
    }

    // Branch-scoped research composition for the observer: the live
    // pipeline, cursor-paginated retained history (10 per page, 50 max)
    // and the same-branch last success. Legacy scope has no pipelines, so
    // without a branch the section stays null. A failure here degrades to
    // null like the workspace; the status route stays authoritative.
    let research = null;
    if (query.branchId) {
      try {
        const branchProfile = await service.read({ organizationId, branchId: query.branchId });
        const [active, history, lastSuccess] = await Promise.all([
          researchReads.readCurrentPipeline({ organizationId, branchId: query.branchId }),
          researchReads.listPipelineHistory({
            organizationId,
            branchId: query.branchId,
            limit: query.historyLimit,
            cursor: query.historyCursor,
          }),
          researchReads.readLastSuccessfulPipeline({
            organizationId,
            branchId: query.branchId,
            currentVersionId: branchProfile.profile?.currentVersionId ?? null,
          }),
        ]);
        research = { branchId: query.branchId, active, history, lastSuccess };
      } catch (researchError) {
        logger.warn("growth_intelligence.research_history_degraded", {
          organizationId,
          correlationId,
          errorCode: toPublicError(researchError).code,
        });
      }
    }

    const response = NextResponse.json({
      marketWatch: { ...marketWatch, nextCursor: claims.nextCursor },
      profile,
      workspace,
      research,
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
