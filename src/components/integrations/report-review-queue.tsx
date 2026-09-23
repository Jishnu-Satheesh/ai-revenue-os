"use client";

import { useMemo } from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import {
  safeValidationCodes,
  stateLabel,
  stateVariant,
} from "@/components/integrations/report-package-upload";
import type { DrawerFocus } from "@/components/integrations/report-package-drawer";
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

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

type QueueAction =
  | { kind: "retry"; label: string }
  | { kind: "retryValidation"; label: string }
  | { kind: "requestProjection"; label: string }
  | { kind: "open"; label: "Review" | "Map columns"; focus: DrawerFocus };

type QueueRow = {
  key: string;
  packageId: string;
  tier: 1 | 2 | 3 | 4;
  createdAt: string;
  title: string;
  reason: string;
  badgeLabel: string;
  badgeVariant: BadgeVariant;
  rowLabel: string;
  action: QueueAction | null;
};

type StripPackage = {
  id: string;
  title: string;
  badgeLabel: string;
  badgeVariant: BadgeVariant;
  detail: string;
  createdAt: string;
};

const IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_upload",
  "uploaded",
  "profiling",
  "validating",
  "projecting",
]);

const SETTLED_STATUSES: ReadonlySet<string> = new Set([
  "projected",
  "partially_projected",
  "validated",
]);

function packageTitle(reportPackage: ReportPackageRow): string {
  return `${reportPackage.report_type} · ${reportPackage.declared_period_start} to ${reportPackage.declared_period_end}`;
}

/**
 * Splits this view's packages into tiered queue rows plus the two strips,
 * exactly per the handoff's queue derivation table: Tier 1 failures, Tier 2
 * decisions, Tier 3 mapping, Tier 4 next steps (oldest `created_at` first
 * within a tier), then the in-progress and settled strips.
 *
 * Two states the table does not name, ruled so nothing ever vanishes
 * silently: a package matching no tier and no strip (e.g. projected with
 * affected records, a state the pipeline should not produce) renders as a
 * labelless queue row with its state label and no action; a validated
 * package whose projection run failed keeps the established Retry-projection
 * affordance rather than a misleading Project safely.
 */
