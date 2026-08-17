import type { CostComponentRate } from "@/domain/economics/types";

/**
 * Choosing which rate priced a period.
 *
 * Two dimensions decide it. A rate is only a candidate if it was in force on
 * the day, and among those the most specific scope wins — the same
 * most-specific-wins order the margin floor uses in
 * `specs/013-margin-firewall.md` section 4.1, so an operator learns one rule
 * rather than two.
 *
 * Dates here are calendar days, `YYYY-MM-DD`, never instants. An operator says
 * a commission tier rose on 1 June, meaning their own 1 June; a Dubai day
 * begins at 20:00 UTC the evening before, so comparing that date against a UTC
 * instant applies every rate change a day late. ISO dates also sort
 * lexicographically, which is why plain comparison is sound here.
 */

/** A calendar day in the period's own timezone, as `YYYY-MM-DD`. */
export type CalendarDate = string;

export type StoredCostRate = CostComponentRate & {
  id: string;
  definitionKey: string;
  /** `null` applies to every channel. */
  channel: string | null;
  /** `null` applies to every branch. */
  branchId: string | null;
  effectiveFrom: CalendarDate;
  /** Exclusive. `null` means still in force. */
  effectiveTo: CalendarDate | null;
};

export type RateScope = {
  /** The local day the period began on. */
  on: CalendarDate;
  channel: string | null;
  branchId: string | null;
};

function isInForce(rate: StoredCostRate, on: CalendarDate): boolean {
  if (rate.effectiveFrom > on) return false;
  return rate.effectiveTo === null || on < rate.effectiveTo;
}

function matchesScope(rate: StoredCostRate, scope: RateScope): boolean {
  if (rate.channel !== null && rate.channel !== scope.channel) return false;
  if (rate.branchId !== null && rate.branchId !== scope.branchId) return false;
  return true;
}

/** A channel-specific rate outranks a branch-specific one, which outranks the default. */
function specificity(rate: StoredCostRate): number {
  return (rate.channel !== null ? 2 : 0) + (rate.branchId !== null ? 1 : 0);
}

/**
 * The rate in force for one component at one scope on one day, or null when
 * nothing covers it.
 *
 * Null is the honest answer for an unpriced component and becomes a `missing`
 * component upstream. Falling back to the nearest rate in time would price a
 * period with a number that was not in force, which is precisely what effective
 * dating exists to prevent: a commission tier change must not retroactively
 * rewrite last month's margin.
 */
export function resolveEffectiveRate(
  rates: readonly StoredCostRate[],
  scope: RateScope,
): StoredCostRate | null {
  const candidates = rates.filter((rate) => isInForce(rate, scope.on) && matchesScope(rate, scope));
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    const difference = specificity(candidate) - specificity(best);
    if (difference !== 0) return difference > 0 ? candidate : best;

    // Equal specificity means one scope, where the no-overlap index allows only
    // one rate per start date. The later start is the more recent revision.
    return candidate.effectiveFrom > best.effectiveFrom ? candidate : best;
  });
}

/** Resolves every component's rate for a scope, keyed by definition. */
export function resolveRatesByKey(
  rates: readonly StoredCostRate[],
  scope: RateScope,
): Map<string, StoredCostRate> {
  const byKey = new Map<string, StoredCostRate[]>();
  for (const rate of rates) {
    const bucket = byKey.get(rate.definitionKey) ?? [];
    bucket.push(rate);
    byKey.set(rate.definitionKey, bucket);
  }

  const resolved = new Map<string, StoredCostRate>();
  for (const [key, bucket] of byKey) {
    const winner = resolveEffectiveRate(bucket, scope);
    if (winner) resolved.set(key, winner);
  }

  return resolved;
}
