"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "tus-js-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calculator,
  Calendar as CalendarIcon,
  ChevronDown,
  FileSpreadsheet,
  Lock,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  UploadCloud,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ReportAdmissionApproval } from "@/components/integrations/report-admission-approval";
import {
  ReportIntakeMapping,
  type RecognisedFamily,
} from "@/components/integrations/report-intake-mapping";
import {
  ReportPackageDrawer,
  type DrawerFocus,
} from "@/components/integrations/report-package-drawer";
import { ReportReviewQueue } from "@/components/integrations/report-review-queue";
import {
  isBareCategoricalValueNotDeclared,
  isDeclarableCategoricalValue,
  isTruncatedCategoricalValue,
  parseCategoricalRefusalDetail,
  type ParsedCategoricalRefusal,
} from "@/domain/reports/projection-error";
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
import { summarizeReportContract } from "@/domain/reports/validation-copy";
import type { OrganizationRole } from "@/domain/organizations/types";
import type {
  ReportPackageSnapshot,
  ReportPackageRow,
  ReportProjectionReconciliationGroup,
} from "@/modules/reports/application/ports";

type UploadIntentResponse = {
  reportPackage: ReportPackageRow;
  upload: { endpoint: string; token: string; apiKey: string; chunkSize: number };
};

type UploadCompleteResponse = { reportPackage: ReportPackageRow; profilingQueued: boolean };

type ResolveOverlapGroupResponse = {
  resolution: { outcome?: unknown };
};

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

/**
 * Why validation did not start, in words that point at the next action.
 *
 * Every one of these used to read "not enabled for this organization yet",
 * including the two cases where the feature was on the whole time -- so an
 * operator whose upload was waiting on an approval, or on a transport that
 * blinked, was sent to ask for a rollout that had already happened.
 */
function validationNotQueuedMessage(
  reason: "feature_disabled" | "contract_unresolved" | "dispatch_failed" | undefined,
): string {
  switch (reason) {
    case "contract_unresolved":
      return "This upload has no approved column mapping yet, so validation cannot start. Approve its contract first.";
    case "dispatch_failed":
      return "Validation could not be queued just now. The upload is still waiting, so try again in a moment.";
    case "feature_disabled":
      return "Validation is ready but is not enabled for this organization yet.";
    default:
      return "Validation did not start. Refresh the page to see where this upload stands.";
  }
}

