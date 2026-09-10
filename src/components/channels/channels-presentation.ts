import { z } from "zod";

import type { AnalysisMoney } from "@/domain/analysis/money-split";
import type { AnalysisGrain } from "@/domain/analysis/types";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewView,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";
import type { OrganizationChannelRow } from "@/modules/channels/application/ports";

/**
 * Channel-only presentation derivations for the Channels landing.
 *
 * Browser-safe and pure: no React, no server-only imports, no storage, no
 * queries. Every money figure below is a sum or regrouping of already-derived
 * `ChannelMoney` bands from the shared overview builder -- this module never
 * derives earned from revenue and loss itself, never reads
 * `view.total.potential` (the complete-only shared total), and never mutates
 * its inputs.
 */

/** Which analysis state the landing composition received from the page. */
export type ChannelsLandingAnalysis =
  | { state: "disabled" }
  | { state: "unavailable" }
  | { state: "ready"; view: ChannelsOverviewView };

/** Active-portfolio summary. Owns sums and presentation decisions, no analysis. */
export type ChannelsPortfolioPresentation = {
  /** Active rows only, in the view's order. Archived rows never appear here. */
  rows: readonly ChannelsOverviewRow[];
  /** Sum of non-null potential over active complete + revenue-only rows. */
  reportedTotal: AnalysisMoney | null;
  /** Sum of already-derived earned over active complete rows only. */
  earnedTotal: AnalysisMoney | null;
  /** Sum of already-derived lost over active complete rows only. */
  lostTotal: AnalysisMoney | null;
  activeCount: number;
  /** Active rows with a non-null potential, including a recorded zero. */
  reportedCount: number;
  completeCount: number;
  revenueOnlyCount: number;
  refusedCount: number;
  /** Currency of the reported total; null whenever no reported total is stated. */
  comparisonCurrency: string | null;
  /**
   * Why no proportional (share) comparison can be shown. Null only when the
   * reported total exists, is nonzero, and has no signed components.
   */
  comparisonReason: string | null;
  /** Why no earned/lost total is stated. Null whenever both are present. */
  earnedReason: string | null;
};

export const NO_ACTIVE_CHANNELS_REASON = "No active channels to compare.";
export const NO_REPORTED_FIGURE_REASON =
  "No channel has a reported revenue figure for this window.";
export const MIXED_CURRENCY_COMPARISON_REASON = "Revenue cannot be compared across currencies.";
export const MIXED_CURRENCY_EARNED_REASON = "Earned and loss cannot be combined across currencies.";
export const UNUSABLE_CURRENCY_COMPARISON_REASON =
  "A reported figure did not carry a usable currency code.";
export const UNUSABLE_CURRENCY_EARNED_REASON =
  "An earned figure did not carry a usable currency code.";
export const UNSAFE_SUM_COMPARISON_REASON = "Reported figures are too large to combine safely.";
export const UNSAFE_SUM_EARNED_REASON = "Earned figures are too large to combine safely.";
export const ZERO_DENOMINATOR_COMPARISON_REASON =
  "No proportional comparison is available for zero reported revenue.";
export const SIGNED_ADJUSTMENT_COMPARISON_REASON =
  "Share comparison is unavailable for signed adjustments.";
export const NO_COMPLETE_BAND_EARNED_REASON =
  "No channel has both a revenue figure and a recorded loss for this window.";

function isUsableCurrency(currency: unknown): currency is string {
  return typeof currency === "string" && currency.trim().length > 0;
}

/**
 * Integer addition that refuses instead of rounding. Any unsafe operand or
 * unsafe running total returns null; callers state the refusal explicitly.
 */
function safeSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) return null;
    total += value;
  }
  return total;
}

