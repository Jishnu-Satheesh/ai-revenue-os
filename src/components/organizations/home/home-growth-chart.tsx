"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import { formatWholeMoney } from "@/components/analysis/format";
import styles from "@/components/organizations/home/organization-home.module.css";
import type {
  GrowthProgressPointView,
  GrowthProgressView,
} from "@/modules/organizations/application/growth-progress-view";

/**
 * Current-vs-projected plotting for the Overview growth section (V04).
 *
 * Like two race lines on the same photo-finish paper: one shared time scale,
 * one shared money scale, solid blue for measured revenue, dashed emerald for
 * the frozen estimate. The blue line stops at the latest fully supported
 * observation — it is never extended, extrapolated or forward-filled.
 *
 * Task 6 owns the sparse static render (labels, guide, bracket). Hover, pin,
 * keyboard, horizon switching and the method dialog arrive in Task 7 on this
 * same file.
 */

/** Section-scoped series tokens (V02). Light values are exact; dark adapts in CSS. */
export const GROWTH_CURRENT = "#2563EB";
export const GROWTH_CURRENT_TEXT = "#173F83";
export const GROWTH_PROJECTED = "#08785A";
export const GROWTH_CURRENT_DARK = "#79A8FF";
export const GROWTH_PROJECTED_DARK = "#69CFAC";

const PROJECTED_DASH = "7 6";
const DOT_RADIUS = 5;
/**
 * Chart-internal type sizes are CSS-driven (V02: 12px normal desktop, 16px
 * canonical ≥1440) so the container query can switch them. Never set
 * fontSize props on ticks, point labels or endpoint words.
 */
/** Projected labels sit above their dot, current below — swapped when blue runs higher. */
const PROJECTED_LABEL_DY = -12;
const CURRENT_LABEL_DY = 16;
/** Endpoint "Current"/"Projected" words follow their dots with this gap. */
const ENDPOINT_LABEL_DX = 12;

export const CHART_FALLBACK_WIDTH = 720;
export const CHART_HEIGHT = 340;

function majorExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export function toMajorUnits(minorUnits: number, currency: string): number {
  return minorUnits / 10 ** majorExponent(currency);
}

/**
 * Compact chart amounts: 18,000 → "18k", 120,000 → "120k", 1,500,000 →
 * "1.5M". One decimal only when it distinguishes the value; whole thousands
 * stay clean so sparse labels never collide by rounding.
 */
