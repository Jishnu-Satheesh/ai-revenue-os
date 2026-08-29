import {
  describeChannelMoney,
  type AnalysisMoney,
  type ChannelMoney,
  type EarnedLostPotential,
} from "@/domain/analysis/money-split";
import type { AnalysisGrain } from "@/domain/analysis/types";
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
