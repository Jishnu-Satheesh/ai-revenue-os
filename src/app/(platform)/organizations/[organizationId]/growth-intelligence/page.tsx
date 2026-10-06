import { GrowthIntelligenceWorkspace } from "@/components/growth-intelligence/growth-intelligence-workspace";
import {
  type MonitoringBranchOption,
  parseWorkspaceMonth,
  summarizeServiceArea,
} from "@/components/growth-intelligence/query-options";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { addLocalDays, localDaysBetween, localPeriodEnd } from "@/domain/analysis/calendar";
import { ChannelAnalysisError } from "@/domain/analysis/errors";
import type { AnalysisGrain } from "@/domain/analysis/types";
import { isWindowCovered } from "@/domain/analysis/window-selection";
import type { CoverageWindow } from "@/domain/analysis/window-selection";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  buildBusinessPerformanceCard,
  PERFORMANCE_CARD_METRIC_KEYS,
  previousEqualRange,
  resolveOverviewWindow,
} from "@/modules/analysis/application/channels-overview";
import type {
  BusinessPerformanceCardView,
  PerformanceFilterState,
} from "@/modules/analysis/application/channels-overview";
import {
  CARD_CACHE_TTL_SECONDS,
  evidenceFingerprint,
  performanceCardCacheKey,
  performanceCardEnvelopeSchema,
} from "@/modules/analysis/application/performance-card-cache";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import {
  createCampaignProposalReader,
  type ProposalReadPersistence,
} from "@/modules/campaigns/infrastructure/proposal-read-repository";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createGrowthIntelligenceReadService } from "@/modules/growth-intelligence/application/read-service";
import { createAuthenticatedGrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";
import { createAuthenticatedResearchReadRepository } from "@/modules/growth-intelligence/infrastructure/research-read-repository";
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
  const activityMonth = parseWorkspaceMonth(search.month);

  const reads = createAuthenticatedGrowthIntelligenceReadRepository(context.supabase);

  // Campaign proposals are composed in only where the caller could actually be
  // shown one: the campaigns feature has to be on for this organization, and
  // the member has to hold `campaign.read`. Passing no reader is how the lane
  // stays absent rather than appearing empty, which would claim there are no
  // proposals when the truth is that this surface may not look.
  let proposalReader: ReturnType<typeof createCampaignProposalReader> | undefined;
  try {
    assertCampaignsEnabled(context.organizationId);
    if (hasOrganizationPermission(role, "campaign.read")) {
      proposalReader = createCampaignProposalReader(
        context.supabase as unknown as ProposalReadPersistence,
      );
    }
  } catch {
    proposalReader = undefined;
  }

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
    proposals: proposalReader,
    onProposalError: (proposalError) => {
      logger.warn("growth_intelligence.campaign_proposals_degraded", {
        organizationId: context.organizationId,
        errorCode: toPublicError(proposalError).code,
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
        // The default opens on the current month plus the previous month, so
        // the daily trend has room to read. Only when that two-month box is
        // not fully covered does the page fall back to the newest analysed
        // dates inside coverage, then to the 28-day tail.
        try {
          const today = todayInZone(view.timeZone);
          const currentMonthStart = `${today.slice(0, 7)}-01`;
          const prevMonthEnd = addLocalDays(currentMonthStart, -1);
          const prevMonthStart = `${prevMonthEnd.slice(0, 7)}-01`;
          const currentMonthEnd = localPeriodEnd(currentMonthStart, "month");
          if (isWindowCovered(prevMonthStart, currentMonthEnd, segments)) {
            requested = { from: prevMonthStart, to: currentMonthEnd };
          }
        } catch {
          requested = null;
        }
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

        // The assembled card, cached per period and scope. A hit is served
        // only when the evidence fingerprint still matches, so a newer
        // report always rebuilds instead of reading stale. The fingerprint
        // is computed from the windows already loaded above, so
        // revalidation needs no extra read and cannot fail on its own.
        const cacheKey = performanceCardCacheKey({
          organizationId: context.organizationId,
          from,
          to,
          channelId: selectedChannelId,
          branchId: selectedBranchId,
        });
        const fingerprint = evidenceFingerprint(evidenceWindows);
        const cached = await cacheGet(cacheKey, performanceCardEnvelopeSchema);
        const cacheUsable =
          cached !== null &&
          cached.card.month.from === from &&
          cached.card.month.to === to &&
          cached.evidenceFingerprint === fingerprint;
        if (cacheUsable && cached !== null) {
          performanceCard = cached.card;
        } else {
          // Two aggregate reads and nothing analysis-gated: the picked range
          // and its previous equal range over the card's metric keys. Cost
          // travels along only as presence for the footnote.
          const [currentAggregates, previousAggregates] = await Promise.all([
            analysis.loadDailyMetricAggregates({
              organizationId: context.organizationId,
              from,
              to,
              metricKeys: PERFORMANCE_CARD_METRIC_KEYS,
            }),
            analysis.loadDailyMetricAggregates({
              organizationId: context.organizationId,
              from: previous.from,
              to: previous.to,
              metricKeys: PERFORMANCE_CARD_METRIC_KEYS,
            }),
          ]);

          if (currentAggregates.some((row) => visibleIds.has(row.channelId))) {
            performanceCard = buildBusinessPerformanceCard({
              month: { from, to },
              channels: visibleChannels.map((channel) => ({
                id: channel.id,
                displayName: channel.display_name,
              })),
              currentAggregates,
              previousAggregates,
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
              {
                builtAt: new Date().toISOString(),
                evidenceFingerprint: fingerprint,
                card: performanceCard,
              },
              CARD_CACHE_TTL_SECONDS,
            );
          } else {
            // Nothing reported for this range yet. Dispatching analyses would
            // not help: runs read these same rows and write findings, never
            // new figures, so the page states the gap and leaves the next
            // step to the Channel Audit pointer below instead of spending
            // detector passes behind a loader.
            logger.info("growth_intelligence.performance_empty_range", {
              organizationId: context.organizationId,
              windowStart: from,
              windowEnd: to,
            });
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

  // Branches feed the New research dialog's Location selector.
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
        isCurrentMonth={activityMonth === null}
        performanceCard={performanceCard}
        fetchedAt={performanceFetchedAt}
        performanceFilters={performanceFilters}
        branches={branches}
        selectedBranchId={branchId}
        canRequestResearch={
          proposalReader !== undefined &&
          hasOrganizationPermission(role, "campaign.research_request")
        }
      />
    </div>
  );
}
