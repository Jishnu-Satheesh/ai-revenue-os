import { GrowthIntelligenceWorkspace } from "@/components/growth-intelligence/growth-intelligence-workspace";
import { MarketProfileReview } from "@/components/growth-intelligence/market-profile-review";
import { MarketWatch } from "@/components/growth-intelligence/market-watch";
import { parseWorkspaceMonth } from "@/components/growth-intelligence/query-options";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { MarketGeographicLayer } from "@/domain/growth-intelligence/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { createEventPublisher } from "@/domain/events/publisher";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { buildMarketWatch } from "@/modules/growth-intelligence/application/market-watch";
import { createMarketProfileService } from "@/modules/growth-intelligence/application/profile-service";
import { createGrowthIntelligenceReadService } from "@/modules/growth-intelligence/application/read-service";
import { createAuthenticatedGrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";
import { createAuthenticatedResearchReadRepository } from "@/modules/growth-intelligence/infrastructure/research-read-repository";
import { createAuthenticatedMarketProfileRepository } from "@/modules/growth-intelligence/infrastructure/profile-repository";
import { createDecisionRepository } from "@/modules/decisions/infrastructure/repository";
import type { DecisionPersistence } from "@/modules/decisions/infrastructure/repository";

type PageProps = {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{
    limit?: string;
    cursor?: string;
    geography?: string;
    month?: string;
    branch?: string;
  }>;
};

function parseLimit(value: string | undefined): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), 50);
}

function parseGeography(value: string | undefined): MarketGeographicLayer | null {
  return value === "trade_area" || value === "city" || value === "country" ? value : null;
}

export default async function GrowthIntelligencePage({ params, searchParams }: PageProps) {
  const context = await getOrganizationContext(params);
  const role = context.membership.role as OrganizationRole;

  assertGrowthIntelligenceAccess(context.organizationId, "market");
  if (!hasOrganizationPermission(role, "growth_intelligence.read")) {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to read Market Intelligence for this organization.",
    );
  }
  const canManage = hasOrganizationPermission(role, "growth_intelligence.manage");

  const search = (await searchParams) ?? {};
  const limit = parseLimit(search.limit);
  const activityMonth = parseWorkspaceMonth(search.month);

  const service = createMarketProfileService({
    repository: createAuthenticatedMarketProfileRepository(context.supabase),
    events: createEventPublisher(),
  });
  // Legacy organization scope: this workspace surface predates branch profiles.
  const profile = await service.read({ organizationId: context.organizationId, branchId: null });
  const currentVersionId = profile.profile?.currentVersionId ?? null;

  const reads = createAuthenticatedGrowthIntelligenceReadRepository(context.supabase);
  const claims = currentVersionId
    ? await reads.listClaimPage({
        organizationId: context.organizationId,
        profileVersionId: currentVersionId,
        limit,
        cursor: search.cursor ?? null,
      })
    : { claims: [], nextCursor: null };
  const claimIds = claims.claims.map((claim) => claim.id);
  const runIds = [...new Set(claims.claims.map((claim) => claim.runId))];
  const [sources, links, events, requests] = await Promise.all([
    reads.listSourcesByRuns({ organizationId: context.organizationId, runIds }),
    reads.listLinksByClaims({ organizationId: context.organizationId, claimIds }),
    reads.listEventsByClaims({ organizationId: context.organizationId, claimIds }),
    reads.listRequests({ organizationId: context.organizationId, limit: 50 }),
  ]);

  const currentVersion = profile.versions.find((version) => version.id === currentVersionId);
  const watch = buildMarketWatch({
    profile,
    claims: claims.claims,
    sources,
    links,
    events,
    requests,
    limit: Math.max(claims.claims.length, 1),
    cursor: null,
    geography: parseGeography(search.geography),
    now: new Date().toISOString(),
    allowBoundedQuotes: currentVersion?.document.sourcePolicy.allowBoundedQuotes ?? false,
  });

  const readService = createGrowthIntelligenceReadService({
    workspace: reads,
    opportunities: createDecisionRepository(context.supabase as unknown as DecisionPersistence),
    research: createAuthenticatedResearchReadRepository(context.supabase),
    onResearchError: (researchError) => {
      logger.warn("growth_intelligence.research_provenance_degraded", {
        organizationId: context.organizationId,
        errorCode: toPublicError(researchError).code,
      });
    },
  });
  // A selected branch scopes research provenance and activity; any other
  // value keeps the legacy organization-wide read.
  const branchId =
    typeof search.branch === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.branch)
      ? search.branch
      : null;
  const view = await readService.getWorkspace({
    organizationId: context.organizationId,
    actorId: context.user.id,
    activityMonth: activityMonth ?? undefined,
    branchId,
  });

  const marketWatch = (
    <MarketWatch
      organizationId={context.organizationId}
      watch={{ ...watch, nextCursor: claims.nextCursor }}
      canRetry={canManage}
    />
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Growth intelligence</h1>
        <p className="text-sm text-muted-foreground">
          What needs you next, what the evidence says, and what changed. Opening this page never
          starts research.
        </p>
      </div>
      <MarketProfileReview
        organizationId={context.organizationId}
        profile={profile}
        canManage={canManage}
      />
      <GrowthIntelligenceWorkspace
        view={view}
        organizationId={context.organizationId}
        canManage={canManage}
        marketWatch={marketWatch}
        isCurrentMonth={activityMonth === null}
      />
    </div>
  );
}
