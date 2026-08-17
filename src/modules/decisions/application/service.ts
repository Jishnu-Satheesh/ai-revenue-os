import { randomUUID } from "node:crypto";

import type { DecisionDomainEvent, EventPublisher } from "@/domain/events/types";
import {
  decisionAggregateSchema,
  type DecisionAggregate,
  decisionLiveClaimSchema,
  type DecisionCyclePort,
  type DecisionLiveClaim,
} from "@/modules/decisions/application/ports";

export type DecisionServiceDependencies = {
  aggregateStore: Pick<DecisionCyclePort, "complete">;
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
    async record(
      claimInput: DecisionLiveClaim,
      input: DecisionAggregate,
    ): Promise<{ decisionRecordId: string; opportunityId: string | null }> {
      const claim = decisionLiveClaimSchema.parse(claimInput);
      const aggregate = decisionAggregateSchema.parse(input);
      const { record } = aggregate;
      if (
        record.organizationId !== claim.organizationId ||
        record.correlationId !== claim.correlationId ||
        record.decisionCycleId !== claim.decisionCycleId
      ) {
        throw new Error("decision_claim_aggregate_mismatch");
      }
      const completion = await dependencies.aggregateStore.complete({ ...claim, aggregate });

      await dependencies.events.publish(toEvent(record, now()));
      return completion;
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
