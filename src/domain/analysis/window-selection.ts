import { addLocalDays, localDaysBetween } from "@/domain/analysis/calendar";
import type { AnalysisGrain } from "@/domain/analysis/types";

/**
 * Which dates a channel's approved reports declare, and whether a picked range
 * sits inside them.
 *
 * Pure calendar arithmetic on local dates, for the reason `calendar.ts` gives:
 * a period boundary was already resolved in the branch's zone when the
 * projection wrote the row, and re-deriving it through a zone here would be a
 * second opinion about a settled boundary.
 *
 * Coverage is built from *declared* package periods rather than from surviving
 * evidence rows. A package whose rows were all superseded still declared the
 * period, and a gap inside a declaration must stay selectable so the coverage
 * detector can report it. `loadAnalysisMonthTimeline` documented the same rule
 * for months; this is the same rule at day resolution.
 */

/** One unbroken stretch of declared dates, both ends inclusive. */
export type CoverageSegment = { start: string; end: string };

/** The subset of a declared package this module needs. */
export type CoverageWindow = {
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
  governedRowCount: number;
};

/**
 * A year of daily periods is the widest window worth one run, matching the
 * `window_end - window_start <= 400` check on `channel_analysis_runs`. A range
 * refused here would otherwise be refused by the database after the operator
 * had already waited for a dispatch.
 */
export const MAX_ANALYSIS_WINDOW_DAYS = 400;

/**
 * Declared periods reduced to ordered, non-overlapping, inclusive stretches.
 *
 * Stretches that merely touch are joined: 31 January and 1 February are
 * adjacent, and leaving them as two segments would grey out a boundary the
 * reports cover. Stretches with a real day between them stay apart, because
 * that day is genuinely unreported.
 */
export function mergeCoverageSegments(
  windows: readonly { windowStart: string; windowEnd: string }[],
): CoverageSegment[] {
  const sorted = [...windows]
    .map((window) => ({ start: window.windowStart, end: window.windowEnd }))
    .filter((segment) => localDaysBetween(segment.start, segment.end) >= 0)
    .sort((left, right) => left.start.localeCompare(right.start));

  const merged: CoverageSegment[] = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    // `<= addLocalDays(last.end, 1)` rather than `<= last.end`: touching is
    // contiguous, only a whole missing day separates two stretches.
    if (last && segment.start <= addLocalDays(last.end, 1)) {
      if (segment.end > last.end) last.end = segment.end;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/**
 * Whether every day of the range is declared by one single stretch.
 *
 * One stretch, not several: a range bridging the gap between two stretches is
 * not "mostly covered", it is a question the reports cannot answer, and every
 * day in the gap would be reported as absent by a run nobody should have
 * started.
 */
export function isWindowCovered(
  from: string,
  to: string,
  segments: readonly CoverageSegment[],
): boolean {
  const span = localDaysBetween(from, to);
  if (span < 0 || span >= MAX_ANALYSIS_WINDOW_DAYS) return false;
  return segments.some((segment) => segment.start <= from && to <= segment.end);
}
