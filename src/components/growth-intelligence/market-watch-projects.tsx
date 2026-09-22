"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";

import { ResearchProjectRow } from "@/components/growth-intelligence/research-project-row";
import { ReportReaderDialog } from "@/components/growth-intelligence/report-reader";
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
  type MarketWatchProjectFailedUpdate,
  type MarketWatchProjectRecord,
  type MarketWatchProjectReportSummary,
  type MarketWatchProjectRevisionSummary,
} from "@/modules/growth-intelligence/application/market-watch";

export type MarketWatchLocationOption = {
  id: string;
  name: string;
};

export type MarketWatchEvidencePeriod = {
  label: string;
};

type ProjectsResponse = {
  /**
   * Server records may carry the Agent fallback lane opt-in flag (absent
   * while the opt-in migration is unpushed). buildMarketWatchProjectList
   * spreads it through to the list items untouched.
   */
  projects: (MarketWatchProjectRecord & { agentLaneOptIn?: boolean })[];
  reportsByProject: Record<string, MarketWatchProjectReportSummary[]>;
  revisionsByProject: Record<string, MarketWatchProjectRevisionSummary[]>;
  failedUpdatesByProject?: Record<string, MarketWatchProjectFailedUpdate[]>;
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

type MarketWatchProjectWithOptIn = MarketWatchProjectListItem & { agentLaneOptIn?: boolean };

function agentLaneOptInFor(item: MarketWatchProjectListItem): boolean {
  return (item as MarketWatchProjectWithOptIn).agentLaneOptIn === true;
}

/**
 * Agent fallback lane opt-in toggle (Track A, additive): managers flip one
 * project between the search lane and the agent lane. The flip persists
 * through the projects PATCH endpoint with an optimistic update that rolls
 * back to the last saved value when the save fails. Says nothing about
 * spend; the platform credit limit arrives in a later slice.
 */
function AgentLaneOptInToggle({
  organizationId,
  projectId,
  initialOptIn,
}: {
  organizationId: string;
  projectId: string;
  initialOptIn: boolean;
}) {
  const [optIn, setOptIn] = useState(initialOptIn);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(next: boolean) {
    const previous = optIn;
    setOptIn(next);
    setFailed(false);
    setPending(true);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/growth-intelligence/monitoring/projects`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ project_id: projectId, agent_lane_opt_in: next }),
        },
      );
      if (!response.ok) throw new Error("OPT_IN_SAVE_FAILED");
    } catch {
      setOptIn(previous);
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={optIn}
          disabled={pending}
          onChange={(event) => void save(event.target.checked)}
          data-testid={`agent-lane-opt-in-${projectId}`}
        />
        Agent lane
      </label>
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          Could not save. Retry.
        </p>
      ) : null}
    </div>
  );
}

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

/**
 * Report-led Market Watch list: filters, featured ready report and compact
 * project rows. Business insights and data gaps live in their own tab
 * sections above — this list never keeps second copies, so triage controls
 * exist in exactly one place. All content arrives through props — branch
 * names, questions, report dates and takeaways are the organization's own
 * records, never fixtures.
 */
export function MarketWatchProjectsView({
  items,
  branches,
  timeZone,
  onNewResearch,
  onReviewReport,
  organizationId,
  canManage,
}: {
  items: readonly MarketWatchProjectListItem[];
  branches: readonly MarketWatchLocationOption[];
  timeZone: string;
  onNewResearch: () => void;
  /**
   * Report reader entry point. Absent by default: the Review report
   * control renders disabled with its reason instead of opening anything.
   */
  onReviewReport?: (reportVersionId: string) => void;
  /**
   * Agent lane opt-in wiring. Both present for managers only: each project
   * row (and the featured card) gains its toggle. Viewers keep the
   * read-only list with no toggle rendered.
   */
  organizationId?: string;
  canManage?: boolean;
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
  // Agent-lane toggles render for managers only; viewers keep the read-only list.
  const optInOrganizationId = canManage === true ? organizationId : undefined;

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
          <h2 className="mt-1 text-xl font-semibold">Research projects</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each question gets its own research and reports.
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
                        ? "Report review is unavailable in this view."
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
                {optInOrganizationId !== undefined ? (
                  <AgentLaneOptInToggle
                    key={`featured-${featured.projectId}-${agentLaneOptInFor(featured) ? "on" : "off"}`}
                    organizationId={optInOrganizationId}
                    projectId={featured.projectId}
                    initialOptIn={agentLaneOptInFor(featured)}
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {rows.map((item) => (
            <div key={item.projectId} className="flex min-w-0 flex-col gap-1">
              <ResearchProjectRow
                item={item}
                timeZone={timeZone}
                onReviewReport={onReviewReport}
              />
              {optInOrganizationId !== undefined ? (
                <AgentLaneOptInToggle
                  key={`row-${item.projectId}-${agentLaneOptInFor(item) ? "on" : "off"}`}
                  organizationId={optInOrganizationId}
                  projectId={item.projectId}
                  initialOptIn={agentLaneOptInFor(item)}
                />
              ) : null}
            </div>
          ))}
          <p className="text-xs text-muted-foreground" role="status">
            {filtered.length} {filtered.length === 1 ? "project" : "projects"} shown. Past reports
            stay available when research updates.
          </p>
        </>
      )}
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
  evidencePeriods,
  canManage,
  onReviewReport,
}: {
  organizationId: string;
  branches: readonly MarketWatchLocationOption[];
  timeZone: string;
  evidencePeriods: readonly MarketWatchEvidencePeriod[];
  /** Viewers read the list and the dialog; only managers see start controls. */
  canManage: boolean;
  onReviewReport?: (reportVersionId: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectsResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [readerVersionId, setReaderVersionId] = useState<string | null>(null);
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
          failedUpdatesByProject: body.failedUpdatesByProject ?? {},
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
            failedUpdatesByProject: new Map(Object.entries(projects.failedUpdatesByProject ?? {})),
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
        onNewResearch={() => setDialogOpen(true)}
        organizationId={organizationId}
        canManage={canManage}
        onReviewReport={(reportVersionId) => {
          if (onReviewReport) {
            onReviewReport(reportVersionId);
            return;
          }
          setReaderVersionId(reportVersionId);
        }}
      />
      <ReportReaderDialog
        organizationId={organizationId}
        reportVersionId={readerVersionId}
        open={readerVersionId !== null}
        onOpenChange={(next) => {
          if (!next) setReaderVersionId(null);
        }}
        timeZone={timeZone}
        canAccept={canManage}
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
