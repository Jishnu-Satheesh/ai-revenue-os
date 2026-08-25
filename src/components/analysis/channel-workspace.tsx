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

import { FindingCard } from "@/components/analysis/finding-card";
import { RecommendationControls } from "@/components/analysis/recommendation-controls";
import { figureToneClass, findingValueLabel, formatCount, formatMoney, formatSignedMoney, formatWindow } from "@/components/analysis/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  SummaryTileView,
  WorkspaceChapterView,
  WorkspaceFindingView,
  WorkspaceRecommendationView,
  WorkspaceRunView,
  WorkspaceValueView,
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
};

/** The plural unit a coverage count is spoken in, matching the analysed grain. */
const GRAIN_UNIT: Readonly<Record<AnalysisGrain, string>> = {
  day: "days",
  week: "weeks",
  month: "months",
};

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
function ratioOf(
  finding: WorkspaceFindingView,
): { numerator: number; denominator: number } | null {
  // The guard mirrors the read model's own: a ratio with no recorded
  // denominator states no fraction, and reading its numerator alone would
  // invent the base it was measured over.
  return finding.value?.kind === "ratio" && finding.value.denominator > 0
    ? { numerator: finding.value.numerator, denominator: finding.value.denominator }
    : null;
}

type MoneyValue = Extract<WorkspaceValueView, { kind: "money" }>;

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
 * Prior-versus-movement comparison bars, drawn only when the detector recorded
 * a base. The prior bar is the stored base itself; the movement bar's length is
 * the stored delta against it, capped so an outlier cannot leave the frame.
 * Only stored amounts are ever printed: the current total is deliberately NOT
 * printed next to the bars, because no detector stored one and adding base and
 * delta for display would put an uncited figure on the page.
 */