export function buildChannelsPortfolioPresentation(
  view: ChannelsOverviewView,
): ChannelsPortfolioPresentation {
  const rows = view.rows.filter((row) => row.status === "active");
  const activeCount = rows.length;
  const completeRows = rows.filter((row) => row.band.state === "complete");
  const revenueOnlyRows = rows.filter((row) => row.band.state === "revenue_only");

  const reportedBands = [...completeRows, ...revenueOnlyRows]
    .map((row) => row.band.potential)
    .filter((money): money is AnalysisMoney => money !== null);
  const reportedCount = reportedBands.length;
  const completeCount = completeRows.length;
  const revenueOnlyCount = revenueOnlyRows.length;
  const refusedCount = rows.filter((row) => row.band.state === "refused").length;

  let reportedTotal: AnalysisMoney | null = null;
  let comparisonCurrency: string | null = null;
  let comparisonReason: string | null = null;
  if (activeCount === 0) {
    comparisonReason = NO_ACTIVE_CHANNELS_REASON;
  } else if (reportedCount === 0) {
    comparisonReason = NO_REPORTED_FIGURE_REASON;
  } else if (!reportedBands.every((money) => isUsableCurrency(money.currency))) {
    comparisonReason = UNUSABLE_CURRENCY_COMPARISON_REASON;
  } else if (new Set(reportedBands.map((money) => money.currency)).size > 1) {
    comparisonReason = MIXED_CURRENCY_COMPARISON_REASON;
  } else {
    const [currency] = reportedBands.map((money) => money.currency);
    const total = safeSum(reportedBands.map((money) => money.minorUnits));
    if (currency === undefined || total === null) {
      comparisonReason =
        total === null && currency !== undefined
          ? UNSAFE_SUM_COMPARISON_REASON
          : UNUSABLE_CURRENCY_COMPARISON_REASON;
    } else {
      reportedTotal = { minorUnits: total, currency };
      comparisonCurrency = currency;
      if (reportedBands.some((money) => money.minorUnits < 0)) {
        comparisonReason = SIGNED_ADJUSTMENT_COMPARISON_REASON;
      } else if (total === 0) {
        comparisonReason = ZERO_DENOMINATOR_COMPARISON_REASON;
      }
    }
  }

  let earnedTotal: AnalysisMoney | null = null;
  let lostTotal: AnalysisMoney | null = null;
  let earnedReason: string | null = null;
  const contributingComplete = completeRows.filter(
    (row): row is ChannelsOverviewRow & { band: { earned: AnalysisMoney; lost: AnalysisMoney } } =>
      row.band.earned !== null && row.band.lost !== null,
  );
  if (completeCount === 0) {
    earnedReason = NO_COMPLETE_BAND_EARNED_REASON;
  } else if (contributingComplete.length === 0) {
    earnedReason = UNUSABLE_CURRENCY_EARNED_REASON;
  } else if (
    !contributingComplete.every(
      (row) =>
        isUsableCurrency(row.band.earned.currency) && isUsableCurrency(row.band.lost.currency),
    )
  ) {
    earnedReason = UNUSABLE_CURRENCY_EARNED_REASON;
  } else if (
    new Set(contributingComplete.map((row) => row.band.earned.currency)).size > 1 ||
    new Set(contributingComplete.map((row) => row.band.lost.currency)).size > 1 ||
    contributingComplete.some((row) => row.band.earned.currency !== row.band.lost.currency)
  ) {
    earnedReason = MIXED_CURRENCY_EARNED_REASON;
  } else {
    const [currency] = contributingComplete.map((row) => row.band.earned.currency);
    const earned = safeSum(contributingComplete.map((row) => row.band.earned.minorUnits));
    const lost = safeSum(contributingComplete.map((row) => row.band.lost.minorUnits));
    if (currency === undefined || earned === null || lost === null) {
      earnedReason = UNSAFE_SUM_EARNED_REASON;
    } else {
      earnedTotal = { minorUnits: earned, currency };
      lostTotal = { minorUnits: lost, currency };
    }
  }

  return {
    rows,
    reportedTotal,
    earnedTotal,
    lostTotal,
    activeCount,
    reportedCount,
    completeCount,
    revenueOnlyCount,
    refusedCount,
    comparisonCurrency,
    comparisonReason,
    earnedReason,
  };
}

export const channelDirectoryFilterSchema = z.enum(["active", "measured", "attention", "archived"]);
export type ChannelDirectoryFilter = z.infer<typeof channelDirectoryFilterSchema>;

export const channelRevenueSortSchema = z.enum(["descending", "ascending"]);
export type ChannelRevenueSort = z.infer<typeof channelRevenueSortSchema>;

export type SelectChannelDirectoryRowsInput = {
  channels: readonly OrganizationChannelRow[];
  analysis: ChannelsLandingAnalysis;
  query: string;
  filter: ChannelDirectoryFilter;
  sort: ChannelRevenueSort;
};

/**
 * Directory filtering and sorting over the management snapshot.
 *
 * Pure: returns the original channel records in stable display order and
 * never touches the portfolio inputs. Analysis rows are looked up by channel
 * ID; a channel with no analysis row reads as refused. Evidence filters
 * (`measured` / `attention`) need a ready view, so without one they select
 * nothing rather than claiming every channel failed.
 */
