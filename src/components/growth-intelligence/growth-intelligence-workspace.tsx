"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, RefreshCw, Settings2, Sparkles } from "lucide-react";

import { formatWindow } from "@/components/analysis/format";
import { WindowMonthPicker } from "@/components/analysis/window-range-picker";
import { BusinessPerformanceCard } from "@/components/growth-intelligence/business-performance-card";
import { DataGaps } from "@/components/growth-intelligence/data-gaps";
import { InsightsList } from "@/components/growth-intelligence/insights-list";
import { IntelligenceTimeline } from "@/components/growth-intelligence/intelligence-timeline";
import {
  MarketMonitoringDialog,
  type MonitoringBranchOption,
} from "@/components/growth-intelligence/market-monitoring-dialog";
import { PriorityActions } from "@/components/growth-intelligence/priority-actions";
import {
  MARKET_MONITORING_OPEN_EVENT,
  previousMonth,
  requestMarketMonitoringDialog,
} from "@/components/growth-intelligence/query-options";
import {
  ResearchProgress,
  useResearchPipeline,
} from "@/components/growth-intelligence/research-progress";
import { ResearchOutcomes } from "@/components/growth-intelligence/research-outcomes";
import type { ResearchPipelineView } from "@/modules/growth-intelligence/application/research-read-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  enumerateCoveredMonths,
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

