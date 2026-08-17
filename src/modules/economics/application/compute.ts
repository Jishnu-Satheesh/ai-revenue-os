import { economicsError } from "@/domain/economics/errors";
import {
  computeDerivedMargin,
  selectEntryMargin,
  type MarginDisagreement,
} from "@/domain/economics/margin";
import { resolveRatesByKey, type StoredCostRate } from "@/domain/economics/rates";
import type {
  CostComponentDefinition,
  EconomicsQualityTier,
  MarginOutcome,
} from "@/domain/economics/types";
import { toCalendarDate } from "@/domain/metrics/periods";
import type { MetricObservationRecord } from "@/modules/metrics/application/ports";

/**
 * Turns metric series into priced periods.
 *
 * Each period is priced against the rates in force **for that period**, not the
 * rates in force today. A commission tier that rose in June must leave May's
 * margin untouched, which is the whole reason rates are effective-dated, and it
 * is also why this cannot be one aggregate query with today's percentages
 * applied to a total.
 *
 * See `specs/012-channel-economics-ledger.md`.
 */

/** A period's inputs, already grouped from the metric series. */
export type EconomicsPeriodInput = {
  periodStart: Date;
  periodEnd: Date;
  periodTimezone: string;
  channel: string | null;
  grossRevenueMinor: number;
  transactionCount: number;
  unitCount?: number;
  currency: string;
  /** A margin the source stated outright, if it supplied one. */
  reportedMarginMinor?: number;
  /** The tier of that stated figure, which is the tier the entry inherits. */
  reportedQualityTier?: Exclude<EconomicsQualityTier, "missing">;
  /** Costs a provider reported outright for this period, keyed by component. */
  sourcedAmounts?: Readonly<
    Record<string, { amountMinor: number; qualityTier: Exclude<EconomicsQualityTier, "missing"> }>
  >;
};

export type ComputedEntry = {
  periodStart: Date;
  periodEnd: Date;
  periodTimezone: string;
  channel: string | null;
  grossRevenueMinor: number;
  transactionCount: number;
  unitCount?: number;
  currency: string;
  margin: MarginOutcome;
  /**
   * Which stored rate priced each component, keyed by component. A component
   * that ended up `missing` is absent here even where a rate existed, because
   * no rate produced its amount.
   */
  rateIdByComponentKey: Readonly<Record<string, string>>;
  /** Set only when a derived figure and a reported one both stand and disagree. */
  reportedDisagreement?: MarginDisagreement;
};

export type ComputeEntriesInput = {
  periods: readonly EconomicsPeriodInput[];
  definitions: readonly CostComponentDefinition[];
  rates: readonly StoredCostRate[];
  branchId: string | null;
  /** Absolute minor units, not a percentage: a small gap on a tiny period is not alarming. */
  reconciliationToleranceMinor?: number;
};

export function computeEntries(input: ComputeEntriesInput): ComputedEntry[] {
  return input.periods.map((period) => {
    const rates = resolveRatesByKey(input.rates, {
      // The local day the period began, so a mid-range rate change splits the
      // range at the right boundary instead of repricing everything — and at
      // the operator's own boundary, not UTC's.
      on: toCalendarDate(period.periodStart, period.periodTimezone),
      channel: period.channel,
      branchId: input.branchId,
    });

    const derived = computeDerivedMargin({
      basis: {
        grossRevenueMinor: period.grossRevenueMinor,
        transactionCount: period.transactionCount,
        unitCount: period.unitCount,
        currency: period.currency,
        ...(period.sourcedAmounts ? { sourcedAmounts: period.sourcedAmounts } : {}),
      },
      channel: period.channel,
      definitions: input.definitions,
      rates: [...rates.values()],
    });

    const selected = selectEntryMargin({
      derived,
      ...(period.reportedMarginMinor === undefined
        ? {}
        : {
            reported: {
              contributionMarginMinor: period.reportedMarginMinor,
              // An untiered report is the operator's own statement about their
              // business, which is what `assumed` means everywhere else.
              qualityTier: period.reportedQualityTier ?? "assumed",
            },
          }),
      ...(input.reconciliationToleranceMinor === undefined
        ? {}
        : { toleranceMinor: input.reconciliationToleranceMinor }),
    });

    // A reported margin carries no waterfall, so it attributes no rates either.
    const rateIdByComponentKey: Record<string, string> = {};
    if (selected.margin.marginSource === "derived") {
      for (const component of selected.margin.components) {
        const rateId = rates.get(component.key)?.id;
        if (component.qualityTier !== "missing" && rateId)
          rateIdByComponentKey[component.key] = rateId;
      }
    }

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      periodTimezone: period.periodTimezone,
      channel: period.channel,
      grossRevenueMinor: period.grossRevenueMinor,
      transactionCount: period.transactionCount,
      ...(period.unitCount === undefined ? {} : { unitCount: period.unitCount }),
      currency: period.currency,
      margin: selected.margin,
      rateIdByComponentKey,
      ...(selected.disagreement ? { reportedDisagreement: selected.disagreement } : {}),
    };
  });
}

