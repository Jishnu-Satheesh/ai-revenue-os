import { startOfPeriod } from "@/domain/metrics/periods";
import {
  rollUpComponents,
  rollUpWindow,
  type LedgerEntry,
  type RolledComponent,
  type WindowRollup,
} from "@/domain/economics/rollup";

/**
 * What the channel economics view reads.
 *
 * The rollup rules live in the domain; this assembles the window, picks the
 * channel to break down, and decides what the operator still has to fix. The
 * last part is the retention mechanism in `specs/012` section 7: a data-quality
 * problem turned into a task list.
 */

export type EconomicsWindowPreset = "7d" | "30d" | "90d";

const PRESET_DAYS: Readonly<Record<EconomicsWindowPreset, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export type EconomicsWindow = {
  preset: EconomicsWindowPreset;
  rangeStart: Date;
  rangeEndExclusive: Date;
  timeZone: string;
};

/**
 * The window a preset means, in the branch's own days.
 *
 * Anchored to the start of today locally rather than to `now`, so the range
 * covers whole days and does not slice the current one at an arbitrary hour.
 */
export function resolveWindow(input: {
  preset: EconomicsWindowPreset;
  timeZone: string;
  now: Date;
}): EconomicsWindow {
  const endExclusive = startOfPeriod(input.now, "day", input.timeZone);
  const rangeStart = startOfPeriod(
    new Date(endExclusive.getTime() - PRESET_DAYS[input.preset] * 86_400_000),
    "day",
    input.timeZone,
  );

  return {
    preset: input.preset,
    rangeStart,
    rangeEndExclusive: endExclusive,
    timeZone: input.timeZone,
  };
}

/** A component the organization could price but has not, or has only guessed at. */
export type TrustGap = {
  key: string;
  label: string;
  /**
   * `unpriced` — no rate, and the operator can supply one.
   * `not_yet_possible` — the platform cannot use a rate yet, so asking for one
   *   would be a task the operator can never complete.
   * `weak` — priced, but from an estimate or a guess rather than a document.
   */
  state: "unpriced" | "not_yet_possible" | "weak";
  reason: string;
};

/**
 * How much of the cost structure is known, as counts rather than a bare ratio.
 *
 * Counted over the registered catalog, not over the entries. A `reported`
 * margin carries no components at all, so an entries-based measure reads zero
 * for an organization that has in fact priced most of its costs — the exact
 * client the task list is meant to encourage.
 */
export type CostCoverage = {
  /** Priced from a document rather than an estimate or a guess. */
  measured: number;
  /** Priced at all, at any confidence. */
  priced: number;
  /** Registered components, including the ones nothing can price yet. */
  applicable: number;
};

export type EconomicsView = {
  window: EconomicsWindow;
  rollup: WindowRollup;
  /** The channel whose breakdown is shown, and its components. */
  breakdown: { channel: string | null; components: readonly RolledComponent[] } | null;
  gaps: readonly TrustGap[];
  coverage: CostCoverage;
  /**
   * False when the catalog could not be read at all. Distinguished from "no
   * gaps", because rendering an all-clear on an empty read would tell the
   * operator their cost structure is complete when nothing was checked.
   */
  catalogAvailable: boolean;
};

export type EconomicsCatalogEntry = {
  key: string;
  label: string;
  computationKind: "fixed_amount" | "rate_of_revenue" | "per_unit" | "sourced";
  hasRate: boolean;
  weakestTier: "measured" | "derived" | "estimated" | "assumed" | null;
};

export function buildEconomicsView(input: {
  window: EconomicsWindow;
  entries: readonly LedgerEntry[];
  catalog: readonly EconomicsCatalogEntry[];
  /** Which channel the operator selected, if any. */
  selectedChannel?: string | null;
}): EconomicsView {
  const rollup = rollUpWindow(input.entries);

  // A breakdown is offered only for a wholly derived channel. A reported or
  // mixed one has components that do not add up to the figure on screen, and
  // showing them would be exactly the silent reconciliation 4.4.1 forbids.
  const breakdownChannel =
    rollup.channels.find(
      (channel) =>
        channel.marginSource === "derived" &&
        (input.selectedChannel === undefined || channel.channel === input.selectedChannel),
    ) ?? rollup.channels.find((channel) => channel.marginSource === "derived");

  const breakdown = breakdownChannel
    ? {
        channel: breakdownChannel.channel,
        components: rollUpComponents(
          input.entries.filter((entry) => entry.channel === breakdownChannel.channel),
        ),
      }
    : null;

  return {
    window: input.window,
    rollup,
    breakdown,
    gaps: input.catalog.flatMap(toGap),
    coverage: {
      measured: input.catalog.filter(
        (component) => component.weakestTier === "measured" || component.weakestTier === "derived",
      ).length,
      priced: input.catalog.filter((component) => component.hasRate).length,
      applicable: input.catalog.length,
    },
    catalogAvailable: input.catalog.length > 0,
  };
}

function toGap(component: EconomicsCatalogEntry): TrustGap[] {
  // Covered components come first, whatever their kind. A sourced component
  // whose provider data has arrived is not a gap, and listing it as one while
  // its amount is visible in the waterfall tells the operator two contradictory
  // things at once.
  if (
    component.hasRate &&
    component.weakestTier !== "estimated" &&
    component.weakestTier !== "assumed"
  )
    return [];

  // A sourced component with nothing behind it needs a provider feed, not a
  // rate, so it may not appear as a task with a button: an action nobody can
  // complete is worse than no action at all.
  if (component.computationKind === "sourced")
    return [
      {
        key: component.key,
        label: component.label,
        state: "not_yet_possible",
        reason: "Comes from provider reports rather than a rate you can enter.",
      },
    ];

  // The same for a per-unit cost with no unit count being imported: no rate the
  // operator could type would price it.
  if (component.computationKind === "per_unit" && !component.hasRate)
    return [
      {
        key: component.key,
        label: component.label,
        state: "not_yet_possible",
        reason: "Charged per item, and no item count is being imported yet.",
      },
    ];

  if (!component.hasRate)
    return [
      {
        key: component.key,
        label: component.label,
        state: "unpriced",
        reason: "No rate recorded, so this cost is missing from every margin.",
      },
    ];

  if (component.weakestTier === "estimated" || component.weakestTier === "assumed")
    return [
      {
        key: component.key,
        label: component.label,
        state: "weak",
        reason:
          component.weakestTier === "assumed"
            ? "A rough guess. Confirming it upgrades every margin it touches."
            : "A worked estimate rather than a contract figure.",
      },
    ];

  return [];
}
