import type { ChannelBandRecord, ChannelFindingRecord } from "@/modules/analysis/application/ports";
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
const MAX_LOSSES = 24;
const MAX_ACTIONS = 50;

export type RevenueAnalysedWindow = {
  windowStart: string;
  windowEnd: string;
  grain: string;
};

/**
 * Newest-first analysed windows, narrowed to the newest window's grain and
 * capped. Mixed grains are never merged into one series: a week bucket and
 * a month bucket side by side would state a trend nobody measured.
 */
export function selectRevenueWindows(
  keys: readonly RevenueAnalysedWindow[],
): RevenueAnalysedWindow[] {
  const newestGrain = keys[0]?.grain;
  if (!newestGrain) return [];
  return keys.filter((key) => key.grain === newestGrain).slice(0, REVENUE_HISTORY_WINDOWS);
}

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
  /** Newest first; the mapper keeps the newest windows at one grain. */
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

function scenarioGrain(grain: string): RevenueScenarioInput["grain"] {
  if (grain === "day" || grain === "week" || grain === "month") return grain;
  return "period";
}

function windowLabel(window: RevenueAnalysedWindow): string {
  if (window.grain === "month") return window.windowStart.slice(0, 7);
  return window.windowStart;
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

  const newestGrain = input.windows[0]?.grain ?? "period";
  const selected = input.windows
    .map((window, index) => ({ window, bands: input.bands[index] ?? null }))
    .filter((entry) => entry.window.grain === newestGrain)
    .slice(0, REVENUE_HISTORY_WINDOWS);
  if (selected.some((entry) => entry.bands === null)) {
    return { status: "failed", code: "HOME_READ_FAILED" };
  }

  // Oldest first, so the chart reads time-by-time and the last-observation
  // boundary lands on the final point.
  const ordered = [...selected].reverse();

  const history: RevenueScenarioInput["history"] = [];
  const losses: RevenueScenarioInput["losses"] = [];
  const channels = new Set<string>();
  for (const entry of ordered) {
    let bucketMinorUnits = 0;
    let bucketCurrency: string | null = null;
    let bucketMixed = false;
    let bucketEmpty = true;
    for (const band of entry.bands ?? []) {
      const gross = grossFigure(band.findings);
      if (!gross) continue;
      bucketEmpty = false;
      channels.add(band.channelId);
      if (bucketCurrency === null) {
        bucketCurrency = gross.currency.toUpperCase();
      } else if (bucketCurrency !== gross.currency.toUpperCase()) {
        bucketMixed = true;
      }
      bucketMinorUnits += gross.minorUnits;
    }
    // A bucket with no reported gross is omitted, never zero-filled: sparse
    // history shows fewer points, not a fabricated dip.
    if (!bucketEmpty && !bucketMixed && bucketCurrency !== null) {
      history.push({
        label: windowLabel(entry.window),
        minorUnits: bucketMinorUnits,
        currency: bucketCurrency,
      });
    }
    for (const band of entry.bands ?? []) {
      for (const loss of lossFigures(band.findings)) {
        if (losses.length >= MAX_LOSSES) break;
        if (losses.some((existing) => existing.findingId === loss.findingId)) continue;
        losses.push(loss);
      }
    }
  }

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

  const lastObservationDate = ordered[ordered.length - 1]?.window.windowEnd ?? input.today;
  const grainLabel =
    newestGrain === "day" || newestGrain === "week" || newestGrain === "month"
      ? `${newestGrain}ly`
      : "period";
  const parsed = revenueScenarioInputSchema.safeParse({
    organizationId: input.organizationId,
    grain: scenarioGrain(newestGrain),
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
