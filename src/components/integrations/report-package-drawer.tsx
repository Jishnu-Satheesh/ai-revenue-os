"use client";

import { RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CategoricalRefusalDeclaration,
  ReconciliationAction,
  optionalContractFieldLabelsBySheet,
  safeValidationCodes,
  stateLabel,
  stateVariant,
  validationCodeContextDetail,
} from "@/components/integrations/report-package-upload";
import {
  explainReportValidationCode,
  summarizeReportContract,
} from "@/domain/reports/validation-copy";
import type { ReportPackageSnapshot } from "@/modules/reports/application/ports";

/**
 * The side drawer that holds one package's full detail.
 *
 * Slice 1 relocates the §1 upload block here verbatim (badge, action buttons,
 * reconciliation rows, validation summary, projection counts, failure detail)
 * and opens it from local state. The §2/§3 version blocks, focus anchors, and
 * `?package=` deep-linking land in later slices.
 */
export function ReportPackageDrawer({
  packageId,
  organizationId,
  timeZone,
  view,
  canRetry,
  canApproveContract,
  onRetry,
  retryPending,
  onRetryValidation,
  retryValidationPending,
  onRequestProjection,
  requestProjectionPending,
  onResolveOverlap,
  resolveOverlapPending,
  onClose,
}: Readonly<{
  packageId: string | null;
  organizationId: string;
  timeZone: string;
  view: ReportPackageSnapshot;
  canRetry: boolean;
  canApproveContract: boolean;
  onRetry: (packageId: string) => void;
  retryPending: boolean;
  onRetryValidation: (packageId: string) => void;
  retryValidationPending: boolean;
  onRequestProjection: (packageId: string) => void;
  requestProjectionPending: boolean;
  onResolveOverlap: (input: {
    reconciliationId: string;
    resolution: "accept_correction" | "keep_existing";
  }) => void;
  resolveOverlapPending: boolean;
  onClose: () => void;
}>) {
  const reportPackage = view.packages.find((candidate) => candidate.id === packageId) ?? null;
  if (!reportPackage) {
    return <Sheet open={false} />;
  }

  const latestValidation = view.validationRuns.find(
    (run) => run.report_package_id === reportPackage.id,
  );
  const validationErrorCodes = safeValidationCodes(latestValidation?.error_codes);
  const validationWarningCodes = safeValidationCodes(latestValidation?.warning_codes);
  const validationSheetResults = latestValidation
    ? view.validationSheetResults.filter(
        (result) => result.validation_run_id === latestValidation.id,
      )
    : [];
  const validationContractVersion = latestValidation
    ? view.contractVersions.find(
        (version) => version.id === latestValidation.report_contract_version_id,
      )
    : undefined;
  const validationContractSummary = validationContractVersion
    ? summarizeReportContract(validationContractVersion.mapping_document)
    : null;
  const validationOptionalBySheet = validationContractVersion
    ? optionalContractFieldLabelsBySheet(validationContractVersion.mapping_document)
    : new Map<string, string[]>();
  const affectedSheetsForValidationCode = (code: string): string[] =>
    validationSheetResults
      .filter(
        (result) =>
          safeValidationCodes(result.error_codes).includes(code) ||
          safeValidationCodes(result.warning_codes).includes(code),
      )
      .map((result) => result.normalized_sheet_name);
  const detailForValidationCode = (code: string): string | null =>
    validationCodeContextDetail({
      code,
      contractSummary: validationContractSummary,
      optionalBySheet: validationOptionalBySheet,
      affectedSheetNames: affectedSheetsForValidationCode(code),
    });
  const latestProjection = view.projectionRuns.find(
    (run) => run.report_package_id === reportPackage.id,
  );
  const projectionFailed =
    reportPackage.status === "projection_failed" || latestProjection?.status === "failed";
  const canRequestProjection =
    reportPackage.status === "validated" ||
    reportPackage.status === "partially_validated" ||
    projectionFailed;
  const reconciliationGroups = view.reconciliationGroups.filter(
    (group) => group.report_package_id === reportPackage.id,
  );
  const affectedRecordCount = reconciliationGroups.reduce(
    (total, group) => total + group.affected_record_count,
    0,
  );
  const readyRecordCount = Math.max(0, (latestProjection?.output_count ?? 0) - affectedRecordCount);
  const absentRowCount = latestProjection?.absent_row_count ?? 0;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/*
        The width override must carry the same side-qualified variant the base
        class uses. A plain `sm:max-w-2xl` would survive the merge but lose on
        specificity to the base `data-[side=right]:sm:max-w-sm`.
      */}
      <SheetContent side="right" className="data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {reportPackage.report_type} · {reportPackage.declared_period_start} to{" "}
            {reportPackage.declared_period_end}
          </SheetTitle>
          <SheetDescription>
            {reportPackage.file_kind.toUpperCase()} · {reportPackage.declared_currency} · retained
            until{" "}
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeZone,
            }).format(new Date(reportPackage.retained_until))}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={stateVariant(reportPackage.status)}>
              {stateLabel(reportPackage.status)}
            </Badge>
            {reportPackage.status === "failed" && canRetry && reportPackage.storage_object_id ? (
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
          {reconciliationGroups.map((group) => (
            <ReconciliationAction
              key={`${group.projection_run_id}:${group.projection_output_key}`}
              group={group}
              canResolve={canApproveContract}
              pending={resolveOverlapPending}
              onResolve={(input) => onResolveOverlap(input)}
            />
          ))}
          {latestValidation ? (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                Validation {latestValidation.status.replaceAll("_", " ")} ·{" "}
                {validationErrorCodes.length} error code(s) · {validationWarningCodes.length}{" "}
                warning code(s)
                {latestValidation.result_digest
                  ? ` · evidence ${latestValidation.result_digest.slice(0, 12)}…`
                  : ""}
              </p>
              {validationSheetResults.map((result) => (
                <div key={result.id} className="rounded-md border bg-muted/30 p-2 text-xs">
                  <p className="font-medium">
                    Sheet {result.normalized_sheet_name} · {result.outcome}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {result.row_count} sheet rows · {result.parsed_field_success_count} mapped
                    values parsed · {result.parsed_field_failure_count} failed
                  </p>
                </div>
              ))}
              {validationErrorCodes.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>Why validation stopped</AlertTitle>
                  <AlertDescription className="space-y-2">
                    {validationErrorCodes.map((code) => {
                      const explanation = explainReportValidationCode(code);
                      const context = detailForValidationCode(code);
                      return (
                        <p key={code} className="text-xs">
                          <span className="font-medium">
                            {explanation.title} <span className="font-mono">({code})</span>
                          </span>
                          {context ? <> — {context}</> : null} — {explanation.nextStep}
                        </p>
                      );
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
              {validationWarningCodes.length > 0 ? (
                <Alert className="border-warning/40 bg-warning/5">
                  <TriangleAlert aria-hidden="true" className="text-warning" />
                  <AlertTitle>Validation warnings</AlertTitle>
                  <AlertDescription className="space-y-2">
                    {validationWarningCodes.map((code) => {
                      const explanation = explainReportValidationCode(code);
                      const context = detailForValidationCode(code);
                      return (
                        <p key={code} className="text-xs">
                          <span className="font-medium">
                            {explanation.title} <span className="font-mono">({code})</span>
                          </span>
                          {context ? <> — {context}</> : null} — {explanation.nextStep}
                        </p>
                      );
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : reportPackage.status === "awaiting_validation" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              The exact contract is approved. Start validation to run the deterministic checks.
            </p>
          ) : null}
          {latestProjection && typeof latestProjection.output_count === "number" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {latestProjection.output_count} records checked
              {affectedRecordCount > 0
                ? ` · ${readyRecordCount} ready for Analysis · ${affectedRecordCount} need review`
                : ""}
              {absentRowCount > 0
                ? ` · ${absentRowCount} source rows had no reported value and stayed missing`
                : ""}
            </p>
          ) : reportPackage.status === "awaiting_projection" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              An approved declaration was selected. Deterministic projection starts when this
              rollout is enabled.
            </p>
          ) : null}
          {/*
            What the failure knew about itself. A code alone names a
            category -- "processing failed" -- and leaves an operator
            with nothing to act on and nothing to report. The detail is
            the error's own words, recorded by the run that failed.
          */}
          {latestProjection?.status === "failed" && latestProjection.failure_detail ? (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Why it stopped: </span>
                {latestProjection.failure_detail}
              </p>
              <CategoricalRefusalDeclaration
                organizationId={organizationId}
                projectionVersionId={latestProjection.report_projection_version_id}
                failureDetail={latestProjection.failure_detail}
                canDeclare={canApproveContract}
              />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
