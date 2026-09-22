"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";

import { formatWindow } from "@/components/analysis/format";
import { WindowRangePicker } from "@/components/analysis/window-range-picker";
import { CampaignProposalSection } from "@/components/campaigns/campaign-proposal-card";
import { RequestCampaignResearch } from "@/components/campaigns/request-campaign-research";
import { BusinessPerformanceCard } from "@/components/growth-intelligence/business-performance-card";
import { DataGaps } from "@/components/growth-intelligence/data-gaps";
import { InsightsList } from "@/components/growth-intelligence/insights-list";
import { MarketWatchLivePreview } from "@/components/growth-intelligence/market-watch-live-preview";
import { MarketWatchProjectsSection } from "@/components/growth-intelligence/market-watch-projects";
import { MergedRecommendations } from "@/components/growth-intelligence/merged-recommendations";
import { PriorityActions } from "@/components/growth-intelligence/priority-actions";
import {
  type MonitoringBranchOption,
  requestNewResearchDialog,
} from "@/components/growth-intelligence/query-options";
import { YourActionsTab } from "@/components/growth-intelligence/your-actions-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { growthIntelligencePath } from "@/lib/routes";
import {
  type BusinessPerformanceCardView,
  type PerformanceFilterState,
} from "@/modules/analysis/application/channels-overview";
import type { GrowthIntelligenceView } from "@/modules/growth-intelligence/application/read-model";

const TAB_IDS = ["overview", "recommendations", "actions", "insights"] as const;
type TabId = (typeof TAB_IDS)[number];

function isTab(value: string): value is TabId {
  return TAB_IDS.includes(value as TabId);
}