function MovementComparisonBars({ value }: { value: MoneyValue }) {
  const base = value.base;
  // Without a positive recorded base there is nothing to compare against --
  // proportions of zero are how fabricated trends start.
  if (base === null || base <= 0) return null;
  const delta = value.minorUnits;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const movementWidth =
    direction === "flat" ? 100 : Math.min(Math.round((Math.abs(delta) / base) * 100), 100);

  return (
    <div
      role="img"
      aria-label={`Prior period ${formatMoney(base, value.currency)}; movement ${formatSignedMoney(delta, value.currency)}.`}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Prior period
          </span>
          <span className="text-xs font-semibold tabular-nums">
            {formatMoney(base, value.currency)}
          </span>
        </div>
        {/* Chart-token tint: a measured series, solid, per the chart grammar. */}
        <div className="h-3 w-full rounded-sm bg-chart-1" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {direction === "down" ? "Lost since" : direction === "up" ? "Gained since" : "Change"}
          </span>
          <span
            className={`text-xs font-semibold tabular-nums ${
              direction === "down" ? "text-destructive" : direction === "up" ? "text-primary" : ""
            }`}
          >
            {formatSignedMoney(delta, value.currency)}
          </span>
        </div>
        {direction === "flat" ? (
          // Level reads as a full-length quiet bar, not a zero-width sliver
          // that could be mistaken for a rendering failure.
          <div className="h-3 w-full rounded-sm border border-dashed border-border bg-muted" />
        ) : (
          <div
            className={`h-3 rounded-sm ${direction === "down" ? "bg-destructive" : "bg-chart-4"}`}
            style={{ width: `${movementWidth}%` }}
          />
        )}
      </div>
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
 * Retention as a pair of columns sized by the stored share. Only the returning
 * count is printed -- it is the number the detector stored. The remainder's
 * height is geometry, and printing a subtracted "new" figure next to it would
 * be arithmetic the detector never declared.
 */
function RepeatMixColumns({
  numerator,
  denominator,
}: {
  numerator: number;
  denominator: number;
}) {
  const returningPercent = Math.max(Math.round((numerator / denominator) * 100), 4);
  return (
    <div
      role="img"
      aria-label={`${numerator} of ${denominator} orders came from returning customers.`}
      className="flex flex-col gap-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Returning vs new orders
        </span>
        <span className="text-[11px] font-semibold tabular-nums">
          {formatCount(numerator)} of {formatCount(denominator)}
        </span>
      </div>
      <div className="flex h-28 items-end gap-2">
        <div className="flex h-full flex-1 flex-col justify-end rounded-t-sm bg-muted">
          <div
            className="flex items-start justify-center bg-chart-2 pt-1.5"
            style={{ height: `${returningPercent}%` }}
          >
            <span className="text-[10px] font-bold tabular-nums text-white">
              {formatCount(numerator)}
            </span>
          </div>
        </div>
        <span className="self-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Returning
        </span>
        <div className="h-full flex-1 self-end rounded-t-sm border border-border bg-background" />
        <span className="self-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          New
        </span>
      </div>
    </div>
  );
}

/**
 * Funnel stages drawn from the stored stage-pair ratios alone. Each block's
 * width is its recorded denominator against the widest recorded one, and the
 * fill inside is the recorded conversion. Stage names are not stored anywhere,
 * so the rows are ordinal rather than named -- naming them would fabricate
 * vocabulary the provider never wrote.
 */
function FunnelStages({ findings }: { findings: readonly WorkspaceFindingView[] }) {
  const stages = findings
    .map((finding) => ({ finding, ratio: ratioOf(finding) }))
    .filter((stage): stage is { finding: WorkspaceFindingView; ratio: { numerator: number; denominator: number } } =>
      Boolean(stage.ratio),
    )
    .sort((left, right) => right.ratio.denominator - left.ratio.denominator);
  if (stages.length === 0) return null;
  const widest = stages[0].ratio.denominator;

  return (
    <div className="flex flex-col gap-3">
      {stages.map(({ finding, ratio }, index) => {
        const widthPercent = Math.max(Math.round((ratio.denominator / widest) * 100), 12);
        const conversion = Math.round((ratio.numerator / ratio.denominator) * 100);
        const isEndToEnd = finding.code === "FUNNEL_STAGE_CONVERSION_END_TO_END";
        return (
          <div key={finding.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {isEndToEnd ? "Impression to order" : `Stage pair ${index + 1}`}
              </span>
              <span className="text-[11px] font-semibold tabular-nums">
                {formatCount(ratio.numerator)} of {formatCount(ratio.denominator)}
              </span>
            </div>
            <div
              role="img"
              aria-label={`${isEndToEnd ? "End to end" : `Stage pair ${index + 1}`}: ${conversion} percent.`}
              className="h-9 overflow-hidden rounded-lg bg-muted"
              style={{ width: `${widthPercent}%` }}
            >
              <div
                className={`flex h-full items-center px-3 ${isEndToEnd ? "bg-chart-4" : "bg-chart-2"}`}
                style={{ width: `${Math.max(conversion, 6)}%` }}
              >
                <span className="text-[10px] font-bold tabular-nums text-white">{conversion}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The visualization slot of a chapter card, assembled purely from the
 * chapter's own stored findings. Chapters whose findings carry no drawable
 * ratio render nothing here -- the rail already shows their figures, and an
 * empty decorated box would imply measurement that did not happen.
 */
function ChapterVisual({ chapter }: { chapter: WorkspaceChapterView }) {
  if (chapter.id === "funnel") return <FunnelStages findings={chapter.findings} />;

  const blocks: React.ReactNode[] = [];
  for (const finding of chapter.findings) {
    if (finding.code === "CUSTOMER_REPEAT_SHARE") {
      const ratio = ratioOf(finding);
      if (ratio)
        blocks.push(<RepeatMixColumns key={finding.id} numerator={ratio.numerator} denominator={ratio.denominator} />);
      continue;
    }
    if (finding.detectorKey === "revenue.period_movement") {
      // The movement is drawn once, in the verdict band, where the window's
      // headline lives; drawing it again here would duplicate a figure.
      continue;
    }
    const ratio = ratioOf(finding);
    if (ratio)
      blocks.push(
        <RatioSplitBar key={finding.id} label={vizLabel(finding)} numerator={ratio.numerator} denominator={ratio.denominator} />,
      );
  }
  if (blocks.length === 0) return null;
  return <div className="grid gap-6 sm:grid-cols-2">{blocks}</div>;
}

// ---------------------------------------------------------------------------
// Verdict band
// ---------------------------------------------------------------------------

/**
 * One briefing figure row: the stored amount, or the em-dash and the reason it
 * cannot be stated. This row is where the platform keeps its promise that an
 * unavailable figure is explained rather than silently blank or zero.
 */
function BriefingRow({
  tile,
  onInspect,
}: {
  tile: SummaryTileView;
  onInspect: (findingId: string) => void;
}) {
  return (
   <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{tile.label}</span>
        {tile.findingId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Inspect the evidence behind ${tile.label.toLowerCase()}`}
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => onInspect(tile.findingId as string)}
          >
            <Fingerprint aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {tile.value?.kind === "money" ? (
        // Emerald marks a primary earned fact, per the design system; the
        // figure itself is formatted exactly as `formatMoney` states it.
        <span className="text-xl font-semibold tabular-nums text-primary">
          {formatMoney(tile.value.minorUnits, tile.value.currency)}
        </span>
      ) : (
        <span className="flex flex-wrap items-baseline gap-2">
          <span aria-hidden="true" className="text-xl font-semibold text-muted-foreground">
            —
          </span>
          <span className="max-w-sm text-[11px] leading-snug text-muted-foreground">
            {tile.unavailableReason}
          </span>
        </span>
      )}
      {tile.value?.kind === "money" && tile.coverage ? (
        <span className="w-full text-right text-[11px] tabular-nums text-muted-foreground">
          over {tile.coverage.observed} of {tile.coverage.expected} periods
        </span>
      ) : null}
    </div>
  );
}

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
  onInspect,
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
  onInspect: (findingId: string) => void;
}) {
  const movement = view.chapters
    .flatMap((chapter) => chapter.findings)
    .find((finding) => finding.detectorKey === "revenue.period_movement");
  const movementValue = movement?.value?.kind === "money" ? movement.value : null;
  // The bars exist only when the detector recorded a base; otherwise the band
  // says plainly that no comparison is available, rather than drawing one bar
  // and leaving the reader to guess what it was measured against.
  const movementBase = movementValue?.base ?? null;
  const hasComparison = movementBase !== null && movementBase > 0;

  return (
    <section
      aria-label="Marketplace audit verdict"
      // The one background emphasis the design system allows, spent here on
      // the band the whole page answers to.
      className="rounded-xl border border-border bg-primary/[0.03] p-6 lg:p-8"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck aria-hidden="true" className="size-4" />
            </span>
            <Kicker>Marketplace audit verdict</Kicker>
          </div>

          <p className="max-w-2xl text-2xl font-semibold leading-snug tracking-tight lg:text-[28px]">
            {view.verdict.headlineSentence}
          </p>

          <div className="flex flex-col gap-4 border-t border-border pt-5">
            <Kicker>Evidence briefing</Kicker>
            <div className="flex flex-col gap-3">
              {view.summaryTiles.map((tile) => (
                <BriefingRow key={tile.label} tile={tile} onInspect={onInspect} />
              ))}
            </div>
          </div>

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
          {hasComparison && movementValue ? (
            <MovementComparisonBars value={movementValue} />
          ) : (
            // An honest absence: the same sentence the verdict badges use, so
            // the empty half of the band explains itself instead of looking
            // like a chart that failed to load.
            <p className="flex min-h-24 items-center rounded-lg border border-dashed border-border bg-card/60 px-4 text-xs leading-relaxed text-muted-foreground">
              {view.verdict.badges[1]}
            </p>
          )}

          <div className="mt-auto flex flex-col gap-2">
            {evidenceWindows.length > 0 ? (
              <>
                <Select
                  value={selectedWindowId ?? undefined}
                  onValueChange={onSelectWindow}
                >
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
                    {selectedWindow.sourceFilename ? `From ${selectedWindow.sourceFilename}. ` : null}
                    The window an approved report declared, in {selectedWindow.timeZone}. Days the
                    provider left blank are counted as absent, not as zero.
                  </p>
                ) : null}
                {canRunAnalysis ? (
                  <Button type="button" size="sm" className="self-start" disabled={pending} onClick={onRunAnalysis}>
                    {pending ? "Starting…" : "Run analysis"}
                  </Button>
                ) : null}
              </>
            ) : (
              // Not a disabled button. An operator staring at one cannot tell
              // whether the platform is busy, broken, or waiting on them.
              <p className="text-[11px] leading-snug text-muted-foreground">
                There is no window to analyse yet. An approved report has to write governed
                evidence for this channel before an analysis has anything to run over.
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
        {chapter.state === "not_run" ? (
          <Database className="size-4" />
        ) : (
          <CircleDashed className="size-4" />
        )}
      </span>
      <p className="text-sm font-semibold">
        {chapter.state === "not_run" ? "Not analysed yet" : "Waiting on evidence"}
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
    finding.detail ??
    (value || finding.value ? null : "This outcome states no figure.");
  return (
    <button
      type="button"
      onClick={() => onInspect(finding.id)}
      className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs font-semibold">{finding.headline}</span>
        {value ? (
          <span className={`shrink-0 text-xs font-semibold tabular-nums ${figureToneClass(finding)}`}>
            {value}
          </span>
        ) : (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">—</span>
        )}
      </span>
      {reason ? <span className="text-[11px] leading-snug text-muted-foreground">{reason}</span> : null}
    </button>
  );
}

function chapterDescription(chapter: WorkspaceChapterView): string | null {
  switch (chapter.id) {
    case "summary":
      return "The window's headline facts, each cited to stored evidence.";
    case "funnel":
      return "Conversion between the funnel stages the reports recorded.";
    case "operations":
      return "Cancellations and closed time, as the provider wrote them.";
    case "trust":
      // Named inline in CardContent with the platform's exact section label,
      // so the card leads with the vocabulary operators know from elsewhere.
      return null;
    default:
      return null;
  }
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
  const coverageRatio = coverageFinding && coverageFinding.kind !== "needs_data" ? ratioOf(coverageFinding) : null;
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
      <div className="flex items-start gap-3">
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
      </div>

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
        onInspect={inspect}
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
              {view.run.periodGrain} periods
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
        {view.runs.find((run) => run.status === "failed") ? (
          <span className="text-warning">
            The last attempt failed:{" "}
            {view.runs.find((run) => run.status === "failed")?.safeFailureCode}
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
        {inlineChapters.map((chapter, index) => (
          <ChapterShell
            key={chapter.id}
            chapter={chapter}
            number={index + 1}
            heldFinding={chapter.id === "trust" ? (heldFinding ?? null) : null}
            coverageFinding={chapter.id === "trust" ? (coverageFinding ?? null) : null}
            onInspect={inspect}
            recommendations={chapterRecommendations(chapter)}
            organizationId={organizationId}
          />
        ))}
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
}: {
  chapter: WorkspaceChapterView;
  number: number;
  heldFinding: WorkspaceFindingView | null;
  coverageFinding: WorkspaceFindingView | null;
  onInspect: (findingId: string) => void;
  recommendations: readonly WorkspaceRecommendationView[];
  organizationId: string;
}) {
  const coverageRatio =
    coverageFinding && coverageFinding.kind !== "needs_data" ? ratioOf(coverageFinding) : null;

  return (
    <section
      id={chapter.id}
      aria-label={`${chapter.navLabel} chapter`}
      className="grid scroll-mt-24 grid-cols-1 gap-6 lg:grid-cols-12"
    >
      <Card className="lg:col-span-8">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {`${String(number).padStart(2, "0")} · ${chapter.heading}`}
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
            <ChapterVisual chapter={chapter} />
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

      <aside
        aria-label={`${chapter.navLabel} figures`}
        className="flex flex-col gap-4 lg:col-span-4"
      >
        {chapter.findings.length > 0 ? (
          <>
            <FindingCard finding={chapter.findings[0]} onInspect={onInspect} />
            {recommendations.length > 0 ? (
              <div className="flex flex-col gap-3">
                {recommendations.map((recommendation) => (
                  <RecommendationControls
                    key={recommendation.id}
                    organizationId={organizationId}
                    recommendation={recommendation}
                  />
                ))}
              </div>
            ) : null}
            {chapter.findings.length > 1 ? (
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {chapter.findings.slice(1).map((finding) => (
                  <CompactFindingRow key={finding.id} finding={finding} onInspect={onInspect} />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            {chapter.state === "not_run"
              ? "Figures appear here once an analysis has run over this channel."
              : "Figures appear here once the missing evidence is written."}
          </p>
        )}
      </aside>
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
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
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
                {run.windowTimezone} · {run.periodGrain} periods · registry version{" "}
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
                    <FileText aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" />
                    <span>
                      {EVIDENCE_KIND_LABEL[reference.kind]}
                      <span className="text-muted-foreground"> — {EVIDENCE_ROLE_LABEL[reference.role]}</span>
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
