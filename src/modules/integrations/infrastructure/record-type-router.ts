import "server-only";

import type { IntegrationRecordEnvelope } from "@/domain/integrations/schemas";
import type { DataIngestionPort } from "@/modules/integrations/infrastructure/ingestion-sink";

/**
 * Routes an ingestion batch to the consumer that owns each record type.
 *
 * The sink accepts one handoff, but the handoff now has several consumers:
 * Business Memory takes provider records, the metric registry takes CSV rows,
 * and more will follow. Broadcasting the whole batch to each of them and adding
 * up the results does not work, because every consumer rejects what it does not
 * own: a two-record batch would report two accepted and two rejected, and
 * `integration_ingestion_runs` checks that accepted plus rejected never exceeds
 * received.
 *
 * Partitioning by record type keeps the counts disjoint, and it puts ownership
 * in one readable place rather than leaving each consumer to guess whether
 * silence means "not mine" or "nothing to do".
 */

export type IngestionConsumer = {
  /** Record types this consumer owns. Declared by the consumer, not the caller. */
  recordTypes: readonly string[];
  port: DataIngestionPort;
};

export function createRecordTypeRouter(consumers: readonly IngestionConsumer[]): DataIngestionPort {
  const routes = new Map<string, DataIngestionPort>();

  for (const consumer of consumers) {
    for (const recordType of consumer.recordTypes) {
      // Two consumers claiming one record type is a composition mistake, and
      // it would silently halve the accepted count of whichever lost.
      if (routes.has(recordType))
        throw new Error(`Two ingestion consumers claim the record type ${recordType}.`);
      routes.set(recordType, consumer.port);
    }
  }

  return {
    async ingest(input) {
      const batches = new Map<DataIngestionPort, IntegrationRecordEnvelope[]>();
      let unroutable = 0;

      for (const record of input.records) {
        const port = routes.get(record.recordType);
        if (!port) {
          unroutable += 1;
          continue;
        }
        const batch = batches.get(port) ?? [];
        batch.push(record);
        batches.set(port, batch);
      }

      let accepted = 0;
      let rejected = unroutable;
      const rejectionReasons: string[] = Array.from(
        { length: unroutable },
        () => "UNSUPPORTED_RECORD_TYPE",
      );

      for (const [port, records] of batches) {
        const result = await port.ingest({ ...input, records });
        accepted += result.accepted;
        rejected += result.rejected;
        rejectionReasons.push(...result.rejectionReasons);
      }

      return { accepted, rejected, rejectionReasons };
    },
  };
}