function formatFetchedAt(value: string, timeZone: string) {
  return new Date(value).toLocaleString("en-AE", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One named evidence period for the New research dialog's business-context
 * summary, e.g. "Channel reports · 1–31 Aug 2026". Unparseable windows fall
 * back to their stored dates rather than failing the section.
 */
function formatEvidencePeriod(start: string, end: string, timeZone: string): string | null {
  try {
    const formatDay = (value: string) =>
      new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
        timeZone,
        day: "numeric",
        month: "short",
      });
    const startLabel = formatDay(start);
    const endLabel = new Date(`${end}T00:00:00Z`).toLocaleDateString("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    if (startLabel === "Invalid Date" || endLabel === "Invalid Date") return null;
    return start === end ? endLabel : `${startLabel}–${endLabel}`;
  } catch {
    return null;
  }
}

function PerformanceSummary({
  card,
  fetchedAt,
  timeZone,
  organizationId,
  filters,
  buildPending,
  buildFailed,
  buildRefused,
  canRequestBuild,
}: {
  card: BusinessPerformanceCardView | null;
  fetchedAt: string | null;
  timeZone: string;
  organizationId: string;
  filters: PerformanceFilterState | null;
  buildPending: boolean;
  buildFailed: boolean;
  buildRefused: boolean;
  canRequestBuild: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [refreshState, setRefreshState] = useState<"idle" | "working" | "failed">("idle");
  const [requestedFrom, setRequestedFrom] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState({ card, fetchedAt });
  const failureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (fetchedAt && fetchedAt !== lastSuccess.fetchedAt) {
    setLastSuccess({ card, fetchedAt });
  }
  const displayedCard = fetchedAt ? card : lastSuccess.card;
  const displayedFetchedAt = fetchedAt ?? lastSuccess.fetchedAt;
  const refreshSucceeded =
    requestedFrom !== null && fetchedAt !== null && fetchedAt !== requestedFrom;
  const refreshFailed = requestedFrom !== null && fetchedAt === null;
  const displayedRefreshState = refreshFailed ? "failed" : refreshSucceeded ? "idle" : refreshState;

  useEffect(
    () => () => {
      if (failureTimer.current) clearTimeout(failureTimer.current);
    },
    [],
  );

  function setParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.push(
      `${pathname ?? growthIntelligencePath(organizationId)}?${next.toString()}#overview`,
    );
  }

  function applyRange(selection: { from: string; to: string }) {
    setParams({ from: selection.from, to: selection.to, window: null });
  }

  function refresh() {
    if (failureTimer.current) clearTimeout(failureTimer.current);
    setRequestedFrom(displayedFetchedAt);
    setRefreshState("working");
    startTransition(() => {
      try {
        router.refresh();
      } catch {
        setRefreshState("failed");
      }
    });
    failureTimer.current = setTimeout(() => {
      setRefreshState("failed");
    }, 10_000);
  }

  const refreshButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={displayedRefreshState === "working"}
      onClick={refresh}
    >
      <RefreshCw
        className={displayedRefreshState === "working" ? "animate-spin" : ""}
        aria-hidden="true"
      />
      {displayedRefreshState === "working"
        ? "Refreshing"
        : displayedRefreshState === "failed"
          ? "Retry"
          : "Refresh"}
    </Button>
  );

  // The filters exist exactly when some range is covered. Without them the
  // picker has no valid selection, so only freshness and refresh remain.
  const filteredOut =
    filters !== null &&
    (filters.channelId !== null || filters.branchId !== null) &&
    (displayedCard?.channelCount ?? 0) === 0;
  const showCard = !filteredOut && (displayedCard !== null || buildPending);

  return (
    <section aria-label="Organization performance" className="flex flex-col gap-4">
      {filters ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="group"
            aria-label="Performance filters"
            className="flex flex-wrap items-center gap-2"
          >
            <WindowRangePicker
              segments={filters.segments}
              windows={filters.coverageWindows}
              selected={{ from: filters.from, to: filters.to }}
              today={filters.today}
              onApply={applyRange}
              subjectLabel="The approved reports state"
            />
            <Select
              value={filters.channelId ?? "all"}
              onValueChange={(value) => setParams({ channel: value === "all" ? null : value })}
            >
              <SelectTrigger aria-label="Channel" className="w-44">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {filters.channels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channel.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.branchId ?? "all"}
              onValueChange={(value) => setParams({ location: value === "all" ? null : value })}
            >
              <SelectTrigger aria-label="Location" className="w-44">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {filters.branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Last fetched{" "}
              {displayedFetchedAt ? formatFetchedAt(displayedFetchedAt, timeZone) : "not available"}
            </span>
            {refreshButton}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Last fetched{" "}
            {displayedFetchedAt ? formatFetchedAt(displayedFetchedAt, timeZone) : "not available"}
          </span>
          {refreshButton}
        </div>
      )}
      {filters && !filters.resolved && !displayedCard && !buildPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {`No completed analysis matches ${formatWindow(filters.from, filters.to)} exactly. Pick a covered range to see measured figures.`}
        </p>
      ) : null}
      {filters && buildFailed && !displayedCard ? (
        <p role="alert" className="text-sm text-destructive">
          The build for this period could not complete. Nothing was changed; press Refresh to try
          again.
        </p>
      ) : null}
      {filters && buildRefused && !displayedCard && !buildPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          This scope covers more channels than one automatic build takes. Run the analyses from the
          Channel Audit page instead.
        </p>
      ) : null}
      {filters &&
      filters.resolved !== null &&
      !canRequestBuild &&
      !displayedCard &&
      !buildPending &&
      !buildFailed ? (
        <p role="status" className="text-sm text-muted-foreground">
          No finished analysis covers this period yet. Someone with analysis permission can run it
          from the Channel Audit page.
        </p>
      ) : null}
      {filteredOut ? (
        <p role="status" className="text-sm text-muted-foreground">
          No channels match the selected filters.
        </p>
      ) : null}
      {displayedRefreshState === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          Refresh failed. The figures and timestamp shown here are still the last successful result.
        </p>
      ) : null}
      {filteredOut ? null : showCard ? (
        // Sections never spinner-load: while the page-content overlay covers
        // the build, the card area holds its shape as quiet skeleton blocks
        // with no figures to misread.
        <div
          data-slot="performance-skeleton"
          aria-hidden={buildPending && !displayedCard ? true : undefined}
        >
          {displayedCard && !buildPending ? (
            <BusinessPerformanceCard card={displayedCard} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((tile) => (
                  <div key={tile} className="flex flex-col gap-2 rounded-xl border p-5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-8 w-28" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_auto_minmax(0,1fr)]">
                <Skeleton className="h-64" />
                <div className="hidden lg:block" aria-hidden="true" />
                <Skeleton className="h-64" />
              </div>
            </div>
          )}
        </div>
      ) : (
        <Card className="p-6">
          <p className="font-medium">Performance reporting is not available yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect and analyse a channel to add measured figures here.
          </p>
        </Card>
      )}
    </section>
  );
}

