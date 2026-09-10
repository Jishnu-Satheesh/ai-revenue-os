import {
  addLocalDays,
  enumerateLocalPeriodStarts,
  localDaysBetween,
  localPeriodEnd,
  localPeriodStart,
} from "@/domain/analysis/calendar";
import {
  describeChannelMoney,
  type AnalysisMoney,
  type ChannelMoney,
  type EarnedLostPotential,
} from "@/domain/analysis/money-split";
import type { AnalysisGrain } from "@/domain/analysis/types";
import type { CoverageSegment, CoverageWindow } from "@/domain/analysis/window-selection";
import type {
  AnalysedWindowKey,
  ChannelBandRecord,
  ChannelEvidenceWindow,
  ChannelFindingRecord,
} from "@/modules/analysis/application/ports";

/**
 * The merged Channels page's read model.
 *
 * One clock governs the page. The roll-up is the sum of the same per-channel
 * bands the channel workspace shows -- computed by the one shared function in
 * `@/domain/analysis/money-split`, never recomputed here -- over exactly one
 * declared evidence window.
 *
 * The rule that keeps it honest is that coverage is always stated. A sum over
 * one of four channels is not a total, and this module never returns one
 * without the count and the names of what it left out.
 */

export type ChannelsOverviewWindow = {
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
  /** What the operator picks from; the dates they declared, never a month name. */
  label: string;
  /** `start..end..grain`. The one string the control emits and the page parses. */
  value: string;
};

export type ChannelsOverviewRow = {
  channelId: string;
  displayName: string;
  status: string;
  band: ChannelMoney;
  /** True only when this channel contributed a complete band to the sum. */
  assessed: boolean;
};

export type ChannelsOverviewView = {
  windows: readonly ChannelsOverviewWindow[];
  selectedWindow: ChannelsOverviewWindow | null;
  total: EarnedLostPotential;
  coverage: {
    assessedCount: number;
    channelCount: number;
    /**
     * Channels that were analysed and reported revenue, but whose provider
     * recorded no loss to subtract from it. Named apart from the channels
     * below because the two gaps need different next actions: one needs a
     * report that records cancellations, the other needs any report at all.
     */
    revenueOnlyNames: readonly string[];
    unassessedNames: readonly string[];
  };
  /** Why no total is stated. Null whenever `total.earned` is present. */
  refusalReason: string | null;
  rows: readonly ChannelsOverviewRow[];
};

const MIXED_CURRENCY_REASON =
  "These channels reported in more than one currency, so no single total can be stated.";
const NOTHING_ANALYSED_REASON =
  "No channel has a completed analysis for this window, so nothing has been measured.";
const NO_COMPLETE_BAND_REASON =
  "No channel has both a revenue figure and a recorded loss for this window, so no earned total can be stated.";
const UNRESOLVED_CURRENCY_REASON =
  "An assessed channel's band did not carry a usable currency code, so no total can be stated.";

const REFUSED: EarnedLostPotential = { potential: null, lost: null, earned: null };

/** The money a finding states, or nothing. Never a rounded or coerced value. */
function moneyOf(
  finding: ChannelFindingRecord | undefined,
  from: "value" | "impact",
): AnalysisMoney | null {
  if (!finding || finding.currency === null) return null;
  const minorUnits =
    from === "value"
      ? finding.valueKind === "money"
        ? finding.valueNumerator
        : null
      : finding.monetaryImpactMinorUnits;
  return minorUnits === null ? null : { minorUnits, currency: finding.currency };
}

function bandOf(record: ChannelBandRecord | undefined): ChannelMoney {
  // No record at all is a channel nothing has analysed, which is a different
  // thing from a channel whose analysis could not complete a band.
  if (!record) return { ...REFUSED, state: "refused" };
  const gross = record.findings.find((finding) => finding.code === "WINDOW_GROSS_REVENUE");
  const loss = record.findings.find((finding) => finding.code === "ORDER_CANCELLATION_LOSS");
  return describeChannelMoney({
    potential: moneyOf(gross, "value"),
    lost: moneyOf(loss, "impact"),
  });
}

/**
 * Declared windows, deduplicated by what an operator can actually tell apart.
 *
 * Exported (not module-private) because a later task needs this window list
 * on its own -- the alternative, calling `buildChannelsOverviewView` with an
 * empty band list purely to harvest `.windows`, is obscure and invites a
 * later reader to "simplify" it into a bug.
 */
