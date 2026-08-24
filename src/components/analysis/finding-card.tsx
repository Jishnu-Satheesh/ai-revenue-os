import { Fingerprint } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { figureToneClass, findingValueLabel, formatWindow } from "@/components/analysis/format";
import type { WorkspaceFindingView } from "@/modules/analysis/application/read-model";

/**
 * The chapter rail block from the approved design: the finding's figure at
 * reading size, its words beneath it, and one explicit way into the provenance.
 *
 * The label in the corner is the outcome's own kind. An observation is a fact,
 * a finding is a quantified problem carrying a severity the detector derived,
 * and `needs_data` says the evidence contract was unsatisfied. All three are
 * shown, because an operator who cannot see the third reads its absence as an
 * all-clear.
 *
 * Limitations and cited rows deliberately live in the evidence sheet rather
 * than here: the rail carries the conclusion at a glance, and "Inspect
 * evidence" is the single door to everything that stands behind it.
 */
export function FindingCard({
  finding,
  onInspect,
}: {
  finding: WorkspaceFindingView;
  onInspect: (findingId: string) => void;
}) {
  const value = findingValueLabel(finding);

  return (
    <article
      aria-labelledby={`finding-${finding.id}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {finding.severity ? (
          <StatusBadge label={finding.severity} tone={finding.severityTone ?? "neutral"} />
        ) : null}
        <StatusBadge label={finding.kindLabel} tone="neutral" />
      </div>

      {value ? (
        <p className={`text-2xl font-semibold tabular-nums ${figureToneClass(finding)}`}>
          {value}
        </p>
      ) : null}

      <p id={`finding-${finding.id}`} className="text-sm font-medium leading-snug">
        {finding.headline}
      </p>
      {finding.detail ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
      ) : null}

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        {finding.periodStart && finding.periodEnd ? (
          <div className="flex gap-1.5">
            <dt>Period</dt>
            <dd className="text-foreground">{formatWindow(finding.periodStart, finding.periodEnd)}</dd>
          </div>
        ) : null}
        {finding.coverage ? (
          <div className="flex gap-1.5">
            <dt>Coverage</dt>
            <dd className="tabular-nums text-foreground">
              {finding.coverage.observed} of {finding.coverage.expected} periods
              {finding.coverage.absent > 0 ? ` · ${finding.coverage.absent} absent` : ""}
            </dd>
          </div>
        ) : null}
        {finding.qualityState === "partial" ? (
          <div className="flex gap-1.5">
            <dt>Quality</dt>
            <dd className="text-warning">Partial</dd>
          </div>
        ) : null}
      </dl>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-auto w-full justify-center gap-2"
        onClick={() => onInspect(finding.id)}
      >
        <Fingerprint aria-hidden="true" className="size-3.5" />
        Inspect evidence
      </Button>
    </article>
  );
}
