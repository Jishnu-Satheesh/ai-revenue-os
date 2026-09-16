import type { ChannelBandRecord, ChannelFindingRecord } from "@/modules/analysis/application/ports";
import { compactRange, pickTrendWindows } from "@/modules/analysis/application/channels-overview";
import { localDaysBetween } from "@/domain/analysis/calendar";
import {
  revenueScenarioInputSchema,
  type RevenueScenarioAction,
  type RevenueScenarioInput,
} from "@/domain/organizations/revenue-scenario";

/**
 * Pure translation from settled home reads to a `RevenueScenarioInput`.
 *
 * Companion spec:
 * `docs/superpowers/specs/2026-09-11-organization-home-revenue-scenario.md`
 * (§§2–9, §14 selections, §16 amendment).
 *
 * The loader owns every read; this module only reshapes what already
 * settled. History comes from analysed-window money bands (reported gross,
 * never modelled), observed losses from the cancellation-loss observations
 * inside those same bands, and the §14(a) action set from recommendations,
 * campaign proposals, and growth insights. Anything without a cited monetary
 * basis stays unquantified downstream — never zeroed, never blocking.
 *
 * Forbidden origins stay out by construction: nothing here sums
 * `value.ts` ranking quantities, maps money-split potential/earned, reuses
 * measurement verdicts, or compounds a period movement into a rate. The
 * builder re-checks currency and citation before any figure ships.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export const REVENUE_HISTORY_WINDOWS = 8;
/** Band reads per load: newest keys first, the mapper picks from them. */
export const MAX_REVENUE_WINDOW_READS = 12;
/**
 * Windows longer than about a quarter never join the history series: a
 * year-long total beside a month bucket would read as a trend nobody
 * measured. Their loss findings still count as cited inputs below.
 */
export const MAX_HISTORY_WINDOW_DAYS = 93;
const MAX_LOSSES = 24;
const MAX_ACTIONS = 50;

export type RevenueAnalysedWindow = {
  windowStart: string;
  windowEnd: string;
  grain: string;
};

export type RevenueRecommendationRow = {
  id: string;
  headline: string;
  decision: { decision: string } | null;
  citationFindingIds?: readonly string[];
};

export type RevenueInsightRow = {
  id: string;
  narrative: string;
  decision: string | null;
};

export type RevenueProposalRow = {
  proposalId: string;
  title: string;
  state: string;
  lastDecision: { decision: string } | null;
};

export type MapRevenueInputsInput = {
  organizationId: string;
  /** Newest first, any grain; the mapper picks a comparable series. */
  windows: readonly RevenueAnalysedWindow[];
  /** Aligned with `windows`; null marks that window's band read failed. */
  bands: readonly (readonly ChannelBandRecord[] | null)[];
  recommendations: readonly RevenueRecommendationRow[];
  insights: readonly RevenueInsightRow[];
  proposals: readonly RevenueProposalRow[];
  /** Inclusive local date the section is rendered for. */
  today: string;
};

export type MapRevenueInputsResult =
  | { status: "ready"; input: RevenueScenarioInput }
  | { status: "failed"; code: "HOME_READ_FAILED" };

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function cleanTitle(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "Untitled action";
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

function cleanStatus(value: string | null): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return "New";
  return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
}

function minStart(dates: readonly string[]): string {
  return dates.length > 0 ? ([...dates].sort()[0] ?? "") : "";
}

function maxEnd(dates: readonly string[]): string {
  const sorted = [...dates].sort();
  return sorted.length > 0 ? (sorted[sorted.length - 1] ?? "") : "";
}

function windowDays(window: RevenueAnalysedWindow): number | null {
  if (!DATE_PATTERN.test(window.windowStart) || !DATE_PATTERN.test(window.windowEnd)) return null;
  if (window.windowEnd < window.windowStart) return null;
  return localDaysBetween(window.windowStart, window.windowEnd) + 1;
}

function isWholeCalendarMonth(window: RevenueAnalysedWindow): boolean {
  if (!DATE_PATTERN.test(window.windowStart) || !DATE_PATTERN.test(window.windowEnd)) {
    return false;
  }
  if (!window.windowStart.endsWith("-01")) return false;
  const [year, month] = window.windowStart.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (
    window.windowEnd === `${window.windowStart.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`
  );
}

function windowLabel(window: RevenueAnalysedWindow, days: number): string {
  if (isWholeCalendarMonth(window)) return window.windowStart.slice(0, 7);
  if (days <= 0) return window.windowStart;
  return compactRange(window.windowStart, window.windowEnd);
}

