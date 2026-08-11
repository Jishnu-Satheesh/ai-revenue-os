import { economicsError } from "@/domain/economics/errors";
import type { CompletenessGrade, EconomicsMetricBinding } from "@/domain/economics/types";
import { findMissingPeriodStarts, nextPeriodStart } from "@/domain/metrics/periods";
import type { MetricPeriodGrain } from "@/domain/metrics/types";
import {
  computeEntries,
  groupPeriods,
  type ComputedEntry,
} from "@/modules/economics/application/compute";
import type {
  EconomicsCatalogPort,
  EconomicsComponentWrite,
  EconomicsEntryWrite,
  EconomicsLedgerStore,
} from "@/modules/economics/application/ports";
import type {
  MetricObservationRecord,
  MetricSeriesPort,
} from "@/modules/metrics/application/ports";
import { readMetricPoints } from "@/modules/metrics/application/service";

/**
 * Recomputes the channel economics ledger for a window.
 *
 * The metric keys are supplied rather than named here. `revenue.gross` and
 * `transactions.count` are core vocabulary, but a reported contribution margin
 * is registered by an industry pack — `margin.contribution` belongs to the
 * Restaurant Pack — and per ADR 0006 the core must not know that key exists.
 * The caller resolves the binding from the registry; the core owns only the
 * structure.
 *
 * See `specs/012-channel-economics-ledger.md`.
 */

export type RecomputeChannelEconomicsInput = {
  organizationId: string;
  branchId: string | null;
  /** The zone the series is bucketed in, normally the branch timezone. */
  timeZone: string;
  grain: MetricPeriodGrain;
  rangeStart: Date;
  rangeEndExclusive: Date;
  metricKeys: EconomicsMetricBinding;
  /** Absolute minor units. A small gap on a tiny period is not a disagreement. */
  reconciliationToleranceMinor?: number;
};

export type ReportedDisagreement = {
  periodStart: Date;
  channel: string | null;
  reportedMinor: number;
  differenceMinor: number;
};

export type RecomputeChannelEconomicsResult = {
  entriesWritten: number;
  gradeCounts: Readonly<Record<CompletenessGrade, number>>;
  /** How many entries record a figure their own source stated, rather than a derived one. */
  reportedEntryCount: number;
  /**
   * Period starts in the window with no revenue on any channel. A gap is an
   * absent entry, never a zero-revenue one, so this is reported rather than
   * filled.
   */
  periodStartsWithoutRevenue: number;
  /**
   * Periods where a derived figure and a reported one both stand and differ.
   * Surfaced, never reconciled: one of the two is wrong and the operator is the
   * only one who can say which.
   */
  disagreements: readonly ReportedDisagreement[];
};

export type ChannelEconomicsDeps = {
  metrics: MetricSeriesPort;
  catalog: EconomicsCatalogPort;
  ledger: EconomicsLedgerStore;
};

