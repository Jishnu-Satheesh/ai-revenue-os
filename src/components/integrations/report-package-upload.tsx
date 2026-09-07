"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "tus-js-client";
import { useMemo, useState } from "react";
import {
  Banknote,
  Calculator,
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

import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ReportAdmissionApproval } from "@/components/integrations/report-admission-approval";
import {
  ReportIntakeMapping,
  type RecognisedFamily,
} from "@/components/integrations/report-intake-mapping";
import {
  isBareCategoricalValueNotDeclared,
  isDeclarableCategoricalValue,
  isTruncatedCategoricalValue,
  parseCategoricalRefusalDetail,
  type ParsedCategoricalRefusal,
} from "@/domain/reports/projection-error";
import { summarizeReportProjection } from "@/domain/reports/projection-copy";
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
import {
  explainReportValidationCode,
  parserLabel,
  summarizeReportContract,
} from "@/domain/reports/validation-copy";
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

function ReconciliationAction({
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

function safeValidationCodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((code): code is string => typeof code === "string").slice(0, 20)
    : [];
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
function ReportContractStep({
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
function CategoricalRefusalDeclaration({
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
}>) {
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
  const [rejectionReason, setRejectionReason] = useState("");
  const [projectionContractVersionId, setProjectionContractVersionId] = useState("");
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
  const visiblePackages = fixedChannelId
    ? view.packages.filter((reportPackage) => reportPackage.channel_id === fixedChannelId)
    : view.packages;
  // Versions belong to a channel through their package. A fixed view hides
  // every other channel's mappings and figures rather than offering
  // approvals for work happening elsewhere.
  const contractVersionVisible = (version: { report_package_id: string }): boolean =>
    !fixedChannelId ||
    view.packages.some(
      (reportPackage) =>
        reportPackage.id === version.report_package_id &&
        reportPackage.channel_id === fixedChannelId,
    );
  const projectionVersionVisible = (version: { report_contract_version_id: string }): boolean => {
    if (!fixedChannelId) return true;
    const contractVersion = view.contractVersions.find(
      (candidate) => candidate.id === version.report_contract_version_id,
    );
    return contractVersion ? contractVersionVisible(contractVersion) : false;
  };
  const activeBranches = view.branches;
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["report-packages", organizationId] });

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

  const selectedProjectionContract = view.contractVersions.find(
    (version) => version.id === projectionContractVersionId,
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
      version.report_contract_version_id === projectionContractVersionId &&
      view.projectionDecisions.find(
        (decision) => decision.report_projection_version_id === version.id,
      )?.decision !== "rejected",
  );

  const projectionSources = useMemo(
    () => approvedProjectionSources(selectedProjectionContract),
    [selectedProjectionContract],
  );

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
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="report-channel">Business channel</Label>
              {fixedChannelId ? (
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                  {view.channels.find((channel) => channel.id === fixedChannelId)?.display_name ??
                    "This channel"}
                </p>
              ) : (
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger id="report-channel">
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
              {recognisedReportTypeForChannel !== null && !overridingReportType ? (
                <>
                  <p
                    id="report-type"
                    className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium"
                  >
                    {recognisedReportTypeForChannel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This channel already reads a known report. Every upload of it is filed under the
                    same type automatically.
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
              <Label htmlFor="report-file">CSV, XLSX, or PDF, up to 50 MiB</Label>
              <Input
                id="report-file"
                type="file"
                accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                  upload.isPending ||
                  snapshot.isLoading ||
                  !effectiveChannelId ||
                  !branchId ||
                  !currency
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
          <h3 className="text-sm font-medium">
            {fixedChannelId ? "1 · This channel's uploads" : "1 · Recent uploads"}
          </h3>
          {visiblePackages.length ? (
            visiblePackages.map((reportPackage) => {
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
              const latestProjection = view.projectionRuns.find(
                (run) => run.report_package_id === reportPackage.id,
              );
              const projectionFailed =
                reportPackage.status === "projection_failed" ||
                latestProjection?.status === "failed";
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
              const readyRecordCount = Math.max(
                0,
                (latestProjection?.output_count ?? 0) - affectedRecordCount,
              );
              const absentRowCount = latestProjection?.absent_row_count ?? 0;
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
                      {canRequestProjection && canRetry ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={requestProjection.isPending}
                          onClick={() => requestProjection.mutate(reportPackage.id)}
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
                  {reconciliationGroups.map((group) => (
                    <ReconciliationAction
                      key={`${group.projection_run_id}:${group.projection_output_key}`}
                      group={group}
                      canResolve={canApproveContract}
                      pending={resolveOverlapGroup.isPending}
                      onResolve={(input) => resolveOverlapGroup.mutate(input)}
                    />
                  ))}
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
                      An approved declaration was selected. Deterministic projection starts when
                      this rollout is enabled.
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
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No governed report packages yet.</p>
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-medium">2 · Approve what the columns mean</h3>
            <p className="text-xs text-muted-foreground">
              An owner or admin decides. Until then the file has been profiled and nothing more.
            </p>
          </div>
          {view.contractVersions.filter(contractVersionVisible).length ? (
            view.contractVersions.filter(contractVersionVisible).map((version) => {
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
                <Select value={proposalPackageId} onValueChange={setProposalPackageId}>
                  <SelectTrigger id="report-contract-package">
                    <SelectValue placeholder="Select an upload waiting to be mapped" />
                  </SelectTrigger>
                  <SelectContent>
                    {visiblePackages
                      .filter((reportPackage) => reportPackage.status === "awaiting_contract")
                      .map((reportPackage) => (
                        <SelectItem key={reportPackage.id} value={reportPackage.id}>
                          {reportPackage.report_type} · {reportPackage.declared_period_start}
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
                  onDone={() => {
                    setProposalPackageId("");
                    invalidate();
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Choose an upload and we will tell you whether we already know how to read it.
                </p>
              )}
            </div>
          ) : null}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium">3 · Approve what gets recorded</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              A separate decision, because it is a separate consequence: this is what enters the
              ledger and drives every figure downstream. No workbook value appears here.
            </p>
            {view.projectionVersions.filter(projectionVersionVisible).map((version) => {
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
                          decideProjection.mutate({ versionId: version.id, decision: "approved" })
                        }
                        disabled={decideProjection.isPending}
                      >
                        Approve these figures
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
              <div className="mt-3 space-y-3 rounded-lg border border-dashed p-4">
                <div className="space-y-2">
                  <Label htmlFor="report-projection-contract">Approved mapping</Label>
                  <Select
                    value={projectionContractVersionId}
                    onValueChange={setProjectionContractVersionId}
                  >
                    <SelectTrigger id="report-projection-contract">
                      <SelectValue placeholder="Select an approved mapping" />
                    </SelectTrigger>
                    <SelectContent>
                      {view.contractVersions
                        .filter(contractVersionVisible)
                        .filter((version) =>
                          view.contractDecisions.some(
                            (decision) =>
                              decision.report_contract_version_id === version.id &&
                              decision.decision === "approved",
                          ),
                        )
                        .map((version) => (
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
                    proposeProjection.isPending || !projectionContractVersionId || alreadyProposed
                  }
                  onClick={() => proposeProjection.mutate(projectionContractVersionId)}
                >
                  {proposeProjection.isPending ? "Proposing…" : "Propose the figures to read"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-medium">What happens to your file</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <Lock className="mt-0.5 size-4 shrink-0" />
              It stays in private storage. Nobody outside your organization can reach it.
            </li>
            <li className="flex gap-2">
              <ScanLine className="mt-0.5 size-4 shrink-0" />
              Recognition looks at column headings only — never at a customer, an order or an
              amount.
            </li>
            <li className="flex gap-2">
              <UserCheck className="mt-0.5 size-4 shrink-0" />A person approves twice before any
              figure is recorded, and both decisions are kept.
            </li>
            <li className="flex gap-2">
              <Calculator className="mt-0.5 size-4 shrink-0" />
              Where the file states its own total, the rows have to add up to it or the import
              stops.
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
