import { economicsError } from "@/domain/economics/errors";
import { deriveCompletenessGrade } from "@/domain/economics/margin";
import type {
  CompletenessGrade,
  EconomicsQualityTier,
  MarginSource,
} from "@/domain/economics/types";

/**
 * Combining priced periods into what a channel earned over a window.
 *
 * Four rules do the work, and each exists to stop a specific lie:
 *
 * 1. A window is only as trustworthy as its weakest period. Sixty complete days
 *    and ten indicative ones make an indicative window, the same rule components
 *    already follow in `deriveCompletenessGrade`.
 * 2. An indicative window reports a ceiling, never a figure — and it has no
 *    field to read a figure from, so the API cannot leak one.
 * 3. Mixed margin sources are labelled, not blended. A window holding both
 *    derived and reported periods offers no waterfall, because the components
 *    do not add up to the reported figures and drawing them together would be
 *    the silent reconciliation specs/012 section 4.4.1 forbids.
 * 4. Two currencies are refused, never converted.
 *
 * See `specs/012-channel-economics-ledger.md` sections 4.4 and 7.
 */

/** One stored entry, as the read model hands it over. */
export type LedgerEntry = {
  channel: string | null;
  periodStart: Date;
  grossRevenueMinor: number;
  transactionCount: number;
  currency: string;
  marginSource: MarginSource;
  completenessGrade: CompletenessGrade;
  /** Null exactly when the grade is indicative. */
  contributionMarginMinor: number | null;
  atMostMinor: number | null;
  /**
   * What the source reported for this period, where a derived figure won.
   *
   * Null on a reported entry, and null where the source stated nothing. Only a
   * period holding both figures can disagree with itself.
   */
  reportedMarginMinor: number | null;
  components: readonly RolledComponent[];
};

export type RolledComponent = {
  key: string;
  label: string;
  amountMinor: number;
  qualityTier: EconomicsQualityTier;
};

/** Where a window's margin came from, once its periods are combined. */
export type RolledMarginSource = MarginSource | "mixed";

type ChannelTotals = {
  channel: string | null;
  currency: string;
  grossRevenueMinor: number;
  transactionCount: number;
  periodCount: number;
  marginSource: RolledMarginSource;
  /**
   * Where the derived figure and the source's own differ over the window.
   *
   * Absent when the source reported nothing, and absent when the two agree
   * exactly — a disagreement of zero is agreement, and marking it would make
   * the marker meaningless. specs/012 section 4.4.1 requires this raised rather
   * than reconciled: one of the two is wrong and only the operator knows which.
   */
  disagreement?: MarginDisagreement;
};

export type MarginDisagreement = {
  /** Summed across the periods that carried a reported figure. */
  reportedMinor: number;
  /** Derived less reported. Positive means the rates flatter the export. */
  differenceMinor: number;
  /** How many of the channel's periods carried a figure to compare against. */
  periodCount: number;
  /** Derived rate less reported rate, in points. Null when revenue is zero. */
  differencePoints: number | null;
};

export type ChannelRollup = ChannelTotals &
  (
    | {
        grade: Exclude<CompletenessGrade, "indicative">;
        contributionMarginMinor: number;
        /** A share in `0..1`, absent when revenue is zero. */
        marginRate: number | null;
      }
    | {
        grade: "indicative";
        /**
         * Revenue less everything known, summed across periods. There is
         * deliberately no `contributionMarginMinor` and no `marginRate` here:
         * a caller cannot read a scalar that does not exist, which is how
         * specs/012 section 12 is enforced rather than merely documented.
         */
        atMostMinor: number;
      }
  );

export type WindowRollup = {
  channels: readonly ChannelRollup[];
  currency: string | null;
  /** True when at least one channel can offer a component breakdown. */
  hasAnyDerivedChannel: boolean;
};

export function rollUpWindow(entries: readonly LedgerEntry[]): WindowRollup {
  if (entries.length === 0) return { channels: [], currency: null, hasAnyDerivedChannel: false };

  const currencies = new Set(entries.map((entry) => entry.currency));
  // Never converted, per specs/012 section 11. Two currencies in one window are
  // two different numbers, not one number in two units.
  if (currencies.size > 1)
    throw economicsError("ECONOMICS_CURRENCY_MISMATCH", {
      found: [...currencies].sort().join(","),
    });

  const currency = entries[0].currency;
  const byChannel = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const key = entry.channel ?? "";
    byChannel.set(key, [...(byChannel.get(key) ?? []), entry]);
  }

  const channels = [...byChannel.values()]
    .map((group) => rollUpChannel(group, currency))
    .sort((left, right) => right.grossRevenueMinor - left.grossRevenueMinor);

  return {
    channels,
    currency,
    hasAnyDerivedChannel: channels.some((channel) => channel.marginSource === "derived"),
  };
}