export function buildOverviewWindows(
  evidenceWindows: readonly ChannelEvidenceWindow[],
): ChannelsOverviewWindow[] {
  const byKey = new Map<string, ChannelsOverviewWindow>();
  for (const entry of evidenceWindows) {
    const key = `${entry.windowStart}|${entry.windowEnd}|${entry.grain}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      windowStart: entry.windowStart,
      windowEnd: entry.windowEnd,
      grain: entry.grain,
      label: `${entry.windowStart} to ${entry.windowEnd}`,
      value: `${entry.windowStart}..${entry.windowEnd}..${entry.grain}`,
    });
  }
  // Newest first, by the end date the package declared.
  return [...byKey.values()].sort((left, right) =>
    left.windowEnd < right.windowEnd ? 1 : left.windowEnd > right.windowEnd ? -1 : 0,
  );
}

/**
 * Which window an unselected page opens on.
 *
 * The newest declared window is the obvious choice and the wrong one: a report
 * uploaded yesterday that nothing has analysed yet would open the page on an
 * empty band while an older window sits below it with figures. So the newest
 * window carrying a completed analysis wins, and the newest declared window is
 * only the fallback when none has been analysed at all.
 */
export type OverviewWindowResolution =
  | { kind: "resolved"; windowStart: string; windowEnd: string; grain: AnalysisGrain }
  | { kind: "unresolved" };

/**
 * Everything the Growth Intelligence performance filter row needs that is not
 * a measured figure: the picked range, what it resolved to, the filter
 * options, and the coverage the free-range picker reasons over. Null on the
 * page means no reported range exists at all.
 */
export type PerformanceFilterState = {
  from: string;
  to: string;
  resolved: { windowStart: string; windowEnd: string; grain: AnalysisGrain } | null;
  channelId: string | null;
  branchId: string | null;
  channels: readonly { id: string; displayName: string }[];
  branches: readonly { id: string; name: string }[];
  segments: readonly CoverageSegment[];
  coverageWindows: readonly CoverageWindow[];
  today: string;
};

/** Coarsest first, so a tie between analysed grains reads the wider period. */
const GRAIN_PREFERENCE: readonly AnalysisGrain[] = ["month", "week", "day", "span"];

/**
 * A free range becomes figures only through exactly one declared window:
 * bands are read for the run matching one start, end, and grain, and two
 * channels analysed over different windows are two answers to different
 * questions. Several declared windows can share the same dates at different
 * grains; then the grain with a completed analysis wins, coarsest first, and
 * anything else stays unresolved rather than silently snapping elsewhere.
 */
export function resolveOverviewWindow(input: {
  from: string;
  to: string;
  evidenceWindows: readonly ChannelEvidenceWindow[];
  analysed: readonly AnalysedWindowKey[];
}): OverviewWindowResolution {
  const grains = new Set<AnalysisGrain>();
  for (const entry of input.evidenceWindows) {
    if (entry.windowStart === input.from && entry.windowEnd === input.to) {
      grains.add(entry.grain);
    }
  }
  if (grains.size === 0) return { kind: "unresolved" };
  const candidates = [...grains];
  if (candidates.length === 1 && candidates[0] !== undefined) {
    return {
      kind: "resolved",
      windowStart: input.from,
      windowEnd: input.to,
      grain: candidates[0],
    };
  }
  const analysedGrains = new Set(
    input.analysed
      .filter((key) => key.windowStart === input.from && key.windowEnd === input.to)
      .map((key) => key.grain),
  );
  const withAnalysis = candidates.filter((grain) => analysedGrains.has(grain));
  const pool = (withAnalysis.length > 0 ? withAnalysis : candidates).sort(
    (left, right) => GRAIN_PREFERENCE.indexOf(left) - GRAIN_PREFERENCE.indexOf(right),
  );
  const [grain] = pool;
  if (grain === undefined) return { kind: "unresolved" };
  return { kind: "resolved", windowStart: input.from, windowEnd: input.to, grain };
}

export function resolveDefaultWindow(input: {
  windows: readonly ChannelsOverviewWindow[];
  analysed: readonly AnalysedWindowKey[];
}): ChannelsOverviewWindow | null {
  const analysedKeys = new Set(
    input.analysed.map((key) => `${key.windowStart}|${key.windowEnd}|${key.grain}`),
  );
  // `windows` is already newest-first, so the first match is the newest match.
  const analysedWindow = input.windows.find((entry) =>
    analysedKeys.has(`${entry.windowStart}|${entry.windowEnd}|${entry.grain}`),
  );
  return analysedWindow ?? input.windows[0] ?? null;
}

/**
 * A picked covered range: the first and last day. Whole calendar months are
 * the common case, but any covered range reads here -- see ADR 0055.
 */
export type CoveredMonth = { from: string; to: string };

/**
 * The equal-length period immediately before the picked range: the same count
 * of days, ending the day the range opens. Deltas compare the range against
 * this period over the channels analysed in both, so a 59-day pick compares
 * against the 59 days before it rather than against a calendar month of a
 * different length without saying so.
 */
export function previousEqualRange(range: CoveredMonth): CoveredMonth {
  const days = localDaysBetween(range.from, range.to);
  const to = addLocalDays(range.from, -1);
  return { from: addLocalDays(to, -days), to };
}

/**
 * Whether the picked range is exactly one calendar month. Whole months keep
 * the month-named copy the prototype verified ("vs January"); any other range
 * names its dates instead of pretending to be a month.
 */
export function isWholeCalendarMonth(range: CoveredMonth): boolean {
  return (
    range.from === localPeriodStart(range.from, "month") &&
    range.to === localPeriodEnd(range.from, "month")
  );
}

/**
 * The whole Monday weeks a picked range contains, for the trend buckets. Edge
 * days outside a whole week are excluded by construction: plotting a four-day
 * stub beside full weeks would read as a collapse nobody measured.
 */
export function wholeWeeksOfRange(range: CoveredMonth): CoveredMonth[] {
  return enumerateLocalPeriodStarts(range.from, range.to, "week").map((start) => ({
    from: start,
    to: localPeriodEnd(start, "week"),
  }));
}

/**
 * The whole calendar months a picked range contains, for the trend's second
 * tier. A month counts only when the range covers it fully: a stub month
 * beside full months would read as a collapse nobody measured.
 */
export function wholeMonthsOfRange(range: CoveredMonth): CoveredMonth[] {
  const months: CoveredMonth[] = [];
  let start = localPeriodStart(range.from, "month");
  while (start <= range.to) {
    const end = localPeriodEnd(start, "month");
    if (range.from <= start && end <= range.to) months.push({ from: start, to: end });
    const next = addLocalDays(end, 1);
    if (next <= start) break;
    start = next;
  }
  return months;
}

/**
 * The analysed windows a long range's trend can honestly plot when whole
 * weeks (and whole months) were never analysed: distinct finished analyses
 * fully inside the range, picked for maximum covered days without overlap.
 *
 * Maximum coverage, not maximum count: for Jan, Jan–Feb, and March analyses
 * the answer is Jan–Feb + March (the whole quarter), never Jan + March with
 * February silently dropped. Ties prefer more windows -- finer is more
 * informative for a trend. The picked range itself is excluded: the tiles
 * already state its total, and a point containing another point misleads.
 * Capped so one pathological history cannot fan the card's reads out.
 */
export function pickTrendWindows(
  keys: readonly { from: string; to: string }[],
  range: CoveredMonth,
  maxBuckets = 12,
): CoveredMonth[] {
  const seen = new Set<string>();
  const candidates = keys
    .filter((key) => {
      const fingerprint = `${key.from}|${key.to}`;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      if (key.from === range.from && key.to === range.to) return false;
      return range.from <= key.from && key.to <= range.to;
    })
    .map((key) => ({ from: key.from, to: key.to }))
    .sort((left, right) =>
      left.to < right.to ? -1 : left.to > right.to ? 1 : left.from < right.from ? -1 : 1,
    );
  // Weighted interval scheduling: best[i] is the best (days, count) pair
  // using the first i candidates, each candidate either skipped or taken
  // with the best set ending before it starts.
  const days = (window: CoveredMonth) => localDaysBetween(window.from, window.to) + 1;
  const better = (
    left: { weight: number; count: number },
    right: { weight: number; count: number },
  ) => left.weight > right.weight || (left.weight === right.weight && left.count > right.count);
  const best: { weight: number; count: number }[] = [{ weight: 0, count: 0 }];
  const ends: string[] = candidates.map((candidate) => candidate.to);
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!candidate) continue;
    let low = 0;
    let high = i;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if ((ends[mid - 1] ?? "") < candidate.from) low = mid;
      else high = mid - 1;
    }
    const previous = best[low] ?? { weight: 0, count: 0 };
    const taken = { weight: previous.weight + days(candidate), count: previous.count + 1 };
    const skipped = best[i] ?? { weight: 0, count: 0 };
    best.push(better(taken, skipped) ? taken : skipped);
  }
  const picked: CoveredMonth[] = [];
  let i = candidates.length;
  while (i > 0) {
    const current = best[i];
    const skipped = best[i - 1] ?? { weight: 0, count: 0 };
    if (current && (current.weight !== skipped.weight || current.count !== skipped.count)) {
      const candidate = candidates[i - 1];
      if (candidate) picked.unshift(candidate);
      let low = 0;
      let high = i - 1;
      while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        if ((ends[mid - 1] ?? "") < (candidate?.from ?? "")) low = mid;
        else high = mid - 1;
      }
      i = low;
    } else {
      i -= 1;
    }
  }
  picked.sort((left, right) => (left.from < right.from ? -1 : 1));
  if (picked.length <= maxBuckets) return picked;
  return picked
    .sort((left, right) => days(right) - days(left))
    .slice(0, maxBuckets)
    .sort((left, right) => (left.from < right.from ? -1 : 1));
}

/**
 * A short bucket label for an analysed window: the year is nearby in the
 * card header, so same-year windows name only their months.
 */
export function compactRange(from: string, to: string): string {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const fromLabel = `${monthName(from).slice(0, 3)}`;
  if (fromYear === toYear && fromMonth === toMonth) return `${fromDay}–${toDay} ${fromLabel}`;
  if (fromYear === toYear) return `${fromDay} ${fromLabel} – ${toDay} ${monthName(to).slice(0, 3)}`;
  return prettyRange(from, to);
}

/** `2026-02-01` reads "February" without a timezone to drift through. */
export function monthName(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, (month ?? 1) - 1, 15)),
  );
}

/**
 * `2026-02-01` to `2026-02-28` reads "1–28 Feb 2026", the range language the
 * performance card speaks everywhere.
 */
export function prettyRange(from: string, to: string): string {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const month = monthName(from).slice(0, 3);
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${fromDay}–${toDay} ${month} ${fromYear}`;
  }
  return `${fromDay} ${month} – ${toDay} ${monthName(to).slice(0, 3)} ${toYear}`;
}