export async function recomputeChannelEconomics(
  deps: ChannelEconomicsDeps,
  input: RecomputeChannelEconomicsInput,
): Promise<RecomputeChannelEconomicsResult> {
  const readSeries = (metricKey: string) =>
    readMetricPoints(deps.metrics, {
      organizationId: input.organizationId,
      metricKey,
      grain: input.grain,
      rangeStart: input.rangeStart,
      rangeEndExclusive: input.rangeEndExclusive,
      timeZone: input.timeZone,
      branchId: input.branchId,
    });

  const optional = async (metricKey: string | undefined) =>
    metricKey === undefined ? undefined : (await readSeries(metricKey)).points;

  // Read together: an unregistered key the caller named is a misconfiguration
  // and throws, rather than quietly pricing the window without that input.
  const [revenue, transactions, units, reportedMargin] = await Promise.all([
    readSeries(input.metricKeys.grossRevenue),
    optional(input.metricKeys.transactionCount),
    optional(input.metricKeys.unitCount),
    optional(input.metricKeys.reportedMargin),
  ]);

  const catalog = await deps.catalog.loadCatalog(input.organizationId);

  const periods = groupPeriods({
    revenue: revenue.points,
    ...(transactions ? { transactions } : {}),
    ...(units ? { units } : {}),
    ...(reportedMargin ? { reportedMargin } : {}),
    periodEndFor: (periodStart) => nextPeriodStart(periodStart, input.grain, input.timeZone),
  });

  const entries = computeEntries({
    periods,
    branchId: input.branchId,
    definitions: catalog.components.map((component) => component.definition),
    rates: catalog.rates,
    ...(input.reconciliationToleranceMinor === undefined
      ? {}
      : { reconciliationToleranceMinor: input.reconciliationToleranceMinor }),
  });

  const definitionIdByKey = new Map(
    catalog.components.map((component) => [component.definition.key, component.id]),
  );

  const writes = entries.map((entry) => toEntryWrite(entry, definitionIdByKey, input.branchId));
  const { written } = await deps.ledger.recordEntries(input.organizationId, writes);

  return {
    entriesWritten: written,
    gradeCounts: countGrades(writes),
    reportedEntryCount: writes.filter((write) => write.marginSource === "reported").length,
    periodStartsWithoutRevenue: findMissingPeriodStarts(
      revenue.expectedPeriodStarts,
      distinctPeriodStarts(revenue.points),
    ).length,
    disagreements: entries.flatMap((entry) =>
      entry.reportedDisagreement
        ? [
            {
              periodStart: entry.periodStart,
              channel: entry.channel,
              ...entry.reportedDisagreement,
            },
          ]
        : [],
    ),
  };
}

/**
 * Turns a priced period into the row the ledger stores.
 *
 * Every applicable component becomes a row, including the ones graded
 * `missing`. An absent row would read as a cost of nothing, which is the one
 * way this table can lie about a margin. A reported entry is the exception and
 * carries no components at all: it was never decomposed, and inventing a
 * waterfall that does not add up to the stated figure would be worse than
 * offering none.
 */
export function toEntryWrite(
  entry: ComputedEntry,
  definitionIdByKey: ReadonlyMap<string, string>,
  branchId: string | null,
): EconomicsEntryWrite {
  const { margin } = entry;

  const components: EconomicsComponentWrite[] =
    margin.marginSource === "reported"
      ? []
      : margin.components.map((component) => {
          const definitionId = definitionIdByKey.get(component.key);
          if (!definitionId)
            throw economicsError("ECONOMICS_DEFINITION_UNKNOWN", { key: component.key });

          return {
            definitionId,
            rateId: entry.rateIdByComponentKey[component.key] ?? null,
            amountMinor: component.amountMinor,
            qualityTier: component.qualityTier,
          };
        });

  return {
    branchId,
    // Period aggregates. Transaction grain waits for transaction-level data,
    // which the CSV path does not carry.
    grain: "period",
    channel: entry.channel,
    periodStart: entry.periodStart,
    periodEnd: entry.periodEnd,
    periodTimezone: entry.periodTimezone,
    grossRevenueMinor: entry.grossRevenueMinor,
    transactionCount: entry.transactionCount,
    unitCount: entry.unitCount ?? null,
    currency: entry.currency,
    marginSource: margin.marginSource,
    completenessGrade: margin.grade,
    contributionMarginMinor: margin.grade === "indicative" ? null : margin.contributionMarginMinor,
    atMostMinor: margin.grade === "indicative" ? margin.atMostMinor : null,
    reportedQualityTier: margin.marginSource === "reported" ? margin.qualityTier : null,
    sourceReference: null,
    components,
  };
}

function countGrades(
  writes: readonly EconomicsEntryWrite[],
): Readonly<Record<CompletenessGrade, number>> {
  const counts: Record<CompletenessGrade, number> = { complete: 0, partial: 0, indicative: 0 };
  for (const write of writes) counts[write.completenessGrade] += 1;
  return counts;
}

function distinctPeriodStarts(points: readonly MetricObservationRecord[]): Date[] {
  const byTime = new Map(points.map((point) => [point.periodStart.getTime(), point.periodStart]));
  return [...byTime.values()];
}
