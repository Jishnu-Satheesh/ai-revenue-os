"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";

import { ResearchProjectRow } from "@/components/growth-intelligence/research-project-row";
import {
  NEW_RESEARCH_OPEN_EVENT,
  parseMonitoringProjectStatus,
  type MonitoringProjectStatusFilter,
} from "@/components/growth-intelligence/query-options";
import { NewResearchDialog } from "@/components/growth-intelligence/new-research-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildMarketWatchProjectList,
  countMarketWatchProjectsByStatus,
  filterMarketWatchProjects,
  selectFeaturedMarketWatchReport,
  type MarketWatchProjectListItem,
  type MarketWatchProjectRecord,
  type MarketWatchProjectReportSummary,
  type MarketWatchProjectRevisionSummary,
} from "@/modules/growth-intelligence/application/market-watch";

export type MarketWatchLocationOption = {
  id: string;
  name: string;
};

export type MarketWatchBusinessInsight = {
  id: string;
  title: string;
  detail: string;
  /** Location or source scope, e.g. "Downtown · Channel reports". */
  scopeLabel: string;
  /** Named evidence period, e.g. "1–31 Aug 2026". */
  evidencePeriodLabel: string | null;
};

export type MarketWatchContextGap = {
  id: string;
  title: string;
  scopeLabel: string;
  /** The specific next action, e.g. "Add recent channel reports". */
  nextAction: string;
};

export type MarketWatchEvidencePeriod = {
  label: string;
};

type ProjectsResponse = {
  projects: MarketWatchProjectRecord[];
  reportsByProject: Record<string, MarketWatchProjectReportSummary[]>;
  revisionsByProject: Record<string, MarketWatchProjectRevisionSummary[]>;
};