const PLACED_ORDERS_METRIC = "listing.placed_orders";
const MENU_VIEWS_METRIC = "listing.menu_views";

export type CardMoney = { minorUnits: number; currency: string };

export type PerformanceCardTile = {
  id: "sales" | "orders" | "views" | "cancelled";
  value: { kind: "money"; money: CardMoney } | { kind: "count"; value: number } | null;
  /** Why there is no figure. Always present when `value` is null. */
  unavailableReason: string | null;
  /** Signed whole percent, so 20 reads "+20%". Null when no comparison. */
  deltaPercent: number | null;
  /** "vs January". Null together with `deltaPercent`. */
  deltaLabel: string | null;
  /** Why there is no comparison. Always present when the value exists but `deltaPercent` is null. */
  deltaAbsentReason: string | null;
  /** The small line under the delta, such as which channels the figure covers. */
  footnote: string | null;
};

/** `2026-02-02` reads "2", so bucket labels never carry a leading zero. */
function dayOfMonth(date: string): number {
  return Number(date.slice(8));
}

export type PerformanceCardTrend =
  | {
      state: "ready";
      buckets: readonly { label: string; minorUnits: number }[];
      currency: string;
      coverageNote: string;
    }
  | {
      state: "empty";
      reason: string;
      /** The week labels the axes keep showing while the plot stays empty. */
      weeks: readonly string[];
    };

export type PerformanceCardShare = {
  channelId: string;
  displayName: string;
  minorUnits: number;
  currency: string;
  sharePercent: number;
};