export function GrowthIntelligenceWorkspace({
  view,
  organizationId,
  canManage,
  isCurrentMonth,
  performanceCard,
  fetchedAt,
  performanceFilters,
  buildPending = false,
  buildFailed = false,
  buildRefused = false,
  canRequestBuild = false,
  branches = [],
  selectedBranchId = null,
  canRequestResearch = false,
}: {
  view: GrowthIntelligenceView;
  organizationId: string;
  canManage: boolean;
  isCurrentMonth: boolean;
  performanceCard: BusinessPerformanceCardView | null;
  fetchedAt: string | null;
  performanceFilters: PerformanceFilterState | null;
  buildPending?: boolean;
  buildFailed?: boolean;
  buildRefused?: boolean;
  canRequestBuild?: boolean;
  branches?: MonitoringBranchOption[];
  selectedBranchId?: string | null;
  /** `campaign.research_request`: may spend the research allowance. */
  canRequestResearch?: boolean;
}) {
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      setTab(isTab(hash) ? hash : "overview");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function changeTab(value: string) {
    if (!isTab(value)) return;
    setTab(value);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${value}`,
    );
  }

  function openNewResearch() {
    changeTab("insights");
    // The New research listener mounts with the Insights tab section, so
    // the open event waits a tick for the tab switch to land.
    setTimeout(() => requestNewResearchDialog(), 0);
  }

  const acted = view.timeline.filter((event) => event.type !== "generated");
  const channelNames = new Map(
    (performanceFilters?.channels ?? []).map((channel) => [channel.id, channel.displayName]),
  );
  const branchNames = new Map(
    (performanceFilters?.branches ?? []).map((branch) => [branch.id, branch.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Growth Intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            See how the business is performing, follow earlier decisions, and choose the next best
            action.
          </p>
        </div>
        <Button size="sm" onClick={openNewResearch} className="shrink-0 self-start sm:mt-1">
          <Plus aria-hidden="true" />
          New research
        </Button>
      </div>
      <Tabs value={tab} onValueChange={changeTab} className="flex flex-col gap-6">
        <div className="overflow-x-auto overflow-y-hidden border-b">
          <TabsList variant="line" className="h-auto min-w-max justify-start">
            <TabsTrigger value="overview" onClick={() => changeTab("overview")}>
              Overview
            </TabsTrigger>
            <TabsTrigger value="recommendations" onClick={() => changeTab("recommendations")}>
              Recommendations <Badge variant="secondary">{view.counts.recommendations}</Badge>
            </TabsTrigger>
            <TabsTrigger value="actions" onClick={() => changeTab("actions")}>
              Your actions <Badge variant="secondary">{acted.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="insights" onClick={() => changeTab("insights")}>
              Insights &amp; market <Badge variant="secondary">{view.counts.insights}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex flex-col gap-10">
          <PerformanceSummary
            card={performanceCard}
            fetchedAt={fetchedAt}
            filters={performanceFilters}
            timeZone={view.timeZone}
            organizationId={organizationId}
            buildPending={buildPending}
            buildFailed={buildFailed}
            buildRefused={buildRefused}
            canRequestBuild={canRequestBuild}
          />

          <section
            aria-label="Top AI recommendations & Campaign opportunities"
            className="flex flex-col gap-4"
          >
            <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight">
                  Top AI recommendations &amp; Campaign opportunities
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Best next moves, scored by impact and freshness. Advice and campaign drafts
                  share one grid.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {canRequestResearch ? (
                  <RequestCampaignResearch organizationId={organizationId} />
                ) : null}
                <Button variant="link" size="sm" asChild className="font-bold text-primary">
                  <a href="#recommendations" onClick={() => setTab("recommendations")}>
                    More <ArrowRight aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>
            <MergedRecommendations
              recommendations={view.priorityActions.recommendations}
              proposals={view.campaignProposals}
              organizationId={organizationId}
              timeZone={view.timeZone}
              canManage={canManage}
              channelNames={channelNames}
              branchNames={branchNames}
            />
          </section>
        </TabsContent>

        <TabsContent value="recommendations" className="flex flex-col gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Recommended next steps</CardTitle>
              <CardDescription>
                Manual advice and campaign-ready opportunities are kept separate so every action is
                clear.
              </CardDescription>
            </CardHeader>
          </Card>
          <PriorityActions
            opportunities={view.priorityActions.opportunities}
            recommendations={view.priorityActions.recommendations}
            organizationId={organizationId}
            timeZone={view.timeZone}
            canManage={canManage}
            channelNames={channelNames}
            branchNames={branchNames}
          />

          {/* After ordinary recommendations, never mixed into them. A
              recommendation is advice someone acts on themselves; a proposal is
              a request to authorize preparing a whole campaign, answered at its
              own gate with its own permission. */}
          <CampaignProposalSection
            proposals={view.campaignProposals}
            organizationId={organizationId}
            timeZone={view.timeZone}
            canRequest={canRequestResearch}
          />
        </TabsContent>

        <TabsContent value="actions" className="flex flex-col gap-6">
          <YourActionsTab
            events={acted}
            opportunities={view.priorityActions.opportunities}
            proposals={view.campaignProposals}
            organizationId={organizationId}
            timeZone={view.timeZone}
            performanceFilters={performanceFilters}
            activityMonth={view.activityMonth}
            isCurrentMonth={isCurrentMonth}
          />
        </TabsContent>

        <TabsContent value="insights" className="flex flex-col gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Insights &amp; market</CardTitle>
              <CardDescription>
                What your evidence says, what is missing, and what market research found — each
                item names its source and next step.
              </CardDescription>
            </CardHeader>
          </Card>
          {selectedBranchId && canManage ? (
            <div className="flex justify-end">
              <MarketWatchLivePreview
                organizationId={organizationId}
                branchId={selectedBranchId}
                canManage={canManage}
              />
            </div>
          ) : null}
          <MarketWatchProjectsSection
            organizationId={organizationId}
            branches={branches.map((branch) => ({ id: branch.id, name: branch.name }))}
            timeZone={view.timeZone}
            canManage={canManage}
            evidencePeriods={(performanceFilters?.coverageWindows ?? [])
              .slice()
              .sort((left, right) => (left.windowEnd < right.windowEnd ? 1 : -1))
              .slice(0, 3)
              .map((window) => {
                const period = formatEvidencePeriod(
                  window.windowStart,
                  window.windowEnd,
                  view.timeZone,
                );
                return {
                  label: `Channel reports · ${period ?? `${window.windowStart}–${window.windowEnd}`}`,
                };
              })}
          />
          <div className="flex min-w-0 flex-col gap-8">
            <InsightsList
              insights={view.insights}
              organizationId={organizationId}
              timeZone={view.timeZone}
              canManage={canManage}
            />
            <DataGaps
              dataGaps={view.dataGaps}
              organizationId={organizationId}
              timeZone={view.timeZone}
              canManage={canManage}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
