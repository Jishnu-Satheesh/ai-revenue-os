"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "tus-js-client";
import { useMemo, useState } from "react";
import { FileSpreadsheet, RotateCcw, ShieldCheck, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currencyOptions } from "@/domain/reference/currencies";
import { REPORT_PACKAGE_LIMITS, type ReportPackageStatus } from "@/domain/reports/types";
import { hasReportPermission } from "@/domain/reports/permissions";
import { getReconciliationNextStep } from "@/domain/reports/reconciliation-copy";
import {
  explainReportValidationCode,
  parserLabel,
  summarizeReportContract,
} from "@/domain/reports/validation-copy";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { ReportPackageSnapshot, ReportPackageRow } from "@/modules/reports/application/ports";

type UploadIntentResponse = {
  reportPackage: ReportPackageRow;
  upload: { endpoint: string; token: string; apiKey: string; chunkSize: number };
};

type UploadCompleteResponse = { reportPackage: ReportPackageRow; profilingQueued: boolean };

function reportPackagesPath(organizationId: string): string {
  return `/api/organizations/${organizationId}/report-packages`;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && payload.error?.message
        ? payload.error.message
        : "The report request could not be completed.";
    throw new Error(message);
  }
  return payload as T;
}

function operationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function stateLabel(status: ReportPackageStatus): string {
  return {
    awaiting_upload: "Awaiting upload",
    uploaded: "Upload verified",
    profiling: "Checking structure",
    awaiting_contract: "Profiled · awaiting contract",
    awaiting_approval: "Contract proposed · awaiting approval",
    awaiting_validation: "Contract approved · awaiting validation",
    validating: "Validation running",
    validated: "Validated · ready for a future projection",
    partially_validated: "Partially validated · review warnings",
    validation_failed: "Validation needs attention",
    awaiting_projection: "Validated · awaiting projection",
    projecting: "Deterministic projection running",
    projected: "Projected · exact-range evidence ready",
    partially_projected: "Partially projected · review warnings",
    reconciliation_required: "Overlap requires review",
    projection_failed: "Projection needs attention",
    failed: "Needs attention",
  }[status];
}

function stateVariant(
  status: ReportPackageStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "validation_failed" || status === "projection_failed")
    return "destructive";
  if (status === "awaiting_contract" || status === "awaiting_approval") return "default";
  if (status === "profiling" || status === "validating" || status === "projecting")
    return "secondary";
  return "outline";
}

function fileKind(file: File): "csv" | "xlsx" | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "csv" || extension === "xlsx" ? extension : null;
}

function approvedProjectionSources(
  version: ReportPackageSnapshot["contractVersions"][number] | undefined,
): string[] {
  const document = version?.mapping_document;
  if (!document || typeof document !== "object" || Array.isArray(document)) return [];
  const sheets = (document as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets.flatMap((sheet) => {
    if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) return [];
    const sheetRecord = sheet as { normalizedSheetName?: unknown; fields?: unknown };
    if (typeof sheetRecord.normalizedSheetName !== "string" || !Array.isArray(sheetRecord.fields))
      return [];
    return sheetRecord.fields.flatMap((field) => {
      if (!field || typeof field !== "object" || Array.isArray(field)) return [];
      const fieldRecord = field as {
        canonicalField?: unknown;
        parser?: unknown;
        required?: unknown;
      };
      if (
        fieldRecord.required !== true ||
        typeof fieldRecord.canonicalField !== "string" ||
        (fieldRecord.parser !== "money" && fieldRecord.parser !== "integer")
      )
        return [];
      return [
        `${sheetRecord.normalizedSheetName}.${fieldRecord.canonicalField} (${fieldRecord.parser})`,
      ];
    });
  });
}

function safeValidationCodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((code): code is string => typeof code === "string").slice(0, 20)
    : [];
}