export type BusinessPerformanceCardView = {
  /** The picked covered range -- a whole calendar month when the operator picks one. */
  month: CoveredMonth;
  /** The previous equal-length covered period the deltas compare against. */
  previous: CoveredMonth;
  /** Visible channels behind the card, so the page can tell "no match" from "no data". */
  channelCount: number;
  headline: string;
  tiles: {
    sales: PerformanceCardTile;
    orders: PerformanceCardTile;
    views: PerformanceCardTile;
    cancelled: PerformanceCardTile;
  };
  /** Rounded whole percent of orders cancelled, with the point change against last month. Nulls when unmeasured. */
  cancelledShare: { percent: number; pointChange: number | null } | null;
  trend: PerformanceCardTrend;
  /** Null with a reason when channels reported more than one currency. */
  shares: {
    rows: readonly PerformanceCardShare[];
    totalMinorUnits: number;
    currency: string;
  } | null;
  sharesAbsentReason: string | null;
  footer: string;
  sources: {
    reportingPeriod: string;
    scope: string;
    salesOrdersNote: string;
    menuViewsNote: string;
    costNote: string;
    reportFiles: readonly string[];
  };
  fulfillment: {
    ordersPlaced: number | null;
    ordersAbsentReason: string | null;
    cancelled: number | null;
    cancelledAbsentReason: string | null;
  };
};

function observationOf(
  findings: readonly ChannelFindingRecord[] | undefined,
  code: string,
  metricKey?: string,
): ChannelFindingRecord | undefined {
  return findings?.find(
    (finding) =>
      finding.kind === "observation" &&
      finding.code === code &&
      (metricKey === undefined || finding.metricKey === metricKey),
  );
}

function moneyFigure(
  findings: readonly ChannelFindingRecord[] | undefined,
  code: string,
): CardMoney | null {
  const finding = observationOf(findings, code);
  if (!finding || finding.valueKind !== "money") return null;
  if (finding.valueNumerator === null || finding.currency === null) return null;
  return { minorUnits: finding.valueNumerator, currency: finding.currency };
}

function countFigure(
  findings: readonly ChannelFindingRecord[] | undefined,
  code: string,
  metricKey?: string,
): number | null {
  const finding = observationOf(findings, code, metricKey);
  if (!finding) return null;
  if (finding.valueKind === "count") return finding.valueNumerator;
  // Funnel stages arrive as ratios whose numerator is the window sum; a ratio
  // with no numerator measured nothing.
  if (finding.valueKind === "ratio") return finding.valueNumerator;
  return null;
}

function shareFigure(
  findings: readonly ChannelFindingRecord[] | undefined,
): { numerator: number; denominator: number } | null {
  const finding = observationOf(findings, "ORDER_CANCELLATION_ATTRIBUTION_SHARE_OF_ORDERS");
  if (!finding || finding.valueKind !== "ratio") return null;
  if (finding.valueNumerator === null || finding.valueDenominator === null) return null;
  if (finding.valueDenominator === 0) return null;
  return { numerator: finding.valueNumerator, denominator: finding.valueDenominator };
}

/**
 * The channels carrying a figure in both months. A delta over two different
 * channel sets would describe the portfolio's changing shape rather than a
 * movement in trade, so the comparison reads only the intersection.
 */
function comparableChannelIds(
  current: ReadonlyMap<string, unknown>,
  previous: ReadonlyMap<string, unknown>,
): string[] {
  return [...current.keys()].filter((id) => previous.has(id));
}

const NO_EARLIER_PERIOD_REASON = "No earlier comparable period was analysed.";
const NO_COMMON_CHANNEL_REASON = "No channel was analysed in both periods.";

/**
 * The business-performance card over one picked covered range: four tiles
 * with deltas against the previous equal-length period, a rule-composed
 * headline, a weekly trend, channel shares, and the payloads behind both
 * modals.
 *
 * Pure. Every figure it carries came out of a detector already; the only
 * arithmetic here is presentation -- sums over the visible channels and whole
 * percent changes -- and anything unmeasured stays absent with its reason,
 * never zero.
 */
