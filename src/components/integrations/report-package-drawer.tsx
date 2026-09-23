"use client";

import { useCallback, useEffect, useMemo } from "react";
import { Banknote, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ReportContractStep,
  approvedProjectionSources,
  optionalContractFieldLabelsBySheet,
  safeValidationCodes,
  stateLabel,
  stateVariant,
  validationCodeContextDetail,
} from "@/components/integrations/report-package-upload";
import { summarizeReportProjection } from "@/domain/reports/projection-copy";
import {
  explainReportValidationCode,
  parserLabel,
  summarizeReportContract,
} from "@/domain/reports/validation-copy";
import type { ReportPackageRow, ReportPackageSnapshot } from "@/modules/reports/application/ports";

/**
 * Which drawer block a queue row lands on. Package rows pass null (open at
 * top); decision rows name their block. Slice 3 mirrors this in `?focus=`.
 */
export type DrawerFocus = "mapping" | "figures" | "validation" | null;

/**
 * The side drawer that holds one package's full detail.
 *
 * Slice 1 relocated the §1 upload block here verbatim; slice 2 adds the §2
 * mapping and §3 figures blocks filtered to the open package, with focus
 * anchors the queue's decision rows scroll to. `?package=` deep-linking
 * opens it from slice 3 on.
 */