export function ReportPackageUpload({
  organizationId,
  role,
  timeZone,
}: Readonly<{ organizationId: string; role: OrganizationRole; timeZone: string }>) {
  const queryClient = useQueryClient();
  const [channelId, setChannelId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [reportType, setReportType] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [currency, setCurrency] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [proposalPackageId, setProposalPackageId] = useState("");
  const [mappingDocument, setMappingDocument] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [projectionContractVersionId, setProjectionContractVersionId] = useState("");
  const [projectionDocument, setProjectionDocument] = useState("");
  const canUpload = hasReportPermission(role, "report.upload");
  const canRetry = hasReportPermission(role, "report.retry");
  const canApproveContract = hasReportPermission(role, "report.contract_approve");

  const snapshot = useQuery({
    queryKey: ["report-packages", organizationId],
    queryFn: () => requestJson<ReportPackageSnapshot>(reportPackagesPath(organizationId)),
  });

  const activeBranches = useMemo(() => snapshot.data?.branches ?? [], [snapshot.data?.branches]);
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["report-packages", organizationId] });

  const selectedProjectionContract = snapshot.data?.contractVersions.find(
    (version) => version.id === projectionContractVersionId,
  );
  const projectionSources = useMemo(
    () => approvedProjectionSources(selectedProjectionContract),
    [selectedProjectionContract],
  );

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a CSV or XLSX report first.");
      const kind = fileKind(file);
      if (!kind) throw new Error("Only CSV and XLSX files are accepted.");
      if (file.size < 1 || file.size > REPORT_PACKAGE_LIMITS.maxCompressedBytes) {
        throw new Error("The upload must be no larger than 50 MiB.");
      }
      const contentType =
        kind === "csv"
          ? file.type === "application/csv"
            ? "application/csv"
            : "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const intent = await requestJson<UploadIntentResponse>(
        `${reportPackagesPath(organizationId)}/upload-intents`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channelId,
            branchId,
            reportType,
            periodStart,
            periodEnd,
            currency,
            originalFilename: file.name,
            contentType,
            contentLength: file.size,
            idempotencyKey: operationKey("report-intent"),
          }),
        },
      );
      await new Promise<void>((resolve, reject) => {
        const tus = new Upload(file, {
          endpoint: intent.upload.endpoint,
          chunkSize: intent.upload.chunkSize,
          uploadSize: file.size,
          metadata: {
            bucketName: "governed-report-packages",
            objectName: intent.reportPackage.storage_path,
            contentType,
          },
          headers: {
            apikey: intent.upload.apiKey,
            "x-signature": intent.upload.token,
          },
          retryDelays: [0, 1_000, 3_000, 5_000],
          removeFingerprintOnSuccess: true,
          fingerprint: () =>
            Promise.resolve(`report-package:${intent.reportPackage.id}:${file.name}:${file.size}`),
          onError: reject,
          onProgress: (uploaded, total) =>
            setProgress(total ? Math.round((uploaded / total) * 100) : 0),
          onSuccess: () => resolve(),
        });
        void tus.findPreviousUploads().then((previous) => {
          if (previous[0]) tus.resumeFromPreviousUpload(previous[0]);
          tus.start();
        }, reject);
      });
      return requestJson<UploadCompleteResponse>(
        `${reportPackagesPath(organizationId)}/${intent.reportPackage.id}/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: operationKey("report-complete") }),
        },
      );
    },
    onSuccess: (result) => {
      setProgress(null);
      setFile(null);
      if (result.reportPackage.status === "failed") {
        toast.error(
          "The file could not be verified. Its package state explains the next safe step.",
        );
      } else {
        toast.success(
          result.profilingQueued
            ? "Upload verified. Structural checks are starting."
            : "Upload verified. Structural checks will resume shortly.",
        );
      }
      invalidate();
    },
    onError: (error) => {
      setProgress(null);
      toast.error(
        error instanceof Error
          ? error.message
          : "The report upload failed. Check the selected channel, branch, dates, and file, then try again.",
      );
      invalidate();
    },
  });

  const retry = useMutation({
    mutationFn: (packageId: string) =>
      requestJson<UploadCompleteResponse>(
        `${reportPackagesPath(organizationId)}/${packageId}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: operationKey("report-retry") }),
        },
      ),
    onSuccess: () => {
      toast.info("Structural checks were queued again.");
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Retry failed."),
  });

  const retryValidation = useMutation({
    mutationFn: (packageId: string) =>
      requestJson<{ reportPackage: ReportPackageRow; validationQueued: boolean }>(
        `${reportPackagesPath(organizationId)}/${packageId}/validation-retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: operationKey("report-validation-retry") }),
        },
      ),
    onSuccess: (result) => {
      toast.info(
        result.validationQueued
          ? "Validation was queued again."
          : "Validation is ready but is not enabled for this organization yet.",
      );
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Validation retry failed."),
  });

  const requestProjection = useMutation({
    mutationFn: (packageId: string) =>
      requestJson<{ reportPackage: ReportPackageRow; projectionQueued: boolean }>(
        `${reportPackagesPath(organizationId)}/${packageId}/projection`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: operationKey("report-projection") }),
        },
      ),
    onSuccess: (result) => {
      toast.info(
        result.projectionQueued
          ? "Deterministic projection was queued."
          : "Projection is approved but not enabled for this organization yet.",
      );
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Projection could not be requested."),
  });

  const proposeContract = useMutation({
    mutationFn: async () => {
      if (!proposalPackageId) throw new Error("Select a profiled package first.");
      let parsedDocument: unknown;
      try {
        parsedDocument = JSON.parse(mappingDocument);
      } catch {
        throw new Error("The contract document must be valid JSON.");
      }
      return requestJson(
        `${reportPackagesPath(organizationId)}/${proposalPackageId}/contract-proposals`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mappingDocument: parsedDocument,
            idempotencyKey: operationKey("report-contract-proposal"),
          }),
        },
      );
    },
    onSuccess: () => {
      setProposalPackageId("");
      setMappingDocument("");
      toast.success("Contract proposal saved for owner/admin review.");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Contract proposal could not be saved."),
  });

  const decideContract = useMutation({
    mutationFn: ({
      versionId,
      decision,
    }: {
      versionId: string;
      decision: "approved" | "rejected";
    }) =>
      requestJson(`/api/organizations/${organizationId}/report-contracts/${versionId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: decision === "rejected" ? rejectionReason : undefined,
          idempotencyKey: operationKey("report-contract-decision"),
        }),
      }),
    onSuccess: () => {
      setRejectionReason("");
      toast.success("Contract decision recorded.");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Contract decision could not be saved."),
  });

  const proposeProjection = useMutation({
    mutationFn: () => {
      if (!projectionContractVersionId) throw new Error("Select an approved contract first.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(projectionDocument);
      } catch {
        throw new Error("The projection declaration must be valid JSON.");
      }
      return requestJson(
        `/api/organizations/${organizationId}/report-contracts/${projectionContractVersionId}/projection-proposals`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectionDocument: parsed,
            idempotencyKey: operationKey("report-projection-proposal"),
          }),
        },
      );
    },
    onSuccess: () => {
      setProjectionDocument("");
      toast.success("Projection declaration saved for owner/admin approval.");
      invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Projection declaration could not be saved.",
      ),
  });

  const decideProjection = useMutation({
    mutationFn: ({
      versionId,
      decision,
    }: {
      versionId: string;
      decision: "approved" | "rejected";
    }) =>
      requestJson(`/api/organizations/${organizationId}/report-projections/${versionId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: decision === "rejected" ? rejectionReason : undefined,
          idempotencyKey: operationKey("report-projection-decision"),
        }),
      }),
    onSuccess: () => {
      setRejectionReason("");
      toast.success("Projection decision recorded.");
      invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Projection decision could not be saved.",
      ),
  });

  const resolveOverlap = useMutation({
    mutationFn: ({
      reconciliationId,
      resolution,
    }: {
      reconciliationId: string;
      resolution: "accept_correction" | "keep_existing";
    }) =>
      requestJson(
        `/api/organizations/${organizationId}/report-reconciliations/${reconciliationId}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            resolution,
            idempotencyKey: operationKey("report-overlap-resolution"),
          }),
        },
      ),
    onSuccess: () => {
      toast.success("Overlap resolution recorded. Historical evidence remains available.");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Overlap resolution failed."),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5" /> Governed reports
            </CardTitle>
            <CardDescription>
              Upload one declared CSV or XLSX report directly to private storage. Files are
              structurally checked before any future contract review.
            </CardDescription>
          </div>
          <Badge variant="outline">
            <ShieldCheck className="mr-1 size-3" /> Private intake
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {canUpload ? (
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="report-channel">Business channel</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id="report-channel">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {snapshot.data?.channels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-branch">Branch / outlet</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="report-branch">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {activeBranches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-type">Report type</Label>
              <Input
                id="report-type"
                value={reportType}
                onChange={(event) => setReportType(event.target.value)}
                maxLength={120}
                placeholder="e.g. Marketplace settlement"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-currency">Declared currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="report-currency">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  {currencyOptions.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.code} · {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-period-start">Period start</Label>
              <Input
                id="report-period-start"
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-period-end">Period end</Label>
              <Input
                id="report-period-end"
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="report-file">CSV or XLSX, up to 50 MiB</Label>
              <Input
                id="report-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </div>
            {progress !== null ? (
              <div className="space-y-2 md:col-span-2">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  Uploading directly to private storage · {progress}%
                </p>
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Button
                type="submit"
                disabled={
                  upload.isPending || snapshot.isLoading || !channelId || !branchId || !currency
                }
              >
                <UploadCloud data-icon="inline-start" />{" "}
                {upload.isPending ? "Uploading…" : "Upload report"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            You can see package state, but only operators and administrators can upload reports.
          </p>
        )}

        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-medium">Recent packages</h3>
          {snapshot.data?.packages.length ? (
            snapshot.data.packages.map((reportPackage) => {
              const latestValidation = snapshot.data.validationRuns.find(
                (run) => run.report_package_id === reportPackage.id,
              );
              const validationErrorCodes = safeValidationCodes(latestValidation?.error_codes);
              const validationWarningCodes = safeValidationCodes(latestValidation?.warning_codes);
              const validationSheetResults = latestValidation
                ? snapshot.data.validationSheetResults.filter(
                    (result) => result.validation_run_id === latestValidation.id,
                  )
                : [];
              const latestProjection = snapshot.data.projectionRuns.find(
                (run) => run.report_package_id === reportPackage.id,
              );
              const reconciliations = snapshot.data.reconciliations.filter(
                (item) => item.report_package_id === reportPackage.id,
              );
              const exactRangeObservations = snapshot.data.exactRangeObservations.filter(
                (item) => item.report_package_id === reportPackage.id,
              );
              return (
                <div key={reportPackage.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {reportPackage.report_type} · {reportPackage.declared_period_start} to{" "}
                        {reportPackage.declared_period_end}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {reportPackage.file_kind.toUpperCase()} · {reportPackage.declared_currency}{" "}
                        · retained until{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeZone,
                        }).format(new Date(reportPackage.retained_until))}
                      </p>
                    </div>
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
                          disabled={retry.isPending}
                          onClick={() => retry.mutate(reportPackage.id)}
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
                          disabled={retryValidation.isPending}
                          onClick={() => retryValidation.mutate(reportPackage.id)}
                        >
                          <RotateCcw data-icon="inline-start" />{" "}
                          {reportPackage.status === "awaiting_validation"
                            ? "Start validation"
                            : "Retry validation"}
                        </Button>
                      ) : null}
                      {(reportPackage.status === "validated" ||
                        reportPackage.status === "partially_validated" ||
                        reportPackage.status === "projection_failed") &&
                      canRetry ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={requestProjection.isPending}
                          onClick={() => requestProjection.mutate(reportPackage.id)}
                        >
                          <ShieldCheck data-icon="inline-start" /> Project safely
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {latestValidation ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Validation {latestValidation.status.replaceAll("_", " ")} ·{" "}
                        {validationErrorCodes.length} error code(s) ·{" "}
                        {validationWarningCodes.length} warning code(s)
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
                            {result.row_count} sheet rows · {result.parsed_field_success_count}{" "}
                            mapped values parsed · {result.parsed_field_failure_count} failed
                          </p>
                        </div>
                      ))}
                      {validationErrorCodes.length > 0 ? (
                        <Alert variant="destructive">
                          <AlertTitle>Why validation stopped</AlertTitle>
                          <AlertDescription className="space-y-2">
                            {validationErrorCodes.map((code) => {
                              const explanation = explainReportValidationCode(code);
                              return (
                                <div key={code}>
                                  <p className="font-medium">
                                    {explanation.title} <span className="font-mono">({code})</span>
                                  </p>
                                  <p>{explanation.detail}</p>
                                  <p>Next step: {explanation.nextStep}</p>
                                </div>
                              );
                            })}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      {validationWarningCodes.length > 0 ? (
                        <Alert>
                          <AlertTitle>Validation warnings</AlertTitle>
                          <AlertDescription className="space-y-2">
                            {validationWarningCodes.map((code) => {
                              const explanation = explainReportValidationCode(code);
                              return (
                                <div key={code}>
                                  <p className="font-medium">
                                    {explanation.title} <span className="font-mono">({code})</span>
                                  </p>
                                  <p>{explanation.detail}</p>
                                  <p>Next step: {explanation.nextStep}</p>
                                </div>
                              );
                            })}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                    </div>
                  ) : reportPackage.status === "awaiting_validation" ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      The exact contract is approved. Start validation to run the deterministic
                      checks.
                    </p>
                  ) : null}
                  {latestProjection ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Projection {latestProjection.status.replaceAll("_", " ")} ·{" "}
                      {latestProjection.output_count} aggregate output(s)
                      {latestProjection.result_digest
                        ? ` · evidence ${latestProjection.result_digest.slice(0, 12)}…`
                        : ""}
                    </p>
                  ) : reportPackage.status === "awaiting_projection" ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      An approved declaration was selected. Deterministic projection starts when
                      this rollout is enabled.
                    </p>
                  ) : null}
                  {exactRangeObservations.map((observation) => (
                    <div
                      key={observation.id}
                      className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground"
                    >
                      <p>
                        {observation.reconciliation_state === "current"
                          ? "Current exact-range evidence"
                          : observation.reconciliation_state === "superseded"
                            ? "Superseded history"
                            : observation.reconciliation_state === "blocked_overlap"
                              ? "Held outside the current rollup"
                              : "Excluded from the current rollup"}
                        {" · "}
                        {observation.projection_output_key.replaceAll("_", " ")} · revision{" "}
                        {observation.revision}
                      </p>
                      <p className="mt-1">
                        {observation.period_start} to {observation.period_end} ·{" "}
                        {observation.period_timezone}
                        {observation.currency ? ` · ${observation.currency}` : ""}
                        {observation.reconciliation_digest
                          ? ` · evidence ${observation.reconciliation_digest.slice(0, 12)}…`
                          : ""}
                      </p>
                    </div>
                  ))}
                  {reconciliations.map((reconciliation) => {
                    const resolved =
                      snapshot.data?.reconciliationResolutions.some(
                        (item) => item.reconciliation_id === reconciliation.id,
                      ) ?? false;
                    const needsReview =
                      reconciliation.classification === "ambiguous_overlap" && !resolved;
                    return (
                      <div
                        key={reconciliation.id}
                        className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground"
                      >
                        <p>
                          Evidence {reconciliation.reconciliation_digest.slice(0, 12)}… ·{" "}
                          {reconciliation.classification.replaceAll("_", " ")} ·{" "}
                          {reconciliation.candidate_count} matching record(s)
                        </p>
                        <p className="mt-1">
                          {getReconciliationNextStep(reconciliation.classification, resolved)}
                        </p>
                        {needsReview && canApproveContract ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={resolveOverlap.isPending}
                              onClick={() =>
                                resolveOverlap.mutate({
                                  reconciliationId: reconciliation.id,
                                  resolution: "accept_correction",
                                })
                              }
                            >
                              Accept correction
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resolveOverlap.isPending}
                              onClick={() =>
                                resolveOverlap.mutate({
                                  reconciliationId: reconciliation.id,
                                  resolution: "keep_existing",
                                })
                              }
                            >
                              Keep current evidence
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No governed report packages yet.</p>
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-medium">Contract trust</h3>
            <p className="text-xs text-muted-foreground">
              A contract is a reviewed structural mapping. It does not import or calculate values
              yet.
            </p>
          </div>
          {snapshot.data?.contractVersions.length ? (
            snapshot.data.contractVersions.map((version) => {
              const decision = snapshot.data?.contractDecisions.find(
                (item) => item.report_contract_version_id === version.id,
              );
              const contractSummary = summarizeReportContract(version.mapping_document);
              return (
                <div key={version.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Contract v{version.version}</span>
                    <Badge variant={decision?.decision === "rejected" ? "destructive" : "outline"}>
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
                            Header row {sheet.headerRow} · data starts at row {sheet.dataStartRow} ·{" "}
                            formulas {sheet.allowFormula ? "allowed" : "rejected"} · merged cells{" "}
                            {sheet.allowMergedCells ? "allowed" : "rejected"}
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
                        disabled={decideContract.isPending}
                        onClick={() =>
                          decideContract.mutate({ versionId: version.id, decision: "approved" })
                        }
                      >
                        Approve exact contract
                      </Button>
                      <Input
                        aria-label={`Rejection reason for contract version ${version.version}`}
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        placeholder="Reason required to reject"
                        className="max-w-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decideContract.isPending || rejectionReason.trim().length === 0}
                        onClick={() =>
                          decideContract.mutate({ versionId: version.id, decision: "rejected" })
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
            <p className="text-sm text-muted-foreground">No contract proposal has been saved.</p>
          )}
          {canApproveContract ? (
            <form
              className="space-y-3 rounded-lg border border-dashed p-3"
              onSubmit={(event) => {
                event.preventDefault();
                proposeContract.mutate();
              }}
            >
              <Label htmlFor="report-contract-package">Profiled package to map</Label>
              <Select value={proposalPackageId} onValueChange={setProposalPackageId}>
                <SelectTrigger id="report-contract-package">
                  <SelectValue placeholder="Select a package awaiting a contract" />
                </SelectTrigger>
                <SelectContent>
                  {snapshot.data?.packages
                    .filter((reportPackage) => reportPackage.status === "awaiting_contract")
                    .map((reportPackage) => (
                      <SelectItem key={reportPackage.id} value={reportPackage.id}>
                        {reportPackage.report_type} · {reportPackage.declared_period_start}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Label htmlFor="report-contract-document">Declarative mapping document</Label>
              <Textarea
                id="report-contract-document"
                value={mappingDocument}
                onChange={(event) => setMappingDocument(event.target.value)}
                placeholder='{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[…],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'
                className="min-h-36 font-mono text-xs"
                required
              />
              <Button type="submit" disabled={proposeContract.isPending || !proposalPackageId}>
                {proposeContract.isPending ? "Saving…" : "Save contract proposal"}
              </Button>
            </form>
          ) : null}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium">Deterministic projection trust</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Declarations map approved fields to registered exact-range aggregates; workbook values
              never appear here.
            </p>
            {snapshot.data?.projectionVersions.map((version) => {
              const decision = snapshot.data.projectionDecisions.find(
                (item) => item.report_projection_version_id === version.id,
              );
              return (
                <div key={version.id} className="mt-2 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Projection v{version.version}</span>
                    <Badge variant={decision?.decision === "rejected" ? "destructive" : "outline"}>
                      {decision?.decision === "approved"
                        ? "Approved"
                        : decision?.decision === "rejected"
                          ? "Rejected"
                          : "Awaiting approval"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Declaration digest {version.projection_digest.slice(0, 12)}… · exact-range only
                  </p>
                  {canApproveContract && !decision ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          decideProjection.mutate({ versionId: version.id, decision: "approved" })
                        }
                        disabled={decideProjection.isPending}
                      >
                        Approve projection
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          decideProjection.mutate({ versionId: version.id, decision: "rejected" })
                        }
                        disabled={decideProjection.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {canApproveContract ? (
              <form
                className="mt-3 space-y-3 rounded-lg border border-dashed p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  proposeProjection.mutate();
                }}
              >
                <Label htmlFor="report-projection-contract">Approved contract</Label>
                <Select
                  value={projectionContractVersionId}
                  onValueChange={(value) => {
                    setProjectionContractVersionId(value);
                    setProjectionDocument("");
                  }}
                >
                  <SelectTrigger id="report-projection-contract">
                    <SelectValue placeholder="Select approved contract" />
                  </SelectTrigger>
                  <SelectContent>
                    {snapshot.data?.contractVersions
                      .filter((version) =>
                        snapshot.data.contractDecisions.some(
                          (decision) =>
                            decision.report_contract_version_id === version.id &&
                            decision.decision === "approved",
                        ),
                      )
                      .map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          Contract v{version.version}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {projectionSources.length ? (
                  <p className="text-xs text-muted-foreground">
                    Exact approved projection sources: {projectionSources.join(", ")}. Use these
                    identities exactly; a CSV file does not create a sheet named “csv”.
                  </p>
                ) : null}
                <Label htmlFor="report-projection-document">
                  Exact-range projection declaration
                </Label>
                <Textarea
                  id="report-projection-document"
                  value={projectionDocument}
                  onChange={(event) => setProjectionDocument(event.target.value)}
                  placeholder='{"schemaVersion":1,"outputKind":"exact_range","outputs":[…]}'
                  className="min-h-28 font-mono text-xs"
                  required
                />
                <Button
                  type="submit"
                  disabled={proposeProjection.isPending || !projectionContractVersionId}
                >
                  {proposeProjection.isPending ? "Saving…" : "Save projection declaration"}
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
