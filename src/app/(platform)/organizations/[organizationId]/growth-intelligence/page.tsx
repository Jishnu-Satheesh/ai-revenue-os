import { GrowthIntelligenceWorkspace } from "@/components/growth-intelligence/growth-intelligence-workspace";
import { PerformanceBuildWatcher } from "@/components/growth-intelligence/performance-build-watcher";
import type { MonitoringBranchOption } from "@/components/growth-intelligence/market-monitoring-dialog";
import { MarketWatch } from "@/components/growth-intelligence/market-watch";
import { formatWindow } from "@/components/analysis/format";
import { PageContentLoader } from "@/components/ui/page-content-loader";
import {
  parseWorkspaceMonth,
  summarizeServiceArea,
} from "@/components/growth-intelligence/query-options";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { addLocalDays, localDaysBetween } from "@/domain/analysis/calendar";
import { ChannelAnalysisError } from "@/domain/analysis/errors";
import type { AnalysisGrain } from "@/domain/analysis/types";
import { isWindowCovered } from "@/domain/analysis/window-selection";
import type { CoverageWindow } from "@/domain/analysis/window-selection";
import type { MarketGeographicLayer } from "@/domain/growth-intelligence/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { createEventPublisher } from "@/domain/events/publisher";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { consumeAnalysisRunAllowance } from "@/lib/cache/rate-limit";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  buildBusinessPerformanceCard,
  pickTrendWindows,
  previousEqualRange,
  resolveOverviewWindow,
  wholeMonthsOfRange,
  wholeWeeksOfRange,
} from "@/modules/analysis/application/channels-overview";
import type {
  BusinessPerformanceCardView,
  PerformanceFilterState,
} from "@/modules/analysis/application/channels-overview";
import {
  CARD_CACHE_TTL_SECONDS,
  performanceCardCacheKey,
  performanceCardEnvelopeSchema,
} from "@/modules/analysis/application/performance-card-cache";
import { requestChannelAnalysis } from "@/modules/analysis/application/dispatch";
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
  // The auto-build the loader watches. `buildPending` means runs are in
  // flight (or were just dispatched) for the picked range; `buildFailed`
  // means every missing channel's latest run failed and nothing is left to
  // wait for; `buildRefused` means the scope was too wide to fan out.
  let buildPending = false;
  let buildFailed = false;
  let buildRefused = false;
  let canRequestBuild = false;
  let pendingChannelIds: string[] = [];
  /**
   * One page load fans out at most this many analyses. Past it the page
   * refuses honestly and names the Channel Audit instead of firing a burst
   * of detector passes and narrations behind a loader.
   */
  const MAX_AUTO_BUILD_CHANNELS = 10;
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

      // The operator's range, taken only when the approved reports cover
      // every day of it. A hand-typed range outside coverage -- and the
      // legacy `?window=` value outside coverage -- is not widened or
      // snapped: the page falls through to its default below.
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
      if (requested === null) {
        // The newest analysed dates inside coverage open the card with
        // figures instead of a loader; only when nothing was ever analysed
        // does the newest coverage open behind a build. `loadAnalysedWindowKeys`
        // already returns newest-end first, so the first covered hit wins.
        const seen = new Set<string>();
        for (const key of analysedKeys) {
          const fingerprint = `${key.windowStart}|${key.windowEnd}`;
          if (seen.has(fingerprint)) continue;
          seen.add(fingerprint);
          try {
            if (isWindowCovered(key.windowStart, key.windowEnd, segments)) {
              requested = { from: key.windowStart, to: key.windowEnd };
              break;
            }
          } catch {
            continue;
          }
        }
        if (requested === null && segments.length > 0) {
          const [latest] = [...segments].sort((left, right) =>
            left.end < right.end ? 1 : left.end > right.end ? -1 : 0,
          );
          if (latest) {
            const days = Math.min(localDaysBetween(latest.start, latest.end), 27);
            requested = { from: addLocalDays(latest.end, -days), to: latest.end };
          }
        }
      }

      if (requested !== null) {
        const { from, to } = requested;
        const previous = previousEqualRange({ from, to });
        const resolution = resolveOverviewWindow({
          from,
          to,
          evidenceWindows,
          analysed: analysedKeys,
        });
        const resolved =
          resolution.kind === "resolved"
            ? {
                windowStart: resolution.windowStart,
                windowEnd: resolution.windowEnd,
                grain: resolution.grain,
              }
            : null;
        const analysedWeekKeys = new Set(
          analysedKeys
            .filter((key) => key.grain === "week")
            .map((key) => `${key.windowStart}|${key.windowEnd}`),
        );
        const trendTargets = wholeWeeksOfRange({ from, to }).filter((week) =>
          analysedWeekKeys.has(`${week.from}|${week.to}`),
        );
        // Second tier: whole calendar months with a finished month-grain
        // analysis. Third tier: distinct analysed windows picked for maximum
        // covered days -- week runs are excluded there because weeks already
        // have their own tier above.
        const analysedMonthKeys = new Set(
          analysedKeys
            .filter((key) => key.grain === "month")
            .map((key) => `${key.windowStart}|${key.windowEnd}`),
        );
        const monthTargets = wholeMonthsOfRange({ from, to }).filter((month) =>
          analysedMonthKeys.has(`${month.from}|${month.to}`),
        );
        const windowTargets = pickTrendWindows(
          analysedKeys
            .filter((key) => key.grain !== "week")
            .map((key) => ({ from: key.windowStart, to: key.windowEnd })),
          { from, to },
        );

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

        // The assembled card, cached per period and scope. A hit is served
        // only when no run completed inside the card's date box after it was
        // built, so a newer analysis always rebuilds instead of reading
        // stale. A revalidation failure serves the hit and warns: a transient
        // outage must not take the card down with it.
        const cacheKey = performanceCardCacheKey({
          organizationId: context.organizationId,
          from,
          to,
          channelId: selectedChannelId,
          branchId: selectedBranchId,
        });
        const cached = await cacheGet(cacheKey, performanceCardEnvelopeSchema);
        let cacheUsable =
          cached !== null && cached.card.month.from === from && cached.card.month.to === to;
        if (cacheUsable && cached !== null) {
          try {
            const newer = await analysis.loadCompletedRunCountSince({
              organizationId: context.organizationId,
              since: cached.builtAt,
              windowStartMin: previous.from,
              windowEndMax: to,
            });
            cacheUsable = newer === 0;
          } catch (error) {
            logger.warn("growth_intelligence.performance_cache_revalidation_failed", {
              organizationId: context.organizationId,
              errorCode: error instanceof Error ? error.name : "unknown",
            });
          }
        }
        if (cacheUsable && cached !== null) {
          performanceCard = cached.card;
        } else {
          const [currentBands, previousBands, ...restBands] = await Promise.all([
            analysis.loadChannelRangeCardFindingsForWindow({
              organizationId: context.organizationId,
              windowStart: from,
              windowEnd: to,
            }),
            analysis.loadChannelRangeCardFindingsForWindow({
              organizationId: context.organizationId,
              windowStart: previous.from,
              windowEnd: previous.to,
            }),
            ...trendTargets.map((week) =>
              analysis.loadChannelCardFindingsForWindow({
                organizationId: context.organizationId,
                grain: "week" as const,
                windowStart: week.from,
                windowEnd: week.to,
              }),
            ),
            ...monthTargets.map((month) =>
              analysis.loadChannelCardFindingsForWindow({
                organizationId: context.organizationId,
                grain: "month" as const,
                windowStart: month.from,
                windowEnd: month.to,
              }),
            ),
            ...windowTargets.map((window) =>
              analysis.loadChannelRangeCardFindingsForWindow({
                organizationId: context.organizationId,
                windowStart: window.from,
                windowEnd: window.to,
              }),
            ),
          ]);
          const trendBands = restBands.slice(0, trendTargets.length);
          const monthBands = restBands.slice(
            trendTargets.length,
            trendTargets.length + monthTargets.length,
          );
          const windowBands = restBands.slice(trendTargets.length + monthTargets.length);
          const current = toFindings(currentBands);

          if ([...current.values()].some((findings) => findings.length > 0)) {
            performanceCard = buildBusinessPerformanceCard({
              month: { from, to },
              channels: visibleChannels.map((channel) => ({
                id: channel.id,
                displayName: channel.display_name,
              })),
              current,
              previous: toFindings(previousBands),
              trendWeeks: trendTargets.map((week, index) => ({
                window: week,
                records: toFindings(trendBands[index] ?? []),
              })),
              trendMonths: monthTargets.map((month, index) => ({
                window: month,
                records: toFindings(monthBands[index] ?? []),
              })),
              trendWindows: windowTargets.map((window, index) => ({
                window,
                records: toFindings(windowBands[index] ?? []),
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
                .filter((window) => from <= window.windowStart && window.windowEnd <= to)
                .map((window) => window.sourceFilename)
                .filter((name): name is string => name !== null),
            });
            await cacheSet(
              cacheKey,
              { builtAt: new Date().toISOString(), card: performanceCard },
              CARD_CACHE_TTL_SECONDS,
            );
          } else {
            // Nothing measured for this range yet. Viewers without the run
            // permission get an honest note instead of a build: starting an
            // analysis spends detector passes and narration, which
            // `report.retry` -- not this page -- authorizes.
            canRequestBuild = hasOrganizationPermission(role, "report.retry");
            if (canRequestBuild && visibleChannels.length <= MAX_AUTO_BUILD_CHANNELS) {
              const correlationId = crypto.randomUUID();
              let dispatched = 0;
              let inflight = 0;
              let failed = 0;
              const pending: string[] = [];
              for (const channel of visibleChannels) {
                const resolvedInput = await analysis.resolveWindowInput({
                  organizationId: context.organizationId,
                  channelId: channel.id,
                  from,
                  to,
                });
                // Covered for the organization but not for this channel: the
                // worker would refuse it, so it stays honestly absent.
                if (resolvedInput === null) continue;
                const existing = await analysis.loadRunForWindow({
                  organizationId: context.organizationId,
                  channelId: channel.id,
                  windowStart: resolvedInput.windowStart,
                  windowEnd: resolvedInput.windowEnd,
                });
                // A completed run with no card figures is measured-and-empty,
                // not missing: re-dispatching it would rebuild forever.
                if (existing !== null && existing.status === "completed") continue;
                if (existing !== null && existing.status === "running") {
                  inflight += 1;
                  pending.push(channel.id);
                  continue;
                }
                if (existing !== null && existing.status === "failed") {
                  failed += 1;
                  continue;
                }
                if (!(await consumeAnalysisRunAllowance(context.organizationId))) break;
                const started = await requestChannelAnalysis({
                  organizationId: context.organizationId,
                  channelId: channel.id,
                  branchId: null,
                  windowStart: resolvedInput.windowStart,
                  windowEnd: resolvedInput.windowEnd,
                  periodGrain: resolvedInput.grain,
                  windowTimezone: resolvedInput.timeZone,
                  analysisRunId: crypto.randomUUID(),
                  correlationId,
                });
                if (started) {
                  dispatched += 1;
                  pending.push(channel.id);
                } else {
                  failed += 1;
                }
              }
              buildPending = dispatched > 0 || inflight > 0;
              buildFailed = !buildPending && failed > 0;
              pendingChannelIds = pending;
              logger.info("growth_intelligence.performance_build_checked", {
                organizationId: context.organizationId,
                windowStart: from,
                windowEnd: to,
                correlationId,
              });
            } else if (canRequestBuild) {
              buildRefused = true;
            }
          }
        }
        performanceFilters = {
          from,
          to,
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
    // The build overlay lives on this content container, so it takes over
    // the page-content viewport with its blur while the dock and navbar --
    // rendered outside it -- stay interactive.
    <div className="relative flex min-h-0 w-full flex-1 flex-col gap-8">
      <GrowthIntelligenceWorkspace
        view={view}
        organizationId={context.organizationId}
        canManage={canManage}
        marketWatch={marketWatch}
        isCurrentMonth={activityMonth === null}
        performanceCard={performanceCard}
        fetchedAt={performanceFetchedAt}
        performanceFilters={performanceFilters}
        buildPending={buildPending}
        buildFailed={buildFailed}
        buildRefused={buildRefused}
        canRequestBuild={canRequestBuild}
        branches={branches}
        selectedBranchId={branchId}
      />
      {buildPending && performanceFilters ? (
        <>
          <PageContentLoader
            title="Building this period's figures"
            detail={`${formatWindow(performanceFilters.from, performanceFilters.to)} · watching ${pendingChannelIds.length} ${pendingChannelIds.length === 1 ? "channel" : "channels"}`}
          />
          <PerformanceBuildWatcher
            organizationId={context.organizationId}
            from={performanceFilters.from}
            to={performanceFilters.to}
            channelIds={pendingChannelIds}
          />
        </>
      ) : null}
    </div>
  );
}
