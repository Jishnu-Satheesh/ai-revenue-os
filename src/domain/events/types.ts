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

export const integrationEventNames = [
  "integration.connected",
  "integration.connection_tested",
  "integration.sync_started",
  "integration.sync_completed",
  "integration.sync_failed",
  "integration.degraded",
  "integration.disconnected",
  "integration.credential_revoked",
  "data_source.created",
  "data_source.import_completed",
  "data_source.import_failed",
] as const;

export type IntegrationEventName = (typeof integrationEventNames)[number];

type SafeRunEventPayload = {
  runId: string;
  sourceId: string;
  status: "queued" | "running" | "succeeded" | "partially_succeeded" | "failed" | "cancelled";
  normalizedErrorCode?: string;
  recordsReceived?: number;
  recordsAccepted?: number;
  recordsRejected?: number;
};

/**
 * Event payloads deliberately contain opaque identifiers and bounded state only.
 * Account labels, provider responses, credentials, and customer data are excluded.
 */
export type IntegrationEventPayloads = {
  "integration.connected": {
    connectionId: string;
    providerKey: string;
    status: "pending" | "active" | "degraded" | "disconnected" | "revoked";
    capabilityCount: number;
  };
  "integration.connection_tested": SafeRunEventPayload & { connectionId: string };
  "integration.sync_started": SafeRunEventPayload & { connectionId: string };
  "integration.sync_completed": SafeRunEventPayload & { connectionId: string };
  "integration.sync_failed": SafeRunEventPayload & { connectionId?: string; dataSourceId?: string };
  "integration.degraded": {
    connectionId: string;
    normalizedErrorCode?: string;
  };
  "integration.disconnected": {
    connectionId: string;
    status: "disconnected";
  };
  "integration.credential_revoked": {
    connectionId: string;
    status: "revoked";
  };
  "data_source.created": {
    dataSourceId: string;
    sourceType: "manual" | "csv_import";
    status: "pending" | "ready" | "processing" | "failed" | "archived";
    branchId?: string;
  };
  "data_source.import_completed": SafeRunEventPayload & { dataSourceId: string };
  "data_source.import_failed": SafeRunEventPayload & { dataSourceId: string };
};

export type IntegrationDomainEvent<TName extends IntegrationEventName> = DomainEvent<
  IntegrationEventPayloads[TName]
> & {
  eventName: TName;
};

export const memoryEventNames = [
  "memory.item_created",
  "memory.item_verified",
  "memory.item_rejected",
  "memory.item_superseded",
  "memory.proposal_created",
  "memory.proposal_confirmed",
  "memory.fact_promoted",
  "memory.embedding_failed",
] as const;

export type MemoryEventName = (typeof memoryEventNames)[number];

/**
 * Memory event payloads carry identifiers, classifications, and counts only.
 * Titles, bodies, structured values, and query text are excluded: an event
 * stream is a poor place to leak the content the sensitivity rules exist to
 * protect.
 */
type SafeMemoryEventPayload = {
  itemId: string;
  memoryType: string;
  origin: string;
  verificationState: "proposed" | "unverified" | "verified" | "rejected";
  sensitivity: "public" | "internal" | "confidential" | "customer_content";
};

export type MemoryEventPayloads = {
  "memory.item_created": SafeMemoryEventPayload;
  "memory.item_verified": SafeMemoryEventPayload;
  "memory.item_rejected": SafeMemoryEventPayload & { reasonProvided: boolean };
  "memory.item_superseded": SafeMemoryEventPayload & { replacementId: string };
  "memory.proposal_created": SafeMemoryEventPayload & { evidenceCount: number };
  "memory.proposal_confirmed": SafeMemoryEventPayload;
  "memory.fact_promoted": {
    itemId: string;
    factKey: string;
    branchScoped: boolean;
    overrodeVerified: boolean;
  };
  "memory.embedding_failed": {
    itemId: string;
    attempts: number;
  };
};

export type MemoryDomainEvent<TName extends MemoryEventName> = DomainEvent<
  MemoryEventPayloads[TName]
> & {
  eventName: TName;
};
