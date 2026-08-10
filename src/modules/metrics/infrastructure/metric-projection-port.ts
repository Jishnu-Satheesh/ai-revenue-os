import "server-only";

import { z } from "zod";

import {
  parseCsvMetricMapping,
  projectCsvRows,
  type CsvProjectionRejection,
} from "@/domain/metrics/csv-projection";
import { MetricError } from "@/domain/metrics/errors";
import type { MetricPeriodGrain } from "@/domain/metrics/types";
import { logger } from "@/lib/logger";
import type { DataIngestionPort } from "@/modules/integrations/infrastructure/ingestion-sink";
import type {
  MetricObservationWrite,
  MetricProjectionStore,
} from "@/modules/metrics/application/ports";

/**
 * Projects CSV import batches into normalized metrics.
 *
 * Follows the shape of `memory-projection-port.ts`: one `DataIngestionPort`
 * per consumer of the ingestion handoff, each recognising the record types it
 * understands and rejecting the rest rather than assuming ownership.
 */

const CSV_ROW_RECORD_TYPE = "csv_import.row";

/**
 * Grain is a property of the import, and `column_mapping` cannot carry it: its
 * values are validated as CSV headers, so a literal would be rejected. Daily is
 * the shape of nearly every operator export, and a source needing another grain
 * will need somewhere real to declare it.
 */
const DEFAULT_GRAIN: MetricPeriodGrain = "day";

const csvRowPayloadSchema = z.object({
  values: z.record(z.string(), z.string()),
  columnMapping: z.record(z.string(), z.string()),
});

export type MetricProjectionDependencies = {
  store: MetricProjectionStore;
  grain?: MetricPeriodGrain;
};

export function createMetricProjectionPort(
  dependencies: MetricProjectionDependencies,
): DataIngestionPort {
  const grain = dependencies.grain ?? DEFAULT_GRAIN;

  return {
    async ingest(input) {
      const rejectionReasons: string[] = [];
      let accepted = 0;

      const csvRecords = input.records.filter(
        (record) => record.recordType === CSV_ROW_RECORD_TYPE,
      );
      for (let index = 0; index < input.records.length - csvRecords.length; index += 1)
        rejectionReasons.push("UNSUPPORTED_RECORD_TYPE");

      if (csvRecords.length === 0)
        return { accepted, rejected: rejectionReasons.length, rejectionReasons };

      // Every record in a batch comes from one import, so the mapping and the
      // branch context are resolved once rather than per row.
      const dataSource = csvRecords[0].source;
      if (dataSource.kind !== "data_source") {
        return {
          accepted,
          rejected: input.records.length,
          rejectionReasons: input.records.map(() => "UNSUPPORTED_RECORD_TYPE"),
        };
      }

      const parsedRecords = csvRecords.map((record) => ({
        record,
        payload: csvRowPayloadSchema.safeParse(record.payload),
      }));

      const usable = parsedRecords.filter((entry) => entry.payload.success);
      for (let index = 0; index < parsedRecords.length - usable.length; index += 1)
        rejectionReasons.push("INVALID_PAYLOAD");

      if (usable.length === 0)
        return { accepted, rejected: rejectionReasons.length, rejectionReasons };

      const context = await dependencies.store.loadProjectionContext({
        organizationId: input.organizationId,
        dataSourceId: dataSource.id,
      });

      if (!context) {
        rejectionReasons.push(...usable.map(() => "POLICY_BLOCKED"));
        return { accepted, rejected: rejectionReasons.length, rejectionReasons };
      }

      let mapping;
      try {
        mapping = parseCsvMetricMapping(usable[0].payload.data!.columnMapping);
      } catch (error) {
        // A mapping that names no period or no metric key means this import
        // carries no metrics at all. That is a configuration problem, not a bad
        // row, and it is reported once rather than once per row.
        logger.warn("csv import mapping is not projectable to metrics", {
          organizationId: input.organizationId,
          dataSourceId: dataSource.id,
          runId: input.ingestionRunId,
          errorCode: error instanceof MetricError ? error.code : "UNKNOWN",
        });
        rejectionReasons.push(...usable.map(() => "INVALID_PAYLOAD"));
        return { accepted, rejected: rejectionReasons.length, rejectionReasons };
      }

      const definitions = await dependencies.store.loadDefinitionsByKey(input.organizationId, [
        ...mapping.metricColumns.keys(),
      ]);

      const projection = projectCsvRows({
        rows: usable.map((entry) => entry.payload.data!.values),
        mapping,
        grain,
        timeZone: context.timeZone,
        definitions: [...definitions.values()].map((definition) => ({
          key: definition.key,
          valueKind: definition.valueKind,
        })),
        defaultCurrency: context.defaultCurrency,
      });

      const writes: MetricObservationWrite[] = [];
      for (const observation of projection.observations) {
        const definition = definitions.get(observation.metricKey);
        if (!definition) continue;

        writes.push({
          organizationId: input.organizationId,
          branchId: context.branchId,
          metricDefinitionId: definition.id,
          valueKind: definition.valueKind,
          periodGrain: grain,
          periodStart: observation.periodStart,
          periodEnd: observation.periodEnd,
          periodTimezone: observation.periodTimezone,
          numerator: observation.numerator,
          denominator: observation.denominator,
          currency: observation.currency,
          channel: observation.channel,
          // An operator's own export is a system of record for what it reports.
          qualityTier: "measured",
          sourceIngestionRunId: input.ingestionRunId || null,
          observedAt: observation.periodEnd,
        });
      }

      const { written, duplicates } = await dependencies.store.writeObservations(writes);

      // Counters are per row, because the sink reconciles them against the row
      // count the worker read from the file. One row can carry several metrics,
      // so it counts as accepted when any of its cells projected.
      accepted = countAcceptedRows(
        usable.length,
        projection.rejections,
        mapping.metricColumns.size,
      );

      for (let index = 0; index < usable.length - accepted; index += 1)
        rejectionReasons.push("INVALID_PAYLOAD");

      logProjectionOutcome({
        organizationId: input.organizationId,
        dataSourceId: dataSource.id,
        ingestionRunId: input.ingestionRunId,
        written,
        duplicates,
        rejections: projection.rejections,
      });

      return { accepted, rejected: rejectionReasons.length, rejectionReasons };
    },
  };
}

