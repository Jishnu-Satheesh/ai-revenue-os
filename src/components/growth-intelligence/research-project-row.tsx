"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MarketWatchProjectListItem } from "@/modules/growth-intelligence/application/market-watch";

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

/**
 * One compact research project row. State is plain text with real dates —
 * never a percentage or a promised completion time. Paused, researching,
 * ready and needs-attention rows stay visually distinct, and a paused or
 * researching row keeps its prior report with its date.
 */
export function ResearchProjectRow({
  item,
  timeZone,
  onReviewReport,
  onOpen,
}: {
  item: MarketWatchProjectListItem;
  timeZone: string;
  /**
   * Slice 5 reader entry point. Absent by default: prior-report and review
   * controls render disabled with their reason instead of navigating
   * anywhere invented.
   */
  onReviewReport?: (reportVersionId: string) => void;
  onOpen?: (projectId: string) => void;
}) {
  const readerReady = onReviewReport !== undefined;
  return (
    <Card data-testid={`research-project-${item.projectId}`} className="min-w-0">
      <CardContent className="flex min-w-0 flex-col gap-2 py-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="min-w-0 text-sm font-semibold break-words">{item.title}</h3>
            <p className="mt-0.5 min-w-0 text-xs text-muted-foreground break-words">
              {item.branchName} · {modeLabel(item.mode)}
            </p>
          </div>
          <span
            data-testid={`research-project-state-${item.projectId}`}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {item.displayState === "ready" && item.latestReport
              ? `Report · ${formatReportDate(item.latestReport.createdAt, timeZone)}`
              : item.displayState === "researching"
                ? `Researching${item.latestRevision ? ` · requested ${formatReportDate(item.latestRevision.createdAt, timeZone)}` : ""}`
                : item.displayState === "paused"
                  ? "Monitoring paused"
                  : `Needs attention · created ${formatReportDate(item.createdAt, timeZone)}`}
          </span>
        </div>
        <p className="min-w-0 text-sm break-words">{item.question}</p>
        <p className="text-xs text-muted-foreground" role="status">
          {item.displayState === "ready"
            ? "Draft advice for review."
            : item.displayState === "researching"
              ? "Comparing public sources. Closing this page never stops the background work."
              : item.displayState === "paused"
                ? "Future scheduled starts are paused; past reports stay available."
                : "Start research to receive the first report."}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {item.priorReport ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto min-w-0 px-0"
              disabled={!readerReady}
              title={
                readerReady
                  ? undefined
                  : "The report reader arrives with the next slice; this link opens it then."
              }
              onClick={() => onReviewReport?.(item.priorReport!.reportVersionId)}
            >
              <span className="truncate">
                Previous report · {formatReportDate(item.priorReport.createdAt, timeZone)}
              </span>
            </Button>
          ) : null}
          {onOpen ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => onOpen(item.projectId)}
            >
              Open {item.title}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