function formatReportDate(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function modeLabel(mode: MarketWatchProjectListItem["mode"]): string {
  return mode === "one-time" ? "One-time research" : "Recurring research";
}

const STATUS_BUTTONS: { value: MonitoringProjectStatusFilter; label: string }[] = [
  { value: "all", label: "All projects" },
  { value: "ready", label: "Ready to review" },
  { value: "in_progress", label: "In progress" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "paused", label: "Paused" },
];

export function MarketWatchProjectsSkeleton() {
  return (
    <section aria-label="Market Watch projects" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </section>
  );
}

function BusinessInsights({
  insights,
  gaps,
}: {
  insights: readonly MarketWatchBusinessInsight[];
  gaps: readonly MarketWatchContextGap[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-label="Business insights" className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Business insights</h2>
          <p className="text-sm text-muted-foreground">
            What your own business evidence is telling us.
          </p>
        </div>
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No business insights yet. Connect and analyse a channel to ground the next report in
            your own evidence.
          </p>
        ) : null}
        {insights.map((insight) => (
          <Card key={insight.id}>
            <CardContent className="flex min-w-0 flex-col gap-1 py-4">
              <h3 className="min-w-0 text-sm font-semibold break-words">{insight.title}</h3>
              <p className="min-w-0 text-sm text-muted-foreground break-words">{insight.detail}</p>
              <p className="min-w-0 text-xs text-muted-foreground break-words">
                {insight.scopeLabel}
                {insight.evidencePeriodLabel ? ` · ${insight.evidencePeriodLabel}` : null}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
      <section aria-label="Improve the next report" className="flex min-w-0 flex-col gap-3">
        <Card>
          <CardContent className="flex min-w-0 flex-col gap-3 py-4">
            <div>
              <h3 className="text-sm font-semibold">Improve the next report</h3>
              <p className="text-xs text-muted-foreground">
                A little more business context can make the advice more useful.
              </p>
            </div>
            {gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing missing right now. New gaps appear here with their next action.
              </p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {gaps.map((gap) => (
                  <li
                    key={gap.id}
                    className="flex min-w-0 flex-col gap-0.5 border-t pt-2 first:border-t-0 first:pt-0"
                  >
                    <span className="min-w-0 text-sm font-medium break-words">{gap.nextAction}</span>
                    <span className="min-w-0 text-xs text-muted-foreground break-words">
                      {gap.title} · {gap.scopeLabel}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/**
 * Report-led Market Watch list: filters, featured ready report, compact
 * project rows, business insights and the grouped next-report area. All
 * content arrives through props — branch names, questions, report dates
 * and takeaways are the organization's own records, never fixtures.
 */
export function MarketWatchProjectsView({
  items,
  branches,
  timeZone,
  businessInsights,
  contextGaps,
  onNewResearch,
  onReviewReport,
}: {
  items: readonly MarketWatchProjectListItem[];
  branches: readonly MarketWatchLocationOption[];
  timeZone: string;
  businessInsights: readonly MarketWatchBusinessInsight[];
  contextGaps: readonly MarketWatchContextGap[];
  onNewResearch: () => void;
  /**
   * Slice 5 reader entry point. Absent by default: the Review report
   * control renders disabled with its reason instead of opening anything.
   */
  onReviewReport?: (reportVersionId: string) => void;
}) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MonitoringProjectStatusFilter>("all");

  const counts = useMemo(() => countMarketWatchProjectsByStatus(items), [items]);
  const filtered = useMemo(
    () => filterMarketWatchProjects(items, { branchId, search, status }),
    [items, branchId, search, status],
  );
  const featured = useMemo(() => selectFeaturedMarketWatchReport(filtered), [filtered]);
  const rows = useMemo(
    () => (featured ? filtered.filter((item) => item.projectId !== featured.projectId) : filtered),
    [filtered, featured],
  );

  function clearFilters() {
    setBranchId(null);
    setSearch("");
    setStatus("all");
  }

  return (
    <section aria-label="Market Watch projects" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Your market, in context
          </p>
          <h2 className="mt-1 text-xl font-semibold">Market Watch</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Research your market. Review what matters for your business.
          </p>
        </div>
        <Button size="sm" onClick={onNewResearch} className="shrink-0">
          <Plus aria-hidden="true" />
          New research
        </Button>
      </div>

      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={branchId ?? "all"}
            onValueChange={(value) => setBranchId(value === "all" ? null : value)}
          >
            <SelectTrigger aria-label="Research location" className="w-44">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-0 flex-1 basis-48">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Find a research project"
              placeholder="Find a research project…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div role="group" aria-label="Filter by project status" className="flex flex-wrap gap-2">
          {STATUS_BUTTONS.map((button) => (
            <Button
              key={button.value}
              variant={status === button.value ? "default" : "outline"}
              size="sm"
              aria-pressed={status === button.value}
              onClick={() => setStatus(parseMonitoringProjectStatus(button.value))}
            >
              {button.label} {counts[button.value]}
            </Button>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No research projects yet</EmptyTitle>
            <EmptyDescription>
              Each question gets its own research and reports. Start the first one to see it
              listed here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={onNewResearch}>
              <Plus aria-hidden="true" />
              Start your first research
            </Button>
          </EmptyContent>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No projects match these filters</EmptyTitle>
            <EmptyDescription>
              {search.trim().length > 0
                ? `Nothing matches “${search.trim()}”. Try different words or clear the filters.`
                : "Try a different location or status, or clear the filters."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {featured && featured.latestReport ? (
            <Card data-testid={`featured-report-${featured.latestReport.reportVersionId}`}>
              <CardContent className="flex min-w-0 flex-col gap-2 py-5">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold tracking-widest uppercase">Ready to review</span>
                  <span>Report · {formatReportDate(featured.latestReport.createdAt, timeZone)}</span>
                </div>
                <h3 className="min-w-0 text-base font-semibold break-words">{featured.title}</h3>
                <p className="min-w-0 text-xs text-muted-foreground break-words">
                  {featured.branchName} · {modeLabel(featured.mode)}
                </p>
                {featured.latestReport.takeaway ? (
                  <p className="min-w-0 text-sm break-words">{featured.latestReport.takeaway}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The report summary could not be read. Open the report to read it in full.
                  </p>
                )}
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={onReviewReport === undefined}
                    title={
                      onReviewReport === undefined
                        ? "The report reader arrives with the next slice; this opens it then."
                        : undefined
                    }
                    onClick={() => onReviewReport?.(featured.latestReport!.reportVersionId)}
                  >
                    Review report
                  </Button>
                  <span className="min-w-0 text-xs text-muted-foreground">
                    Based on brief {featured.latestRevision?.revisionNumber ?? 1} ·{" "}
                    {featured.latestReport.reviewState === "pending_review"
                      ? "Advice awaits your review"
                      : "Reviewed"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ) : null}
          {rows.map((item) => (
            <ResearchProjectRow
              key={item.projectId}
              item={item}
              timeZone={timeZone}
              onReviewReport={onReviewReport}
            />
          ))}
          <p className="text-xs text-muted-foreground" role="status">
            {filtered.length} {filtered.length === 1 ? "project" : "projects"} shown. Past reports
            stay available when research updates.
          </p>
        </>
      )}

      <BusinessInsights insights={businessInsights} gaps={contextGaps} />
    </section>
  );
}

/**
 * Self-loading Market Watch section for the Insights & market tab. Holds
 * the layout shape while loading, names a next action for every empty
 * cause, and keeps the last successful list on screen with a retry control
 * when a refresh fails — a failed refresh never clears retained reports.
 */
export function MarketWatchProjectsSection({
  organizationId,
  branches,
  timeZone,
  businessInsights,
  contextGaps,
  evidencePeriods,
  canManage,
  onReviewReport,
}: {
  organizationId: string;
  branches: readonly MarketWatchLocationOption[];
  timeZone: string;
  businessInsights: readonly MarketWatchBusinessInsight[];
  contextGaps: readonly MarketWatchContextGap[];
  evidencePeriods: readonly MarketWatchEvidencePeriod[];
  /** Viewers read the list and the dialog; only managers see start controls. */
  canManage: boolean;
  onReviewReport?: (reportVersionId: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectsResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [dialogOpen, setDialogOpen] = useState(false);
  // A started research refreshes the list through this token.
  const [reloadToken, setReloadToken] = useState(0);

  // Once a list has loaded, later refreshes keep it on screen when they
  // fail — a failed refresh never clears retained reports.
  const loadedOnce = useRef(false);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function read(signal: AbortSignal) {
      try {
        const response = await fetch(
          `/api/organizations/${organizationId}/growth-intelligence/monitoring/projects?limit=50`,
          { cache: "no-store", signal },
        );
        if (!response.ok) throw new Error("PROJECTS_LOAD_FAILED");
        const body = (await response.json()) as ProjectsResponse;
        if (!Array.isArray(body.projects)) throw new Error("PROJECTS_LOAD_FAILED");
        if (disposed) return;
        loadedOnce.current = true;
        setProjects({
          projects: body.projects,
          reportsByProject: body.reportsByProject ?? {},
          revisionsByProject: body.revisionsByProject ?? {},
        });
        setLoadState("ready");
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        if (!loadedOnce.current) setLoadState("failed");
      }
    }
    void read(controller.signal);
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [organizationId, reloadToken]);

  useEffect(() => {
    const open = () => setDialogOpen(true);
    window.addEventListener(NEW_RESEARCH_OPEN_EVENT, open);
    return () => window.removeEventListener(NEW_RESEARCH_OPEN_EVENT, open);
  }, []);

  const items = useMemo(
    () =>
      projects
        ? buildMarketWatchProjectList({
            projects: projects.projects,
            reportsByProject: new Map(Object.entries(projects.reportsByProject)),
            revisionsByProject: new Map(Object.entries(projects.revisionsByProject)),
          })
        : [],
    [projects],
  );

  if (loadState === "loading") return <MarketWatchProjectsSkeleton />;
  if (loadState === "failed") {
    return (
      <section aria-label="Market Watch projects" className="flex min-w-0 flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>Market Watch could not be loaded</AlertTitle>
          <AlertDescription>
            Nothing changed. Retry to load your research projects and reports.
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setLoadState("loading");
            setReloadToken((token) => token + 1);
          }}
        >
          Retry
        </Button>
      </section>
    );
  }

  return (
    <>
      <MarketWatchProjectsView
        items={items}
        branches={branches}
        timeZone={timeZone}
        businessInsights={businessInsights}
        contextGaps={contextGaps}
        onNewResearch={() => setDialogOpen(true)}
        onReviewReport={onReviewReport}
      />
      <NewResearchDialog
        organizationId={organizationId}
        branches={branches}
        timeZone={timeZone}
        evidencePeriods={evidencePeriods}
        canManage={canManage}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onStarted={() => {
          setReloadToken((token) => token + 1);
        }}
      />
    </>
  );
}