/**
 * Groups metric points into the periods the ledger prices.
 *
 * Revenue is the spine: a period with costs or counts but no revenue has
 * nothing to take a margin of, and inventing a zero-revenue period would put a
 * meaningless row in the ledger for every day a channel happened to report a
 * stray number.
 */
export function groupPeriods(input: {
  revenue: readonly MetricObservationRecord[];
  transactions?: readonly MetricObservationRecord[];
  units?: readonly MetricObservationRecord[];
  reportedMargin?: readonly MetricObservationRecord[];
  /**
   * One series per `sourced` component, keyed by component. Each is a cost the
   * provider reported per period rather than one computed from a rate.
   */
  sourced?: Readonly<Record<string, readonly MetricObservationRecord[]>>;
  periodEndFor: (periodStart: Date) => Date;
}): EconomicsPeriodInput[] {
  const keyOf = (record: MetricObservationRecord) =>
    `${record.periodStart.getTime()}::${record.channel ?? ""}`;

  const index = (records: readonly MetricObservationRecord[] | undefined) =>
    new Map((records ?? []).map((record) => [keyOf(record), record]));

  const transactions = index(input.transactions);
  const units = index(input.units);
  const reported = index(input.reportedMargin);
  const sourced = Object.entries(input.sourced ?? {}).map(
    ([componentKey, records]) => [componentKey, index(records)] as const,
  );

  return input.revenue.map((record) => {
    const key = keyOf(record);
    const unitRecord = units.get(key);
    const reportedRecord = reported.get(key);

    // A money series always carries its currency, so an absent one means the
    // series is not what the caller thinks it is. Substituting a default here
    // would silently price a period in the wrong money.
    if (record.currency === null)
      throw economicsError("ECONOMICS_CURRENCY_MISSING", {
        periodStart: record.periodStart.toISOString(),
        channel: record.channel ?? "",
      });

    // Never converted, per specs/012 section 11: a reported margin in another
    // currency is a different number, not the same one in other units.
    if (reportedRecord && reportedRecord.currency !== record.currency)
      throw economicsError("ECONOMICS_CURRENCY_MISMATCH", {
        periodStart: record.periodStart.toISOString(),
        revenue: record.currency,
        reported: reportedRecord.currency ?? "",
      });

    const sourcedAmounts: Record<
      string,
      { amountMinor: number; qualityTier: Exclude<EconomicsQualityTier, "missing"> }
    > = {};
    for (const [componentKey, byPeriod] of sourced) {
      const sourcedRecord = byPeriod.get(key);
      if (!sourcedRecord) continue;

      // A sourced cost is money, so a mismatched currency is a different number
      // rather than the same one in other units.
      if (sourcedRecord.currency !== record.currency)
        throw economicsError("ECONOMICS_CURRENCY_MISMATCH", {
          periodStart: record.periodStart.toISOString(),
          component: componentKey,
          revenue: record.currency,
          sourced: sourcedRecord.currency ?? "",
        });

      sourcedAmounts[componentKey] = {
        amountMinor: sourcedRecord.numerator,
        qualityTier: sourcedRecord.qualityTier,
      };
    }

    return {
      periodStart: record.periodStart,
      periodEnd: input.periodEndFor(record.periodStart),
      periodTimezone: record.periodTimezone,
      channel: record.channel,
      grossRevenueMinor: record.numerator,
      transactionCount: transactions.get(key)?.numerator ?? 0,
      ...(unitRecord ? { unitCount: unitRecord.numerator } : {}),
      currency: record.currency,
      ...(Object.keys(sourcedAmounts).length > 0 ? { sourcedAmounts } : {}),
      ...(reportedRecord
        ? {
            reportedMarginMinor: reportedRecord.numerator,
            reportedQualityTier: reportedRecord.qualityTier,
          }
        : {}),
    };
  });
}