/**
 * A row is accepted when at least one of its metric cells projected. A row
 * whose period could not be read fails whole, and a row where every mapped
 * metric was rejected produced nothing.
 *
 * A duplicate is not counted as a rejection here: the row was understood and
 * its period simply already holds a current revision. That shows up in the
 * store's own counts and in the log, because treating a re-import as malformed
 * input would misreport a governance question as a parsing failure.
 */
function countAcceptedRows(
  rowCount: number,
  rejections: readonly CsvProjectionRejection[],
  metricColumnCount: number,
): number {
  const rowFailedWhole = new Set(
    rejections
      .filter((rejection) => rejection.metricKey === null)
      .map((rejection) => rejection.row),
  );

  const cellFailures = new Map<number, number>();
  for (const rejection of rejections) {
    if (rejection.metricKey === null) continue;
    cellFailures.set(rejection.row, (cellFailures.get(rejection.row) ?? 0) + 1);
  }

  let accepted = 0;
  for (let row = 1; row <= rowCount; row += 1) {
    if (rowFailedWhole.has(row)) continue;
    if ((cellFailures.get(row) ?? 0) >= metricColumnCount) continue;
    accepted += 1;
  }

  return accepted;
}

/**
 * The sink flattens any reason outside its safe enum to `DOWNSTREAM_REJECTION`,
 * so the per-cell detail is written to the structured log instead of being lost
 * at the boundary. `AGENTS.md` forbids discarding events silently, and a
 * histogram of reasons is what makes a broken mapping diagnosable.
 */
function logProjectionOutcome(input: {
  organizationId: string;
  dataSourceId: string;
  ingestionRunId: string;
  written: number;
  duplicates: number;
  rejections: readonly CsvProjectionRejection[];
}): void {
  if (input.rejections.length === 0 && input.duplicates === 0) return;

  const histogram = new Map<string, number>();
  for (const rejection of input.rejections)
    histogram.set(rejection.reason, (histogram.get(rejection.reason) ?? 0) + 1);

  logger.warn(
    `metric projection rejected cells: ${[...histogram]
      .map(([reason, count]) => `${reason}=${count}`)
      .sort()
      .join(" ")}${input.duplicates > 0 ? ` DUPLICATE=${input.duplicates}` : ""}`,
    {
      organizationId: input.organizationId,
      dataSourceId: input.dataSourceId,
      runId: input.ingestionRunId,
    },
  );
}
