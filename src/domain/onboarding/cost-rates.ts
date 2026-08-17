import {
  costEffectiveFromSchema,
  costRateEntriesSchema,
  isPricedCostRate,
} from "@/domain/onboarding/vocabularies";

/**
 * Turns the costs an operator typed into the rate rows the ledger prices
 * against.
 *
 * Kept apart from the database call because this is where the judgement is: a
 * percentage becomes a fraction, an absolute amount keeps the organization's
 * currency and a share does not, and a row the operator opened but never filled
 * is not a rate at all. Getting any of those wrong silently mis-prices every
 * margin that follows.
 *
 * See `specs/012-channel-economics-ledger.md` section 6.
 */

export type CostRateRow = {
  definition_id: string;
  branch_id: string | null;
  channel: string | null;
  amount_minor: number | null;
  rate_of_revenue: number | null;
  currency: string | null;
  quality_tier: "measured" | "estimated" | "assumed";
  source_reference: string | null;
  effective_from: string;
};

export function toCostRateRows(
  payload: Record<string, unknown>,
  context: { definitionIdByKey: ReadonlyMap<string, string>; baseCurrency: string },
): CostRateRow[] {
  const entries = costRateEntriesSchema.safeParse(payload.costRates);
  const effectiveFrom = costEffectiveFromSchema.safeParse(payload.effectiveFrom);
  if (!entries.success || !effectiveFrom.success) return [];

  const sourceReference =
    typeof payload.sourceNotes === "string" && payload.sourceNotes.trim()
      ? payload.sourceNotes.trim()
      : null;

  return entries.data.flatMap((entry) => {
    // A row opened and never filled is not a rate. Writing it as one would turn
    // "I have not told you yet" into a priced zero and inflate every margin it
    // touches — the single most expensive mistake this path can make.
    if (!isPricedCostRate(entry)) return [];

    const definitionId = context.definitionIdByKey.get(entry.componentKey);
    // Only reachable if a definition was deactivated between the form being
    // rendered and saved, since the catalog is what the operator was offered.
    if (!definitionId) return [];

    return [
      {
        definition_id: definitionId,
        // Organization-wide. Branch-level rates arrive with the operator
        // surface; onboarding asks once, for the business as a whole.
        branch_id: null,
        channel: entry.channel,
        amount_minor: entry.amountMinor,
        // Percent to fraction. The rate column is a share in 0..1, and storing
        // 28 where 0.28 belongs would price a period at 28 times its cost.
        rate_of_revenue: entry.percent === null ? null : entry.percent / 100,
        // Money needs its currency and a share does not; the rate table rejects
        // a row that disagrees with that.
        currency: entry.amountMinor === null ? null : context.baseCurrency,
        quality_tier: entry.confidence,
        source_reference: sourceReference,
        effective_from: effectiveFrom.data,
      },
    ];
  });
}
