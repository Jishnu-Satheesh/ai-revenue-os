"use client";

import { ArrowRight, BadgeCheck, LoaderCircle, Pause, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  MarketWatchProjectDisplayState,
  MarketWatchProjectListItem,
} from "@/modules/growth-intelligence/application/market-watch";

export function formatReportDate(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function modeLabel(mode: MarketWatchProjectListItem["mode"]): string {
  return mode === "one-time" ? "One-time research" : "Recurring research";
}

type ProjectStateMeta = {
  label: string;
  Icon: LucideIcon;
  /** Extra tint over the secondary badge; empty keeps the plain secondary tint. */
  tintClassName: string;
};

const PROJECT_STATE_META: Record<MarketWatchProjectDisplayState, ProjectStateMeta> = {
  ready: {
    label: "Ready to review",
    Icon: BadgeCheck,
    tintClassName: "bg-emerald-100 text-emerald-900",
  },
  researching: { label: "Researching", Icon: LoaderCircle, tintClassName: "" },
  paused: { label: "Monitoring paused", Icon: Pause, tintClassName: "" },
  failed: {
    label: "Needs attention",
    Icon: TriangleAlert,
    tintClassName: "bg-amber-100 text-amber-900",
  },
  needs_attention: {
    label: "Needs attention",
    Icon: TriangleAlert,
    tintClassName: "bg-amber-100 text-amber-900",
  },
};

/**
 * Small status pill shared by the project rows and the project overview
 * dialog — the single place that maps a display state to its label, icon
 * and tint. Failed and needs-attention rows share one honest pill instead
 * of inventing distinct severities.
 */
export function ProjectStatusPill({
  displayState,
}: {
  displayState: MarketWatchProjectDisplayState;
}) {
  const meta = PROJECT_STATE_META[displayState];
  const Icon = meta.Icon;
  const isResearching = displayState === "researching";
  return (
    <Badge variant="secondary" className={meta.tintClassName}>
      <Icon
        aria-hidden="true"
        {...(isResearching
          ? {
              "data-testid": "market-watch-loading-ring",
              className: "animate-spin motion-reduce:animate-none",
            }
          : null)}
      />
      {meta.label}
    </Badge>
  );
}

/**
 * One-line state caption for a project row or the overview dialog's empty
 * history. Ready names its report date; every other state is a fixed plain
 * sentence — never a percentage or a promised completion time.
 */
export function projectStateSubCaption(
  displayState: MarketWatchProjectDisplayState,
  reportDateLabel: string | null,
): string {
  switch (displayState) {
    case "ready":
      return reportDateLabel === null ? "Report · —" : `Report · ${reportDateLabel}`;
    case "researching":
      return "Comparing public sources.";
    case "paused":
      return "Future scheduled starts are paused.";
    case "failed":
      return "The background research run could not finish. No findings were saved.";
    case "needs_attention":
      return "Start research to receive the first report.";
  }
}

/**
 * One compact research project row: icon tile, title and location, then
 * the status pill with its caption, and an arrow drill-in when the list
 * wires one up. The blocks sit side by side from sm up and stack on narrow
 * screens so the title never squeezes. The full question lives in the
 * overview dialog, not here. Paused, researching, failed and needs-attention
 * rows keep their prior report with its date.
 */
export function ResearchProjectRow({
  item,
  timeZone,
  onReviewReport,
  onOpen,
  bare = false,
}: {
  item: MarketWatchProjectListItem;
  timeZone: string;
  /**
   * Report reader entry point. Absent by default: prior-report controls
   * render disabled with their reason instead of navigating anywhere
   * invented.
   */
  onReviewReport?: (reportVersionId: string) => void;
  onOpen?: (projectId: string) => void;
  /**
   * Grouped-list rendering (Track C3, additive): when true the row renders
   * without its own Card chrome so the parent single-box list can own the
   * border with bottom separation lines between rows. Defaults to the
   * standalone Card.
   */
  bare?: boolean;
}) {
  const readerReady = onReviewReport !== undefined;
  const meta = PROJECT_STATE_META[item.displayState];
  const TileIcon = meta.Icon;
  const isResearching = item.displayState === "researching";
  const priorReport = item.priorReport;
  const latestReportDateLabel = item.latestReport
    ? formatReportDate(item.latestReport.createdAt, timeZone)
    : null;
  const body = (
    <div className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
        >
          <TileIcon
            className={isResearching ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"}
          />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0 text-sm font-semibold break-words">{item.title}</h3>
          <p className="mt-0.5 min-w-0 text-xs text-muted-foreground break-words">
            {item.branchName} · {modeLabel(item.mode)}
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1 sm:shrink-0 sm:items-end">
          <span data-testid={`research-project-state-${item.projectId}`}>
            <ProjectStatusPill displayState={item.displayState} />
          </span>
          <p
            className="text-xs text-muted-foreground sm:max-w-64 sm:text-right lg:max-w-none"
            role="status"
          >
            {projectStateSubCaption(item.displayState, latestReportDateLabel)}
          </p>
          {priorReport ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto min-w-0 px-0 text-xs"
              disabled={!readerReady}
              title={readerReady ? undefined : "Report review is unavailable in this view."}
              onClick={() => onReviewReport?.(priorReport.reportVersionId)}
            >
              <span className="truncate">
                Previous report · {formatReportDate(priorReport.createdAt, timeZone)}
              </span>
            </Button>
          ) : null}
        </div>
        {onOpen ? (
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 self-end sm:self-auto"
            aria-label={`Open ${item.title}`}
            onClick={() => onOpen(item.projectId)}
          >
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
    </div>
  );
  if (bare) {
    return (
      <div data-testid={`research-project-${item.projectId}`} className="min-w-0 px-4 sm:px-5">
        {body}
      </div>
    );
  }
  return (
    <Card data-testid={`research-project-${item.projectId}`} className="min-w-0">
      <CardContent className="px-4 py-0 sm:px-5 sm:py-0">{body}</CardContent>
    </Card>
  );
}