function deriveQueue(
  view: ReportPackageSnapshot,
  packages: ReportPackageRow[],
  canRetry: boolean,
): { rows: QueueRow[]; inProgress: StripPackage[]; settled: StripPackage[] } {
  const rows: QueueRow[] = [];
  const limbo: QueueRow[] = [];
  const inProgress: StripPackage[] = [];
  const settled: StripPackage[] = [];

  const undecidedContract = (versionId: string): boolean =>
    !view.contractDecisions.some((decision) => decision.report_contract_version_id === versionId);
  const undecidedProjection = (versionId: string): boolean =>
    !view.projectionDecisions.some(
      (decision) => decision.report_projection_version_id === versionId,
    );

  for (const version of view.contractVersions) {
    if (!undecidedContract(version.id)) continue;
    const reportPackage = packages.find(
      (candidate) => candidate.id === version.report_package_id,
    );
    if (!reportPackage) continue;
    const title = packageTitle(reportPackage);
    rows.push({
      key: `contract:${version.id}`,
      packageId: reportPackage.id,
      tier: 2,
      createdAt: version.created_at,
      title,
      reason: `Mapping v${version.version} awaiting approval`,
      badgeLabel: "Awaiting approval",
      badgeVariant: "outline",
      rowLabel: `Review mapping v${version.version} for ${title}`,
      action: { kind: "open", label: "Review", focus: "mapping" },
    });
  }
  for (const version of view.projectionVersions) {
    if (!undecidedProjection(version.id)) continue;
    const contractVersion = view.contractVersions.find(
      (candidate) => candidate.id === version.report_contract_version_id,
    );
    const reportPackage = packages.find(
      (candidate) => candidate.id === contractVersion?.report_package_id,
    );
    if (!reportPackage) continue;
    const title = packageTitle(reportPackage);
    rows.push({
      key: `projection:${version.id}`,
      packageId: reportPackage.id,
      tier: 2,
      createdAt: version.created_at,
      title,
      reason: `Figures v${version.version} awaiting approval`,
      badgeLabel: "Awaiting approval",
      badgeVariant: "outline",
      rowLabel: `Review figures v${version.version} for ${title}`,
      action: { kind: "open", label: "Review", focus: "figures" },
    });
  }

  for (const reportPackage of packages) {
    const title = packageTitle(reportPackage);
    const latestValidation = view.validationRuns.find(
      (run) => run.report_package_id === reportPackage.id,
    );
    const errorCount = safeValidationCodes(latestValidation?.error_codes).length;
    const latestProjection = view.projectionRuns.find(
      (run) => run.report_package_id === reportPackage.id,
    );
    const projectionFailed =
      reportPackage.status === "projection_failed" || latestProjection?.status === "failed";
    const canRequestProjection =
      reportPackage.status === "validated" ||
      reportPackage.status === "partially_validated" ||
      projectionFailed;
    const affectedCount = view.reconciliationGroups
      .filter((group) => group.report_package_id === reportPackage.id)
      .reduce((total, group) => total + group.affected_record_count, 0);
    const hasUndecidedVersion =
      view.contractVersions.some(
        (version) =>
          version.report_package_id === reportPackage.id && undecidedContract(version.id),
      ) ||
      view.projectionVersions.some((version) => {
        const contractVersion = view.contractVersions.find(
          (candidate) => candidate.id === version.report_contract_version_id,
        );
        return (
          contractVersion?.report_package_id === reportPackage.id &&
          undecidedProjection(version.id)
        );
      });

    if (
      SETTLED_STATUSES.has(reportPackage.status) &&
      affectedCount === 0 &&
      !projectionFailed &&
      !hasUndecidedVersion &&
      !(reportPackage.status === "validated" && canRetry)
    ) {
      settled.push({
        id: reportPackage.id,
        title: reportPackage.report_type,
        badgeLabel: stateLabel(reportPackage.status),
        badgeVariant: stateVariant(reportPackage.status),
        detail: `${reportPackage.declared_period_start} to ${reportPackage.declared_period_end}`,
        createdAt: reportPackage.created_at,
      });
      continue;
    }
    if (IN_PROGRESS_STATUSES.has(reportPackage.status)) {
      inProgress.push({
        id: reportPackage.id,
        title,
        badgeLabel: stateLabel(reportPackage.status),
        badgeVariant: stateVariant(reportPackage.status),
        detail: packageAge(reportPackage.created_at),
        createdAt: reportPackage.created_at,
      });
      continue;
    }

    const base = {
      key: `package:${reportPackage.id}`,
      packageId: reportPackage.id,
      createdAt: reportPackage.created_at,
      title,
      badgeLabel: stateLabel(reportPackage.status),
      badgeVariant: stateVariant(reportPackage.status),
      rowLabel: `Open details for ${title}`,
    };
    switch (reportPackage.status) {
      case "failed":
        rows.push({
          ...base,
          tier: 1,
          reason: "Upload or profiling failed",
          action: reportPackage.storage_object_id ? { kind: "retry", label: "Retry" } : null,
        });
        break;
      case "validation_failed":
        rows.push({
          ...base,
          tier: 1,
          reason: `Validation failed: ${errorCount} error(s)`,
          action: { kind: "retryValidation", label: "Retry validation" },
        });
        break;
      case "projection_failed":
        rows.push({
          ...base,
          tier: 1,
          reason: "Projection failed",
          action: { kind: "requestProjection", label: "Retry projection" },
        });
        break;
      case "awaiting_contract":
        rows.push({
          ...base,
          tier: 3,
          reason: "Needs column mapping",
          action: { kind: "open", label: "Map columns", focus: "mapping" },
        });
        break;
      case "awaiting_validation":
        rows.push({
          ...base,
          tier: 4,
          reason: "Contract approved — start validation",
          action: { kind: "retryValidation", label: "Start validation" },
        });
        break;
      case "validated":
      case "partially_validated":
        if (canRequestProjection) {
          rows.push({
            ...base,
            tier: 4,
            reason: "Validated — project the figures",
            action: {
              kind: "requestProjection",
              label: projectionFailed ? "Retry projection" : "Project safely",
            },
          });
        } else {
          limbo.push({ ...base, tier: 4, reason: stateLabel(reportPackage.status), action: null });
        }
        break;
      case "reconciliation_required":
        rows.push({
          ...base,
          tier: 4,
          reason: `${affectedCount} records need review`,
          action: { kind: "open", label: "Review", focus: null },
        });
        break;
      case "awaiting_approval":
        rows.push({ ...base, tier: 4, reason: stateLabel(reportPackage.status), action: null });
        break;
      case "awaiting_projection":
        rows.push({
          ...base,
          tier: 4,
          reason: "Projection starts when the rollout is enabled",
          action: null,
        });
        break;
      default:
        limbo.push({ ...base, tier: 4, reason: stateLabel(reportPackage.status), action: null });
        break;
    }
  }

  const byAge = (left: { createdAt: string }, right: { createdAt: string }): number =>
    left.createdAt.localeCompare(right.createdAt);
  rows.sort(
    (left, right) => left.tier - right.tier || byAge(left, right),
  );
  limbo.sort(byAge);
  inProgress.sort(byAge);
  settled.sort(byAge);
  return { rows: [...rows, ...limbo], inProgress, settled };
}

