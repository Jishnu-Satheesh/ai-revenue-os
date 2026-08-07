import { z } from "zod";

export const eventActorTypeSchema = z.enum(["user", "system", "ai"]);
export type EventActorType = z.infer<typeof eventActorTypeSchema>;

export type DomainEvent<TPayload = Record<string, unknown>> = {
  eventId: string;
  eventName: string;
  occurredAt: string;
  organizationId: string;
  branchId?: string;
  actorType: EventActorType;
  actorId?: string;
  correlationId: string;
  causationId?: string;
  schemaVersion: number;
  payload: TPayload;
};

export type EventPublisher = {
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
};
