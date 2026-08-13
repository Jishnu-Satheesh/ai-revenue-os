import { randomUUID } from "node:crypto";

import type { DecisionDomainEvent, EventPublisher } from "@/domain/events/types";
import {
  decisionAggregateSchema,
  type DecisionAggregate,
  type DecisionWorkerStore,
} from "@/modules/decisions/application/ports";

export type DecisionServiceDependencies = {
  workerStore: DecisionWorkerStore;
  events: EventPublisher;
  now?: () => Date;
};

type DecisionEventName =
  | "decision.recorded"
  | "decision.needs_data_identified"
  | "opportunity.proposed";

export function createDecisionService(dependencies: DecisionServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async record(input: DecisionAggregate): Promise<void> {
      const aggregate = decisionAggregateSchema.parse(input);
      const { record } = aggregate;
      await dependencies.workerStore.persist(aggregate);

      await dependencies.events.publish(toEvent(record, now()));
    },
  };
}

function toEvent(
  record: DecisionAggregate["record"],
  occurredAt: Date,
): DecisionDomainEvent<
  "decision.recorded" | "decision.needs_data_identified" | "opportunity.proposed"
> {
  const base = {
    eventId: randomUUID(),
    occurredAt: occurredAt.toISOString(),
    organizationId: record.organizationId,
    actorType: "system" as const,
    correlationId: record.correlationId,
    schemaVersion: 1,
  };

  if (record.outcome === "needs_data") {
    return {
      ...base,
      eventName: "decision.needs_data_identified" satisfies DecisionEventName,
      payload: { decisionCycleId: record.decisionCycleId },
    };
  }

  if (record.outcome === "action_selected") {
    return {
      ...base,
      eventName: "opportunity.proposed" satisfies DecisionEventName,
      payload: { opportunityId: record.opportunityId!, decisionCycleId: record.decisionCycleId },
    };
  }

  return {
    ...base,
    eventName: "decision.recorded" satisfies DecisionEventName,
    payload: { decisionCycleId: record.decisionCycleId },
  };
}
