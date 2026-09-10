import { GrowthIntelligenceWorkspace } from "@/components/growth-intelligence/growth-intelligence-workspace";
import type { MonitoringBranchOption } from "@/components/growth-intelligence/market-monitoring-dialog";
import { MarketWatch } from "@/components/growth-intelligence/market-watch";
import {
  parseWorkspaceMonth,
  summarizeServiceArea,
} from "@/components/growth-intelligence/query-options";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { ChannelAnalysisError } from "@/domain/analysis/errors";
import type { AnalysisGrain } from "@/domain/analysis/types";
import { isWindowCovered } from "@/domain/analysis/window-selection";
import type { CoverageWindow } from "@/domain/analysis/window-selection";
import type { MarketGeographicLayer } from "@/domain/growth-intelligence/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { createEventPublisher } from "@/domain/events/publisher";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  buildBusinessPerformanceCard,
  enumerateCoveredMonths,
  previousCalendarMonth,
  resolveOverviewWindow,
  snapToCoveredMonth,
  wholeWeeksOfMonth,
} from "@/modules/analysis/application/channels-overview";
import type {
  BusinessPerformanceCardView,
  PerformanceFilterState,
} from "@/modules/analysis/application/channels-overview";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import type { ChannelBandRecord } from "@/modules/analysis/application/ports";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { buildMarketWatch } from "@/modules/growth-intelligence/application/market-watch";
import { createMarketProfileService } from "@/modules/growth-intelligence/application/profile-service";
import { createGrowthIntelligenceReadService } from "@/modules/growth-intelligence/application/read-service";
import { createAuthenticatedGrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";
import { createAuthenticatedResearchReadRepository } from "@/modules/growth-intelligence/infrastructure/research-read-repository";
import { createAuthenticatedMarketProfileRepository } from "@/modules/growth-intelligence/infrastructure/profile-repository";
import { createDecisionRepository } from "@/modules/decisions/infrastructure/repository";
import type { DecisionPersistence } from "@/modules/decisions/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

type PageProps = {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{
    limit?: string;
    cursor?: string;
    geography?: string;
    month?: string;
    window?: string;
    branch?: string;
    from?: string;
    to?: string;
    channel?: string;
    location?: string;
  }>;
};

/**
 * Today, as the organization's own calendar reads it. `en-CA` renders
 * `YYYY-MM-DD`, the shape every date on this page already uses.
 */
function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

function parseUuid(value: string | undefined): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function parseDateRange(
  from: string | undefined,
  to: string | undefined,
): { from: string; to: string } | null {
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

function parseWindow(
  value: string | undefined,
): { windowStart: string; windowEnd: string; grain: AnalysisGrain } | null {
  if (!value) return null;
  const [windowStart, windowEnd, grain] = value.split("..");
  if (!windowStart || !windowEnd || (grain !== "day" && grain !== "week" && grain !== "month")) {
    return null;
  }
  return { windowStart, windowEnd, grain };
}

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

  let performanceCard: BusinessPerformanceCardView | null = null;
  let performanceFetchedAt: string | null = null;
  let performanceFilters: PerformanceFilterState | null = null;
  const channelAnalysisEnabled = isGovernedChannelAnalysisEnabled(context.organizationId);
  if (channelAnalysisEnabled) {
    try {
      const snapshot = await createChannelService(
        createAuthenticatedChannelRepository(context.supabase),
      ).listManagementSnapshot({
        organizationId: context.organizationId,
        actorId: context.user.id,
        role: context.membership.role,
      });
      const analysis = createAuthenticatedChannelAnalysisRepository(context.supabase);
      const [evidenceWindows, analysedKeys, segments] = await Promise.all([
        analysis.loadEvidenceWindows({
          organizationId: context.organizationId,
          channelId: null,
          limit: 24,
        }),
        analysis.loadAnalysedWindowKeys({ organizationId: context.organizationId }),
        analysis.loadCoverageSegments({
          organizationId: context.organizationId,
          channelId: null,
        }),
      ]);
      const coverageWindows: CoverageWindow[] = evidenceWindows.map((window) => ({
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        grain: window.grain,
        governedRowCount: window.governedRowCount,
      }));

      // The card reads one calendar month at a time. A hand-typed range lands
      // on its month when it sits inside one covered month; anything else --
      // a straddler, an uncovered range, the legacy `?window=` value outside a
      // month -- falls back to the default month rather than widening what
      // this page will state.
      const months = enumerateCoveredMonths(segments);
      let requested: { from: string; to: string } | null = null;
      try {
        const urlRange = parseDateRange(search.from, search.to);
        if (urlRange && isWindowCovered(urlRange.from, urlRange.to, segments)) {
          requested = urlRange;
        } else {
          const legacy = parseWindow(search.window);
          if (legacy && isWindowCovered(legacy.windowStart, legacy.windowEnd, segments)) {
            requested = { from: legacy.windowStart, to: legacy.windowEnd };
          }
        }
      } catch (error) {
        if (!(error instanceof ChannelAnalysisError)) throw error;
        requested = null;
      }
      const analysedMonthKeys = new Set(
        analysedKeys
          .filter((key) => key.grain === "month")
          .map((key) => `${key.windowStart}|${key.windowEnd}`),
      );
      // The newest month with a completed analysis opens the card; a newer
      // reported-but-unanalysed month would open on empty tiles while an
      // older month sits below it with figures.
      const defaultMonth =
        months.find((month) => analysedMonthKeys.has(`${month.from}|${month.to}`)) ??
        months[0] ??
        null;
      const month = requested
        ? (snapToCoveredMonth(requested.from, requested.to, segments) ?? defaultMonth)
        : defaultMonth;

      if (month) {
        const resolution = resolveOverviewWindow({
          from: month.from,
          to: month.to,
          evidenceWindows,
          analysed: analysedKeys,
        });
        // The card compares month to month. A non-month grain resolving on
        // the same dates is a different question with different periods, so
        // it stays unread rather than standing in for the month.
        const resolved =
          resolution.kind === "resolved" && resolution.grain === "month"
            ? {
                windowStart: resolution.windowStart,
                windowEnd: resolution.windowEnd,
                grain: resolution.grain,
              }
            : null;
        const previousMonth = previousCalendarMonth(month.from);
        const analysedWeekKeys = new Set(
          analysedKeys
            .filter((key) => key.grain === "week")
            .map((key) => `${key.windowStart}|${key.windowEnd}`),
        );
        const trendTargets = wholeWeeksOfMonth(month).filter((week) =>
          analysedWeekKeys.has(`${week.from}|${week.to}`),
        );
        const cardInput = {
          organizationId: context.organizationId,
          grain: "month" as const,
        };
        const [currentBands, previousBands, ...trendBands] = await Promise.all([
          resolved
            ? analysis.loadChannelCardFindingsForWindow({
                ...cardInput,
                windowStart: month.from,
                windowEnd: month.to,
              })
            : Promise.resolve([]),
          analysis.loadChannelCardFindingsForWindow({
            ...cardInput,
            windowStart: previousMonth.from,
            windowEnd: previousMonth.to,
          }),
          ...trendTargets.map((week) =>
            analysis.loadChannelCardFindingsForWindow({
              ...cardInput,
              grain: "week" as const,
              windowStart: week.from,
              windowEnd: week.to,
            }),
          ),
        ]);

        // Unknown ids fall back to All rather than failing the page, and a
        // foreign id can only ever do that: every read below stays scoped to
        // this organization.
        const channelId = parseUuid(search.channel);
        const selectedChannelId =
          channelId && snapshot.channels.some((channel) => channel.id === channelId)
            ? channelId
            : null;
        const locationId = parseUuid(search.location);
        const selectedBranchId =
          locationId && snapshot.branches.some((branch) => branch.id === locationId)
            ? locationId
            : null;
        let visibleChannels = snapshot.channels;
        if (selectedChannelId) {
          visibleChannels = visibleChannels.filter((channel) => channel.id === selectedChannelId);
        }
        if (selectedBranchId) {
          const mappedChannelIds = new Set(
            snapshot.branchMappings
              .filter(
                (mapping) => mapping.branch_id === selectedBranchId && mapping.status === "active",
              )
              .map((mapping) => mapping.channel_id),
          );
          visibleChannels = visibleChannels.filter((channel) => mappedChannelIds.has(channel.id));
        }
        const visibleIds = new Set(visibleChannels.map((channel) => channel.id));
        const toFindings = (bands: readonly ChannelBandRecord[]) =>
          new Map(
            bands
              .filter((record) => visibleIds.has(record.channelId))
              .map((record) => [record.channelId, record.findings] as const),
          );

        performanceCard = buildBusinessPerformanceCard({
          month,
          channels: visibleChannels.map((channel) => ({
            id: channel.id,
            displayName: channel.display_name,
          })),
          current: toFindings(currentBands),
          previous: toFindings(previousBands),
          trendWeeks: trendTargets.map((week, index) => ({
            window: week,
            records: toFindings(trendBands[index] ?? []),
          })),
          locationCount: new Set(
            snapshot.branchMappings
              .filter(
                (mapping) => mapping.status === "active" && visibleIds.has(mapping.channel_id),
              )
              .map((mapping) => mapping.branch_id),
          ).size,
          channelScopeName:
            visibleChannels.find((channel) => channel.id === selectedChannelId)?.display_name ??
            null,
          locationScopeName:
            snapshot.branches.find((branch) => branch.id === selectedBranchId)?.name ?? null,
          reportFiles: evidenceWindows
            .filter((window) => month.from <= window.windowStart && window.windowEnd <= month.to)
            .map((window) => window.sourceFilename)
            .filter((name): name is string => name !== null),
        });
        performanceFilters = {
          from: month.from,
          to: month.to,
          resolved,
          channelId: selectedChannelId,
          branchId: selectedBranchId,
          channels: snapshot.channels.map((channel) => ({
            id: channel.id,
            displayName: channel.display_name,
          })),
          branches: snapshot.branches.map((branch) => ({ id: branch.id, name: branch.name })),
          segments,
          coverageWindows,
          today: todayInZone(view.timeZone),
        };
      }
      performanceFetchedAt = new Date().toISOString();
    } catch {
      logger.warn("growth_intelligence.performance_read_failed", {
        organizationId: context.organizationId,
      });
    }
  }
  if (!channelAnalysisEnabled) {
    performanceFetchedAt = new Date().toISOString();
  }

  const marketWatch = (
    <MarketWatch
      organizationId={context.organizationId}
      watch={{ ...watch, nextCursor: claims.nextCursor }}
      canRetry={canManage}
    />
  );

  // Branches feed the Review market monitoring dialog's Location selector.
  // A failed list degrades to no branches rather than failing the page.
  let branches: MonitoringBranchOption[] = [];
  try {
    const { data: branchRows } = await context.supabase
      .from("branches")
      .select("id,name,service_area,is_active")
      .eq("organization_id", context.organizationId)
      .order("name");
    branches = (branchRows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      serviceArea: summarizeServiceArea(row.service_area),
      isActive: row.is_active,
    }));
  } catch {
    logger.warn("growth_intelligence.branch_list_degraded", {
      organizationId: context.organizationId,
    });
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-8">
      <GrowthIntelligenceWorkspace
        view={view}
        organizationId={context.organizationId}
        canManage={canManage}
        marketWatch={marketWatch}
        isCurrentMonth={activityMonth === null}
        performanceCard={performanceCard}
        fetchedAt={performanceFetchedAt}
        performanceFilters={performanceFilters}
        branches={branches}
        selectedBranchId={branchId}
      />
    </div>
  );
}
