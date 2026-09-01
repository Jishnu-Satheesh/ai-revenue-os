"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  CircleDashed,
  Clock,
  Database,
  FileText,
  Fingerprint,
  LayoutTemplate,
  ShieldCheck,
} from "lucide-react";

import {
  AvailabilityVisual,
  CancellationImpact,
  RetentionVisual,
} from "@/components/analysis/operations-visuals";
import { RecommendationControls } from "@/components/analysis/recommendation-controls";
import {
  figureToneClass,
  findingValueLabel,
  formatCount,
  formatMoney,
  formatPercent,
  formatPercentPrecise,
  formatWholeMoney,
  formatWindow,
} from "@/components/analysis/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AnalysisGrain } from "@/domain/analysis/types";
import type { ChannelEvidenceWindow } from "@/modules/analysis/application/ports";
import type {
  ChannelWorkspaceView,
  WorkspaceChapterView,
  WorkspaceFindingView,
  WorkspaceRecommendationView,
  WorkspaceRunView,
} from "@/modules/analysis/application/read-model";

/**
 * The channel workspace, rebuilt onto the approved Superdesign refined draft.
 *
 * The page tells one analytical story in a fixed order: what the window proved
 * (the verdict band), the chapters the detectors filled (each an eight-column
 * analysis card beside a four-column figure rail), what was measured besides
 * (compact rows), and what is still waiting on other reports (a quiet shelf).
 * Nothing on the page computes a fact: every figure arrives from a versioned
 * detector through the read model, and every visualization below draws its
 * geometry from those stored numerators and denominators -- a wider segment
 * always means a larger stored count, never an opinion.
 *
 * Absence has a house style here, borrowed from the draft: a figure that
 * cannot be stated is an em-dash *with its reason beside it*, because a bare
 * dash reads as a styling bug and a bare zero reads as a measured result.
 */

export type WorkspaceChannel = {
  id: string;
  key: string;
  displayName: string;
  category: string;
  templateKey: string | null;
  status: string;
};

/** The period length an operator reads, not the enum a detector binds. */
const GRAIN_LABEL: Readonly<Record<AnalysisGrain, string>> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  // Not a length. This provider reported one figure for the whole window.
  span: "whole period",
};

/** The plural unit a coverage count is spoken in, matching the analysed grain. */
const GRAIN_UNIT: Readonly<Record<AnalysisGrain, string>> = {
  day: "days",
  week: "weeks",
  month: "months",
  span: "periods",
};

/**
 * How a run describes the grain it analysed.
 *
 * Every other grain reads naturally as "daily periods". A span does not: it is
 * one figure for the window, so "span periods" would both misname it and imply
 * a count the evidence never carried.
 */
function grainPhrase(grain: AnalysisGrain): string {
  return grain === "span" ? "one figure for the whole window" : `${grain} periods`;
}

/**
 * The four numbered findings the approved draft leads with. Only these render
 * with an ordinal; the summary, evidence and deferred chapters read as
 * supporting context rather than part of the numbered story.
 */
const FINDING_CHAPTER_IDS: ReadonlySet<string> = new Set([
  "cancellations",
  "availability",
  "funnel",
  "retention",
]);

/**
 * What one window choice is called.
 *
 * The dates are the ones the package declared and are shown exactly, never
 * rounded to a month name: "1 Jan – 28 Feb" and "January to February" are the
 * same span only by accident, and the analysis runs on the former.
 */
function windowLabel(option: ChannelEvidenceWindow): string {
  return `${option.windowStart} to ${option.windowEnd} · ${GRAIN_LABEL[option.grain]}`;
}

/**
 * Short labels for the bars a chapter draws. Long headlines belong to the
 * rail; a bar needs five words that say what was counted. Switched on the
 * detector's own codes so an unknown code degrades to the outcome kind rather
 * than to invented prose.
 */
function vizLabel(finding: WorkspaceFindingView): string {
  switch (finding.code) {
    case "PERIOD_COVERAGE_COMPLETE":
    case "PERIOD_COVERAGE_INCOMPLETE":
      return "Periods carrying evidence";
    case "CHANNEL_REVENUE_SHARE":
      return "Share of gross revenue";
    case "OPERATIONS_CLOSED_SHARE":
      return "Scheduled minutes reported closed";
    case "ORDER_CANCELLATION_LOSS":
      return "Orders reaching fulfilment";
    default:
      return finding.kindLabel;
  }
}

/** A ratio whose denominator was actually recorded, and is dividable. */
function ratioOf(finding: WorkspaceFindingView): { numerator: number; denominator: number } | null {
  // The guard mirrors the read model's own: a ratio with no recorded
  // denominator states no fraction, and reading its numerator alone would
  // invent the base it was measured over.
  return finding.value?.kind === "ratio" && finding.value.denominator > 0
    ? { numerator: finding.value.numerator, denominator: finding.value.denominator }
    : null;
}

/** The small uppercase section label the draft uses for every band and card. */
function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={`text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground ${className}`}
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Stored-value visualizations. Pure divs; every width traces to a stored pair.
// ---------------------------------------------------------------------------

/**
 * The verdict band's Potential / Lost / Earned scale, drawn from the stored
 * split. Each bar's height is the amount's own share of the potential, so a
 * larger bar always means a larger stated amount. No bar is drawn when the
 * split cannot be stated, because a scale with one empty column would read as a
 * measurement failure rather than an honest absence.
 */
