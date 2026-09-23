"use client";

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
  formatReportDate,
  projectStateSubCaption,
} from "@/components/growth-intelligence/research-project-row";
import type {
  MarketWatchProjectListItem,
  MarketWatchProjectReportSummary,
} from "@/modules/growth-intelligence/application/market-watch";

/**
 * Read-only history for one research project: its update and report rows,
 * newest first. The footer keeps Close only; project controls (pause, stop)
 * return with the backend slice that ships them. This dialog never starts,
 * pauses or stops anything. There is no brief viewer yet, so the update row
 * names the live brief with its state while its button stays disabled with
 * its reason; finished reports open in the report reader.
 *
 * While the update is queued or researching, the body follows the approved
 * progress mockup: a four-step timeline (step one names the live position —
 * queued brief vs saved brief) and the close-later caption. Report history
 * below it is unchanged live data; presentation only, no binding changed.
 */
export function ProjectOverviewDialog({
  project,
  reports,
  briefNumbers,
  timeZone,
  open,
  onOpenChange,
  onReviewReport,
}: {
  project: MarketWatchProjectListItem;
  reports: readonly MarketWatchProjectReportSummary[];
  /**
   * Brief revision numbers keyed by revision id for the history sublines.
   * Absent by default: sublines render numberless rather than failing.
   */
  briefNumbers?: ReadonlyMap<string, number>;
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

  function briefSubline(revisionId: string, state: string): string {
    const number = briefNumbers?.get(revisionId);
    return number === undefined ? `Brief · ${state}` : `Brief ${number} · ${state}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-[640px]">
        <DialogHeader className="static px-7 pt-6 text-left">
          <p className="text-[11px] font-bold tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-300">
            Market Watch
          </p>
          <DialogTitle className="mt-2 text-[22px] font-bold tracking-tight">
            Project history
          </DialogTitle>
          <DialogDescription className="mt-2 min-w-0 text-[13px] break-words">
            {project.title} · {project.branchName}
          </DialogDescription>
        </DialogHeader>

        <div className="px-7 py-6">
          <p className="min-w-0 text-sm text-muted-foreground break-words">
            Each report keeps the question and evidence used for that update.
          </p>
          {!isProgress ? (
            <div className="mt-2 flex min-w-0 items-center justify-between gap-3 border-b py-5">
              <div className="min-w-0">
                <p className="min-w-0 text-sm font-bold break-words">Current update</p>
                <p className="mt-0.5 min-w-0 text-[13px] text-muted-foreground break-words">
                  {project.latestRevision
                    ? briefSubline(project.latestRevision.revisionId, project.stateLabel)
                    : project.stateLabel}
                </p>
              </div>
              <Button
                variant="outline"
                className="h-10 shrink-0"
                disabled
                title="Viewing a brief is not available yet — finished reports open in the report reader below."
              >
                View update
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
          <div className="min-w-0 outline-none">
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
                <ul className="flex min-w-0 flex-col">
                  {reports.map((report) => {
                    const dateLabel = formatReportDate(report.createdAt, timeZone);
                    return (
                      <li
                        key={report.reportVersionId}
                        className="flex min-w-0 items-center justify-between gap-3 border-b py-5 last:border-b-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="min-w-0 text-sm font-bold break-words">
                            Report · {dateLabel}
                          </p>
                          <p className="mt-0.5 min-w-0 text-[13px] text-muted-foreground break-words">
                            {briefSubline(report.briefRevisionId, "Saved report")}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="h-10 shrink-0"
                          disabled={!readerReady}
                          title={
                            readerReady ? undefined : "Report review is unavailable in this view."
                          }
                          aria-label={`Read report · ${dateLabel}`}
                          onClick={() => onReviewReport?.(report.reportVersionId)}
                        >
                          Read report
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 justify-start gap-3 rounded-b-2xl bg-background px-7 py-4 max-sm:flex-col max-sm:items-stretch">
          <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