export function buildBusinessPerformanceCard(input: {
  month: CoveredMonth;
  /** The visible channels: already filtered to the picked channel/location. */
  channels: readonly { id: string; displayName: string }[];
  current: ReadonlyMap<string, readonly ChannelFindingRecord[]>;
  previous: ReadonlyMap<string, readonly ChannelFindingRecord[]>;
  /** Nested analysed weeks, each with the same card findings for its window. */
  trendWeeks: readonly {
    window: CoveredMonth;
    records: ReadonlyMap<string, readonly ChannelFindingRecord[]>;
  }[];
  /**
   * Nested analysed calendar months, same shape as the weeks: the trend's
   * second tier when whole weeks were never analysed.
   */
  trendMonths: readonly {
    window: CoveredMonth;
    records: ReadonlyMap<string, readonly ChannelFindingRecord[]>;
  }[];
  /**
   * Distinct analysed windows inside the range, picked for maximum covered
   * days without overlap: the trend's third tier when neither weeks nor
   * months were analysed.
   */
  trendWindows: readonly {
    window: CoveredMonth;
    records: ReadonlyMap<string, readonly ChannelFindingRecord[]>;
  }[];
  /** Actively mapped branches across the visible channels, for the footer. */
  locationCount: number;
  /** Scope names for the sources modal; null reads "all". */
  channelScopeName: string | null;
  locationScopeName: string | null;
  /** Report filenames behind the current month's windows. */
  reportFiles: readonly string[];
}): BusinessPerformanceCardView {
  const previous = previousEqualRange(input.month);
  // A whole picked month keeps the month-named copy the prototype verified;
  // any other range names its dates and its period instead of pretending.
  const wholeMonth = isWholeCalendarMonth(input.month);
  const periodPhrase = wholeMonth ? "this month" : "the selected period";
  const deltaLabel = wholeMonth
    ? `vs ${monthName(previous.from)}`
    : `vs ${prettyRange(previous.from, previous.to)}`;
  const byId = new Map(input.channels.map((channel) => [channel.id, channel.displayName]));

  const grossByChannel = (records: ReadonlyMap<string, readonly ChannelFindingRecord[]>) => {
    const figures = new Map<string, CardMoney>();
    for (const [channelId, findings] of records) {
      if (!byId.has(channelId)) continue;
      const money = moneyFigure(findings, "WINDOW_GROSS_REVENUE");
      if (money) figures.set(channelId, money);
    }
    return figures;
  };
  const countByChannel = (
    records: ReadonlyMap<string, readonly ChannelFindingRecord[]>,
    code: string,
    metricKey?: string,
  ) => {
    const figures = new Map<string, number>();
    for (const [channelId, findings] of records) {
      if (!byId.has(channelId)) continue;
      const value = countFigure(findings, code, metricKey);
      if (value !== null) figures.set(channelId, value);
    }
    return figures;
  };

  const sumMoney = (figures: ReadonlyMap<string, CardMoney>): CardMoney | null => {
    const currencies = new Set([...figures.values()].map((figure) => figure.currency));
    if (figures.size === 0 || currencies.size !== 1) return null;
    const [currency] = currencies;
    if (!currency) return null;
    return {
      minorUnits: [...figures.values()].reduce((total, figure) => total + figure.minorUnits, 0),
      currency,
    };
  };
  const sumCounts = (figures: ReadonlyMap<string, number>): number | null =>
    figures.size === 0 ? null : [...figures.values()].reduce((total, value) => total + value, 0);

  /** A whole percent change over the intersected channels, or why none exists. */
  const deltaOver = (
    current: ReadonlyMap<string, number>,
    prev: ReadonlyMap<string, number>,
  ): { deltaPercent: number | null; reason: string | null } => {
    const ids = comparableChannelIds(current, prev);
    if (ids.length === 0) {
      return {
        deltaPercent: null,
        reason:
          current.size === 0 || prev.size === 0
            ? NO_EARLIER_PERIOD_REASON
            : NO_COMMON_CHANNEL_REASON,
      };
    }
    const base = ids.reduce((total, id) => total + (prev.get(id) ?? 0), 0);
    if (base === 0) {
      // A change from zero has no defined proportion; stating one would
      // invent a scale the reports never gave.
      return { deltaPercent: null, reason: "The earlier period recorded zero." };
    }
    const now = ids.reduce((total, id) => total + (current.get(id) ?? 0), 0);
    return { deltaPercent: Math.round(((now - base) / base) * 100), reason: null };
  };

  const currentGross = grossByChannel(input.current);
  const previousGross = grossByChannel(input.previous);
  const currentSales = sumMoney(currentGross);
  const salesDelta = deltaOver(
    new Map([...currentGross].map(([id, money]) => [id, money.minorUnits])),
    new Map([...previousGross].map(([id, money]) => [id, money.minorUnits])),
  );
  const salesDeltaBlockedByCurrency =
    currentGross.size > 0 &&
    new Set([...currentGross.values()].map((figure) => figure.currency)).size > 1;

  const currentOrders = countByChannel(
    input.current,
    "FUNNEL_STAGE_CONVERSION",
    PLACED_ORDERS_METRIC,
  );
  const previousOrders = countByChannel(
    input.previous,
    "FUNNEL_STAGE_CONVERSION",
    PLACED_ORDERS_METRIC,
  );
  const currentViews = countByChannel(input.current, "FUNNEL_STAGE_CONVERSION", MENU_VIEWS_METRIC);
  const previousViews = countByChannel(
    input.previous,
    "FUNNEL_STAGE_CONVERSION",
    MENU_VIEWS_METRIC,
  );
  const currentCancelled = countByChannel(input.current, "ORDER_CANCELLATION_LOSS");
  const previousCancelled = countByChannel(input.previous, "ORDER_CANCELLATION_LOSS");

  const ordersTotal = sumCounts(currentOrders);
  const viewsTotal = sumCounts(currentViews);
  const cancelledTotal = sumCounts(currentCancelled);
  const ordersDelta = deltaOver(currentOrders, previousOrders);
  const viewsDelta = deltaOver(currentViews, previousViews);
  const cancelledDelta = deltaOver(currentCancelled, previousCancelled);

  const viewChannelNames = [...currentViews.keys()].map((id) => byId.get(id) ?? id);
  const hasCostContext = [...input.current.values()].some((findings) =>
    findings.some(
      (finding) =>
        finding.kind === "observation" &&
        (finding.code === "CHANNEL_COST_LOAD_OF_REVENUE" ||
          finding.code === "COMPANY_COST_STRUCTURE_OF_REVENUE"),
    ),
  );

  const channelWord = (count: number) => `${count} ${count === 1 ? "channel" : "channels"}`;

  const salesTile: PerformanceCardTile = {
    id: "sales",
    value: currentSales ? { kind: "money", money: currentSales } : null,
    unavailableReason: currentSales
      ? null
      : salesDeltaBlockedByCurrency
        ? "These channels reported in more than one currency, so no single total can be stated."
        : `No approved report carried a sales figure for ${periodPhrase}.`,
    deltaPercent: salesDeltaBlockedByCurrency ? null : salesDelta.deltaPercent,
    deltaLabel:
      salesDelta.deltaPercent !== null && !salesDeltaBlockedByCurrency ? deltaLabel : null,
    deltaAbsentReason:
      currentSales && (salesDeltaBlockedByCurrency || salesDelta.deltaPercent === null)
        ? salesDeltaBlockedByCurrency
          ? "Channels reported more than one currency, so no comparison can be stated."
          : (salesDelta.reason ?? NO_EARLIER_PERIOD_REASON)
        : null,
    footnote: hasCostContext ? null : "Costs are not yet included",
  };

  const ordersTile: PerformanceCardTile = {
    id: "orders",
    value: ordersTotal !== null ? { kind: "count", value: ordersTotal } : null,
    unavailableReason:
      ordersTotal !== null
        ? null
        : `No approved report carried an order count for ${periodPhrase}.`,
    deltaPercent: ordersDelta.deltaPercent,
    deltaLabel: ordersDelta.deltaPercent !== null ? deltaLabel : null,
    deltaAbsentReason:
      ordersTotal !== null && ordersDelta.deltaPercent === null
        ? (ordersDelta.reason ?? NO_EARLIER_PERIOD_REASON)
        : null,
    footnote: currentOrders.size > 0 ? channelWord(currentOrders.size) : null,
  };

  const viewsTile: PerformanceCardTile = {
    id: "views",
    value: viewsTotal !== null ? { kind: "count", value: viewsTotal } : null,
    unavailableReason:
      viewsTotal !== null ? null : `No approved report carried menu views for ${periodPhrase}.`,
    deltaPercent: viewsDelta.deltaPercent,
    deltaLabel: viewsDelta.deltaPercent !== null ? deltaLabel : null,
    deltaAbsentReason:
      viewsTotal !== null && viewsDelta.deltaPercent === null
        ? (viewsDelta.reason ?? NO_EARLIER_PERIOD_REASON)
        : null,
    footnote: viewChannelNames.length > 0 ? `${viewChannelNames.join(", ")} only` : null,
  };

  const cancelledTile: PerformanceCardTile = {
    id: "cancelled",
    value: cancelledTotal !== null ? { kind: "count", value: cancelledTotal } : null,
    unavailableReason:
      cancelledTotal !== null
        ? null
        : `No approved report carried a cancellation count for ${periodPhrase}.`,
    deltaPercent: cancelledDelta.deltaPercent,
    deltaLabel: cancelledDelta.deltaPercent !== null ? deltaLabel : null,
    deltaAbsentReason:
      cancelledTotal !== null && cancelledDelta.deltaPercent === null
        ? (cancelledDelta.reason ?? NO_EARLIER_PERIOD_REASON)
        : null,
    footnote: "Review the reasons",
  };

  // The headline is composed by fixed rules from measured movement, never
  // written by a model at render time: the spec bars live model calls during
  // page rendering, so a sentence that reads as model prose must still be a
  // deterministic function of the figures above it.
  const salesDirection =
    salesTile.deltaPercent === null
      ? "none"
      : salesTile.deltaPercent > 0
        ? "up"
        : salesTile.deltaPercent < 0
          ? "down"
          : "flat";
  const firstSentence =
    salesDirection === "up"
      ? "Sales are up."
      : salesDirection === "down"
        ? "Sales are down."
        : salesDirection === "flat"
          ? "Sales held steady."
          : null;
  const secondSentence =
    cancelledTotal === null
      ? null
      : cancelledTotal > 0
        ? "Cancellations still need attention."
        : "No cancellations recorded.";
  // Without a comparison the card still names its period: a lone
  // "Cancellations still need attention." would read as a floating warning
  // rather than a statement about the picked range.
  const neutralTitle = wholeMonth
    ? `Performance for ${monthName(input.month.from)} ${input.month.from.slice(0, 4)}.`
    : `Performance for ${prettyRange(input.month.from, input.month.to)}.`;
  const headline =
    firstSentence && secondSentence
      ? `${firstSentence} ${secondSentence}`
      : (firstSentence ?? (secondSentence ? `${neutralTitle} ${secondSentence}` : neutralTitle));

  const shareByChannel = (records: ReadonlyMap<string, readonly ChannelFindingRecord[]>) => {
    const numerator: number[] = [];
    const denominator: number[] = [];
    for (const [channelId, findings] of records) {
      if (!byId.has(channelId)) continue;
      const share = shareFigure(findings);
      if (share) {
        numerator.push(share.numerator);
        denominator.push(share.denominator);
      }
    }
    const numTotal = numerator.reduce((total, value) => total + value, 0);
    const denTotal = denominator.reduce((total, value) => total + value, 0);
    if (numerator.length === 0 || denTotal === 0) return null;
    return { percent: Math.round((numTotal / denTotal) * 100) };
  };
  const currentShare = shareByChannel(input.current);
  const previousShare = shareByChannel(input.previous);
  const cancelledShare = currentShare
    ? {
        percent: currentShare.percent,
        pointChange: previousShare !== null ? currentShare.percent - previousShare.percent : null,
      }
    : null;

  const shareRows = [...currentGross.entries()].map(([channelId, money]) => ({
    channelId,
    displayName: byId.get(channelId) ?? channelId,
    minorUnits: money.minorUnits,
    currency: money.currency,
  }));
  const shareCurrencies = new Set(shareRows.map((row) => row.currency));
  const shareTotal = shareRows.reduce((total, row) => total + row.minorUnits, 0);
  const [shareCurrency] = shareCurrencies;
  const shares =
    shareRows.length > 0 && shareCurrencies.size === 1 && shareCurrency && shareTotal > 0
      ? {
          rows: shareRows
            .map((row) => ({
              ...row,
              sharePercent: Math.round((row.minorUnits / shareTotal) * 100),
            }))
            .sort((left, right) => right.minorUnits - left.minorUnits),
          totalMinorUnits: shareTotal,
          currency: shareCurrency,
        }
      : null;
  const sharesAbsentReason =
    shares !== null
      ? null
      : shareRows.length === 0
        ? `No channel has a reported sales figure for ${periodPhrase}.`
        : "Channels reported in more than one currency, so shares cannot be combined.";

  const wholeWeeks = wholeWeeksOfRange(input.month);
  const weekLabel = (week: CoveredMonth) =>
    monthName(week.from) === monthName(week.to)
      ? `${dayOfMonth(week.from)}–${dayOfMonth(week.to)} ${monthName(week.from).slice(0, 3)}`
      : `${dayOfMonth(week.from)} ${monthName(week.from).slice(0, 3)}–${dayOfMonth(week.to)} ${monthName(week.to).slice(0, 3)}`;
  const monthBucketLabel = (month: CoveredMonth) =>
    input.month.from.slice(0, 4) === input.month.to.slice(0, 4)
      ? monthName(month.from).slice(0, 3)
      : `${monthName(month.from).slice(0, 3)} ${month.from.slice(2, 4)}`;

  /** One tier's pass over its entries: same currency rule, same sums. */
  const collectTier = (
    entries: readonly {
      window: CoveredMonth;
      records: ReadonlyMap<string, readonly ChannelFindingRecord[]>;
    }[],
    labelOf: (window: CoveredMonth) => string,
  ) => {
    const buckets: { label: string; minorUnits: number }[] = [];
    let currency: string | null = null;
    let blocked = false;
    const channels = new Set<string>();
    for (const entry of entries) {
      const figures = grossByChannel(entry.records);
      if (figures.size === 0) continue;
      const currencies = new Set([...figures.values()].map((figure) => figure.currency));
      if (currencies.size !== 1) {
        blocked = true;
        break;
      }
      const [entryCurrency] = currencies;
      if (currency !== null && entryCurrency !== currency) {
        blocked = true;
        break;
      }
      currency = entryCurrency ?? currency;
      for (const id of figures.keys()) channels.add(id);
      buckets.push({
        label: labelOf(entry.window),
        minorUnits: [...figures.values()].reduce((total, figure) => total + figure.minorUnits, 0),
      });
    }
    return { buckets, currency, blocked, channels };
  };

  // Three tiers, finest first: analysed whole weeks, then analysed whole
  // calendar months, then distinct analysed windows picked for maximum
  // coverage. A tier with fewer than two plotted buckets yields to the next;
  // a coarser tier whose own figures combine cleanly still reads even when a
  // finer tier mixed currencies -- its runs stand alone, and the note names
  // the tier shown.
  const wholeMonths = wholeMonthsOfRange(input.month);
  const weekEntries = wholeWeeks.map((week) => ({
    window: week,
    records:
      input.trendWeeks.find(
        (entry) => entry.window.from === week.from && entry.window.to === week.to,
      )?.records ?? new Map<string, readonly ChannelFindingRecord[]>(),
  }));
  const monthEntries = wholeMonths.map((month) => ({
    window: month,
    records:
      input.trendMonths.find(
        (entry) => entry.window.from === month.from && entry.window.to === month.to,
      )?.records ?? new Map<string, readonly ChannelFindingRecord[]>(),
  }));
  const windowEntries = [...input.trendWindows].sort((left, right) =>
    left.window.from < right.window.from ? -1 : 1,
  );
  const weekTier = collectTier(weekEntries, weekLabel);
  const monthTier = collectTier(monthEntries, monthBucketLabel);
  const windowTier = collectTier(windowEntries, (window) => compactRange(window.from, window.to));
  const readyTier =
    !weekTier.blocked && weekTier.buckets.length >= 2 && weekTier.currency !== null
      ? {
          buckets: weekTier.buckets,
          currency: weekTier.currency,
          coverageNote: wholeMonth
            ? `${weekTier.buckets.length} of ${wholeWeeks.length} ${monthName(input.month.from)} weeks · ${weekTier.channels.size} of ${input.channels.length} channels`
            : `${weekTier.buckets.length} of ${wholeWeeks.length} weeks · ${weekTier.channels.size} of ${input.channels.length} channels`,
        }
      : !monthTier.blocked && monthTier.buckets.length >= 2 && monthTier.currency !== null
        ? {
            buckets: monthTier.buckets,
            currency: monthTier.currency,
            coverageNote: `${monthTier.buckets.length} of ${wholeMonths.length} months · ${monthTier.channels.size} of ${input.channels.length} channels`,
          }
        : !windowTier.blocked && windowTier.buckets.length >= 2 && windowTier.currency !== null
          ? {
              buckets: windowTier.buckets,
              currency: windowTier.currency,
              coverageNote: `${windowTier.buckets.length} analysed windows · ${windowTier.channels.size} of ${input.channels.length} channels`,
            }
          : null;
  // A currency split only refuses the card when no tier could plot: the
  // weeks keep their own reason, coarser tiers share one.
  const trendBlockedByCurrency =
    readyTier === null && (weekTier.blocked || monthTier.blocked || windowTier.blocked);
  const trendCurrencyBlockedInWeeks = readyTier === null && weekTier.blocked;
  const trend: PerformanceCardTrend = readyTier
    ? {
        state: "ready",
        buckets: readyTier.buckets,
        currency: readyTier.currency,
        coverageNote: readyTier.coverageNote,
      }
    : trendBlockedByCurrency
      ? {
          state: "empty",
          reason: trendCurrencyBlockedInWeeks
            ? "Weeks reported in more than one currency."
            : "Periods reported in more than one currency.",
          weeks: wholeWeeks.map(weekLabel),
        }
      : {
          state: "empty",
          reason:
            wholeWeeks.length < 2
              ? wholeMonth
                ? "This month holds fewer than two whole weeks to plot."
                : "The selected period holds fewer than two whole weeks to plot."
              : wholeMonth
                ? "Fewer than two weeks of this month have a completed analysis."
                : "Fewer than two weeks of the selected period have a completed analysis.",
          weeks: wholeWeeks.map(weekLabel),
        };

  const orderChannels = currentOrders.size;
  const locationWord = `${input.locationCount} ${input.locationCount === 1 ? "location" : "locations"}`;
  const footer =
    `Sales and orders: ${channelWord(Math.max(currentGross.size, orderChannels))} · ${locationWord}.` +
    (viewChannelNames.length > 0
      ? ` Menu views: ${viewChannelNames.join(", ")} only.`
      : " Menu views were not reported.");

  const scope = `${input.channelScopeName ?? "all channels"} · ${input.locationScopeName ?? "all locations"}`;
  const files = [...new Set(input.reportFiles)];
  return {
    month: input.month,
    previous,
    channelCount: input.channels.length,
    headline,
    tiles: { sales: salesTile, orders: ordersTile, views: viewsTile, cancelled: cancelledTile },
    cancelledShare,
    trend,
    shares,
    sharesAbsentReason,
    footer,
    sources: {
      reportingPeriod: prettyRange(input.month.from, input.month.to),
      scope,
      salesOrdersNote:
        "Comparable channel reports for the selected period and locations." +
        (files.length > 0 ? ` Filed as ${files.join(", ")}.` : ""),
      menuViewsNote:
        viewChannelNames.length > 0
          ? `${viewChannelNames.join(", ")} listing report only. Menu views are a source-specific traffic measure.`
          : `No approved report carried menu views for ${periodPhrase}.`,
      costNote: hasCostContext
        ? `Cost reports were analysed for ${periodPhrase}; profit is still not stated here.`
        : "Cost reports are missing, so this screen shows reported sales without claiming profit.",
      reportFiles: files,
    },
    fulfillment: {
      ordersPlaced: ordersTotal,
      ordersAbsentReason:
        ordersTotal !== null
          ? null
          : `No approved report carried an order count for ${periodPhrase}.`,
      cancelled: cancelledTotal,
      cancelledAbsentReason:
        cancelledTotal !== null
          ? null
          : `No approved report carried a cancellation count for ${periodPhrase}.`,
    },
  };
}

