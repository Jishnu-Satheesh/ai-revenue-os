"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ProjectStatusPill,
  formatReportDate,
  modeLabel,
  projectStateSubCaption,
} from "@/components/growth-intelligence/research-project-row";
import type {
  MarketWatchProjectListItem,
  MarketWatchProjectReportSummary,
} from "@/modules/growth-intelligence/application/market-watch";

/**
 * Read-only overview for one research project: its state, its full question
 * and its report history, newest first. Project controls (pause, stop) are
 * shown disabled with their reason until the backend update ships them; this
 * dialog never starts, pauses or stops anything.
 */
export function ProjectOverviewDialog({
  project,
  reports,
  timeZone,
  open,
  onOpenChange,
  onReviewReport,
}: {
  project: MarketWatchProjectListItem;
  reports: readonly MarketWatchProjectReportSummary[];
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Report reader entry point. Absent by default: review controls render
   * disabled with their reason instead of navigating anywhere invented.
   */
  onReviewReport?: (reportVersionId: string) => void;
}) {
  const readerReady = onReviewReport !== undefined;
  const latestReport = project.latestReport;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader className="text-left">
          <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Market Watch
          </p>
          <DialogTitle className="mt-1 text-lg font-semibold">{project.title}</DialogTitle>
          <DialogDescription>
            {project.branchName} · {modeLabel(project.mode)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          <ProjectStatusPill displayState={project.displayState} />
          <p className="min-w-0 text-sm leading-relaxed break-words">{project.question}</p>
          {latestReport ? (
            <div>
              <Button
                disabled={!readerReady}
                title={readerReady ? undefined : "Report review is unavailable in this view."}
                onClick={() => onReviewReport?.(latestReport.reportVersionId)}
              >
                Review report
              </Button>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-2">
            <h4 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Report history
            </h4>
            {reports.length === 0 ? (
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm text-muted-foreground">No reports yet.</p>
                <p className="text-xs text-muted-foreground" role="status">
                  {projectStateSubCaption(
                    project.displayState,
                    latestReport ? formatReportDate(latestReport.createdAt, timeZone) : null,
                  )}
                </p>
              </div>
            ) : (
              <ul className="flex min-w-0 flex-col">
                {reports.map((report) => {
                  const dateLabel = formatReportDate(report.createdAt, timeZone);
                  return (
                    <li
                      key={report.reportVersionId}
                      className="flex min-w-0 flex-col gap-1 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
                    >
                      <p className="min-w-0 text-sm font-semibold break-words">
                        Report · {dateLabel}
                      </p>
                      {report.takeaway ? (
                        <p className="min-w-0 text-sm leading-relaxed text-muted-foreground break-words">
                          {report.takeaway}
                        </p>
                      ) : null}
                      <div>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto px-0"
                          disabled={!readerReady}
                          title={
                            readerReady ? undefined : "Report review is unavailable in this view."
                          }
                          aria-label={`Review report · ${dateLabel}`}
                          onClick={() => onReviewReport?.(report.reportVersionId)}
                        >
                          Review
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Pausing is not available yet — project controls arrive with the backend update."
            >
              Pause monitoring
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Stopping is not available yet — project controls arrive with the backend update."
            >
              Stop this research
            </Button>
          </div>
          <Button size="sm" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
