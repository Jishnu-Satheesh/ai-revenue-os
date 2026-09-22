"use client";

import { useRef } from "react";
import { Check } from "lucide-react";

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
 *
 * While the update is queued or researching, the body follows the approved
 * progress mockup: the live status pill, the full question, a four-step
 * timeline (step one names the live position — queued brief vs saved brief),
 * and the close-later caption. Report history below it is unchanged live
 * data; presentation only, no binding changed.
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
  const isProgress =
    project.displayState === "researching" || project.displayState === "needs_attention";
  // Researching means the brief is pinned to running work; needs attention
  // means it is saved and waiting for research to start.
  const started = project.displayState === "researching";
  const historyRef = useRef<HTMLDivElement>(null);

  function showHistory() {
    const node = historyRef.current;
    if (!node) return;
    // jsdom (unit tests) has no scrollIntoView; the focus still lands.
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    node.focus({ preventScroll: true });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-[640px]">
        <DialogHeader className="static px-7 pt-6 text-left">
          <p className="text-[11px] font-bold tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-300">
            Market Watch
          </p>
          <DialogTitle className="mt-2 text-xl font-semibold tracking-tight">
            {project.title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px]">
            {project.branchName} · {modeLabel(project.mode)}
          </DialogDescription>
        </DialogHeader>

        <div className="px-7 py-6">
          <ProjectStatusPill displayState={project.displayState} />
          <p className="mt-4 min-w-0 text-[13px] leading-relaxed text-muted-foreground break-words">
            {project.question}
          </p>
          {latestReport ? (
            <div className="mt-4">
              <Button
                disabled={!readerReady}
                title={readerReady ? undefined : "Report review is unavailable in this view."}
                onClick={() => onReviewReport?.(latestReport.reportVersionId)}
              >
                Review report
              </Button>
            </div>
          ) : null}
          {isProgress ? (
            <ol className="m-0 mt-6 flex list-none flex-col p-0">
              <li className="relative flex gap-3.5 pb-6 before:absolute before:top-7 before:bottom-1 before:left-[12px] before:w-px before:bg-border last:pb-0 last:before:hidden">
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-600 bg-emerald-50 text-[10px] font-semibold text-emerald-700"
                >
                  {started ? <Check className="size-3" /> : "1"}
                </span>
                <div>
                  <strong className="block text-xs font-semibold">
                    {started ? "Brief saved" : "Research queued"}
                  </strong>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {started
                      ? "The exact question and scope are saved for this update."
                      : "Your reviewed brief is saved. This project is waiting for research to start."}
                  </p>
                </div>
              </li>
              <li className="relative flex gap-3.5 pb-6 before:absolute before:top-7 before:bottom-1 before:left-[12px] before:w-px before:bg-border last:pb-0 last:before:hidden">
                <span
                  aria-hidden="true"
                  className={
                    started
                      ? "flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-600 bg-emerald-50 text-[10px] font-semibold text-emerald-700"
                      : "flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] text-muted-foreground"
                  }
                >
                  2
                </span>
                <div>
                  <strong className="block text-xs font-semibold">Research the market</strong>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Find and compare useful public evidence.
                  </p>
                </div>
              </li>
              <li className="relative flex gap-3.5 pb-6 before:absolute before:top-7 before:bottom-1 before:left-[12px] before:w-px before:bg-border last:pb-0 last:before:hidden">
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] text-muted-foreground"
                >
                  3
                </span>
                <div>
                  <strong className="block text-xs font-semibold">Prepare your report</strong>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Connect market findings with the business context.
                  </p>
                </div>
              </li>
              <li className="relative flex gap-3.5 pb-6 before:absolute before:top-7 before:bottom-1 before:left-[12px] before:w-px before:bg-border last:pb-0 last:before:hidden">
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] text-muted-foreground"
                >
                  4
                </span>
                <div>
                  <strong className="block text-xs font-semibold">Ready for your review</strong>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Read the report and consider the draft advice.
                  </p>
                </div>
              </li>
            </ol>
          ) : null}
          <div ref={historyRef} tabIndex={-1} className="min-w-0 outline-none">
            {isProgress ? (
              <p className="mt-[18px] text-xs leading-relaxed text-muted-foreground">
                You can close this dialog and return to the project later.
              </p>
            ) : null}
            {reports.length === 0 ? (
              isProgress ? null : (
                <div className="mt-6 flex min-w-0 flex-col gap-1">
                  <p className="text-sm text-muted-foreground">No reports yet.</p>
                  <p className="text-xs text-muted-foreground" role="status">
                    {projectStateSubCaption(
                      project.displayState,
                      latestReport ? formatReportDate(latestReport.createdAt, timeZone) : null,
                    )}
                  </p>
                </div>
              )
            ) : (
              <div className="mt-6 flex min-w-0 flex-col gap-2">
                <h4 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                  Report history
                </h4>
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
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 justify-between gap-3 rounded-b-2xl bg-background px-7 py-4 max-sm:flex-col max-sm:items-stretch">
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
          <div className="flex flex-wrap items-center gap-2 max-sm:justify-end">
            <Button variant="outline" size="sm" onClick={showHistory}>
              History
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