/**
 * The compact "needs review" queue that replaced the fully expanded upload list.
 *
 * Slice 3 completes the handoff's derivation table: tiered rows with one-line
 * reasons and one primary action each, the in-progress strip at the queue
 * foot, and the collapsed settled strip. Mutation buttons keep the exact
 * gating and payload the page had; Review and Map columns only open the
 * drawer, where the real gates live.
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
  onOpen: (packageId: string, focus: DrawerFocus) => void;
}>) {
  const { rows, inProgress, settled } = useMemo(
    () => deriveQueue(view, packages, canRetry),
    [view, packages, canRetry],
  );

  const renderAction = (row: QueueRow) => {
    const action = row.action;
    if (!action) return null;
    if (action.kind === "open") {
      return (
        <Button size="sm" onClick={() => onOpen(row.packageId, action.focus)}>
          {action.label}
        </Button>
      );
    }
    if (!canRetry) return null;
    if (action.kind === "retry") {
      return (
        <Button size="sm" variant="outline" disabled={retryPending} onClick={() => onRetry(row.packageId)}>
          <RotateCcw data-icon="inline-start" /> {action.label}
        </Button>
      );
    }
    if (action.kind === "retryValidation") {
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={retryValidationPending}
          onClick={() => onRetryValidation(row.packageId)}
        >
          <RotateCcw data-icon="inline-start" /> {action.label}
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={requestProjectionPending}
        onClick={() => onRequestProjection(row.packageId)}
      >
        {action.label === "Retry projection" ? (
          <RotateCcw data-icon="inline-start" />
        ) : (
          <ShieldCheck data-icon="inline-start" />
        )}{" "}
        {action.label}
      </Button>
    );
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">
        {fixedChannelId ? "1 · This channel's uploads" : "1 · Recent uploads"}
      </h3>
      {rows.map((row) => (
        <div key={row.key} className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onOpen(row.packageId, row.action?.kind === "open" ? row.action.focus : null)}
              aria-label={row.rowLabel}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block font-medium">{row.title}</span>
              <span className="block text-xs text-muted-foreground">
                {row.reason} · {packageAge(row.createdAt)}
              </span>
            </button>
            <div className="flex items-center gap-2">
              <Badge variant={row.badgeVariant}>{row.badgeLabel}</Badge>
              {renderAction(row)}
            </div>
          </div>
        </div>
      ))}
      {rows.length === 0 && inProgress.length === 0 && settled.length === 0 ? (
        <p className="text-sm text-muted-foreground">No governed report packages yet.</p>
      ) : null}
      {inProgress.length > 0 ? (
        <div className="space-y-2">
          {inProgress.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <Spinner />
                {item.badgeLabel}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {settled.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              Settled · {settled.length}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 pt-2">
              {settled.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpen(item.id, null)}
                  aria-label={`Open details for ${item.title}, ${item.detail}`}
                  className="flex w-full items-center gap-2 rounded-lg border p-2 text-left text-sm"
                >
                  <span className="font-medium">{item.title}</span>
                  <Badge variant={item.badgeVariant}>{item.badgeLabel}</Badge>
                  <span className="text-xs text-muted-foreground">{item.detail}</span>
                </button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