function PerformanceSummary({
  card,
  fetchedAt,
  timeZone,
  organizationId,
  filters,
}: {
  card: BusinessPerformanceCardView | null;
  fetchedAt: string | null;
  timeZone: string;
  organizationId: string;
  filters: PerformanceFilterState | null;
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

  function applyMonth(selection: { from: string; to: string }) {
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

  // The filters exist exactly when some month is reported. Without them the
  // picker has no valid selection, so only freshness and refresh remain.
  const filteredOut =
    filters !== null &&
    (filters.channelId !== null || filters.branchId !== null) &&
    (displayedCard?.channelCount ?? 0) === 0;
  const coveredMonths = filters ? enumerateCoveredMonths(filters.segments) : [];

  return (
    <section aria-label="Organization performance" className="flex flex-col gap-4">
      {filters ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="group"
            aria-label="Performance filters"
            className="flex flex-wrap items-center gap-2"
          >
            <WindowMonthPicker
              months={coveredMonths}
              selected={{ from: filters.from, to: filters.to }}
              onApply={applyMonth}
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
      {filters && !filters.resolved ? (
        <p role="status" className="text-sm text-muted-foreground">
          {`No completed analysis matches ${formatWindow(filters.from, filters.to)} exactly. Pick a reported month to see measured figures.`}
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
      {filteredOut ? null : displayedCard ? (
        <BusinessPerformanceCard card={displayedCard} />
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

function BranchResearch({
  organizationId,
  active,
  history,
  lastSuccess,
  status,
  timeZone,
  canManage,
}: {
  organizationId: string;
  active: ResearchPipelineView | null;
  history: ResearchPipelineView[];
  lastSuccess: ResearchPipelineView | null;
  status: "loading" | "ready" | "unavailable";
  timeZone: string;
  canManage: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ResearchProgress
        organizationId={organizationId}
        pipeline={active}
        timeZone={timeZone}
        loadError={status === "unavailable" && !active ? "network" : null}
      />
      <ResearchOutcomes
        organizationId={organizationId}
        history={history}
        lastSuccess={lastSuccess}
        canManage={canManage}
      />
    </div>
  );
}

export function GrowthIntelligenceWorkspace({
  view,
  organizationId,
  canManage,
  marketWatch,
  isCurrentMonth,
  performanceCard,
  fetchedAt,
  performanceFilters,
  branches = [],
  selectedBranchId = null,
}: {
  view: GrowthIntelligenceView;
  organizationId: string;
  canManage: boolean;
  marketWatch: React.ReactNode;
  isCurrentMonth: boolean;
  performanceCard: BusinessPerformanceCardView | null;
  fetchedAt: string | null;
  performanceFilters: PerformanceFilterState | null;
  branches?: MonitoringBranchOption[];
  selectedBranchId?: string | null;
}) {
  const base = growthIntelligencePath(organizationId);
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");
  const [monitoringOpen, setMonitoringOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      setTab(isTab(hash) ? hash : "overview");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    const open = () => setMonitoringOpen(true);
    window.addEventListener(MARKET_MONITORING_OPEN_EVENT, open);
    return () => window.removeEventListener(MARKET_MONITORING_OPEN_EVENT, open);
  }, []);

  function refreshResearch() {
    startTransition(() => {
      router.refresh();
    });
  }

  // The pipeline observer lives above the tabs so active runs keep polling
  // while the operator reads other sections; the views below render inside
  // Insights & market only.
  const research = useResearchPipeline({
    organizationId,
    branchId: selectedBranchId,
    onTransition: refreshResearch,
  });

  function changeTab(value: string) {
    if (!isTab(value)) return;
    setTab(value);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${value}`,
    );
  }

  const acted = view.timeline.filter((event) => event.type !== "generated");
  const topRecommendations = view.priorityActions.recommendations.slice(0, 3);

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
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMonitoringOpen(true)}
          className="shrink-0 self-start sm:mt-1"
        >
          <Settings2 aria-hidden="true" />
          Market monitoring
        </Button>
      </div>
      <Tabs value={tab} onValueChange={changeTab} className="flex flex-col gap-6">
        <MarketMonitoringDialog
          organizationId={organizationId}
          canManage={canManage}
          branches={branches}
          initialBranchId={selectedBranchId}
          open={monitoringOpen}
          onOpenChange={setMonitoringOpen}
          onStarted={refreshResearch}
        />
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
          />

          <section aria-label="Previous actions" className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Previous actions</h2>
                <p className="text-sm text-muted-foreground">
                  What you decided and what happened next.
                </p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <a href="#actions" onClick={() => setTab("actions")}>
                  View all <ArrowRight aria-hidden="true" />
                </a>
              </Button>
            </div>
            {acted.length > 0 ? (
              <Card>
                <CardContent>
                  <IntelligenceTimeline
                    events={acted.slice(0, 4)}
                    timeZone={view.timeZone}
                    compact
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
                  <Clock3 aria-hidden="true" />
                  Your acknowledgements, plans, snoozes, and draft progress will appear here.
                </CardContent>
              </Card>
            )}
          </section>

          <section aria-label="Top Recommendations" className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-5 text-primary" aria-hidden="true" />
                  <h2 className="text-xl font-semibold">Top Recommendations</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The clearest actions waiting for your decision.
                </p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <a href="#recommendations" onClick={() => setTab("recommendations")}>
                  More <ArrowRight aria-hidden="true" />
                </a>
              </Button>
            </div>
            <PriorityActions
              opportunities={[]}
              recommendations={topRecommendations}
              organizationId={organizationId}
              timeZone={view.timeZone}
              canManage={canManage}
              hideHeading
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
          />
        </TabsContent>

        <TabsContent value="actions" className="flex flex-col gap-6">
          <nav aria-label="Activity month" className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline">Activity {view.activityMonth}</Badge>
            <Link
              className="font-medium text-primary hover:underline"
              href={`${base}?month=${previousMonth(view.activityMonth)}#actions`}
            >
              Previous month
            </Link>
            {isCurrentMonth ? null : (
              <Link className="font-medium text-primary hover:underline" href={`${base}#actions`}>
                Back to current month
              </Link>
            )}
          </nav>
          {acted.length > 0 ? (
            <IntelligenceTimeline events={acted} timeZone={view.timeZone} />
          ) : (
            <Card>
              <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
                <CheckCircle2 aria-hidden="true" />
                No recorded actions for this activity month.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="insights" className="grid items-start gap-8 lg:grid-cols-2">
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
          <div className="min-w-0 flex flex-col gap-8">
            {selectedBranchId ? (
              <BranchResearch
                organizationId={organizationId}
                active={research.active}
                history={research.history}
                lastSuccess={research.lastSuccess}
                status={research.status}
                timeZone={view.timeZone}
                canManage={canManage}
              />
            ) : (
              <Card>
                <CardContent className="flex flex-col gap-3 py-6 text-sm text-muted-foreground">
                  <p>
                    Market research follows one branch at a time. Review market monitoring to choose
                    a location.
                  </p>
                  <Button variant="outline" size="sm" onClick={requestMarketMonitoringDialog}>
                    <Settings2 aria-hidden="true" />
                    Review market monitoring
                  </Button>
                </CardContent>
              </Card>
            )}
            {marketWatch}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
