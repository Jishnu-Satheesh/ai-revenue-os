import { computeDerivedMargin, reconcileReportedMargin } from "@/domain/economics/margin";
import { resolveRatesByKey, type StoredCostRate } from "@/domain/economics/rates";
import type {
  CostComponentDefinition,
  DerivedMargin,
  IndicativeMargin,
} from "@/domain/economics/types";
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
};

export type ComputedEntry = {
  periodStart: Date;
  periodEnd: Date;
  periodTimezone: string;
  channel: string | null;
  margin: DerivedMargin | IndicativeMargin;
  /** Set only when the source also reported a margin and it disagrees. */
  reportedDisagreement?: { reportedMinor: number; differenceMinor: number };
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
      // The day the period began, so a mid-range rate change splits the range
      // at the right boundary instead of repricing everything.
      on: period.periodStart,
      channel: period.channel,
      branchId: input.branchId,
    });

    const margin = computeDerivedMargin({
      basis: {
        grossRevenueMinor: period.grossRevenueMinor,
        transactionCount: period.transactionCount,
        unitCount: period.unitCount,
        currency: period.currency,
      },
      channel: period.channel,
      definitions: input.definitions,
      rates: [...rates.values()],
    });

    const entry: ComputedEntry = {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      periodTimezone: period.periodTimezone,
      channel: period.channel,
      margin,
    };

    if (period.reportedMarginMinor === undefined) return entry;

    const reconciliation = reconcileReportedMargin({
      derived: margin,
      reportedMinor: period.reportedMarginMinor,
      toleranceMinor: input.reconciliationToleranceMinor,
    });

    // Null means the derived side is indicative, so there is nothing to compare
    // against. Silence there is correct: an unpriced period disagreeing with a
    // reported figure says nothing about either.
    if (reconciliation && !reconciliation.agrees) {
      entry.reportedDisagreement = {
        reportedMinor: period.reportedMarginMinor,
        differenceMinor: reconciliation.differenceMinor,
      };
    }

    return entry;
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
  periodEndFor: (periodStart: Date) => Date;
}): EconomicsPeriodInput[] {
  const keyOf = (record: MetricObservationRecord) =>
    `${record.periodStart.getTime()}::${record.channel ?? ""}`;

  const index = (records: readonly MetricObservationRecord[] | undefined) =>
    new Map((records ?? []).map((record) => [keyOf(record), record]));

  const transactions = index(input.transactions);
  const units = index(input.units);
  const reported = index(input.reportedMargin);

  return input.revenue.map((record) => {
    const key = keyOf(record);
    const unitRecord = units.get(key);
    const reportedRecord = reported.get(key);

    return {
      periodStart: record.periodStart,
      periodEnd: input.periodEndFor(record.periodStart),
      periodTimezone: record.periodTimezone,
      channel: record.channel,
      grossRevenueMinor: record.numerator,
      transactionCount: transactions.get(key)?.numerator ?? 0,
      ...(unitRecord ? { unitCount: unitRecord.numerator } : {}),
      currency: record.currency ?? "",
      ...(reportedRecord ? { reportedMarginMinor: reportedRecord.numerator } : {}),
    };
  });
}