export function buildChannelsOverviewView(input: {
  channels: readonly { id: string; display_name: string; status: string }[];
  bands: readonly ChannelBandRecord[];
  evidenceWindows: readonly ChannelEvidenceWindow[];
  selected: { windowStart: string; windowEnd: string; grain: AnalysisGrain } | null;
}): ChannelsOverviewView {
  const windows = buildOverviewWindows(input.evidenceWindows);
  const bandByChannel = new Map(input.bands.map((record) => [record.channelId, record]));

  const rows: ChannelsOverviewRow[] = input.channels.map((channel) => {
    const band = bandOf(bandByChannel.get(channel.id));
    return {
      channelId: channel.id,
      displayName: channel.display_name,
      status: channel.status,
      band,
      // Only a complete band is an assessment. A revenue-only channel is
      // covered -- it is named as such below -- but it contributes nothing to
      // the sum, because there is no earned figure to contribute.
      assessed: band.state === "complete",
    };
  });

  // The page resolves which window to read bands for and passes it in, so this
  // only has to recognise it among the declared windows. Inferring it from the
  // bands is not possible and not wanted: the bands were read for exactly one
  // window and carry no window of their own.
  const selected = input.selected;
  const selectedWindow =
    (selected
      ? (windows.find(
          (entry) =>
            entry.windowStart === selected.windowStart &&
            entry.windowEnd === selected.windowEnd &&
            entry.grain === selected.grain,
        ) ?? null)
      : null) ?? null;

  const assessedRows = rows.filter((row) => row.assessed);
  const revenueOnlyRows = rows.filter((row) => row.band.state === "revenue_only");
  const currencies = new Set(
    assessedRows.map((row) => row.band.earned?.currency).filter((code): code is string => !!code),
  );

  let total: EarnedLostPotential = REFUSED;
  let refusalReason: string | null = null;
  if (assessedRows.length === 0) {
    // Saying "nothing has been measured" over a channel that reported its
    // revenue is false, and it is the exact sentence that made a successful
    // import look like a failed one.
    refusalReason = revenueOnlyRows.length > 0 ? NO_COMPLETE_BAND_REASON : NOTHING_ANALYSED_REASON;
  } else if (currencies.size > 1) {
    refusalReason = MIXED_CURRENCY_REASON;
  } else {
    // `currencies` is built by filtering out falsy currency codes, so its
    // size can be 0 even though `assessedRows` is non-empty and `size > 1`
    // is false -- an assessed band's currency is typed `string`, and nothing
    // in that type forbids "". Destructure and check for real rather than
    // asserting the first element exists.
    const [currency] = currencies;
    if (currency === undefined) {
      refusalReason = UNRESOLVED_CURRENCY_REASON;
    } else {
      const sum = (pick: (band: EarnedLostPotential) => AnalysisMoney | null) =>
        assessedRows.reduce((running, row) => running + (pick(row.band)?.minorUnits ?? 0), 0);
      total = {
        potential: { minorUnits: sum((band) => band.potential), currency },
        lost: { minorUnits: sum((band) => band.lost), currency },
        earned: { minorUnits: sum((band) => band.earned), currency },
      };
    }
  }

  return {
    windows,
    selectedWindow,
    total,
    coverage: {
      assessedCount: assessedRows.length,
      channelCount: rows.length,
      revenueOnlyNames: revenueOnlyRows.map((row) => row.displayName),
      unassessedNames: rows
        .filter((row) => row.band.state === "refused")
        .map((row) => row.displayName),
    },
    refusalReason,
    rows,
  };
}
