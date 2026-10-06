import {
  addLocalDays,
  localDaysBetween,
  enumerateLocalPeriodStarts,
  localPeriodEnd,
  localPeriodStart,
} from "@/domain/analysis/calendar";
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
  // `>` not `>=`: the database's own check is `window_end - window_start <= 400`,
  // so a span of exactly 400 is legal. Refusing it here would reject a window
  // the database would have accepted -- the opposite of what this guard is for.
  if (span < 0 || span > MAX_ANALYSIS_WINDOW_DAYS) return false;
  return segments.some((segment) => segment.start <= from && to <= segment.end);
}

/** A picked range, both ends inclusive. */
export type AnalysisWindowSelection = { from: string; to: string };

/** The latest declaration wins; a tie breaks to the finer grain. */
const GRAIN_FINENESS: readonly AnalysisGrain[] = ["day", "week", "month", "span"];

function latestWindow(windows: readonly CoverageWindow[]): CoverageWindow | null {
  const [latest] = [...windows].sort(
    (left, right) =>
      right.windowEnd.localeCompare(left.windowEnd) ||
      GRAIN_FINENESS.indexOf(left.grain) - GRAIN_FINENESS.indexOf(right.grain),
  );
  return latest ?? null;
}

/**
 * The last whole period a declaration contains, or the whole declaration when
 * it contains none.
 *
 * A span is one figure for one range, so its "last period" is the range itself:
 * there is nothing narrower that figure can fill.
 */
function lastWholePeriod(window: CoverageWindow): AnalysisWindowSelection {
  if (window.grain === "span") return { from: window.windowStart, to: window.windowEnd };
  if (window.grain === "day") {
    // Seven days ending where the evidence ends, never reaching behind its start.
    const from = addLocalDays(window.windowEnd, -6);
    return {
      from: from < window.windowStart ? window.windowStart : from,
      to: window.windowEnd,
    };
  }
  const starts = enumerateLocalPeriodStarts(window.windowStart, window.windowEnd, window.grain);
  const last = starts[starts.length - 1];
  if (last === undefined) return { from: window.windowStart, to: window.windowEnd };
  return { from: last, to: localPeriodEnd(last, window.grain) };
}

/**
 * What the picker opens on.
 *
 * The last seven days when they are covered *by a daily report* -- the grain
 * check is not incidental. Reports arrive covering periods already past, so on
 * this platform the recent past is usually unreported, and where it is
 * reported it may be reported as one monthly figure. Opening on seven days of
 * a monthly report would open the page on the warning in
 * `describeGrainMismatch`, which is a complaint, not an answer.
 *
 * Otherwise the most recent window the channel can actually answer: seven days
 * on a daily channel, the last whole month on a monthly one, the whole span on
 * a channel that files a single figure.
 */
export function defaultAnalysisWindow(input: {
  today: string;
  windows: readonly CoverageWindow[];
}): AnalysisWindowSelection | null {
  if (input.windows.length === 0) return null;

  const dayGrained = input.windows.filter((window) => window.grain === "day");
  const recent = { from: addLocalDays(input.today, -6), to: input.today };
  if (isWindowCovered(recent.from, recent.to, mergeCoverageSegments(dayGrained))) {
    return recent;
  }

  const latest = latestWindow(input.windows);
  return latest === null ? null : lastWholePeriod(latest);
}

/** Why a picked range would come back empty, and the range that would not. */
export type GrainMismatch = {
  grain: AnalysisGrain;
  declaredStart: string;
  declaredEnd: string;
  suggested: AnalysisWindowSelection;
};

function overlaps(window: CoverageWindow, from: string, to: string): boolean {
  return window.windowStart <= to && from <= window.windowEnd;
}

/**
 * Whether this declaration can put at least one whole period inside the range.
 *
 * A period counts only when it lies entirely inside both the range and the
 * declaration, which is the same rule `enumerateLocalPeriodStarts` applies:
 * reporting a week the caller asked about four days of would claim a gap
 * nobody has.
 */
function canAnswer(window: CoverageWindow, from: string, to: string): boolean {
  if (window.grain === "span") {
    // One figure for one range. It fits only if the whole of it is asked for.
    return from <= window.windowStart && window.windowEnd <= to;
  }
  const grain = window.grain;
  return enumerateLocalPeriodStarts(from, to, grain).some(
    (start) => start >= window.windowStart && localPeriodEnd(start, grain) <= window.windowEnd,
  );
}

/** The narrowest range containing the picked one that this declaration can fill. */
function widenFor(window: CoverageWindow, from: string, to: string): AnalysisWindowSelection {
  if (window.grain === "span") return { from: window.windowStart, to: window.windowEnd };
  const grain = window.grain;
  const start = localPeriodStart(from, grain);
  const end = localPeriodEnd(localPeriodStart(to, grain), grain);
  return {
    from: start < window.windowStart ? window.windowStart : start,
    to: end > window.windowEnd ? window.windowEnd : end,
  };
}

/**
 * Why a picked range would come back empty, or null when it would not.
 *
 * Silent unless *every* overlapping declaration is too coarse: a channel filing
 * three report families at once needs only one of them to be able to answer.
 * Silent too when nothing overlaps at all -- that is a coverage refusal, and
 * two complaints about one mistake is one too many.
 *
 * The declaration blamed is the one carrying the most governed rows, so the
 * warning names the report the operator is most likely to recognise.
 */
export function describeGrainMismatch(input: {
  from: string;
  to: string;
  windows: readonly CoverageWindow[];
}): GrainMismatch | null {
  const overlapping = input.windows.filter((window) => overlaps(window, input.from, input.to));
  if (overlapping.length === 0) return null;
  if (overlapping.some((window) => canAnswer(window, input.from, input.to))) return null;

  const [blamed] = [...overlapping].sort(
    (left, right) =>
      right.governedRowCount - left.governedRowCount ||
      GRAIN_FINENESS.indexOf(left.grain) - GRAIN_FINENESS.indexOf(right.grain),
  );
  return {
    grain: blamed.grain,
    declaredStart: blamed.windowStart,
    declaredEnd: blamed.windowEnd,
    suggested: widenFor(blamed, input.from, input.to),
  };
}