export function formatCompactMoney(minorUnits: number, currency: string): string {
  const major = toMajorUnits(minorUnits, currency);
  const sign = major < 0 ? "−" : "";
  const absolute = Math.abs(major);
  const trimmed = (value: number): string =>
    Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (absolute >= 1_000_000) return `${sign}${trimmed(Math.round(absolute / 100_000) / 10)}M`;
  if (absolute >= 1_000) return `${sign}${trimmed(Math.round(absolute / 100) / 10)}k`;
  return `${sign}${trimmed(Math.round(absolute * 10) / 10)}`;
}

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "2026-09-21" → "21 Sep". Fixed English abbreviations (en-GB shortens September to "Sept"). */
export function formatShortDate(isoDate: string): string {
  const date = utcDate(isoDate);
  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth() as number]}`;
}

/** "2026-09-01" → "1 Sep" (footer stamps carry no year, matching the reference). */
export function formatFooterDay(isoDate: string): string {
  return formatShortDate(isoDate);
}

/** "2026-09-21" → "21 SEP" for the advice eyebrow. */
export function formatAsOfDay(isoDate: string): string {
  return formatShortDate(isoDate).toUpperCase();
}

/**
 * Nice y scale with four intervals by default: the fixture's 0–120,000
 * yields exactly 0/40k/80k/120k. Always includes zero and every plotted value
 * (reported actuals plus the frozen central estimate); negative actual
 * adjustments expand the domain below zero instead of clipping. The low/high
 * scenario bounds stay stored and readable in the tooltip and method table
 * (Task 7) rather than stretching this scale — the approved reference itself
 * tops its grid at the 120k central point while the 128k high bound remains
 * a stored number. Returns major units for direct Recharts use.
 */
export function growthNiceTicks(
  minMinor: number,
  maxMinor: number,
  currency: string,
): { domain: [number, number]; ticks: number[] } {
  const toMajor = (minor: number) => toMajorUnits(minor, currency);
  const span = Math.max(toMajor(maxMinor) - toMajor(minMinor), 1);
  const magnitude = 10 ** Math.floor(Math.log10(span / 4));
  const normalized = span / 4 / magnitude;
  // Ceiling ladder tuned so the fixture span (18k–120k plotted, norm 2.55)
  // lands on the approved 40k step rather than 25k or 30k.
  const niceFactor =
    normalized >= 10 ? 10 : normalized >= 5 ? 5 : normalized >= 2 ? 4 : 1;
  let step = niceFactor * magnitude;
  let low = Math.min(0, Math.floor(toMajor(minMinor) / step) * step);
  let high = Math.max(1, Math.ceil(toMajor(maxMinor) / step) * step);
  let ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) {
    ticks.push(Math.round(value * 1e9) / 1e9);
  }
  while (ticks.length > 8) {
    step *= 2;
    low = Math.min(0, Math.floor(toMajor(minMinor) / step) * step);
    high = Math.max(1, Math.ceil(toMajor(maxMinor) / step) * step);
    ticks = [];
    for (let value = low; value <= high + step / 2; value += step) {
      ticks.push(Math.round(value * 1e9) / 1e9);
    }
  }
  return { domain: [low, high], ticks };
}

export type GrowthLabelSide = "above" | "below";

/**
 * V04 collision rule for one date carrying both values: projected above and
 * current below while blue runs lower; swapped while blue runs higher; the
 * current label hides on exact equality so two words never print on one dot.
 */
export function placeGrowthPairLabels(
  currentMinor: number | null,
  projectedCentralMinor: number | null,
): { current: GrowthLabelSide | "hidden"; projected: GrowthLabelSide | "hidden" } {
  if (currentMinor === null || projectedCentralMinor === null) {
    return {
      current: currentMinor === null ? "hidden" : "below",
      projected: projectedCentralMinor === null ? "hidden" : "above",
    };
  }
  if (currentMinor === projectedCentralMinor) return { current: "hidden", projected: "above" };
  if (currentMinor < projectedCentralMinor) return { current: "below", projected: "above" };
  return { current: "above", projected: "below" };
}

/**
 * Endpoint "Current"/"Projected" words share one row per series unless both
 * series end on the same date within a hair of each other, in which case the
 * current word steps up a row instead of printing over the projected one.
 */
export function placeEndpointLabels(options: {
  currentEndDate: string | null;
  currentEndMinor: number | null;
  projectedEndDate: string | null;
  projectedEndMinor: number | null;
  domainSpanMinor: number;
}): { currentDy: number; projectedDy: number } {
  const { currentEndDate, currentEndMinor, projectedEndDate, projectedEndMinor } = options;
  if (
    currentEndDate !== null &&
    currentEndDate === projectedEndDate &&
    currentEndMinor !== null &&
    projectedEndMinor !== null &&
    Math.abs(currentEndMinor - projectedEndMinor) < options.domainSpanMinor * 0.08
  ) {
    return { currentDy: -18, projectedDy: 4 };
  }
  return { currentDy: 4, projectedDy: 4 };
}

/** Bracket label sits right of the latest-date bracket, left when the bracket hugs the right edge. */
export function bracketLabelAnchor(
  latestMs: number,
  startMs: number,
  endMs: number,
): "left" | "right" {
  return latestMs > startMs + (endMs - startMs) * 0.8 ? "left" : "right";
}

export type GrowthChartRow = {
  t: number;
  date: string;
  current: number | null;
  projected: number | null;
  currentMinor: number | null;
  projectedCentralMinor: number | null;
};

/**
 * V05 tooltip content for one date. Difference is null whenever the current
 * value is unavailable — a future date or a coverage gap never gets a
 * fabricated current value, so there is nothing to subtract.
 */
export type GrowthTooltipModel = {
  date: string;
  currentMinor: number | null;
  projectedLowMinor: number | null;
  projectedCentralMinor: number | null;
  projectedHighMinor: number | null;
  differenceMinor: number | null;
  reasonCode: GrowthProgressPointView["reasonCode"];
};

export function growthTooltipForDate(
  view: GrowthProgressView,
  date: string,
): GrowthTooltipModel | null {
  const point = view.points.find((candidate) => candidate.date === date) ?? null;
  if (point === null) return null;
  const currentMinor =
    point.currentMinor !== null && point.currentCoverage === "complete"
      ? point.currentMinor
      : null;
  return {
    date: point.date,
    currentMinor,
    projectedLowMinor: point.projectedLowMinor,
    projectedCentralMinor: point.projectedCentralMinor,
    projectedHighMinor: point.projectedHighMinor,
    differenceMinor:
      currentMinor !== null && point.projectedCentralMinor !== null
        ? currentMinor - point.projectedCentralMinor
        : null,
    reasonCode: point.reasonCode,
  };
}

/** One announcement sentence for the live region per intentional selection. */
export function describeGrowthTooltip(model: GrowthTooltipModel, currency: string): string {
  const parts = [formatShortDate(model.date)];
  parts.push(
    model.currentMinor !== null
      ? `Current ${formatWholeMoney(model.currentMinor, currency)}`
      : "Current not reported",
  );
  if (model.projectedCentralMinor !== null) {
    parts.push(`Projected ${formatWholeMoney(model.projectedCentralMinor, currency)}`);
  }
  if (model.projectedLowMinor !== null && model.projectedHighMinor !== null) {
    parts.push(
      `Range ${formatWholeMoney(model.projectedLowMinor, currency)} to ${formatWholeMoney(model.projectedHighMinor, currency)}`,
    );
  }
  if (model.differenceMinor !== null && model.differenceMinor !== 0) {
    parts.push(
      `${formatWholeMoney(Math.abs(model.differenceMinor), currency)} ${model.differenceMinor > 0 ? "ahead" : "behind"}`,
    );
  } else if (model.differenceMinor === 0) {
    parts.push("Matches the estimate");
  }
  return `${parts.join(". ")}.`;
}

/**
 * V04 deterministic label thinning for dense real data: at most maxLabels
 * dates keep point labels and x ticks. The first date, the latest comparable
 * date and the final projection always survive; interior dates fill in on an
 * even round-robin. Sparse fixtures (≤ maxLabels) keep every label.
 */
export function selectGrowthLabelDates(
  dates: readonly string[],
  latestDate: string | null,
  maxLabels: number,
): string[] {
  if (dates.length <= maxLabels) return [...dates];
  const first = dates[0] as string;
  const last = dates[dates.length - 1] as string;
  const picked = new Set<string>([first, last]);
  if (latestDate !== null && dates.includes(latestDate)) picked.add(latestDate);
  const step = (dates.length - 1) / (maxLabels - 1);
  for (let slot = 1; slot < maxLabels && picked.size < maxLabels; slot += 1) {
    picked.add(dates[Math.round(slot * step)] as string);
  }
  return dates.filter((date) => picked.has(date));
}

/** Narrow viewports (V03 <560) read at most four x ticks. Viewport is the
 *  practical proxy here: the card fills it on phones. Server render is wide. */
function useNarrowGrowthViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return;
    const query = window.matchMedia("(max-width: 559px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/**
 * One row per view point in chronological order. Current stays null wherever
 * coverage is not complete — including every future date — so the blue line
 * breaks instead of bridging the gap. Projected carries the frozen central
 * estimate only.
 */
export function buildGrowthChartRows(
  points: readonly GrowthProgressPointView[],
  currency: string,
): GrowthChartRow[] {
  return [...points]
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))
    .map((point) => ({
      t: utcDate(point.date).getTime(),
      date: point.date,
      current:
        point.currentMinor !== null && point.currentCoverage === "complete"
          ? toMajorUnits(point.currentMinor, currency)
          : null,
      projected:
        point.projectedCentralMinor !== null
          ? toMajorUnits(point.projectedCentralMinor, currency)
          : null,
      currentMinor:
        point.currentMinor !== null && point.currentCoverage === "complete"
          ? point.currentMinor
          : null,
      projectedCentralMinor: point.projectedCentralMinor,
    }));
}

function useMeasuredWidth(fallback: number): { ref: React.RefObject<HTMLDivElement | null>; width: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const measured = element.clientWidth;
      if (measured > 0) setWidth(measured);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

type GlyphProps = {
  cx?: number | string;
  cy?: number | string;
  index?: number;
  payload?: GrowthChartRow;
};

function toNumber(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function CurrentGlyph({
  cx,
  cy,
  payload,
  labelSide,
  showEndpointWord,
  endpointDy,
  currency,
  onSelectDate,
  onHoverDate,
}: GlyphProps & {
  labelSide: GrowthLabelSide | "hidden";
  showEndpointWord: boolean;
  endpointDy: number;
  currency: string;
  onSelectDate: (date: string) => void;
  onHoverDate: (date: string | null) => void;
}) {
  const x = toNumber(cx);
  const y = toNumber(cy);
  if (x === null || y === null || !payload || payload.currentMinor === null) return <g />;
  const label = formatCompactMoney(payload.currentMinor, currency);
  const full = formatWholeMoney(payload.currentMinor, currency);
  const labelY = y + (labelSide === "above" ? PROJECTED_LABEL_DY : CURRENT_LABEL_DY + 4);
  const date = payload.date;
  return (
    <g
      onClick={() => onSelectDate(date)}
      onMouseEnter={() => onHoverDate(date)}
      style={{ cursor: "pointer" }}
    >
      <circle cx={x} cy={y} r={14} fill="transparent" stroke="none" />
      <circle
        className={styles.growthCurrentDot}
        cx={x}
        cy={y}
        r={DOT_RADIUS}
        fill={GROWTH_CURRENT}
        stroke="#ffffff"
        strokeWidth={2}
      />
      {labelSide === "hidden" ? null : (
        <text
          className={styles.growthCurrentLabel}
          x={x}
          y={labelY}
          textAnchor="middle"
          fontWeight={500}
          fill={GROWTH_CURRENT_TEXT}
        >
          <title>{`${full} current on ${formatShortDate(payload.date)}`}</title>
          {label}
        </text>
      )}
      {showEndpointWord ? (
        <text
          className={styles.growthCurrentWord}
          x={x + ENDPOINT_LABEL_DX}
          y={y + endpointDy}
          textAnchor="start"
          fontWeight={500}
          fill={GROWTH_CURRENT}
        >
          Current
        </text>
      ) : null}
    </g>
  );
}

function ProjectedGlyph({
  cx,
  cy,
  payload,
  labelSide,
  showEndpointWord,
  endpointDy,
  currency,
  onSelectDate,
  onHoverDate,
}: GlyphProps & {
  labelSide: GrowthLabelSide | "hidden";
  showEndpointWord: boolean;
  endpointDy: number;
  currency: string;
  onSelectDate: (date: string) => void;
  onHoverDate: (date: string | null) => void;
}) {
  const x = toNumber(cx);
  const y = toNumber(cy);
  if (x === null || y === null || !payload || payload.projectedCentralMinor === null) {
    return <g />;
  }
  const label = formatCompactMoney(payload.projectedCentralMinor, currency);
  const full = formatWholeMoney(payload.projectedCentralMinor, currency);
  const labelY = y + (labelSide === "above" ? PROJECTED_LABEL_DY : CURRENT_LABEL_DY + 4);
  const date = payload.date;
  return (
    <g
      onClick={() => onSelectDate(date)}
      onMouseEnter={() => onHoverDate(date)}
      style={{ cursor: "pointer" }}
    >
      <circle cx={x} cy={y} r={14} fill="transparent" stroke="none" />
      <circle
        className={styles.growthProjectedDot}
        cx={x}
        cy={y}
        r={DOT_RADIUS}
        fill="#ffffff"
        stroke={GROWTH_PROJECTED}
        strokeWidth={2.5}
      />
      {labelSide === "hidden" ? null : (
        <text
          className={styles.growthProjectedLabel}
          x={x}
          y={labelY}
          textAnchor="middle"
          fontWeight={500}
          fill={GROWTH_PROJECTED}
        >
          <title>{`${full} projected on ${formatShortDate(payload.date)}`}</title>
          {label}
        </text>
      )}
      {showEndpointWord ? (
        <text
          className={styles.growthProjectedWord}
          x={x + ENDPOINT_LABEL_DX}
          y={y + endpointDy}
          textAnchor="start"
          fontWeight={500}
          fill={GROWTH_PROJECTED}
        >
          Projected
        </text>
      ) : null}
    </g>
  );
}

function chartAriaLabel(view: GrowthProgressView, currency: string): string {
  const current = view.points
    .filter((point) => point.currentMinor !== null && point.currentCoverage === "complete")
    .map(
      (point) =>
        `${formatShortDate(point.date)} ${formatWholeMoney(point.currentMinor as number, currency)}`,
    )
    .join(", ");
  const projected = view.points
    .filter((point) => point.projectedCentralMinor !== null)
    .map(
      (point) =>
        `${formatShortDate(point.date)} ${formatWholeMoney(point.projectedCentralMinor as number, currency)}`,
    )
    .join(", ");
  return `Current (reported revenue): ${current || "none"}. Projected (frozen estimate): ${projected || "none"}.`;
}

/**
 * Summaries plus the two-line chart for one ready growth view. Both summaries
 * stay pinned to the latest comparable date; the chart labels every sparse
 * point and stops the blue line where complete coverage stops.
 *
 * V05 interaction state machine lives here: hovering a date shows a transient
 * tooltip and crosshair, tapping/clicking pins it, a second tap or Escape
 * dismisses, and the keyboard walks every chronological date. Exploring never
 * moves the summaries or the right panel — those stay at the latest report,
 * so incidental hovering cannot present an old date as today's evidence.
 */
export function HomeGrowthChart({ view }: Readonly<{ view: GrowthProgressView }>) {
  const currency = view.currency ?? "AED";
  const rows = buildGrowthChartRows(view.points, currency);
  const { ref, width } = useMeasuredWidth(CHART_FALLBACK_WIDTH);
  const narrow = useNarrowGrowthViewport();
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dates = rows.map((row) => row.date);
  const activeDate = hoverDate ?? pinnedDate;
  const activeModel = activeDate !== null ? growthTooltipForDate(view, activeDate) : null;

  const announce = (date: string) => {
    const model = growthTooltipForDate(view, date);
    if (model !== null) setAnnouncement(describeGrowthTooltip(model, currency));
  };
  const selectDate = (date: string) => {
    // A second tap on the pinned date dismisses it.
    setPinnedDate((pinned) => (pinned === date ? null : date));
    setHoverDate(null);
    announce(date);
  };
  const stepDate = (direction: 1 | -1) => {
    if (dates.length === 0) return;
    const from = activeDate ?? (direction === 1 ? dates[0] : dates[dates.length - 1]);
    const index = dates.indexOf(from as string);
    const next =
      activeDate === null
        ? (dates[direction === 1 ? 0 : dates.length - 1] as string)
        : (dates[Math.min(dates.length - 1, Math.max(0, index + direction))] as string);
    setHoverDate(next);
    announce(next);
  };
  const onChartKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        stepDate(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        stepDate(-1);
        break;
      case "Home":
        event.preventDefault();
        if (dates.length > 0) {
          const first = dates[0] as string;
          setHoverDate(first);
          announce(first);
        }
        break;
      case "End":
        event.preventDefault();
        if (dates.length > 0) {
          const last = dates[dates.length - 1] as string;
          setHoverDate(last);
          announce(last);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (activeDate !== null) selectDate(activeDate);
        break;
      case "Escape":
        setPinnedDate(null);
        setHoverDate(null);
        setAnnouncement("Date selection cleared.");
        break;
      default:
        break;
    }
  };

  const latest = rows.find((row) => row.date === view.latestComparableDate) ?? null;
  const latestSummaryDate =
    view.latestComparableDate !== null ? formatShortDate(view.latestComparableDate) : null;
  const latestCurrent = latest?.currentMinor ?? null;
  const latestProjected = latest?.projectedCentralMinor ?? null;

  const minors = view.points.flatMap((point) =>
    [point.currentMinor, point.projectedCentralMinor].filter(
      (value): value is number => value !== null,
    ),
  );
  const { domain, ticks } = growthNiceTicks(
    Math.min(0, ...minors),
    Math.max(0, ...minors),
    currency,
  );

  const startMs = utcDate(view.period.startDate).getTime();
  const endMs = utcDate(view.period.endDateExclusive).getTime();
  // Dense series thin to ≤6 labelled dates (≤4 on narrow phones); the first,
  // latest comparable and final dates always survive.
  const labelDates = new Set(
    selectGrowthLabelDates(dates, view.latestComparableDate, narrow ? 4 : 6),
  );
  const tickValues = rows.filter((row) => labelDates.has(row.date)).map((row) => row.t);
  // Tooltip placement rides the shared time scale as a percentage, flipping
  // to the left of the date past 70% so it never collides with the edge.
  const activeT = activeDate !== null ? utcDate(activeDate).getTime() : null;
  const activeFraction =
    activeT !== null && endMs > startMs
      ? Math.min(1, Math.max(0, (activeT - startMs) / (endMs - startMs)))
      : null;

  let lastCurrentIndex = -1;
  let lastProjectedIndex = -1;
  rows.forEach((row, index) => {
    if (row.currentMinor !== null) lastCurrentIndex = index;
    if (row.projectedCentralMinor !== null) lastProjectedIndex = index;
  });
  const domainSpanMinor = Math.max(0, ...minors) - Math.min(0, ...minors);
  const endpointPlacement = placeEndpointLabels({
    currentEndDate: rows[lastCurrentIndex]?.date ?? null,
    currentEndMinor: rows[lastCurrentIndex]?.currentMinor ?? null,
    projectedEndDate: rows[lastProjectedIndex]?.date ?? null,
    projectedEndMinor: rows[lastProjectedIndex]?.projectedCentralMinor ?? null,
    domainSpanMinor: domainSpanMinor === 0 ? 1 : domainSpanMinor,
  });

  const comparison = view.latestComparison;
  const bracketValues =
    comparison !== null &&
    comparison.state !== "equal" &&
    comparison.state !== "unavailable" &&
    comparison.differenceMinor !== null &&
    comparison.differenceMinor !== 0 &&
    latest !== null &&
    latest.current !== null &&
    latest.projected !== null
      ? {
          t: latest.t,
          current: latest.current,
          projected: latest.projected,
          differenceMinor: comparison.differenceMinor,
          ahead: comparison.state === "ahead",
        }
      : null;
  const bracketWord = bracketValues?.ahead ? "ahead" : "gap";
  const bracketLabel =
    bracketValues !== null
      ? `${currency} ${formatCompactMoney(Math.abs(bracketValues.differenceMinor), currency)} ${bracketWord}`
      : "";
  const bracketAnchor =
    view.latestComparableDate !== null
      ? bracketLabelAnchor(utcDate(view.latestComparableDate).getTime(), startMs, endMs)
      : "right";

  return (
    <div className={styles.growthChartBlock}>
      <dl className={styles.growthSummaries}>
        <div className={styles.growthSummary}>
          <dt className={styles.growthSummaryLabel}>
            <span className={styles.growthLegendDotFilled} aria-hidden="true" />
            <span>{latestSummaryDate ? `Current · ${latestSummaryDate}` : "Current"}</span>
          </dt>
          <dd className={styles.growthSummaryCurrent}>
            {latestCurrent !== null ? formatWholeMoney(latestCurrent, currency) : "Awaiting reports"}
          </dd>
        </div>
        <div className={styles.growthSummary}>
          <dt className={styles.growthSummaryLabel}>
            <span className={styles.growthLegendDotHollow} aria-hidden="true" />
            <span>{latestSummaryDate ? `Projected · ${latestSummaryDate}` : "Projected"}</span>
          </dt>
          <dd className={styles.growthSummaryProjected}>
            {latestProjected !== null
              ? formatWholeMoney(latestProjected, currency)
              : "Projection not set"}
          </dd>
          <dd className={styles.growthSummaryEstimate}>Estimate</dd>
        </div>
      </dl>

      <p className={styles.growthAxisMeasure}>Revenue so far ({currency})</p>
      <div
        ref={ref}
        className={styles.growthChartWrap}
        role="group"
        tabIndex={0}
        aria-label="Growth chart. Arrow keys explore dates, Enter pins a date, Escape clears."
        aria-describedby={activeModel !== null ? "growth-chart-tooltip" : undefined}
        onKeyDown={onChartKeyDown}
        onMouseLeave={() => setHoverDate(null)}
      >
        <div
          className={styles.growthChart}
          role="img"
          aria-label={chartAriaLabel(view, currency)}
        >
        <ComposedChart
          width={width}
          height={CHART_HEIGHT}
          data={rows}
          margin={{ top: 30, right: 70, bottom: 8, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[startMs, endMs]}
            ticks={tickValues}
            padding={{ left: 0, right: 0 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickMargin={10}
            tick={{ fill: "var(--muted-foreground)" }}
            tickFormatter={(value: number) => formatShortDate(new Date(value).toISOString().slice(0, 10))}
          />
          <YAxis
            domain={[domain[0], domain[1]]}
            ticks={ticks}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            width={56}
            tick={{ fill: "var(--muted-foreground)" }}
            tickFormatter={(value: number) =>
              formatCompactMoney(value * 10 ** majorExponent(currency), currency)
            }
          />
          {view.latestComparableDate !== null ? (
            <ReferenceLine
              x={utcDate(view.latestComparableDate).getTime()}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{
                value: "Latest report",
                position: "top",
                fill: "var(--muted-foreground)",
                className: styles.growthGuideLabel,
              }}
            />
          ) : null}
          {activeT !== null ? (
            <ReferenceLine
              x={activeT}
              stroke="var(--foreground)"
              strokeOpacity={0.45}
              strokeDasharray="3 3"
            />
          ) : null}
          {bracketValues !== null ? (
            <ReferenceLine
              segment={[
                { x: bracketValues.t, y: bracketValues.current },
                { x: bracketValues.t, y: bracketValues.projected },
              ]}
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              label={{
                value: bracketLabel,
                position: bracketAnchor === "right" ? "right" : "left",
                fill: "var(--muted-foreground)",
                className: styles.growthBracketLabel,
              }}
            />
          ) : null}
          <Line
            type="linear"
            dataKey="projected"
            name="Projected"
            stroke={GROWTH_PROJECTED}
            strokeWidth={3}
            strokeDasharray={PROJECTED_DASH}
            connectNulls={false}
            isAnimationActive={false}
            dot={(dotProps) => {
              const payload = (dotProps as GlyphProps).payload;
              const placement = placeGrowthPairLabels(
                payload?.currentMinor ?? null,
                payload?.projectedCentralMinor ?? null,
              );
              return (
                <ProjectedGlyph
                  {...(dotProps as GlyphProps)}
                  labelSide={
                    payload && labelDates.has(payload.date) ? placement.projected : "hidden"
                  }
                  showEndpointWord={(dotProps as GlyphProps).index === lastProjectedIndex}
                  endpointDy={endpointPlacement.projectedDy}
                  currency={currency}
                  onSelectDate={selectDate}
                  onHoverDate={setHoverDate}
                />
              );
            }}
            activeDot={false}
          />
          <Line
            type="linear"
            dataKey="current"
            name="Current"
            stroke={GROWTH_CURRENT}
            strokeWidth={3}
            connectNulls={false}
            isAnimationActive={false}
            dot={(dotProps) => {
              const payload = (dotProps as GlyphProps).payload;
              const placement = placeGrowthPairLabels(
                payload?.currentMinor ?? null,
                payload?.projectedCentralMinor ?? null,
              );
              return (
                <CurrentGlyph
                  {...(dotProps as GlyphProps)}
                  labelSide={
                    payload && labelDates.has(payload.date) ? placement.current : "hidden"
                  }
                  showEndpointWord={(dotProps as GlyphProps).index === lastCurrentIndex}
                  endpointDy={endpointPlacement.currentDy}
                  currency={currency}
                  onSelectDate={selectDate}
                  onHoverDate={setHoverDate}
                />
              );
            }}
            activeDot={false}
          />
        </ComposedChart>
        </div>
        {activeModel !== null && activeFraction !== null ? (
          <div
            id="growth-chart-tooltip"
            role="tooltip"
            data-pinned={pinnedDate !== null && hoverDate === null ? "true" : "false"}
            className={styles.growthTooltip}
            style={
              activeFraction > 0.7
                ? { right: `${(1 - activeFraction) * 100}%` }
                : { left: `${activeFraction * 100}%` }
            }
          >
            <p className={styles.growthTooltipDate}>
              {formatShortDate(activeModel.date)}
              {pinnedDate !== null && hoverDate === null ? " · Pinned" : ""}
            </p>
            <p className={styles.growthTooltipRow}>
              Current:{" "}
              {activeModel.currentMinor !== null
                ? formatWholeMoney(activeModel.currentMinor, currency)
                : "not reported"}
            </p>
            {activeModel.projectedCentralMinor !== null ? (
              <p className={styles.growthTooltipRow}>
                Projected: {formatWholeMoney(activeModel.projectedCentralMinor, currency)}
                {activeModel.projectedLowMinor !== null &&
                activeModel.projectedHighMinor !== null ? (
                  <>
                    {" "}
                    (range {formatWholeMoney(activeModel.projectedLowMinor, currency)}–
                    {formatWholeMoney(activeModel.projectedHighMinor, currency)})
                  </>
                ) : null}
              </p>
            ) : null}
            {activeModel.differenceMinor !== null && activeModel.differenceMinor !== 0 ? (
              <p className={styles.growthTooltipRow}>
                Difference: {formatWholeMoney(Math.abs(activeModel.differenceMinor), currency)}{" "}
                {activeModel.differenceMinor > 0 ? "ahead" : "behind"}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="sr-only" role="status">
          {announcement}
        </p>
      </div>
      <p className={styles.growthHint}>Hover or tap a point to compare</p>
    </div>
  );
}