function seriesGrain(
  days: readonly number[],
  monthShaped: readonly boolean[],
): RevenueScenarioInput["grain"] {
  if (days.length > 0 && days.every((length) => length === 1)) return "day";
  if (days.length > 0 && days.every((length) => length === 7)) return "week";
  if (monthShaped.length > 0 && monthShaped.every((shaped) => shaped)) return "month";
  return "period";
}

function grossFigure(
  findings: readonly ChannelFindingRecord[] | undefined,
): { minorUnits: number; currency: string } | null {
  const finding = findings?.find(
    (entry) => entry.kind === "observation" && entry.code === "WINDOW_GROSS_REVENUE",
  );
  if (!finding || finding.valueKind !== "money") return null;
  if (finding.valueNumerator === null || finding.currency === null) return null;
  return { minorUnits: finding.valueNumerator, currency: finding.currency };
}

function lossFigures(
  findings: readonly ChannelFindingRecord[] | undefined,
): { findingId: string; minorUnits: number; currency: string }[] {
  if (!findings) return [];
  const losses: { findingId: string; minorUnits: number; currency: string }[] = [];
  for (const finding of findings) {
    if (finding.kind !== "observation" || finding.code !== "ORDER_CANCELLATION_LOSS") continue;
    if (finding.monetaryImpactMinorUnits === null || finding.currency === null) continue;
    if (!isUuid(finding.id)) continue;
    losses.push({
      findingId: finding.id,
      minorUnits: finding.monetaryImpactMinorUnits,
      currency: finding.currency,
    });
  }
  return losses;
}

/**
 * Reshapes settled reads into a validated scenario input. A failed band
 * read for any selected window fails the section rather than leaving a
 * silent hole in the middle of the chart. Validation failure also fails
 * rather than shipping a hand-repaired input.
 */