function humanizeProjectionKey(key: string): string {
  const words = key.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function reconciliationDecisionSubject(group: ReportProjectionReconciliationGroup): string {
  if (group.metric_key?.startsWith("revenue.") || group.projection_output_key.includes("revenue")) {
    return "revenue";
  }
  return humanizeProjectionKey(group.projection_output_key).toLowerCase();
}

function formatReportDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function ReconciliationAction({
  group,
  canResolve,
  pending,
  onResolve,
}: Readonly<{
  group: ReportProjectionReconciliationGroup;
  canResolve: boolean;
  pending: boolean;
  onResolve: (input: {
    reconciliationId: string;
    resolution: "accept_correction" | "keep_existing";
  }) => void;
}>) {
  const fieldLabel = humanizeProjectionKey(group.projection_output_key);
  const decisionSubject = reconciliationDecisionSubject(group);
  const sourceField = group.source_header ?? group.canonical_field ?? "Approved mapped field";
  const firstPeriod = formatReportDate(group.first_period);
  const lastPeriod = formatReportDate(group.last_period);
  const priorStart = formatReportDate(group.prior_period_start);
  const priorEnd = formatReportDate(group.prior_period_end);
  const priorUpload =
    group.prior_upload_count === 1
      ? `an earlier ${group.prior_report_type ?? "report"} upload`
      : `${group.prior_upload_count} earlier uploads`;

  return (
    <Alert
      role="region"
      aria-label={`${fieldLabel} overlap`}
      className="mt-3 border-warning/40 bg-warning/5 px-3 py-3"
    >
      <TriangleAlert aria-hidden="true" className="text-warning" />
      <AlertTitle>
        {group.affected_record_count} daily {fieldLabel} record
        {group.affected_record_count === 1 ? "" : "s"} need a decision
      </AlertTitle>
      <AlertDescription className="mt-2 grid gap-3 text-pretty">
        <p>
          This upload and {priorUpload} both contain {fieldLabel.toLowerCase()} for the same{" "}
          {group.affected_record_count} day{group.affected_record_count === 1 ? "" : "s"}. Choose
          which upload Analysis should use for those dates.
        </p>
        <dl className="grid gap-2 rounded-md border bg-background/80 p-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-foreground">Source field: {sourceField}</dt>
          </div>
          <div>
            <dt className="text-xs font-medium text-foreground">Affected dates</dt>
            <dd className="mt-0.5 text-xs">
              {firstPeriod && lastPeriod ? `${firstPeriod} – ${lastPeriod}` : "Dates unavailable"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-foreground">Earlier upload period</dt>
            <dd className="mt-0.5 text-xs">
              {priorStart && priorEnd ? `${priorStart} – ${priorEnd}` : "Period unavailable"}
            </dd>
          </div>
        </dl>
        {group.affected_dates.length > 0 ? (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-auto w-fit px-0">
                <ChevronDown data-icon="inline-start" /> View affected dates
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="rounded-md bg-muted/60 p-2 text-xs">
                {group.affected_dates.map((date) => formatReportDate(date)).join(" · ")}
                {group.affected_dates_truncated ? " · More dates are retained in the ledger." : ""}
              </p>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        {canResolve ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2 rounded-md border bg-background p-3">
              <p className="text-xs">
                Replaces {group.matching_record_count} existing record
                {group.matching_record_count === 1 ? "" : "s"}. Their history stays available.
              </p>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  onResolve({
                    reconciliationId: group.representative_reconciliation_id,
                    resolution: "accept_correction",
                  })
                }
              >
                Use this upload&apos;s {decisionSubject}
              </Button>
            </div>
            <div className="grid gap-2 rounded-md border bg-background p-3">
              <p className="text-xs">
                Keeps the existing records. These {group.affected_record_count} incoming records
                stay out of Analysis.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  onResolve({
                    reconciliationId: group.representative_reconciliation_id,
                    resolution: "keep_existing",
                  })
                }
              >
                Keep existing {decisionSubject}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs font-medium text-foreground">
            An organization owner or admin must choose which upload Analysis should use.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function stateLabel(status: ReportPackageStatus): string {
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

export function stateVariant(
  status: ReportPackageStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "validation_failed" || status === "projection_failed")
    return "destructive";
  if (status === "awaiting_contract" || status === "awaiting_approval") return "default";
  if (status === "profiling" || status === "validating" || status === "projecting")
    return "secondary";
  return "outline";
}

type UploadFileKind = "csv" | "xlsx" | "pdf";

/**
 * Formats worth naming in the refusal rather than lumping in with "unsupported".
 *
 * A provider in the pilot serves pre-2007 binary `.xls`. Its icon says Excel, so
 * "only CSV, XLSX and PDF are accepted" reads as a mistake by the platform
 * rather than as something the operator can fix in twenty seconds.
 */
const unsupportedFileMessages: Readonly<Record<string, string>> = {
  xls: "This is an older Excel format (.xls). Open it and save as .xlsx, then upload again.",
  xlsm: "Macro-enabled workbooks are not accepted. Save as .xlsx, then upload again.",
  numbers: "Numbers files are not accepted. Export as .xlsx or CSV, then upload again.",
};

function fileExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function fileKind(file: File): UploadFileKind | null {
  const extension = fileExtension(file);
  return extension === "csv" || extension === "xlsx" || extension === "pdf" ? extension : null;
}

const contentTypeFor: Readonly<Record<UploadFileKind, string>> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export function approvedProjectionSources(
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

/**
 * Every list the panel reads, present and empty by default.
 *
 * The snapshot arrives over the network, so its shape is a promise rather than
 * a fact: a partial body, an error envelope, or an older server all leave a
 * list undefined, and a component that reached straight into one took the whole
 * Data Sources tab down with it. Normalizing once here means no reader below
 * has to remember, and a missing list renders as "nothing yet" rather than a
 * blank screen.
 */
function toSnapshotView(data: ReportPackageSnapshot | undefined): ReportPackageSnapshot {
  const list = <TKey extends keyof ReportPackageSnapshot>(key: TKey): ReportPackageSnapshot[TKey] =>
    (Array.isArray(data?.[key]) ? data[key] : []) as ReportPackageSnapshot[TKey];

  return {
    packages: list("packages"),
    sheetManifests: list("sheetManifests"),
    contracts: list("contracts"),
    contractVersions: list("contractVersions"),
    contractDecisions: list("contractDecisions"),
    contractBindings: list("contractBindings"),
    validationRuns: list("validationRuns"),
    validationSheetResults: list("validationSheetResults"),
    validationControlResults: list("validationControlResults"),
    projectionVersions: list("projectionVersions"),
    projectionDecisions: list("projectionDecisions"),
    projectionBindings: list("projectionBindings"),
    projectionRuns: list("projectionRuns"),
    reconciliationGroups: list("reconciliationGroups"),
    channels: list("channels"),
    branches: list("branches"),
  };
}

export function safeValidationCodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((code): code is string => typeof code === "string").slice(0, 20)
    : [];
}

function formatContractFieldLabel(canonicalField: string, sourceHeader: string): string {
  return `${canonicalField} (${sourceHeader})`;
}

/**
 * Optional fields per sheet from the already-loaded approved contract.
 *
 * `summarizeReportContract` keeps required fields only, so the optional side
 * is read from the same mapping document with the same field shape:
 * `required !== true` with non-empty `canonicalField` + `sourceHeader`.
 * Nothing here invents a name -- every label is contract text verbatim.
 */
export function optionalContractFieldLabelsBySheet(
  mappingDocument: unknown,
): Map<string, string[]> {
  const bySheet = new Map<string, string[]>();
  if (!mappingDocument || typeof mappingDocument !== "object" || Array.isArray(mappingDocument)) {
    return bySheet;
  }
  const sheets = (mappingDocument as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets)) return bySheet;
  for (const sheet of sheets) {
    if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) continue;
    const record = sheet as { normalizedSheetName?: unknown; fields?: unknown };
    if (typeof record.normalizedSheetName !== "string" || !Array.isArray(record.fields)) continue;
    const labels: string[] = [];
    for (const field of record.fields) {
      if (!field || typeof field !== "object" || Array.isArray(field)) continue;
      const candidate = field as {
        canonicalField?: unknown;
        sourceHeader?: unknown;
        required?: unknown;
      };
      if (candidate.required === true) continue;
      if (typeof candidate.canonicalField !== "string" || candidate.canonicalField.length === 0)
        continue;
      if (typeof candidate.sourceHeader !== "string" || candidate.sourceHeader.length === 0)
        continue;
      labels.push(formatContractFieldLabel(candidate.canonicalField, candidate.sourceHeader));
    }
    bySheet.set(record.normalizedSheetName, labels);
  }
  return bySheet;
}

/**
 * The middle of a compact validation row: field names or a sheet name.
 *
 * Validation tables store codes only by design (bounded evidence, never
 * workbook content), so field identity comes from the approved contract the
 * run already points at. When the contract is unavailable there is nothing
 * honest to list, so the affected sheet name stands in instead.
 */
export function validationCodeContextDetail(options: {
  code: string;
  contractSummary: ReturnType<typeof summarizeReportContract>;
  optionalBySheet: Map<string, string[]>;
  affectedSheetNames: string[];
}): string | null {
  const { code, contractSummary, optionalBySheet, affectedSheetNames } = options;
  const uniqueAffected = [...new Set(affectedSheetNames)];
  const sheetLabel = uniqueAffected.length > 0 ? `Sheet ${uniqueAffected.join(", ")}` : null;

  if (code === "OPTIONAL_FIELD_MISSING") {
    const sheetsToUse =
      uniqueAffected.length > 0
        ? uniqueAffected
        : ((contractSummary?.sheets.map((sheet) => sheet.normalizedSheetName) ?? [
            ...optionalBySheet.keys(),
          ]) as string[]);
    const parts: string[] = [];
    for (const sheetName of sheetsToUse) {
      const labels = optionalBySheet.get(sheetName) ?? [];
      if (labels.length > 0) parts.push(`${sheetName}: ${labels.join(", ")}`);
    }
    if (parts.length > 0) return parts.join(" · ");
    if (sheetLabel) return sheetLabel;
    if (contractSummary && contractSummary.sheets.length > 0) {
      return `Sheet ${contractSummary.sheets.map((sheet) => sheet.normalizedSheetName).join(", ")}`;
    }
    return null;
  }

  if (code === "REQUIRED_FIELD_MISSING" || code === "REQUIRED_SOURCE_HEADER_MISSING") {
    if (!contractSummary) return sheetLabel;
    const matching = contractSummary.sheets.filter((sheet) =>
      uniqueAffected.includes(sheet.normalizedSheetName),
    );
    const effective =
      matching.length > 0 || uniqueAffected.length > 0 ? matching : contractSummary.sheets;
    const parts: string[] = [];
    for (const sheet of effective) {
      const labels = sheet.requiredFields.map((field) =>
        formatContractFieldLabel(field.canonicalField, field.sourceHeader),
      );
      if (labels.length > 0) parts.push(`${sheet.normalizedSheetName}: ${labels.join(", ")}`);
    }
    if (parts.length > 0) return parts.join(" · ");
    return sheetLabel;
  }

  return sheetLabel;
}

type ReportFamilyRecognition = { sheets: unknown[]; recognisedFamilies: RecognisedFamily[] };

/**
 * Which of the two mapping experiences a selected upload gets.
 *
 * Exactly one recognised family collapses the old propose-then-approve pair
 * into the single standing-admission screen from ADR 0046. Zero families, or
 * more than one -- Keeta's exports all share a sheet name and differ only in
 * their columns, so several can match -- falls back to the guided flow,
 * which already lets an approver choose among candidates rather than this
 * step guessing on their behalf.
 *
 * An operator reaches this too: they hold `report.upload` and `report.retry`
 * but not `report.contract_approve`, so they can select an upload and see
 * what it needs, even though only the admission screen (not the guided form,
 * which would just be refused on submit) tells them anything useful to look
 * at while they wait for an owner or admin.
 */
export function ReportContractStep({
  organizationId,
  packageId,
  canApprove,
  onDone,
}: Readonly<{
  organizationId: string;
  packageId: string;
  canApprove: boolean;
  onDone: () => void;
}>) {
  const recognition = useQuery({
    queryKey: ["report-recognised-families", organizationId, packageId],
    queryFn: () =>
      requestJson<ReportFamilyRecognition>(
        `${reportPackagesPath(organizationId)}/${packageId}/recognised-families`,
      ),
  });

  if (recognition.isPending) {
    return <p className="text-sm text-muted-foreground">Reading the file&rsquo;s structure…</p>;
  }

  const families = recognition.isError ? [] : (recognition.data?.recognisedFamilies ?? []);

  if (families.length === 1) {
    return (
      <ReportAdmissionApproval
        organizationId={organizationId}
        packageId={packageId}
        family={families[0]}
        canApprove={canApprove}
        onAdmitted={onDone}
      />
    );
  }

  if (!canApprove) {
    return (
      <p className="text-sm text-muted-foreground">
        This upload still needs an owner or admin to say what its columns mean. Nothing is read
        until they do.
      </p>
    );
  }

  return (
    <ReportIntakeMapping
      organizationId={organizationId}
      packageId={packageId}
      onProposed={onDone}
    />
  );
}

/**
 * The way out of a categorical refusal, offered where the refusal is read.
 *
 * The run stopped because a label the provider wrote is not in the approved
 * vocabulary. Declaring it proposes the label into the figures as a new,
 * unapproved version -- the existing Approve control below still has to pass
 * it before anything is read. An operator without approval permission sees
 * who must act instead of a button that would only be refused.
 */
export function CategoricalRefusalDeclaration({
  organizationId,
  projectionVersionId,
  failureDetail,
  canDeclare,
}: Readonly<{
  organizationId: string;
  projectionVersionId: string;
  failureDetail: string;
  canDeclare: boolean;
}>) {
  const queryClient = useQueryClient();
  const refusal: ParsedCategoricalRefusal | null = parseCategoricalRefusalDetail(failureDetail);
  const declareLabel = useMutation({
    mutationFn: () =>
      requestJson(
        `/api/organizations/${organizationId}/report-projections/${projectionVersionId}/declarations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ outputKey: refusal?.outputKey, value: refusal?.value }),
        },
      ),
    onSuccess: () => {
      toast.success(
        "Label proposed into the figures. Approve the new version below, then retry the projection.",
      );
      void queryClient.invalidateQueries({ queryKey: ["report-packages", organizationId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The label could not be declared."),
  });

  if (!refusal) {
    // A package refused before Task 4 recorded a name for this failure reads
    // as the bare code, with nothing after it -- Nostaza's March package is
    // in exactly this state on staging. The parser correctly declines to
    // fabricate a label out of that, but leaving the operator with nothing
    // just replaces one dead end with a more honest one. Retrying the
    // projection re-runs it under the current code, which does name the
    // label, after which this panel can offer Declare.
    if (isBareCategoricalValueNotDeclared(failureDetail)) {
      return (
        <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <RotateCcw className="mt-0.5 size-3.5 shrink-0" />
          This refusal predates the detail the platform now records, so the label it stopped on
          cannot be shown here. Use Retry projection above -- it re-runs the same file and will name
          the label, after which Declare appears here too.
        </p>
      );
    }
    return null;
  }
  const dates = refusal.dates.length > 0 ? refusal.dates.join(", ") : "dates not recorded";
  const outputLabel = refusal.outputKey.replaceAll("_", " ");
  // The refusal carries the provider's text exactly as written, not a code
  // (see ReportCategoricalValueNotDeclared / categoryLabel in projection.ts),
  // so it routinely arrives lowercase, spaced, or cut short at 64 characters.
  // The declare route's own Zod boundary and the database guard both require
  // a short uppercase code, and offering the button on a value that cannot
  // pass that boundary would only replace a nameless refusal with a named
  // dead end -- exactly the failure mode this feature exists to remove.
  if (isTruncatedCategoricalValue(refusal.value)) {
    return (
      <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        The file uses a label starting {refusal.value} ({dates}), too long to record in full and cut
        off before it reached the platform. It may not be the provider&rsquo;s exact text, so it
        cannot be declared as shown. Ask an engineer to open the source file and add the full label
        to this output&rsquo;s label map.
      </p>
    );
  }
  if (!isDeclarableCategoricalValue(refusal.value)) {
    return (
      <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        The file uses the label <span className="font-medium text-foreground">
          {refusal.value}
        </span>{" "}
        ({dates}), which is not a declared {outputLabel} value. It is written as the
        provider&rsquo;s own prose, not a short code, so it cannot be declared with one click. Ask
        an engineer to add it to this output&rsquo;s label map, translating it to a short code such
        as <span className="font-mono">{outputLabel.toUpperCase().replaceAll(" ", "_")}</span>.
      </p>
    );
  }
  if (!canDeclare) {
    return (
      <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        The file uses the label {refusal.value} ({dates}), which nobody has declared yet. An owner
        or admin declares it once, then the figures can be approved and read.
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border p-2 text-xs">
      <p className="text-muted-foreground">
        The file uses the label <span className="font-medium text-foreground">{refusal.value}</span>{" "}
        ({dates}), which is not a declared {outputLabel} value. Declaring it proposes the figures
        again with that label counted -- nothing is approved until an owner or admin says so below.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={declareLabel.isPending}
        onClick={() => declareLabel.mutate()}
      >
        <UserCheck data-icon="inline-start" />{" "}
        {declareLabel.isPending ? "Declaring…" : `Declare "${refusal.value}" as a value we count`}
      </Button>
    </div>
  );
}

export function ReportPackageUpload({
  organizationId,
  role,
  timeZone,
  fixedChannelId,
  defaultCurrency,
}: Readonly<{
  organizationId: string;
  role: OrganizationRole;
  timeZone: string;
  /**
   * The channel page fixes the channel from the route, so the form is
   * shorter and every upload lands where the operator is standing. Absent
   * on the Integrations view, which behaves exactly as before.
   */
  fixedChannelId?: string;
  /**
   * The organization's base currency, used as the form's starting currency.
   * The select still allows an override per upload. Absent (for example in
   * tests) leaves currency manual, exactly as before.
   */
  defaultCurrency?: string;
}>) {
  const queryClient = useQueryClient();
  const [channelId, setChannelId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [reportType, setReportType] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency ?? "");
  // The default arrives with the page's own props, so a late value still
  // reaches the form. Adjusted during render rather than in an effect (the
  // repo forbids synchronous setState in effects): comparing against the
  // previously seen prop means a currency the operator chose by hand is
  // never overwritten -- only a changed prop resets it.
  const [seenDefaultCurrency, setSeenDefaultCurrency] = useState(defaultCurrency);
  if (seenDefaultCurrency !== defaultCurrency) {
    setSeenDefaultCurrency(defaultCurrency);
    if (defaultCurrency) setCurrency(defaultCurrency);
  }
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [proposalPackageId, setProposalPackageId] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [projectionContractVersionId, setProjectionContractVersionId] = useState("");
  // Drawer state, mirrored in `?package=` + `?focus=` so a row can be
  // deep-linked: row clicks push, the sync effect below reads params back.
  const [openPackageId, setOpenPackageId] = useState<string | null>(null);
  const [openFocus, setOpenFocus] = useState<DrawerFocus>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canUpload = hasReportPermission(role, "report.upload");
  const canRetry = hasReportPermission(role, "report.retry");
  const canApproveContract = hasReportPermission(role, "report.contract_approve");
  const effectiveChannelId = fixedChannelId ?? channelId;

  const snapshot = useQuery({
    queryKey: ["report-packages", organizationId],
    queryFn: () => requestJson<ReportPackageSnapshot>(reportPackagesPath(organizationId)),
  });

  const view = useMemo(() => toSnapshotView(snapshot.data), [snapshot.data]);
  // The channel page answers for one channel, so it lists only that
  // channel's uploads. The Integrations view keeps answering for all of them.
  // Memoized: the param-sync effect below keys off this list's identity, and
  // a fresh filter each render would re-run it for no reason.
  const visiblePackages = useMemo(
    () =>
      fixedChannelId
        ? view.packages.filter((reportPackage) => reportPackage.channel_id === fixedChannelId)
        : view.packages,
    [fixedChannelId, view.packages],
  );
  // Versions belong to a channel through their package. The queue and the
  // drawer receive only this view's packages and filter versions to the open
  // package, so every other channel's mappings and figures stay out of reach
  // rather than offering approvals for work happening elsewhere.
  const activeBranches = view.branches;
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["report-packages", organizationId] });

  /**
   * The single way a package opens: row clicks and the `?package=` sync
   * below both go through it, so a deep link (or back/forward) preselects
   * the mapping box exactly like a row click does.
   */
  const applyOpenState = useCallback(
    (packageId: string, focus: DrawerFocus) => {
      setOpenPackageId(packageId);
      setOpenFocus(focus);
      // A mapping row lands on its upload's mapping box with that
      // upload already chosen. Anything else leaves the selector
      // wherever the operator last put it.
      if (focus === "mapping") {
        const reportPackage = visiblePackages.find((candidate) => candidate.id === packageId);
        if (reportPackage?.status === "awaiting_contract") {
          setProposalPackageId(packageId);
        }
      }
    },
    [visiblePackages],
  );

  /**
   * What the last param sync settled: the raw query plus the package ids it
   * resolved against. The effect only acts when one of them moved -- without
   * this, the render between a row click's setState and its push landing
   * would read the stale (empty) params and close the drawer the click just
   * opened. It never calls the router itself, so no loop is possible.
   */
  const lastParamSync = useRef<{ params: string; packageIds: string } | null>(null);
  useEffect(() => {
    const paramsKey = searchParams.toString();
    const packageIds = visiblePackages.map((reportPackage) => reportPackage.id).join(",");
    if (
      lastParamSync.current?.params === paramsKey &&
      lastParamSync.current.packageIds === packageIds
    ) {
      return;
    }
    lastParamSync.current = { params: paramsKey, packageIds };
    const paramId = searchParams.get("package");
    const rawFocus = searchParams.get("focus");
    const paramFocus: DrawerFocus =
      rawFocus === "mapping" || rawFocus === "figures" || rawFocus === "validation"
        ? rawFocus
        : null;
    const nextId =
      paramId !== null && visiblePackages.some((pkg) => pkg.id === paramId) ? paramId : null;
    // An unknown or malformed id, or one outside this view's channel
    // scoping, resolves to closed: the page renders normally, never a crash.
    const nextFocus = nextId === null ? null : paramFocus;
    if (nextId === openPackageId && nextFocus === openFocus) return;
    /* eslint-disable react-hooks/set-state-in-effect -- param→state sync is this effect's whole
    job (§7): it sets state only when the derived open state differs from the current one, and it
    never calls the router, so no render loop is possible. */
    if (nextId === null) {
      setOpenPackageId(null);
      setOpenFocus(null);
    } else {
      applyOpenState(nextId, nextFocus);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [searchParams, visiblePackages, openPackageId, openFocus, applyOpenState]);

  const handleOpen = (packageId: string, focus: DrawerFocus) => {
    applyOpenState(packageId, focus);
    const params = new URLSearchParams(searchParams.toString());
    params.set("package", packageId);
    if (focus === null) params.delete("focus");
    else params.set("focus", focus);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleClose = () => {
    setOpenPackageId(null);
    setOpenFocus(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("package");
    params.delete("focus");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  /**
   * The report type this channel is already known to carry, if -- and only
   * if -- every upload of it that was ever recognised as a known library
   * family and approved agrees on both which family and which exact text.
   *
   * Recognition itself cannot run before this file is even uploaded -- it
   * reads a profile that does not exist until after the upload completes --
   * so this does not repeat that check. It reuses its outcome: the exact,
   * immutable `report_type` text a prior approved upload for this channel
   * recorded. That text, not the library's own name for the family, is what
   * `grant_governed_report_structure_admission`'s binding match compares
   * every later upload against, so reusing it verbatim (rather than typing it
   * again and risking "Performance report" one month and "Performance
   * Report" the next) is what keeps a channel's admission usable at all. See
   * ADR 0046: "a reuse key with a hand-typed component is not a key."
   *
   * A channel is not guaranteed to carry only one family -- Keeta's own
   * exports can match several definitions -- and which family *this* upload
   * turns out to be is not knowable before it is profiled. Picking the first
   * approved family found would silently mislabel every later upload of a
   * second family, and the field is read-only, so an operator could not even
   * correct it: a narrower repeat of the exact defect this plan exists to
   * close. So this disqualifies itself -- returns null, falling back to the
   * free-text input -- the moment the channel's history is ambiguous either
   * about which family (more than one distinct `provider_definition_key`) or
   * about which spelling (more than one distinct `report_type` text within
   * one family). Only a channel whose entire approved-library history agrees
   * on one family and one spelling is confident enough to show read-only.
   */
  const recognisedReportTypeForChannel = useMemo(() => {
    if (!effectiveChannelId) return null;
    const approvedLibraryReportTypes = view.contractVersions.flatMap((version) => {
      if (!version.provider_definition_key) return [];
      const owningPackage = view.packages.find(
        (candidate) => candidate.id === version.report_package_id,
      );
      if (!owningPackage || owningPackage.channel_id !== effectiveChannelId) return [];
      const approved = view.contractDecisions.some(
        (decision) =>
          decision.report_contract_version_id === version.id && decision.decision === "approved",
      );
      if (!approved) return [];
      return [
        { familyKey: version.provider_definition_key, reportType: owningPackage.report_type },
      ];
    });
    if (approvedLibraryReportTypes.length === 0) return null;
    const distinctFamilies = new Set(approvedLibraryReportTypes.map((entry) => entry.familyKey));
    const distinctReportTypes = new Set(
      approvedLibraryReportTypes.map((entry) => entry.reportType),
    );
    if (distinctFamilies.size > 1 || distinctReportTypes.size > 1) return null;
    return approvedLibraryReportTypes[0].reportType;
  }, [effectiveChannelId, view.contractVersions, view.packages, view.contractDecisions]);

  /**
   * The operator saying "this is not that report", for the one channel they
   * said it about.
   *
   * The derivation above only disqualifies itself once a second family has
   * *already* been uploaded and approved. The upload that introduces the
   * second family arrives while the channel still agrees on one, so without
   * this the field is read-only and names the wrong report -- and being
   * read-only, there is no way to correct it. Keeta alone sends three
   * different exports to one channel.
   *
   * Stored as the channel it applies to rather than a bare flag, so changing
   * the channel drops it: an override declared for Keeta must not silently
   * govern the next upload to Talabat.
   */
  const [reportTypeOverrideChannelId, setReportTypeOverrideChannelId] = useState<string | null>(
    null,
  );
  const overridingReportType =
    reportTypeOverrideChannelId !== null && reportTypeOverrideChannelId === effectiveChannelId;

  // What actually gets submitted: the derived value once the channel's report
  // type is known and the operator has not said otherwise, the hand-typed one
  // otherwise. Computed at render rather than synced into state, so there is
  // no moment where the free-text field's last-typed value and the derived one
  // could disagree about what a submit sends.
  const effectiveReportType =
    overridingReportType || recognisedReportTypeForChannel === null
      ? reportType
      : recognisedReportTypeForChannel;

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a CSV, XLSX, or PDF report first.");
      const kind = fileKind(file);
      if (!kind) {
        throw new Error(
          unsupportedFileMessages[fileExtension(file)] ??
            "Only CSV, XLSX, and PDF files are accepted.",
        );
      }
      if (file.size < 1 || file.size > REPORT_PACKAGE_LIMITS.maxCompressedBytes) {
        throw new Error("The upload must be no larger than 50 MiB.");
      }
      const contentType =
        kind === "csv" && file.type === "application/csv"
          ? "application/csv"
          : contentTypeFor[kind];
      const intent = await requestJson<UploadIntentResponse>(
        `${reportPackagesPath(organizationId)}/upload-intents`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channelId: effectiveChannelId,
            branchId,
            reportType: effectiveReportType,
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
      requestJson<{
        reportPackage: ReportPackageRow;
        validationQueued: boolean;
        reason?: "feature_disabled" | "contract_unresolved" | "dispatch_failed";
      }>(`${reportPackagesPath(organizationId)}/${packageId}/validation-retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: operationKey("report-validation-retry") }),
      }),
    onSuccess: (result) => {
      if (result.validationQueued) {
        toast.info("Validation was queued again.");
      } else {
        toast.warning(validationNotQueuedMessage(result.reason));
      }
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
    mutationFn: (contractVersionId: string) => {
      const version = view.contractVersions.find((candidate) => candidate.id === contractVersionId);
      // Only the source is sent. A library contract's declaration comes from the
      // same checked-in definition; a guided one is derived from the contract an
      // owner already approved. Neither can drift from what was approved.
      const body = version?.provider_definition_key
        ? { source: "library", providerDefinitionKey: version.provider_definition_key }
        : { source: "guided" };
      return requestJson(
        `/api/organizations/${organizationId}/report-contracts/${contractVersionId}/projection-proposals`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Keyed to the mapping rather than to the click. The declaration for
          // an approved mapping is always the same document, so a second click
          // replays the first instead of stacking an identical version beside
          // it. A random key per click is what produced three approved copies.
          body: JSON.stringify({
            ...body,
            idempotencyKey: `report-projection-proposal:${contractVersionId}`,
          }),
        },
      );
    },
    onSuccess: () => {
      toast.success("Figures to read proposed. Nothing is read until an owner or admin approves.");
      invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "The figures to read could not be proposed.",
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

  const resolveOverlapGroup = useMutation({
    mutationFn: async ({
      reconciliationId,
      resolution,
    }: {
      reconciliationId: string;
      resolution: "accept_correction" | "keep_existing";
    }) => {
      const response = await requestJson<ResolveOverlapGroupResponse>(
        `/api/organizations/${organizationId}/report-reconciliations/${reconciliationId}/resolve-group`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            resolution,
            idempotencyKey: operationKey("report-overlap-group-resolution"),
          }),
        },
      );
      if (
        response.resolution.outcome !== "resolved" &&
        response.resolution.outcome !== "completed"
      ) {
        throw new Error(
          "This field was already resolved differently. Refresh to see the recorded choice.",
        );
      }
      return response;
    },
    onSuccess: () => {
      toast.success("The field decision was recorded. Historical evidence remains available.");
      invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "The field decision could not be saved.",
      ),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5" /> Governed reports
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm">
                    How it works
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex gap-2">
                      <Lock className="mt-0.5 size-4 shrink-0" />
                      It stays in private storage. Nobody outside your organization can reach it.
                    </li>
                    <li className="flex gap-2">
                      <ScanLine className="mt-0.5 size-4 shrink-0" />
                      Recognition looks at column headings only — never at a customer, an order or
                      an amount.
                    </li>
                    <li className="flex gap-2">
                      <UserCheck className="mt-0.5 size-4 shrink-0" />A person approves twice before
                      any figure is recorded, and both decisions are kept.
                    </li>
                    <li className="flex gap-2">
                      <Calculator className="mt-0.5 size-4 shrink-0" />
                      Where the file states its own total, the rows have to add up to it or the
                      import stops.
                    </li>
                  </ul>
                </PopoverContent>
              </Popover>
            </CardTitle>
            <CardDescription>
              Upload one declared CSV, XLSX, or PDF report directly to private storage. A PDF is
              read only where its figures are already text; a scan is refused rather than guessed
              at. Files are structurally checked before any future contract review.
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
            className="grid gap-3 lg:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="report-channel">Business channel</Label>
              {fixedChannelId ? (
                <p className="flex h-8 w-full items-center rounded-md border bg-muted/30 px-3 text-sm font-medium">
                  {view.channels.find((channel) => channel.id === fixedChannelId)?.display_name ??
                    "This channel"}
                </p>
              ) : (
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger id="report-channel" className="w-full">
                    <SelectValue placeholder="Select channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {view.channels.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        {channel.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-branch">Branch / outlet</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="report-branch" className="w-full">
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
              {recognisedReportTypeForChannel !== null && !overridingReportType ? (
                <>
                  <p
                    id="report-type"
                    className="flex h-8 w-full items-center rounded-md border bg-muted/30 px-3 text-sm font-medium"
                  >
                    {recognisedReportTypeForChannel}
                  </p>
                  {/*
                    One provider can send a channel several different exports,
                    and the first upload of a second one arrives before
                    anything can know it is different. Reusing the derived
                    text is still the default, because a reuse key that gets
                    retyped stops being a key.
                  */}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => setReportTypeOverrideChannelId(effectiveChannelId)}
                  >
                    This is a different report
                  </Button>
                </>
              ) : (
                <>
                  <Input
                    id="report-type"
                    value={reportType}
                    onChange={(event) => setReportType(event.target.value)}
                    maxLength={120}
                    placeholder="e.g. Marketplace settlement"
                    required
                  />
                  {overridingReportType ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => setReportTypeOverrideChannelId(null)}
                    >
                      Use this channel&rsquo;s known report type instead
                    </Button>
                  ) : null}
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-currency">Declared currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="report-currency" className="w-full">
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
            <div className="space-y-2 lg:col-span-2">
              <Label id="report-period-label">Start &amp; end date</Label>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-labelledby="report-period-label"
              >
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="report-period-start"
                      variant="outline"
                      data-empty={!periodStart}
                      className="h-8 w-full justify-start px-2.5 text-left font-normal data-[empty=true]:text-muted-foreground"
                    >
                      <CalendarIcon data-icon="inline-start" />
                      {periodStart ? (
                        format(parseISO(periodStart), "PPP")
                      ) : (
                        <span>Pick start date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={periodStart ? parseISO(periodStart) : undefined}
                      onSelect={(day) => {
                        if (!day) return;
                        const next = format(day, "yyyy-MM-dd");
                        setPeriodStart(next);
                        if (periodEnd && periodEnd < next) setPeriodEnd("");
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="report-period-end"
                      variant="outline"
                      data-empty={!periodEnd}
                      className="h-8 w-full justify-start px-2.5 text-left font-normal data-[empty=true]:text-muted-foreground"
                    >
                      <CalendarIcon data-icon="inline-start" />
                      {periodEnd ? format(parseISO(periodEnd), "PPP") : <span>Pick end date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={periodEnd ? parseISO(periodEnd) : undefined}
                      disabled={periodStart ? { before: parseISO(periodStart) } : undefined}
                      onSelect={(day) => {
                        if (day) setPeriodEnd(format(day, "yyyy-MM-dd"));
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            {recognisedReportTypeForChannel !== null && !overridingReportType ? (
              <p className="text-xs text-muted-foreground italic lg:col-span-6">
                * This channel already reads a known report. Every upload of it is filed under the
                same type automatically.
              </p>
            ) : null}
            <div
              className="lg:col-span-6"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                setFile(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              <Label
                htmlFor="report-file"
                className="flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center cursor-pointer"
              >
                <UploadCloud className="size-5 text-muted-foreground" aria-hidden="true" />
                <span className="mt-2 text-sm">
                  Drag files here, or <span className="font-medium underline">Choose file</span>
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  CSV, XLSX, or PDF, up to 50 MiB
                </span>
                {file ? (
                  <span className="mt-2 text-xs font-medium">
                    {file.name} · {(file.size / 1_048_576).toFixed(2)} MiB
                  </span>
                ) : null}
              </Label>
              <Input
                id="report-file"
                type="file"
                accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </div>
            {progress !== null ? (
              <div className="space-y-2 lg:col-span-6">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  Uploading directly to private storage · {progress}%
                </p>
              </div>
            ) : null}
            <div className="lg:col-span-6">
              <Button
                type="submit"
                disabled={
                  upload.isPending ||
                  snapshot.isLoading ||
                  !effectiveChannelId ||
                  !branchId ||
                  !currency ||
                  !periodStart ||
                  !periodEnd
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

        <ReportReviewQueue
          packages={visiblePackages}
          view={view}
          fixedChannelId={fixedChannelId}
          canRetry={canRetry}
          onRetry={(packageId) => retry.mutate(packageId)}
          retryPending={retry.isPending}
          onRetryValidation={(packageId) => retryValidation.mutate(packageId)}
          retryValidationPending={retryValidation.isPending}
          onRequestProjection={(packageId) => requestProjection.mutate(packageId)}
          requestProjectionPending={requestProjection.isPending}
          onOpen={handleOpen}
        />
        <ReportPackageDrawer
          packageId={openPackageId}
          focus={openFocus}
          organizationId={organizationId}
          timeZone={timeZone}
          view={view}
          packages={visiblePackages}
          fixedChannelId={fixedChannelId}
          canUpload={canUpload}
          canRetry={canRetry}
          canApproveContract={canApproveContract}
          onRetry={(packageId) => retry.mutate(packageId)}
          retryPending={retry.isPending}
          onRetryValidation={(packageId) => retryValidation.mutate(packageId)}
          retryValidationPending={retryValidation.isPending}
          onRequestProjection={(packageId) => requestProjection.mutate(packageId)}
          requestProjectionPending={requestProjection.isPending}
          onResolveOverlap={(input) => resolveOverlapGroup.mutate(input)}
          resolveOverlapPending={resolveOverlapGroup.isPending}
          rejectionReason={rejectionReason}
          onRejectionReasonChange={setRejectionReason}
          proposalPackageId={proposalPackageId}
          onProposalPackageIdChange={setProposalPackageId}
          onMappingDone={() => {
            setProposalPackageId("");
            invalidate();
          }}
          projectionContractVersionId={projectionContractVersionId}
          onProjectionContractVersionIdChange={setProjectionContractVersionId}
          onDecideContract={(input) => decideContract.mutate(input)}
          decideContractPending={decideContract.isPending}
          onDecideProjection={(input) => decideProjection.mutate(input)}
          decideProjectionPending={decideProjection.isPending}
          onProposeProjection={(contractVersionId) => proposeProjection.mutate(contractVersionId)}
          proposeProjectionPending={proposeProjection.isPending}
          onClose={handleClose}
        />
      </CardContent>
    </Card>
  );
}