function PotentialLostEarnedScale({
  figures,
}: {
  figures: {
    earned: { minorUnits: number; currency: string } | null;
    lost: { minorUnits: number; currency: string } | null;
    potential: { minorUnits: number; currency: string } | null;
  };
}) {
  const potential = figures.potential;
  if (potential === null || potential.minorUnits <= 0) {
    return (
      <div
        role="img"
        aria-label="No earned, lost and potential split can be stated for this window."
        className="flex min-h-24 items-center rounded-lg border border-dashed border-border bg-card/60 px-4 text-xs leading-relaxed text-muted-foreground"
      >
        The earned / lost / potential split cannot be stated for this window yet.
      </div>
    );
  }

  const bars: {
    label: string;
    value: { minorUnits: number; currency: string } | null;
    tone: "neutral" | "danger" | "success";
  }[] = [
    { label: "Potential", value: potential, tone: "neutral" },
    { label: "Lost", value: figures.lost, tone: "danger" },
    { label: "Earned", value: figures.earned, tone: "success" },
  ];

  return (
    <div
      role="img"
      aria-label={`Potential ${formatMoney(potential.minorUnits, potential.currency)}${
        figures.lost ? `; lost ${formatMoney(figures.lost.minorUnits, figures.lost.currency)}` : ""
      }${figures.earned ? `; earned ${formatMoney(figures.earned.minorUnits, figures.earned.currency)}` : ""}.`}
      className="relative flex h-56 w-full items-end gap-3 px-6 pb-4"
    >
      <span aria-hidden="true" className="absolute bottom-8 left-0 right-0 h-px bg-border" />
      {bars.map((bar) => {
        const share =
          bar.value === null || potential.minorUnits <= 0
            ? 0
            : Math.min(Math.round((bar.value.minorUnits / potential.minorUnits) * 100), 100);
        return (
          <div key={bar.label} className="flex flex-1 flex-col items-center gap-3">
            <span
              className={`text-sm font-mono font-bold ${
                bar.tone === "danger"
                  ? "text-destructive"
                  : bar.tone === "success"
                    ? "text-emerald-600"
                    : "text-foreground"
              }`}
            >
              {bar.value ? formatWholeMoney(bar.value.minorUnits, bar.value.currency) : "—"}
            </span>
            {/* Fixed-height track so the bar's percentage resolves against a
                real pixel height instead of an auto-sized flex column. */}
            <div className="flex h-40 w-full items-end">
              <div
                className={`w-full rounded-t-[2px] ${
                  bar.tone === "danger"
                    ? "bg-destructive"
                    : bar.tone === "success"
                      ? "bg-emerald-500"
                      : "bg-slate-200"
                }`}
                style={{ height: `${share}%` }}
              />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {bar.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One stored ratio as a split bar with its counts in the segments. The fill is
 * the numerator's share of the recorded denominator -- display-time division of
 * two stored integers, the same last-moment arithmetic `format.ts` does, never
 * a quotient of our own invention.
 */
function RatioSplitBar({
  label,
  numerator,
  denominator,
}: {
  label: string;
  numerator: number;
  denominator: number;
}) {
  const percent = Math.round((numerator / denominator) * 100);
  // Below ~18% a label inside the segment clips; moving it to the legend keeps
  // the count readable instead of decorative.
  const labelInside = percent >= 18;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] font-semibold tabular-nums">
          {formatCount(numerator)} of {formatCount(denominator)}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${numerator} of ${denominator}.`}
        className="flex h-8 w-full overflow-hidden rounded-lg bg-muted"
      >
        <div
          className={`flex h-full items-center bg-chart-2 px-3 ${
            labelInside ? "justify-start" : "justify-end"
          }`}
          style={{ width: `${percent}%` }}
        >
          {labelInside ? (
            <span className="text-[10px] font-bold tabular-nums text-white">{percent}%</span>
          ) : null}
        </div>
      </div>
      {!labelInside ? (
        <p className="text-[11px] tabular-nums text-muted-foreground">{percent}% of the base</p>
      ) : null}
    </div>
  );
}

/**
 * The conversion funnel, drawn as a vertical set of bars that shrink as the
 * stage moves toward the order. Stage names come from the metric key the funnel
 * detector hung on each pair, so a bar is named for the stage it counts rather
 * than read as an anonymous ordinal. The counts are the stored numerators and
 * denominators of the stage-pair findings, read here for display and never
 * recomputed: impressions is the top pair's denominator, and each later stage is
 * the previous pair's numerator. A width is always a stored amount's share of
 * the window's impressions, never an invented intermediate figure.
 */
function FunnelStages({ findings }: { findings: readonly WorkspaceFindingView[] }) {
  const pairs = findings.filter((finding) => finding.code === "FUNNEL_STAGE_CONVERSION");
  const endToEnd = findings.find(
    (finding) => finding.code === "FUNNEL_STAGE_CONVERSION_END_TO_END",
  );
  const endRatio = endToEnd ? ratioOf(endToEnd) : null;

  // Funnel order, named by the metric the stage counts. The denominator of the
  // first pair is the top of the funnel; each later stage's count is the prior
  // pair's numerator, so nothing here invents a step.
  const stageMeta: readonly { metricKey: string; label: string }[] = [
    { metricKey: "listing.menu_views", label: "Menu Views" },
    { metricKey: "listing.cart_additions", label: "Add-to-Cart" },
    { metricKey: "listing.placed_orders", label: "Orders" },
  ];

  const firstPair = pairs.find((finding) => finding.metricKey === "listing.menu_views");
  const firstRatio = firstPair ? ratioOf(firstPair) : null;
  const impressions = firstRatio?.denominator ?? endRatio?.denominator ?? null;
  if (impressions === null || impressions <= 0) return null;

  const stages: {
    label: string;
    count: number;
    fromPrevious: number | null;
    findingId: string | null;
  }[] = [
    {
      label: "Impressions",
      count: impressions,
      fromPrevious: null,
      findingId: firstPair?.id ?? null,
    },
  ];

  for (const meta of stageMeta) {
    const pair = pairs.find((finding) => finding.metricKey === meta.metricKey);
    if (!pair) continue;
    const ratio = ratioOf(pair);
    if (!ratio) continue;
    stages.push({
      label: meta.label,
      count: ratio.numerator,
      fromPrevious:
        ratio.denominator > 0 ? Math.round((ratio.numerator / ratio.denominator) * 100) : null,
      findingId: pair.id,
    });
  }

  const overall =
    endRatio && endRatio.denominator > 0
      ? Math.round((endRatio.numerator / endRatio.denominator) * 100)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        {stages.map((stage) => {
          const heightPercent = Math.max(Math.round((stage.count / impressions) * 100), 4);
          return (
            <div
              key={stage.label}
              className="flex flex-1 flex-col items-center gap-2"
              title={`${stage.count} ${stage.label}`}
            >
              <span className="text-sm font-mono font-bold tabular-nums">
                {formatCount(stage.count)}
              </span>
              {/* Fixed-height track so the bar shrinks in real pixels toward
                  the order stage instead of collapsing in an auto column. */}
              <div className="flex h-40 w-full items-end">
                <div
                  role="img"
                  aria-label={`${stage.label}: ${formatCount(stage.count)}.`}
                  className="w-full rounded-t-md bg-emerald-100"
                  style={{ height: `${heightPercent}%` }}
                />
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-700">
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {overall !== null ? (
        <div className="flex items-center justify-between rounded-lg bg-emerald-500 px-4 py-2 text-white shadow-card">
          <span className="text-[10px] font-bold uppercase tracking-wider">Overall conversion</span>
          <span className="text-xs font-mono font-bold tabular-nums">{overall}%</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The visualization slot of a chapter card, assembled purely from the
 * chapter's own stored findings. Chapters whose findings carry no drawable
 * ratio render nothing here -- the rail already shows their figures, and an
 * empty decorated box would imply measurement that did not happen.
 */
function ChapterVisual({
  chapter,
  allFindings,
  run,
}: {
  chapter: WorkspaceChapterView;
  allFindings: readonly WorkspaceFindingView[];
  run: WorkspaceRunView | null;
}) {
  if (chapter.id === "funnel") return <FunnelStages findings={chapter.findings} />;
  if (chapter.id === "cancellations")
    return <CancellationImpact chapter={chapter} allFindings={allFindings} />;
  if (chapter.id === "availability") return <AvailabilityVisual chapter={chapter} run={run} />;
  if (chapter.id === "retention") return <RetentionVisual chapter={chapter} run={run} />;

  const blocks: React.ReactNode[] = [];
  for (const finding of chapter.findings) {
    const ratio = ratioOf(finding);
    if (ratio)
      blocks.push(
        <RatioSplitBar
          key={finding.id}
          label={vizLabel(finding)}
          numerator={ratio.numerator}
          denominator={ratio.denominator}
        />,
      );
  }
  if (blocks.length === 0) return null;
  return <div className="grid gap-6 sm:grid-cols-2">{blocks}</div>;
}

// ---------------------------------------------------------------------------
// Verdict band
// ---------------------------------------------------------------------------

function VerdictBand({
  view,
  coverageChip,
  selectedWindowId,
  onSelectWindow,
  evidenceWindows,
  canRunAnalysis,
  pending,
  onRunAnalysis,
  selectedWindow,
}: {
  view: ChannelWorkspaceView;
  coverageChip: string | null;
  selectedWindowId: string | null;
  onSelectWindow: (packageId: string) => void;
  evidenceWindows: readonly ChannelEvidenceWindow[];
  canRunAnalysis: boolean;
  pending: boolean;
  onRunAnalysis: () => void;
  selectedWindow: ChannelEvidenceWindow | null;
}) {
  return (
    <section
      aria-label="Marketplace audit verdict"
      // Full-bleed: negative margins escape the shell's horizontal padding so
      // the tint runs edge to edge, with its own padding re-applied inside.
      className="-mx-4 border-b border-border bg-emerald-50/40 px-4 py-14 sm:-mx-8 sm:px-8 lg:py-16"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
              <ShieldCheck aria-hidden="true" className="size-4" />
            </span>
            <Kicker>Marketplace audit verdict</Kicker>
          </div>

          <p className="max-w-2xl text-3xl font-bold leading-[1.1] tracking-[-0.03em] lg:text-[42px]">
            {view.verdict.verdictFigures.earned && view.verdict.verdictFigures.lost ? (
              <>
                You earned{" "}
                <span className="font-mono font-bold text-emerald-600">
                  {formatWholeMoney(
                    view.verdict.verdictFigures.earned.minorUnits,
                    view.verdict.verdictFigures.earned.currency,
                  )}
                </span>{" "}
                and lost{" "}
                <span className="font-mono font-bold text-destructive">
                  {formatWholeMoney(
                    view.verdict.verdictFigures.lost.minorUnits,
                    view.verdict.verdictFigures.lost.currency,
                  )}
                </span>{" "}
                to cancellations you could have prevented.
              </>
            ) : (
              view.verdict.headlineSentence
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            {coverageChip ? (
              <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                {coverageChip}
              </span>
            ) : null}
            {view.run ? (
              <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                Deterministic findings only
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-5">
          <PotentialLostEarnedScale figures={view.verdict.verdictFigures} />

          <div className="mt-auto flex flex-col gap-2">
            {evidenceWindows.length > 0 ? (
              <>
                <Select value={selectedWindowId ?? undefined} onValueChange={onSelectWindow}>
                  <SelectTrigger
                    aria-label="Window to analyse"
                    className="h-9 w-full rounded-full border-border bg-card pl-3.5 pr-3 text-xs font-semibold shadow-sm lg:w-auto lg:min-w-64"
                  >
                    <CalendarRange aria-hidden="true" className="size-3.5 text-muted-foreground" />
                    <SelectValue placeholder="Choose a window" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* The port delivers these newest-first; the offer keeps
                        that order so the freshest declared window is the
                        default choice, not buried. */}
                    {evidenceWindows.map((option) => (
                      <SelectItem key={option.packageId} value={option.packageId}>
                        {windowLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedWindow ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {selectedWindow.sourceFilename
                      ? `From ${selectedWindow.sourceFilename}. `
                      : null}
                    The window an approved report declared, in {selectedWindow.timeZone}. Days the
                    provider left blank are counted as absent, not as zero.
                  </p>
                ) : null}
                {canRunAnalysis ? (
                  <Button
                    type="button"
                    size="sm"
                    className="self-start"
                    disabled={pending}
                    onClick={onRunAnalysis}
                  >
                    {pending ? "Starting…" : "Run analysis"}
                  </Button>
                ) : null}
              </>
            ) : (
              // Not a disabled button. An operator staring at one cannot tell
              // whether the platform is busy, broken, or waiting on them.
              <p className="text-[11px] leading-snug text-muted-foreground">
                There is no window to analyse yet. An approved report has to write governed evidence
                for this channel before an analysis has anything to run over.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

/**
 * The chip that names a chapter's state at a glance. Colour encodes status
 * only: danger severities, warning for waiting on evidence, neutral for
 * structural absences -- never decoration.
 */
function StateChip({ chapter }: { chapter: WorkspaceChapterView }) {
  if (chapter.state === "needs_data") return <StatusBadge label="Needs data" tone="warning" />;
  if (chapter.state === "not_run") return <StatusBadge label="Not analysed" tone="neutral" />;
  if (chapter.state === "not_applicable")
    return <StatusBadge label="Does not apply" tone="neutral" />;
  const featured = chapter.findings[0];
  if (featured?.severity) {
    return <StatusBadge label={featured.severity} tone={featured.severityTone ?? "neutral"} />;
  }
  return <StatusBadge label="Reported" tone="success" />;
}

/**
 * What a chapter card says when its detectors had nothing to answer. Always an
 * icon, a title, and the reason in the detector's own words: the three ways a
 * chapter can be empty mean different things, and an operator has to be able
 * to tell them apart at a glance.
 */
function ChapterUnavailableBody({ chapter }: { chapter: WorkspaceChapterView }) {
  const reasons = [
    ...new Set(
      chapter.findings
        .map((finding) => finding.detail)
        .filter((detail): detail is string => detail !== null),
    ),
  ];
  return (
    <div className="my-2 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        {chapter.state === "not_run" || chapter.state === "not_applicable" ? (
          <Database className="size-4" />
        ) : (
          <CircleDashed className="size-4" />
        )}
      </span>
      <p className="text-sm font-semibold">
        {chapter.state === "not_run"
          ? "Not analysed yet"
          : chapter.state === "not_applicable"
            ? "Does not apply to this channel"
            : "Waiting on evidence"}
      </p>
      {reasons.length > 0 ? (
        reasons.map((reason) => (
          <p key={reason} className="max-w-md text-xs leading-relaxed text-muted-foreground">
            {reason}
          </p>
        ))
      ) : (
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {chapter.state === "not_run"
            ? "No analysis has completed for this channel, so this chapter has nothing to report."
            : chapter.state === "not_applicable"
              ? "This provider reports one figure for the whole window rather than a figure per period, so the checks behind this chapter have nothing to measure against. It is not missing data; it is a question this export cannot answer."
              : "The detectors for this chapter had no evidence to work with."}
        </p>
      )}
    </div>
  );
}

/**
 * A finding that did not earn the chapter rail: one calm row, label left,
 * stored value right, reason attached to any dash. Nothing is dropped from the
 * page -- it is just quieter than the findings with figures.
 */
function CompactFindingRow({
  finding,
  onInspect,
}: {
  finding: WorkspaceFindingView;
  onInspect: (findingId: string) => void;
}) {
  const value = findingValueLabel(finding);
  const reason =
    finding.detail ?? (value || finding.value ? null : "This outcome states no figure.");
  const storedRatio = ratioOf(finding);
  const bar = storedRatio
    ? {
        numerator: storedRatio.numerator,
        denominator: storedRatio.denominator,
        label: `Measured ratio: ${storedRatio.numerator} of ${storedRatio.denominator}.`,
      }
    : finding.coverage && finding.coverage.expected > 0
      ? {
          numerator: finding.coverage.observed,
          denominator: finding.coverage.expected,
          label: `Evidence coverage: ${finding.coverage.observed} of ${finding.coverage.expected} periods.`,
        }
      : null;
  const barPercent = bar
    ? Math.min(Math.max((bar.numerator / bar.denominator) * 100, 0), 100)
    : null;
  return (
    <button
      type="button"
      onClick={() => onInspect(finding.id)}
      className="grid w-full grid-cols-1 gap-2 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-xs font-semibold">{finding.headline}</span>
        {reason ? (
          <span className="text-[11px] leading-snug text-muted-foreground">{reason}</span>
        ) : null}
      </span>
      {bar && barPercent !== null ? (
        <span
          role="img"
          aria-label={bar.label}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <span
            aria-hidden="true"
            className="block h-full rounded-full bg-chart-2"
            style={{ width: `${barPercent}%` }}
          />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="hidden h-2 rounded-full border border-dashed border-border sm:block"
        />
      )}
      {value ? (
        <span className={`shrink-0 text-xs font-semibold tabular-nums ${figureToneClass(finding)}`}>
          {value}
        </span>
      ) : (
        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">—</span>
      )}
    </button>
  );
}

function chapterDescription(chapter: WorkspaceChapterView): string | null {
  switch (chapter.id) {
    case "cancellations":
      return "Cancellations and the provider's own rejection loss, as they were written.";
    case "availability":
      return "Closed and scheduled time, and the reasons the provider recorded.";
    case "funnel":
      return "Conversion from impressions to orders, stage by stage.";
    case "retention":
      return "New against returning customers, and the pace new orders arrive at.";
    case "trust":
      // Named inline in CardContent with the platform's exact section label,
      // so the card leads with the vocabulary operators know from elsewhere.
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Chapter rail
// ---------------------------------------------------------------------------

/**
 * The distinct provider reason labels a finding cites. An empty result means no
 * reason was recorded, and a single value means every cited day shared one
 * label -- which is the only case where a sentence may say "every cancellation
 * was X" without inventing a cause.
 */
function distinctReasonValues(finding: WorkspaceFindingView | undefined): string[] {
  if (!finding) return [];
  const values = new Set<string>();
  for (const citation of finding.evidence) {
    const reason = citation.metric?.dimensions.reason_code;
    if (reason) values.add(reason);
  }
  return [...values];
}

/**
 * The approved draft's rail figure, plain reason, and cited-record count for a
 * chapter, assembled from the chapter's own stored findings and nothing else.
 *
 * The figure is the headline amount the draft introduces with -- the money lost
 * for cancellations, the closed-hour share, the end-to-end yield, the return
 * mix -- read off the detector's stored value, never recomputed. The reason is
 * one calm sentence; where the draft pairs it with a cause ("every cancellation
 * was ITEM_UNAVAILABLE"), that cause is shown only when a single stored label
 * covers the window, so an attribution is cited evidence and not prose.
 */
function chapterRailSummary(chapter: WorkspaceChapterView): {
  figure: string | null;
  figureClass: string;
  reason: string | null;
  inspectCount: number | null;
} {
  const loss = chapter.findings.find((finding) => finding.code === "ORDER_CANCELLATION_LOSS");
  const shareRatio = chapter.findings
    .filter((finding) => finding.code === "OPERATIONS_CLOSED_SHARE")
    .map((finding) => ratioOf(finding))
    .find((ratio) => ratio !== null);
  const funnelRatio = chapter.findings
    .filter((finding) => finding.code === "FUNNEL_STAGE_CONVERSION_END_TO_END")
    .map((finding) => ratioOf(finding))
    .find((ratio) => ratio !== null);
  const repeatRatio = chapter.findings
    .filter((finding) => finding.code === "CUSTOMER_REPEAT_SHARE")
    .map((finding) => ratioOf(finding))
    .find((ratio) => ratio !== null);

  if (chapter.id === "cancellations" && loss) {
    const impact = loss.monetaryImpact;
    const reasonFinding = chapter.findings.find(
      (finding) => finding.code === "ORDER_CANCELLATION_REASON",
    );
    const reasons = distinctReasonValues(reasonFinding);
    const figure = impact ? formatMoney(impact.minorUnits, impact.currency) : null;
    const reason =
      reasons.length === 1
        ? `Every single order cancellation recorded in this window was attributed to ${reasons[0]}.`
        : loss.value?.kind === "count"
          ? `The provider recorded ${formatCount(loss.value.value)} avoidable cancellations this window.`
          : null;
    return {
      figure,
      figureClass: figure ? "text-destructive" : "text-foreground",
      reason,
      inspectCount: loss.value?.kind === "count" ? loss.value.value : null,
    };
  }

  if (chapter.id === "availability" && shareRatio) {
    const { numerator, denominator } = shareRatio;
    return {
      figure: `${formatPercent(numerator, denominator)} Hours`,
      figureClass: "text-foreground",
      reason: `${formatPercent(numerator, denominator)} of scheduled operating time was recorded closed this window.`,
      inspectCount: null,
    };
  }

  if (chapter.id === "funnel" && funnelRatio) {
    const { numerator, denominator } = funnelRatio;
    return {
      figure: `${formatPercentPrecise(numerator, denominator)} Yield`,
      figureClass: "text-foreground",
      reason: `Of every impression, ${formatPercentPrecise(numerator, denominator)} became a placed order.`,
      inspectCount: null,
    };
  }

  if (chapter.id === "retention" && repeatRatio) {
    const { numerator, denominator } = repeatRatio;
    const returning = Math.min(numerator, denominator);
    const total = denominator;
    return {
      figure: `${formatCount(returning)} of ${formatCount(total)} Return`,
      figureClass: "text-foreground",
      reason: `${formatCount(total - returning)} of ${formatCount(total)} orders came from new customers; ${formatCount(returning)} returned.`,
      inspectCount: null,
    };
  }

  // A chapter whose headline figure is not among the four above falls back to
  // the generic rail block: the featured finding's own figure, its own words
  // (a needs_data sentence, or the outcome headline when one is not recorded),
  // and its own cited record count.
  const primary = chapter.findings[0];
  const figure = primary ? findingValueLabel(primary) : null;
  return {
    figure,
    figureClass: primary ? figureToneClass(primary) : "text-foreground",
    reason: primary?.detail ?? primary?.headline ?? null,
    inspectCount: primary?.evidence.length ?? null,
  };
}

/**
 * The approved draft's chapter rail: one big figure, one calm reason, the AI
 * advice box drawn in the platform's green house style, and one way into the
 * evidence. The advice is the narrated recommendation for this chapter; the
 * inspect control opens the cited records behind the headline figure.
 */
function ChapterRail({
  chapter,
  recommendations,
  onInspect,
  organizationId,
}: {
  chapter: WorkspaceChapterView;
  recommendations: readonly WorkspaceRecommendationView[];
  onInspect: (findingId: string) => void;
  organizationId: string;
}) {
  const summary = chapterRailSummary(chapter);
  // The green box is the advice slot, so only advice goes in it. Narration
  // labelled `observation` is a plain reading of the figure and belongs beside
  // the figure -- putting it in the box gave the operator the number twice and
  // no action at all.
  const advice = recommendations.find((item) => item.label === "recommendation") ?? null;
  const narratedObservation = recommendations.find((item) => item.label === "observation") ?? null;
  const inspectFinding = chapter.findings[0];

  // An empty chapter still gets its rail: a quiet frame that says no analysis
  // has run, rather than a blank column that reads as a layout gap.
  if (chapter.findings.length === 0) {
    return (
      <aside
        aria-label={`${chapter.navLabel} figures`}
        className="flex flex-col gap-8 lg:col-span-4"
      >
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          {chapter.state === "not_run"
            ? "Figures appear here once an analysis has run over this channel."
            : chapter.state === "not_applicable"
              ? "This chapter's figures need a report broken into periods."
              : "Figures appear here once the missing evidence is written."}
        </p>
      </aside>
    );
  }

  return (
    <aside aria-label={`${chapter.navLabel} figures`} className="flex flex-col gap-8 lg:col-span-4">
      <div className="flex flex-col gap-3">
        {summary.figure ? (
          <p className={`font-mono text-4xl font-bold tracking-tight ${summary.figureClass}`}>
            {summary.figure}
          </p>
        ) : null}
        {summary.reason ? (
          <p className="text-[15px] leading-relaxed text-muted-foreground">{summary.reason}</p>
        ) : null}
        {/* The narrator's plain reading of the same figure, when it wrote one.
            It sits under the deterministic sentence rather than replacing it:
            the detector's own words stay the record, and the narration adds
            what it saw across the findings together. */}
        {narratedObservation ? (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {narratedObservation.headline}
          </p>
        ) : null}
      </div>

      {advice ? (
        <RecommendationControls organizationId={organizationId} recommendation={advice} />
      ) : null}

      {inspectFinding ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-center gap-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
          onClick={() => onInspect(inspectFinding.id)}
        >
          <Fingerprint aria-hidden="true" className="size-4" />
          {summary.inspectCount !== null && summary.inspectCount > 0
            ? `Inspect ${formatCount(summary.inspectCount)} cited records`
            : "Inspect evidence"}
        </Button>
      ) : null}
    </aside>
  );
}

export function ChannelWorkspace({
  organizationId,
  channel,
  view,
  evidenceWindows,
  canRunAnalysis,
  channelsHref,
  economicsHref,
}: {
  organizationId: string;
  channel: WorkspaceChannel;
  view: ChannelWorkspaceView;
  /**
   * The windows this channel holds governed evidence for, newest first. Offered
   * instead of spans counted back from today, because evidence arrives as
   * uploaded reports covering periods already past: "the last thirty days"
   * reaches an imported January only by coincidence.
   */
  evidenceWindows: readonly ChannelEvidenceWindow[];
  canRunAnalysis: boolean;
  channelsHref: string;
  economicsHref: string;
}) {
  const router = useRouter();
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(
    evidenceWindows[0]?.packageId ?? null,
  );
  const selectedWindow =
    evidenceWindows.find((option) => option.packageId === selectedWindowId) ??
    evidenceWindows[0] ??
    null;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const allFindings = useMemo<WorkspaceFindingView[]>(
    () => [...view.chapters.flatMap((chapter) => chapter.findings), ...view.unplacedFindings],
    [view],
  );

  const selectedFinding = useMemo(
    () => allFindings.find((finding) => finding.id === selectedFindingId) ?? null,
    [allFindings, selectedFindingId],
  );

  // The sheet is modal, so selecting a finding opens provenance over the page
  // instead of toggling a highlight the reader may never notice.
  const inspect = useCallback((findingId: string) => setSelectedFindingId(findingId), []);
  const closeSheet = useCallback(() => setSelectedFindingId(null), []);

  const inlineChapters = useMemo(
    () => view.chapters.filter((chapter) => chapter.state !== "deferred"),
    [view.chapters],
  );
  const deferredChapters = useMemo(
    () => view.chapters.filter((chapter) => chapter.state === "deferred"),
    [view.chapters],
  );

  // Only the four findings the draft leads with carry an ordinal; the summary,
  // evidence and deferred chapters read as supporting context. Computed once so
  // no value is reassigned during render.
  const findingOrdinals = useMemo(() => {
    const ordinals = new Map<string, number>();
    let ordinal = 0;
    for (const chapter of inlineChapters) {
      if (FINDING_CHAPTER_IDS.has(chapter.id)) ordinals.set(chapter.id, (ordinal += 1));
    }
    return ordinals;
  }, [inlineChapters]);

  // Narration attaches where its first cited finding is displayed; a
  // recommendation citing nothing on this page still reaches the operator
  // through the Further noted shelf, because dropping one would be indistinguishable from it never existing.
  const recommendationsByFindingId = useMemo(() => {
    const displayed = new Set(allFindings.map((finding) => finding.id));
    const byFinding = new Map<string, WorkspaceRecommendationView[]>();
    const further: WorkspaceRecommendationView[] = [];
    for (const recommendation of view.recommendations) {
      const firstCited = recommendation.citationFindingIds.find((id) => displayed.has(id));
      if (firstCited) {
        const existing = byFinding.get(firstCited);
        if (existing) existing.push(recommendation);
        else byFinding.set(firstCited, [recommendation]);
      } else {
        further.push(recommendation);
      }
    }
    return { byFinding, further };
  }, [allFindings, view.recommendations]);

  const chapterRecommendations = useCallback(
    (chapter: WorkspaceChapterView) =>
      chapter.findings.flatMap(
        (finding) => recommendationsByFindingId.byFinding.get(finding.id) ?? [],
      ),
    [recommendationsByFindingId],
  );

  const trustChapter = view.chapters.find((chapter) => chapter.id === "trust");
  const coverageFinding = trustChapter?.findings.find(
    (finding) => finding.detectorKey === "evidence.period_coverage",
  );
  const heldFinding = trustChapter?.findings.find(
    (finding) => finding.detectorKey === "evidence.reconciliation_blocked",
  );

  // Coverage speaks in the grain the run actually analysed; without a
  // completed run there is no grain to speak in, so the chip falls back to the
  // verdict's own sentence about coverage being unreported.
  const coverageRatio =
    coverageFinding && coverageFinding.kind !== "needs_data" ? ratioOf(coverageFinding) : null;
  const coverageUnit = view.run ? GRAIN_UNIT[view.run.periodGrain] : "periods";
  const coverageChip = coverageRatio
    ? `${coverageRatio.numerator} of ${coverageRatio.denominator} ${coverageUnit} carry evidence`
    : view.verdict.badges[2];

  async function runAnalysis() {
    if (!selectedWindow) return;
    setPending(true);
    setMessage(null);
    const { windowStart, windowEnd, grain, branchId } = selectedWindow;
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/channels/${channel.id}/analysis`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The branch the evidence was written for, so the analysis asks about
          // the same rows the package produced rather than every branch at once.
          body: JSON.stringify({ windowStart, windowEnd, periodGrain: grain, branchId }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setMessage({
          tone: "error",
          text: payload?.error?.message ?? "The analysis could not be started.",
        });
        return;
      }
      setMessage({
        tone: "info",
        // Honest about the shape of the work: the run is queued, not finished.
        text: `Analysis started for ${formatWindow(windowStart, windowEnd)}. It runs in the background; refresh in a moment to see the result.`,
      });
      router.refresh();
    } catch {
      setMessage({
        tone: "error",
        text: "The analysis could not be started. Check your connection.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    // Sized to its content, not to the viewport: the shell's `main` scrolls,
    // and capping this child's height would clip the narrative mid-chapter.
    <div className="flex w-full flex-col gap-8">
      {/* <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <LayoutTemplate aria-hidden="true" className="size-6" />
        </span>
        <div>
          <Kicker>Channel Economics</Kicker>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
            {channel.displayName} marketplace audit
          </h1>
          <p className="text-sm text-muted-foreground">
            Deterministic findings for the {channel.displayName} channel, and what the evidence
            cannot yet support.
          </p>
        </div>
      </div> */}

      <VerdictBand
        view={view}
        coverageChip={coverageChip}
        evidenceWindows={evidenceWindows}
        selectedWindow={selectedWindow}
        selectedWindowId={selectedWindow?.packageId ?? null}
        onSelectWindow={setSelectedWindowId}
        canRunAnalysis={canRunAnalysis}
        pending={pending}
        onRunAnalysis={runAnalysis}
      />

      {message ? (
        <Alert variant={message.tone === "error" ? "destructive" : "default"}>
          <AlertTitle>{message.tone === "error" ? "Not started" : "Analysis started"}</AlertTitle>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      {/* What is on screen, stated exactly. A window label that rounded to a
          month name would be a claim the evidence does not make. */}
      <div
        aria-label="Run status"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-xs"
      >
        {view.run ? (
          <>
            <StatusBadge label="Showing" tone="success" />
            <span className="text-muted-foreground">
              analysis of{" "}
              {formatWindow(view.run.windowStart, view.run.windowEnd, view.run.windowTimezone)} ·{" "}
              {grainPhrase(view.run.periodGrain)}
            </span>
          </>
        ) : (
          <>
            <StatusBadge label="Nothing analysed" tone="neutral" />
            <span className="text-muted-foreground">
              No analysis has completed for this channel yet.
            </span>
          </>
        )}
        {view.runs.some((run) => run.status === "running") ? (
          <StatusBadge label="A run is in progress" tone="warning" />
        ) : null}
        {/* The newest run, not the newest failure. Searching the list for any
            failed run left this warning on screen forever once a channel had
            failed even once, contradicting the figures printed beside it. */}
        {view.runs[0]?.status === "failed" ? (
          <span className="text-warning">
            The last attempt failed: {view.runs[0]?.safeFailureCode}
          </span>
        ) : null}
      </div>

      {/* A compact, accessible map of the story instead of a sticky tracker:
          the narrative is meant to be scrolled, not navigated around. */}
      <nav aria-label="Workspace chapters">
        <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {inlineChapters.map((chapter) => (
            <li key={chapter.id}>
              <a
                href={`#${chapter.id}`}
                className="block whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {chapter.navLabel}
              </a>
            </li>
          ))}
          {recommendationsByFindingId.further.length > 0 ? (
            <li>
              <a
                href="#further-noted"
                className="block whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Further noted
              </a>
            </li>
          ) : null}

          {deferredChapters.length > 0 ? (
            <li>
              <a
                href="#awaiting-other-reports"
                className="block whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Awaiting other reports
              </a>
            </li>
          ) : null}
        </ul>
      </nav>

      <section aria-label="Findings & recommendations" className="flex flex-col gap-10">
        {inlineChapters.map((chapter) => {
          const number = findingOrdinals.get(chapter.id) ?? null;
          return (
            <ChapterShell
              key={chapter.id}
              chapter={chapter}
              number={number}
              heldFinding={chapter.id === "trust" ? (heldFinding ?? null) : null}
              coverageFinding={chapter.id === "trust" ? (coverageFinding ?? null) : null}
              onInspect={inspect}
              recommendations={chapterRecommendations(chapter)}
              organizationId={organizationId}
              allFindings={allFindings}
              run={view.run}
            />
          );
        })}
      </section>

      {view.unplacedFindings.length > 0 ? (
        // Findings whose detector belongs to no chapter land here rather than
        // being dropped: a detector shipped after this page was written still
        // reaches the operator, just without a chapter of its own.
        <section
          id="also-measured"
          aria-label="Also measured"
          className="flex scroll-mt-24 flex-col gap-3 border-t border-border pt-8"
        >
          <Kicker>Also measured</Kicker>
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {view.unplacedFindings.map((finding) => (
              <CompactFindingRow key={finding.id} finding={finding} onInspect={inspect} />
            ))}
          </div>
        </section>
      ) : null}

      {recommendationsByFindingId.further.length > 0 ? (
        // Narration whose citations land outside this page's chapters, or on
        // no finding at all. It renders here rather than vanishing.
        <section
          id="further-noted"
          aria-label="Further noted"
          className="flex scroll-mt-24 flex-col gap-3 border-t border-border pt-8"
        >
          <Kicker>Further noted</Kicker>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {recommendationsByFindingId.further.map((recommendation) => (
              <RecommendationControls
                key={recommendation.id}
                organizationId={organizationId}
                recommendation={recommendation}
              />
            ))}
          </div>
        </section>
      ) : null}

      {deferredChapters.length > 0 ? (
        // Deferred chapters collapse into one quiet shelf. Each card names
        // what it waits on in its own recorded words -- paraphrasing a data
        // dependency is how wrong promises about "soon" get written.
        <section
          id="awaiting-other-reports"
          aria-label="Awaiting other reports"
          className="flex scroll-mt-24 flex-col gap-4 rounded-xl border border-border bg-muted/30 p-6"
        >
          <div className="flex items-center gap-2">
            <Clock aria-hidden="true" className="size-3.5 text-muted-foreground" />
            <Kicker>Awaiting other reports</Kicker>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {deferredChapters.map((chapter) => (
              <article
                key={chapter.id}
                aria-label={chapter.navLabel}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {chapter.navLabel}
                </span>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {chapter.deferredReason}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Channel identity stays explicit and separate from any provider
          relationship: `specs/018` section 6.1 -- a channel is an
          organization's own identity, never a connection or a permission. */}
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-xs">
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Channel key</dt>
            <dd className="font-mono">{channel.key}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Category</dt>
            <dd>{channel.category}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="sr-only">Integration</dt>
            <dd>
              <StatusBadge label="No connection implied" tone="neutral" />
            </dd>
          </div>
        </dl>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={channelsHref}>Manage this channel</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={economicsHref}>Back to channel economics</Link>
          </Button>
        </div>
      </footer>

      {/* One shared evidence sheet. Provenance opens over the page from an
          explicit control, so the analytical story never trades its width for
          a permanently mounted rail of metadata nobody is reading. */}
      {selectedFinding ? (
        <EvidenceSheet finding={selectedFinding} run={view.run} onClose={closeSheet} />
      ) : null}
    </div>
  );
}

/**
 * Renders one inline chapter: the eight-column analysis card (heading, state
 * chip, stored-value visualization) beside the four-column figure rail
 * (featured finding, then quieter rows). Deferred chapters never reach this
 * shell; they live on the awaiting shelf where their reasons are the content.
 */
function ChapterShell({
  chapter,
  number,
  heldFinding,
  coverageFinding,
  onInspect,
  recommendations,
  organizationId,
  allFindings,
  run,
}: {
  chapter: WorkspaceChapterView;
  /** The finding ordinal, or null for a supplementary chapter. */
  number: number | null;
  heldFinding: WorkspaceFindingView | null;
  coverageFinding: WorkspaceFindingView | null;
  onInspect: (findingId: string) => void;
  recommendations: readonly WorkspaceRecommendationView[];
  organizationId: string;
  allFindings: readonly WorkspaceFindingView[];
  run: WorkspaceRunView | null;
}) {
  const coverageRatio =
    coverageFinding && coverageFinding.kind !== "needs_data" ? ratioOf(coverageFinding) : null;

  return (
    <section
      id={chapter.id}
      aria-label={`${chapter.navLabel} chapter`}
      // `items-start` because a grid item stretches to its row by default, and
      // the row is as tall as whichever column has more to say. The rail is
      // transparent so stretching costs it nothing, but the card is a bordered
      // box: a chapter whose figures are two short bars drew that border around
      // a screenful of nothing, which reads as content that failed to load
      // rather than a chapter that is simply brief.
      className="grid scroll-mt-24 grid-cols-1 items-start gap-6 lg:grid-cols-12"
    >
      <Card className="lg:col-span-8">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {number !== null
                  ? `${String(number).padStart(2, "0")} · ${chapter.heading}`
                  : chapter.heading}
              </CardTitle>
              {chapterDescription(chapter) ? (
                <CardDescription className="text-xs">{chapterDescription(chapter)}</CardDescription>
              ) : null}
            </div>
            <StateChip chapter={chapter} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {chapter.id === "trust" ? <Kicker>Reports & trust</Kicker> : null}
          {chapter.id === "trust" && coverageRatio ? (
            <div className="flex flex-col gap-2">
              <Kicker>Data trust</Kicker>
              <RatioSplitBar
                label="Periods carrying evidence"
                numerator={coverageRatio.numerator}
                denominator={coverageRatio.denominator}
              />
            </div>
          ) : null}
          {chapter.findings.length > 0 ? (
            <ChapterVisual chapter={chapter} allFindings={allFindings} run={run} />
          ) : (
            <ChapterUnavailableBody chapter={chapter} />
          )}
          {/* All findings need data -> the card body is the explanation. */}
          {chapter.state === "needs_data" &&
          chapter.findings.length > 0 &&
          chapter.findings.every((finding) => finding.kind === "needs_data") ? (
            <ChapterUnavailableBody chapter={chapter} />
          ) : null}
          {heldFinding && heldFinding.kind === "finding" ? (
            <Alert>
              <AlertTitle>A decision is waiting</AlertTitle>
              <AlertDescription>
                Held evidence stays out of every figure on this page until someone decides which
                import is right. Resolve it in the Integration Hub.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <ChapterRail
        chapter={chapter}
        recommendations={recommendations}
        onInspect={onInspect}
        organizationId={organizationId}
      />
    </section>
  );
}

/**
 * The evidence sheet, restyled light to match the cards. Every row is read off
 * a stored record -- the detector and the version of its arithmetic, the window
 * the run declared, the quality the write path recorded, the limitations the
 * detector itself stated, and the rows it cited. Nothing is summarised into a
 * sentence somebody could disagree with.
 */

const EVIDENCE_ROLE_LABEL: Readonly<
  Record<WorkspaceFindingView["evidence"][number]["role"], string>
> = {
  subject_period: "the period measured",
  prior_period: "the period compared against",
  component: "a figure summed in",
  denominator: "part of the base",
  held_evidence: "the decision holding evidence back",
  gap_count: "the import that reported the blanks",
};

const EVIDENCE_KIND_LABEL: Readonly<
  Record<WorkspaceFindingView["evidence"][number]["kind"], string>
> = {
  normalized_metric: "Metric observation",
  exact_range_metric_observation: "Exact-range observation",
  report_projection_reconciliation: "Reconciliation record",
  projection_run: "Projection run",
};

function SheetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-[13px] leading-relaxed">{children}</div>
    </div>
  );
}

function EvidenceSheet({
  finding,
  run,
  onClose,
}: {
  finding: WorkspaceFindingView;
  run: WorkspaceRunView | null;
  onClose: () => void;
}) {
  return (
    <Sheet open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border p-5 pr-14">
          <div className="flex items-center gap-2">
            <Fingerprint aria-hidden="true" className="size-4 text-primary" />
            <SheetTitle className="text-base font-semibold">Inspect evidence</SheetTitle>
          </div>
          <SheetDescription className="text-xs leading-relaxed">
            {finding.headline}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-5">
          <SheetRow label="Detector">
            <span className="font-medium">{finding.detectorKey}</span>
            <span className="text-muted-foreground">
              {" "}
              · calculation version {finding.detectorVersion}
            </span>
          </SheetRow>

          <div className="grid grid-cols-2 gap-4">
            <SheetRow label="Period">
              {finding.periodStart && finding.periodEnd
                ? formatWindow(finding.periodStart, finding.periodEnd)
                : run
                  ? formatWindow(run.windowStart, run.windowEnd)
                  : "Not recorded"}
            </SheetRow>
            <SheetRow label="Quality">
              <span className={finding.qualityState === "partial" ? "text-warning" : ""}>
                {finding.qualityState === "partial" ? "Partial" : "Complete"}
              </span>
            </SheetRow>
          </div>

          <SheetRow label="Recorded in">
            {run ? (
              <span>
                {run.windowTimezone} · {grainPhrase(run.periodGrain)} · registry version{" "}
                {run.registryVersion}
              </span>
            ) : (
              <span className="text-muted-foreground">Not recorded</span>
            )}
          </SheetRow>

          <SheetRow label="Limitations">
            {finding.limitations.length === 0 ? (
              <span className="text-muted-foreground">The detector stated none.</span>
            ) : (
              <ul className="space-y-1 text-muted-foreground">
                {finding.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            )}
          </SheetRow>

          <SheetRow label={`Cited evidence (${finding.evidence.length})`}>
            {finding.evidence.length === 0 ? (
              <span className="text-muted-foreground">
                This outcome states no figure, so it cites no row.
              </span>
            ) : (
              <ul className="space-y-1.5">
                {finding.evidence.map((reference) => (
                  <li key={`${reference.kind}:${reference.referenceId}`} className="flex gap-2">
                    <FileText
                      aria-hidden="true"
                      className="mt-0.5 size-3 shrink-0 text-muted-foreground/60"
                    />
                    <span>
                      {EVIDENCE_KIND_LABEL[reference.kind]}
                      <span className="text-muted-foreground">
                        {" "}
                        — {EVIDENCE_ROLE_LABEL[reference.role]}
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground/70">
                        {reference.referenceId}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SheetRow>

          <SheetRow label="Calculation digest">
            <span className="break-all font-mono text-[10px] text-muted-foreground">
              {finding.calculationDigest}
            </span>
          </SheetRow>
        </div>
      </SheetContent>
    </Sheet>
  );
}