export function ReportPackageDrawer({
  packageId,
  focus,
  organizationId,
  timeZone,
  view,
  packages,
  fixedChannelId,
  canUpload,
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
  rejectionReason,
  onRejectionReasonChange,
  proposalPackageId,
  onProposalPackageIdChange,
  onMappingDone,
  projectionContractVersionId,
  onProjectionContractVersionIdChange,
  onDecideContract,
  decideContractPending,
  onDecideProjection,
  decideProjectionPending,
  onProposeProjection,
  proposeProjectionPending,
  onClose,
}: Readonly<{
  packageId: string | null;
  focus: DrawerFocus;
  organizationId: string;
  timeZone: string;
  view: ReportPackageSnapshot;
  packages: ReportPackageRow[];
  fixedChannelId?: string;
  canUpload: boolean;
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
  rejectionReason: string;
  onRejectionReasonChange: (value: string) => void;
  proposalPackageId: string;
  onProposalPackageIdChange: (value: string) => void;
  onMappingDone: () => void;
  projectionContractVersionId: string;
  onProjectionContractVersionIdChange: (value: string) => void;
  onDecideContract: (input: { versionId: string; decision: "approved" | "rejected" }) => void;
  decideContractPending: boolean;
  onDecideProjection: (input: { versionId: string; decision: "approved" | "rejected" }) => void;
  decideProjectionPending: boolean;
  onProposeProjection: (contractVersionId: string) => void;
  proposeProjectionPending: boolean;
  onClose: () => void;
}>) {
  // The drawer only ever resolves a package this view may show: anything
  // else reads as closed, which is also what slice 3 does with an unknown
  // `?package=` id.
  const reportPackage = packages.find((candidate) => candidate.id === packageId) ?? null;
  // The sheet content mounts after this component's effects (Radix commits it
  // in a later pass), so an effect alone cannot see a fresh anchor. The ref
  // callback fires when the anchor itself mounts instead; it also refires on
  // focus changes (new identity), while the effect below covers package
  // changes that keep the same anchors mounted.
  const scrollAnchors = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      if (
        focus &&
        element.id === `drawer-${focus}` &&
        typeof element.scrollIntoView === "function"
      ) {
        element.scrollIntoView();
      }
    },
    [focus],
  );
  useEffect(() => {
    if (!packageId || !focus) return;
    const target = document.getElementById(`drawer-${focus}`);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView();
    }
  }, [packageId, focus]);

  const latestValidation = view.validationRuns.find(
    (run) => run.report_package_id === reportPackage?.id,
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
    (run) => run.report_package_id === reportPackage?.id,
  );
  const projectionFailed =
    reportPackage?.status === "projection_failed" || latestProjection?.status === "failed";
  const canRequestProjection =
    reportPackage?.status === "validated" ||
    reportPackage?.status === "partially_validated" ||
    projectionFailed;
  const reconciliationGroups = view.reconciliationGroups.filter(
    (group) => group.report_package_id === reportPackage?.id,
  );
  const affectedRecordCount = reconciliationGroups.reduce(
    (total, group) => total + group.affected_record_count,
    0,
  );
  const readyRecordCount = Math.max(0, (latestProjection?.output_count ?? 0) - affectedRecordCount);
  const absentRowCount = latestProjection?.absent_row_count ?? 0;
  const packageContractVersions = view.contractVersions.filter(
    (version) => version.report_package_id === reportPackage?.id,
  );
  const packageProjectionVersions = view.projectionVersions.filter((version) => {
    const contractVersion = view.contractVersions.find(
      (candidate) => candidate.id === version.report_contract_version_id,
    );
    return contractVersion?.report_package_id === reportPackage?.id;
  });
  const packageApprovedContractVersions = packageContractVersions.filter((version) =>
    view.contractDecisions.some(
      (decision) =>
        decision.report_contract_version_id === version.id && decision.decision === "approved",
    ),
  );
  // The propose box is scoped to this package: a selection left over from
  // another package's drawer reads as empty here rather than proposing
  // figures for the wrong upload.
  const scopedProjectionContractVersionId = packageApprovedContractVersions.some(
    (version) => version.id === projectionContractVersionId,
  )
    ? projectionContractVersionId
    : "";
  const selectedProjectionContract = view.contractVersions.find(
    (version) => version.id === scopedProjectionContractVersionId,
  );
  /**
   * Whether the selected mapping already has figures nobody has rejected.
   *
   * Two live declarations for one mapping would either agree, and be
   * redundant, or disagree, and leave no honest answer about which one the
   * ledger follows.
   */
  const alreadyProposed = view.projectionVersions.some(
    (version) =>
      version.report_contract_version_id === scopedProjectionContractVersionId &&
      view.projectionDecisions.find(
        (decision) => decision.report_projection_version_id === version.id,
      )?.decision !== "rejected",
  );

  const projectionSources = useMemo(
    () => approvedProjectionSources(selectedProjectionContract),
    [selectedProjectionContract],
  );

  // Below every hook: the derivations above tolerate a missing package (they
  // match nothing) so opening and closing never changes the hook count.
  if (!reportPackage) {
    return <Sheet open={false} />;
  }

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
            <div id="drawer-validation" ref={scrollAnchors} className="mt-2 space-y-2">
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
          <div id="drawer-mapping" ref={scrollAnchors} className="mt-4 space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-medium">2 · Approve what the columns mean</h3>
              <p className="text-xs text-muted-foreground">
                An owner or admin decides. Until then the file has been profiled and nothing more.
              </p>
            </div>
            {packageContractVersions.length ? (
              packageContractVersions.map((version) => {
                const decision = view.contractDecisions.find(
                  (item) => item.report_contract_version_id === version.id,
                );
                const contractSummary = summarizeReportContract(version.mapping_document);
                return (
                  <div key={version.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        Mapping v{version.version}
                        <Badge variant="secondary" className="font-normal">
                          {version.provider_definition_key
                            ? `From the known ${version.provider_definition_key} report`
                            : "Described by hand"}
                        </Badge>
                      </span>
                      <Badge
                        variant={decision?.decision === "rejected" ? "destructive" : "outline"}
                      >
                        {decision?.decision === "approved"
                          ? "Approved · validation next"
                          : decision?.decision === "rejected"
                            ? "Rejected"
                            : "Awaiting approval"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Fingerprint {version.schema_fingerprint.slice(0, 12)}… · mapping digest{" "}
                      {version.mapping_digest.slice(0, 12)}…
                    </p>
                    {contractSummary ? (
                      <div className="mt-3 space-y-2 rounded-md bg-muted/30 p-2 text-xs">
                        <p className="font-medium">What this contract checks</p>
                        <p className="text-muted-foreground">
                          Currency {contractSummary.currency} · outlet grain{" "}
                          {contractSummary.outletGrain} · unmapped fields:{" "}
                          {contractSummary.unmappedFieldDisposition}
                        </p>
                        {contractSummary.sheets.map((sheet) => (
                          <div
                            key={sheet.normalizedSheetName}
                            className="rounded border bg-background p-2"
                          >
                            <p className="font-medium">Sheet {sheet.normalizedSheetName}</p>
                            <p className="mt-1 text-muted-foreground">
                              Header row {sheet.headerRow} · data starts at row {sheet.dataStartRow}{" "}
                              · formulas {sheet.allowFormula ? "allowed" : "rejected"} · merged
                              cells {sheet.allowMergedCells ? "allowed" : "rejected"}
                            </p>
                            {sheet.requiredFields.length > 0 ? (
                              <div className="mt-2 space-y-1">
                                <p className="font-medium">Required fields</p>
                                {sheet.requiredFields.map((field) => (
                                  <p
                                    key={`${sheet.normalizedSheetName}.${field.canonicalField}`}
                                    className="text-muted-foreground"
                                  >
                                    {field.canonicalField} · source header {field.sourceHeader} ·{" "}
                                    {parserLabel(field.parser, field.financialSign)}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {canApproveContract && !decision ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={decideContractPending}
                          onClick={() =>
                            onDecideContract({ versionId: version.id, decision: "approved" })
                          }
                        >
                          Approve exact contract
                        </Button>
                        <Input
                          aria-label={`Rejection reason for contract version ${version.version}`}
                          value={rejectionReason}
                          onChange={(event) => onRejectionReasonChange(event.target.value)}
                          placeholder="Reason required to reject"
                          className="max-w-xs"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decideContractPending || rejectionReason.trim().length === 0}
                          onClick={() =>
                            onDecideContract({ versionId: version.id, decision: "rejected" })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                {fixedChannelId
                  ? "Nothing has been mapped for this channel yet."
                  : "Nothing has been mapped yet."}
              </p>
            )}
            {canApproveContract || canUpload ? (
              <div className="space-y-3 rounded-lg border border-dashed p-4">
                <div className="space-y-2">
                  <Label htmlFor="report-contract-package">Which upload are you mapping?</Label>
                  <Select value={proposalPackageId} onValueChange={onProposalPackageIdChange}>
                    <SelectTrigger id="report-contract-package">
                      <SelectValue placeholder="Select an upload waiting to be mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      {packages
                        .filter((candidate) => candidate.status === "awaiting_contract")
                        .map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {candidate.report_type} · {candidate.declared_period_start}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                {proposalPackageId ? (
                  <ReportContractStep
                    key={proposalPackageId}
                    organizationId={organizationId}
                    packageId={proposalPackageId}
                    canApprove={canApproveContract}
                    onDone={onMappingDone}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Choose an upload and we will tell you whether we already know how to read it.
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <div id="drawer-figures" ref={scrollAnchors} className="mt-4 space-y-3 border-t pt-4">
            <h3 className="text-sm font-medium">3 · Approve what gets recorded</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              A separate decision, because it is a separate consequence: this is what enters the
              ledger and drives every figure downstream. No workbook value appears here.
            </p>
            {packageProjectionVersions.map((version) => {
              const decision = view.projectionDecisions.find(
                (item) => item.report_projection_version_id === version.id,
              );
              const contractVersion = view.contractVersions.find(
                (candidate) => candidate.id === version.report_contract_version_id,
              );
              // The last thing a person reads before figures enter the ledger.
              // A digest proves two documents are the same and is useless for
              // deciding whether to approve one.
              const summary = summarizeReportProjection(
                version.projection_document,
                contractVersion?.mapping_document,
              );
              return (
                <div key={version.id} className="mt-2 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Figures v{version.version}</span>
                    <Badge variant={decision?.decision === "rejected" ? "destructive" : "outline"}>
                      {decision?.decision === "approved"
                        ? "Approved"
                        : decision?.decision === "rejected"
                          ? "Rejected"
                          : "Awaiting approval"}
                    </Badge>
                  </div>
                  {summary ? (
                    <div className="mt-2 space-y-2">
                      <ul className="space-y-1">
                        {summary.entries.map((entry) => (
                          <li key={entry.label} className="flex items-start gap-2">
                            <Banknote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            <span>
                              <span className="font-medium capitalize">{entry.label}</span>
                              <span className="text-muted-foreground">
                                {" — "}
                                {summary.shape}
                                {entry.sourceColumn ? `, from ${entry.sourceColumn}` : ""}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      {summary.checkedAgainst ? (
                        <p className="text-xs text-muted-foreground">
                          Checked against {summary.checkedAgainst}. The import stops if the rows do
                          not reach it.
                        </p>
                      ) : null}
                      {summary.mayHaveGaps ? (
                        <p className="text-xs text-muted-foreground">
                          Days the provider left blank stay blank. They are not recorded as zero, so
                          a quiet day and a day nobody reported on never look the same.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      This declaration was written in a form this screen cannot read back. Reject it
                      and map the upload again rather than approving what you cannot see.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Declaration digest {version.projection_digest.slice(0, 12)}…
                  </p>
                  {canApproveContract && !decision ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          onDecideProjection({ versionId: version.id, decision: "approved" })
                        }
                        disabled={decideProjectionPending}
                      >
                        Approve these figures
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onDecideProjection({ versionId: version.id, decision: "rejected" })
                        }
                        disabled={decideProjectionPending}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {canApproveContract ? (
              <div className="mt-3 space-y-3 rounded-lg border border-dashed p-4">
                <div className="space-y-2">
                  <Label htmlFor="report-projection-contract">Approved mapping</Label>
                  <Select
                    value={scopedProjectionContractVersionId}
                    onValueChange={onProjectionContractVersionIdChange}
                  >
                    <SelectTrigger id="report-projection-contract">
                      <SelectValue placeholder="Select an approved mapping" />
                    </SelectTrigger>
                    <SelectContent>
                      {packageApprovedContractVersions.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          Mapping v{version.version}
                          {version.provider_definition_key
                            ? ` · ${version.provider_definition_key}`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {projectionSources.length ? (
                  <p className="text-xs text-muted-foreground">
                    Reads from {projectionSources.join(", ")}.
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  The figures follow from the mapping that was approved, so nothing here can differ
                  from what an owner already agreed to.
                </p>
                {alreadyProposed ? (
                  <p className="text-xs text-muted-foreground">
                    This mapping already has a set of figures above. Reject that one before
                    proposing another, so there is never a question about which one governs.
                  </p>
                ) : null}
                <Button
                  size="sm"
                  disabled={
                    proposeProjectionPending ||
                    !scopedProjectionContractVersionId ||
                    alreadyProposed
                  }
                  onClick={() => onProposeProjection(scopedProjectionContractVersionId)}
                >
                  {proposeProjectionPending ? "Proposing…" : "Propose the figures to read"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
