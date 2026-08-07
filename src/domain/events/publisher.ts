import type { DomainEvent, EventPublisher } from "@/domain/events/types";
import { logger } from "@/lib/logger";

/** Initial publisher boundary. A durable outbox can replace this without changing domain callers. */
export function createEventPublisher(): EventPublisher {
  return {
    async publish<TPayload>(event: DomainEvent<TPayload>) {
      logger.info("domain_event.published", {
        organizationId: event.organizationId,
        correlationId: event.correlationId,
      });
    },
  };
}
