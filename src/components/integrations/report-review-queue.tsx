"use client";

import { useMemo } from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { stateLabel, stateVariant } from "@/components/integrations/report-package-upload";
import type { ReportPackageRow, ReportPackageSnapshot } from "@/modules/reports/application/ports";

/**
 * How long ago a package was uploaded, in words short enough for a queue row.
 *
 * `created_at` arrives on every package row, so no backend change is needed
 * for the age display. Only whole days are shown: the queue answers "what
 * needs me", not "at which hour did it arrive".
 */
function packageAge(createdAt: string): string {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 86_400_000));
  if (days < 1) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * The compact "needs review" queue that replaced the fully expanded upload list.
 *
 * Slice 1 renders one row per package, oldest first. Decision rows,
 * settled/in-progress strips, and tier reasons land in later slices; every
 * action button here keeps the exact gating and payload the expanded list had.
 */
export function ReportReviewQueue({
  packages,
  view,
  fixedChannelId,
  canRetry,
  onRetry,
  retryPending,
  onRetryValidation,
  retryValidationPending,
  onRequestProjection,
  requestProjectionPending,
  onOpen,
}: Readonly<{
  packages: ReportPackageRow[];
  view: ReportPackageSnapshot;
  fixedChannelId?: string;
  canRetry: boolean;
  onRetry: (packageId: string) => void;
  retryPending: boolean;
  onRetryValidation: (packageId: string) => void;
  retryValidationPending: boolean;
  onRequestProjection: (packageId: string) => void;
  requestProjectionPending: boolean;
  onOpen: (packageId: string) => void;
}>) {
  const ordered = useMemo(
    () => [...packages].sort((left, right) => left.created_at.localeCompare(right.created_at)),
    [packages],
  );

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">
        {fixedChannelId ? "1 · This channel's uploads" : "1 · Recent uploads"}
      </h3>
      {ordered.length ? (
        ordered.map((reportPackage) => {
          const latestProjection = view.projectionRuns.find(
            (run) => run.report_package_id === reportPackage.id,
          );
          const projectionFailed =
            reportPackage.status === "projection_failed" || latestProjection?.status === "failed";
          const canRequestProjection =
            reportPackage.status === "validated" ||
            reportPackage.status === "partially_validated" ||
            projectionFailed;
          return (
            <div key={reportPackage.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpen(reportPackage.id)}
                  aria-label={`Open details for ${reportPackage.report_type}, ${reportPackage.declared_period_start} to ${reportPackage.declared_period_end}`}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block font-medium">
                    {reportPackage.report_type} · {reportPackage.declared_period_start} to{" "}
                    {reportPackage.declared_period_end}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {stateLabel(reportPackage.status)} · {packageAge(reportPackage.created_at)}
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  <Badge variant={stateVariant(reportPackage.status)}>
                    {stateLabel(reportPackage.status)}
                  </Badge>
                  {reportPackage.status === "failed" &&
                  canRetry &&
                  reportPackage.storage_object_id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retryPending}
                      onClick={() => onRetry(reportPackage.id)}
                    >
                      <RotateCcw data-icon="inline-start" /> Retry
                    </Button>
                  ) : null}
                  {(reportPackage.status === "validation_failed" ||
                    reportPackage.status === "awaiting_validation") &&
                  canRetry ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retryValidationPending}
                      onClick={() => onRetryValidation(reportPackage.id)}
                    >
                      <RotateCcw data-icon="inline-start" />{" "}
                      {reportPackage.status === "awaiting_validation"
                        ? "Start validation"
                        : "Retry validation"}
                    </Button>
                  ) : null}
                  {canRequestProjection && canRetry ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={requestProjectionPending}
                      onClick={() => onRequestProjection(reportPackage.id)}
                    >
                      {projectionFailed ? (
                        <RotateCcw data-icon="inline-start" />
                      ) : (
                        <ShieldCheck data-icon="inline-start" />
                      )}
                      {projectionFailed ? "Retry projection" : "Project safely"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">No governed report packages yet.</p>
      )}
    </div>
  );
}