export function selectChannelDirectoryRows(
  input: SelectChannelDirectoryRowsInput,
): OrganizationChannelRow[] {
  const filter = channelDirectoryFilterSchema.parse(input.filter);
  const sort = channelRevenueSortSchema.parse(input.sort);
  const query = input.query.slice(0, 160).trim().toLowerCase();

  const bandByChannel = new Map<string, ChannelsOverviewRow>();
  if (input.analysis.state === "ready") {
    for (const row of input.analysis.view.rows) bandByChannel.set(row.channelId, row);
  }
  const analysisReady = input.analysis.state === "ready";

  const filtered = input.channels.filter((channel) => {
    const archived = channel.status === "archived";
    if (filter === "archived") {
      if (!archived) return false;
    } else {
      if (archived) return false;
      if (filter === "measured" || filter === "attention") {
        if (!analysisReady) return false;
        const state = bandByChannel.get(channel.id)?.band.state ?? "refused";
        if (filter === "measured" ? state !== "complete" : state === "complete") return false;
      }
    }
    if (query.length === 0) return true;
    return (
      channel.display_name.toLowerCase().includes(query) ||
      channel.category.toLowerCase().includes(query)
    );
  });

  const withAmounts = filtered.map((channel) => ({
    channel,
    amount: bandByChannel.get(channel.id)?.band.potential ?? null,
  }));
  const currencies = new Set(
    withAmounts
      .map((entry) => entry.amount?.currency)
      .filter((currency): currency is string => currency !== undefined && currency !== null),
  );
  if (currencies.size > 1) {
    // Different currencies cannot be ranked together: alphabetical order.
    return withAmounts
      .map((entry) => entry.channel)
      .sort(
        (left, right) =>
          left.display_name.localeCompare(right.display_name) || left.id.localeCompare(right.id),
      );
  }

  const direction = sort === "descending" ? -1 : 1;
  return withAmounts
    .sort((left, right) => {
      const leftAmount = left.amount?.minorUnits;
      const rightAmount = right.amount?.minorUnits;
      if (leftAmount === undefined && rightAmount === undefined) return 0;
      if (leftAmount === undefined) return 1;
      if (rightAmount === undefined) return -1;
      return (
        (leftAmount - rightAmount) * direction ||
        left.channel.display_name.localeCompare(right.channel.display_name) ||
        left.channel.id.localeCompare(right.channel.id)
      );
    })
    .map((entry) => entry.channel);
}

const WINDOW_VALUE_SCHEMA = z.string().min(1);
const WINDOW_GRAIN_SCHEMA = z.enum(["day", "week", "month", "span"]);

export type ParsedChannelsWindow = {
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
};

/** Strict `YYYY-MM-DD` with a real calendar date behind it, UTC-safe. */
function isStrictIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Parse an exact-window option value (`start..end..grain`).
 *
 * Requires exactly three nonempty segments, strict ISO dates, end >= start,
 * and a known grain. Anything else -- including undefined -- returns null so
 * the page falls back to its default resolver; there are no today-based
 * defaults here.
 */
export function parseChannelsWindow(value: string | undefined): ParsedChannelsWindow | null {
  if (typeof value !== "string" || !WINDOW_VALUE_SCHEMA.safeParse(value).success) return null;
  const segments = value.split("..");
  if (segments.length !== 3) return null;
  const [windowStart, windowEnd, grain] = segments;
  if (!windowStart || !windowEnd || !grain) return null;
  if (!isStrictIsoDate(windowStart) || !isStrictIsoDate(windowEnd)) return null;
  if (windowEnd < windowStart) return null;
  const parsedGrain = WINDOW_GRAIN_SCHEMA.safeParse(grain);
  if (!parsedGrain.success) return null;
  return { windowStart, windowEnd, grain: parsedGrain.data };
}

function parseIsoParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

/** True only for an actual full calendar month (leap-year aware). */
function isFullCalendarMonth(windowStart: string, windowEnd: string): boolean {
  const start = parseIsoParts(windowStart);
  const end = parseIsoParts(windowEnd);
  if (start.year !== end.year || start.month !== end.month) return false;
  if (start.day !== 1) return false;
  return end.day === new Date(Date.UTC(end.year, end.month, 0)).getUTCDate();
}

function formatMonthYear(date: string): string {
  const { year, month } = parseIsoParts(date);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatShortDay(date: string): string {
  const { year, month, day } = parseIsoParts(date);
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return `${day} ${monthName} ${year}`;
}

/**
 * Display label for one reporting-window option.
 *
 * A true full calendar month reads `Month YYYY`; any other range reads
 * `D Mon YYYY – D Mon YYYY` so Jan 1–Feb 28 is never relabelled as February.
 * When the same dates exist at another grain, the grain is appended so two
 * March windows stay distinct. The option value always stays the original
 * `window.value` -- labels never become values.
 */
export function formatChannelsWindowOption(
  window: ChannelsOverviewWindow,
  siblings: readonly ChannelsOverviewWindow[],
): string {
  const base = isFullCalendarMonth(window.windowStart, window.windowEnd)
    ? formatMonthYear(window.windowStart)
    : `${formatShortDay(window.windowStart)} – ${formatShortDay(window.windowEnd)}`;
  const duplicatesDates = siblings.some(
    (sibling) =>
      sibling !== window &&
      sibling.windowStart === window.windowStart &&
      sibling.windowEnd === window.windowEnd,
  );
  return duplicatesDates ? `${base} · ${window.grain}` : base;
}