export function mapRevenueInputs(input: MapRevenueInputsInput): MapRevenueInputsResult {
  if (!isUuid(input.organizationId)) return { status: "failed", code: "HOME_READ_FAILED" };
  if (!DATE_PATTERN.test(input.today)) return { status: "failed", code: "HOME_READ_FAILED" };
  // Misaligned reads are a settling defect, so they fail. Empty windows are
  // honest, not defective: the builder below refuses with its no-history
  // reason and the surface says so.
  if (input.bands.length !== input.windows.length) {
    return { status: "failed", code: "HOME_READ_FAILED" };
  }

  const entries = input.windows.map((window, index) => ({
    window,
    bands: input.bands[index] ?? null,
  }));
  if (entries.some((entry) => entry.bands === null)) {
    return { status: "failed", code: "HOME_READ_FAILED" };
  }

  type CandidateBucket = {
    window: RevenueAnalysedWindow;
    days: number;
    monthShaped: boolean;
    minorUnits: number;
    currency: string;
    channels: readonly string[];
  };
  const candidates: CandidateBucket[] = [];
  const losses: RevenueScenarioInput["losses"] = [];
  // Losses ride every settled window, newest first: each loss is an
  // individually cited input, so bucket comparability never gates them.
  // History buckets are picked from the same reads below.
  for (const entry of entries) {
    for (const band of entry.bands ?? []) {
      for (const loss of lossFigures(band.findings)) {
        if (losses.length >= MAX_LOSSES) break;
        if (losses.some((existing) => existing.findingId === loss.findingId)) continue;
        losses.push(loss);
      }
    }
    const days = windowDays(entry.window);
    if (days === null || days > MAX_HISTORY_WINDOW_DAYS) continue;
    let bucketMinorUnits = 0;
    let bucketCurrency: string | null = null;
    let bucketMixed = false;
    let bucketEmpty = true;
    const bucketChannels = new Set<string>();
    for (const band of entry.bands ?? []) {
      const gross = grossFigure(band.findings);
      if (!gross) continue;
      bucketEmpty = false;
      bucketChannels.add(band.channelId);
      if (bucketCurrency === null) {
        bucketCurrency = gross.currency.toUpperCase();
      } else if (bucketCurrency !== gross.currency.toUpperCase()) {
        bucketMixed = true;
      }
      bucketMinorUnits += gross.minorUnits;
    }
    // A bucket with no reported gross is omitted, never zero-filled: sparse
    // history shows fewer points, not a fabricated dip. A mixed-currency
    // bucket is omitted for the same reason a mixed scenario is refused.
    if (bucketEmpty || bucketMixed || bucketCurrency === null) continue;
    candidates.push({
      window: entry.window,
      days,
      monthShaped: isWholeCalendarMonth(entry.window),
      minorUnits: bucketMinorUnits,
      currency: bucketCurrency,
      channels: [...bucketChannels],
    });
  }

  // Maximum coverage without overlap, ties preferring more windows — the same
  // discipline as the performance card's third trend tier. A lone surviving
  // bucket still anchors a baseline; nothing is interpolated between points.
  const pickedKeys = pickTrendWindows(
    candidates.map((candidate) => ({
      from: candidate.window.windowStart,
      to: candidate.window.windowEnd,
    })),
    {
      from: minStart(candidates.map((candidate) => candidate.window.windowStart)),
      to: maxEnd(candidates.map((candidate) => candidate.window.windowEnd)),
    },
    REVENUE_HISTORY_WINDOWS,
  );
  const pickedSet = new Set(pickedKeys.map((key) => `${key.from}|${key.to}`));
  let picked = candidates.filter((candidate) =>
    pickedSet.has(`${candidate.window.windowStart}|${candidate.window.windowEnd}`),
  );
  if (picked.length === 0 && candidates.length > 0) {
    picked = [...candidates]
      .sort(
        (left, right) =>
          right.days - left.days || (right.window.windowEnd < left.window.windowEnd ? -1 : 1),
      )
      .slice(0, 1);
  }
  // Oldest first, so the chart reads time-by-time and the last-observation
  // boundary lands on the final point.
  picked.sort((left, right) => (left.window.windowStart < right.window.windowStart ? -1 : 1));

  const history: RevenueScenarioInput["history"] = picked.map((candidate) => ({
    label: windowLabel(candidate.window, candidate.days),
    minorUnits: candidate.minorUnits,
    currency: candidate.currency,
  }));
  const channels = new Set(picked.flatMap((candidate) => candidate.channels));

  const lossByFindingId = new Map(losses.map((loss) => [loss.findingId, loss]));
  const growthUrl = `/organizations/${input.organizationId}/growth-intelligence`;

  const actions: RevenueScenarioAction[] = [];
  for (const row of input.recommendations) {
    if (actions.length >= MAX_ACTIONS) break;
    const citedFindingId = row.citationFindingIds?.find((id) => lossByFindingId.has(id)) ?? null;
    const basis = citedFindingId !== null ? (lossByFindingId.get(citedFindingId) ?? null) : null;
    actions.push({
      id: `rec:${row.id}`,
      title: cleanTitle(row.headline),
      kind: "recommendation",
      status: cleanStatus(row.decision?.decision ?? null),
      href: growthUrl,
      citedFindingId: basis?.findingId ?? null,
      citedBasisMinorUnits: basis?.minorUnits ?? null,
      citedCurrency: basis?.currency ?? null,
      // No evidenced per-action estimator exists yet: the deterministic
      // slice leaves the response fraction empty and the AI proposal route
      // attaches validated ranges later via applyProposedRanges.
      assumptionLow: null,
      assumptionHigh: null,
    });
  }
  for (const row of input.proposals) {
    if (actions.length >= MAX_ACTIONS) break;
    actions.push({
      id: `proposal:${row.proposalId}`,
      title: cleanTitle(row.title),
      kind: "proposal",
      status: cleanStatus(row.lastDecision?.decision ?? row.state),
      href: `/organizations/${input.organizationId}/campaign-proposals/${row.proposalId}`,
      citedFindingId: null,
      citedBasisMinorUnits: null,
      citedCurrency: null,
      assumptionLow: null,
      assumptionHigh: null,
    });
  }
  for (const row of input.insights) {
    if (actions.length >= MAX_ACTIONS) break;
    actions.push({
      id: `insight:${row.id}`,
      title: cleanTitle(row.narrative),
      kind: "insight",
      status: cleanStatus(row.decision),
      href: growthUrl,
      citedFindingId: null,
      citedBasisMinorUnits: null,
      citedCurrency: null,
      assumptionLow: null,
      assumptionHigh: null,
    });
  }

  const lastObservationDate = picked[picked.length - 1]?.window.windowEnd ?? input.today;
  const grain = seriesGrain(
    picked.map((candidate) => candidate.days),
    picked.map((candidate) => candidate.monthShaped),
  );
  const grainLabel =
    grain === "day"
      ? "daily"
      : grain === "week"
        ? "weekly"
        : grain === "month"
          ? "monthly"
          : "period";
  const parsed = revenueScenarioInputSchema.safeParse({
    organizationId: input.organizationId,
    grain,
    history,
    losses,
    actions,
    lastObservationDate,
    today: input.today,
    cutoffNote: `Reports through ${lastObservationDate}.`,
    coverageNote:
      channels.size === 0
        ? "No reporting channels."
        : `${channels.size} reporting channel${channels.size === 1 ? "" : "s"} · ${grainLabel} buckets.`,
  });
  if (!parsed.success) return { status: "failed", code: "HOME_READ_FAILED" };
  return { status: "ready", input: parsed.data };
}