function rollUpChannel(entries: readonly LedgerEntry[], currency: string): ChannelRollup {
  const grossRevenueMinor = sum(entries.map((entry) => entry.grossRevenueMinor));

  const disagreement = rollUpDisagreement(entries, grossRevenueMinor);

  const totals: ChannelTotals = {
    channel: entries[0].channel,
    currency,
    grossRevenueMinor,
    transactionCount: sum(entries.map((entry) => entry.transactionCount)),
    periodCount: entries.length,
    marginSource: rollUpSource(entries),
    ...(disagreement ? { disagreement } : {}),
  };

  const grade = deriveCompletenessGrade(
    entries.map((entry) => ({
      // A period's grade is already the weakest of its own components, so it
      // maps straight onto a tier here rather than being recomputed.
      qualityTier: gradeAsTier(entry.completenessGrade),
    })),
  );

  if (grade === "indicative")
    return {
      ...totals,
      grade,
      // Each period's own upper bound is already revenue less its known costs,
      // so the window's bound is simply their sum. A period that is not itself
      // indicative contributes its exact figure.
      atMostMinor: sum(
        entries.map((entry) => entry.atMostMinor ?? entry.contributionMarginMinor ?? 0),
      ),
    };

  const contributionMarginMinor = sum(entries.map((entry) => entry.contributionMarginMinor ?? 0));

  return {
    ...totals,
    grade,
    contributionMarginMinor,
    // A rate needs something to be a rate of. Zero revenue makes it undefined
    // rather than zero, and showing 0% would read as a real measurement.
    marginRate: grossRevenueMinor === 0 ? null : contributionMarginMinor / grossRevenueMinor,
  };
}

/**
 * A window holding both kinds is `mixed`, which is a label rather than a blend.
 * The view offers no waterfall for it: the components explain only the derived
 * periods and would not add up to the total on screen.
 */
function rollUpSource(entries: readonly LedgerEntry[]): RolledMarginSource {
  const sources = new Set(entries.map((entry) => entry.marginSource));
  if (sources.size > 1) return "mixed";
  return entries[0].marginSource;
}

/**
 * Maps a period's grade onto the tier scale so one weakest-wins rule serves
 * both components and periods. `partial` maps to `estimated` because both mean
 * "usable but not fully measured"; the exact tier is irrelevant, only its rank.
 */
function gradeAsTier(grade: CompletenessGrade): EconomicsQualityTier {
  if (grade === "indicative") return "missing";
  if (grade === "partial") return "estimated";
  return "measured";
}

/**
 * The component waterfall for one channel over a window.
 *
 * Offered only for a wholly derived channel. Amounts are summed per component
 * key across periods, and a component that was missing in any period stays
 * missing for the window — a cost known on some days and not others is not a
 * known cost.
 */
/**
 * Where the derived figure and the source's own disagree over a window.
 *
 * Only periods that carry both are compared: a channel where the export was
 * silent for half the window would otherwise look like it disagreed by the
 * value of the missing half. The rate is computed from those periods' revenue
 * alone for the same reason.
 *
 * Returns nothing when the two agree exactly. Every non-zero gap is surfaced —
 * there is no threshold below which a contradiction stops being one — but a
 * difference of zero is agreement, not a very small disagreement.
 */
function rollUpDisagreement(
  entries: readonly LedgerEntry[],
  _grossRevenueMinor: number,
): MarginDisagreement | undefined {
  const comparable = entries.filter(
    (entry) => entry.reportedMarginMinor !== null && entry.contributionMarginMinor !== null,
  );
  if (comparable.length === 0) return undefined;

  const reportedMinor = sum(comparable.map((entry) => entry.reportedMarginMinor ?? 0));
  const derivedMinor = sum(comparable.map((entry) => entry.contributionMarginMinor ?? 0));
  const differenceMinor = derivedMinor - reportedMinor;
  if (differenceMinor === 0) return undefined;

  const comparableRevenueMinor = sum(comparable.map((entry) => entry.grossRevenueMinor));

  return {
    reportedMinor,
    differenceMinor,
    periodCount: comparable.length,
    differencePoints:
      comparableRevenueMinor === 0 ? null : (differenceMinor / comparableRevenueMinor) * 100,
  };
}

export function rollUpComponents(entries: readonly LedgerEntry[]): RolledComponent[] {
  const byKey = new Map<string, RolledComponent>();

  for (const entry of entries) {
    for (const component of entry.components) {
      const existing = byKey.get(component.key);
      if (!existing) {
        byKey.set(component.key, { ...component });
        continue;
      }

      byKey.set(component.key, {
        key: component.key,
        label: component.label,
        amountMinor: existing.amountMinor + component.amountMinor,
        qualityTier: weakestTier(existing.qualityTier, component.qualityTier),
      });
    }
  }

  return [...byKey.values()].sort((left, right) => right.amountMinor - left.amountMinor);
}

const TIER_RANK: Readonly<Record<EconomicsQualityTier, number>> = {
  missing: 0,
  assumed: 1,
  estimated: 2,
  derived: 3,
  measured: 4,
};

function weakestTier(left: EconomicsQualityTier, right: EconomicsQualityTier) {
  return TIER_RANK[left] <= TIER_RANK[right] ? left : right;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
