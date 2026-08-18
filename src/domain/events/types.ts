import { z } from "zod";

export const eventActorTypeSchema = z.enum(["user", "system", "ai"]);
export type EventActorType = z.infer<typeof eventActorTypeSchema>;

/**
 * Every event used to belong to an organization, because every tenant-owned
 * record did. Agency-level events -- a teammate invited, a member's role changed
 * -- belong to an account and to no single client, so scope is now one or the
 * other and at least one is required.
 *
 * The union rather than two optional fields: an event with neither scope is
 * unattributable, and making that unrepresentable is cheaper than checking for
 * it at every consumer.
 */
type EventScope =
  | { organizationId: string; accountId?: string }
  | { organizationId?: string; accountId: string };

export type DomainEvent<TPayload = Record<string, unknown>> = EventScope & {
  eventId: string;
  eventName: string;
  occurredAt: string;
  branchId?: string;
  actorType: EventActorType;
  actorId?: string;
  correlationId: string;
  causationId?: string;
  schemaVersion: number;
  payload: TPayload;
};

/**
 * Membership and invitation changes. `context/06-multi-tenancy-and-security.md`
 * lists these first among the things that must be audited.
 */
export const accountEventNames = [
  "account.created",
  "account_member.invited",
  "account_member.invitation_reissued",
  "account_member.invitation_revoked",
  "account_member.joined",
  "account_member.role_changed",
  "account_member.removed",
] as const;

export type AccountEventName = (typeof accountEventNames)[number];

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

export const decisionEventNames = [
  "decision.cycle_started",
  "decision.recorded",
  "decision.needs_data_identified",
  "opportunity.proposed",
  "opportunity.approved",
  "opportunity.rejected",
  "opportunity.snoozed",
  "opportunity.expired",
  "decision.feedback_captured",
] as const;

export type DecisionEventName = (typeof decisionEventNames)[number];

/** Decision events are identifiers and bounded state only; never evidence, PII, or provider data. */
export type DecisionEventPayloads = {
  "decision.cycle_started": { decisionCycleId: string };
  "decision.recorded": { decisionCycleId: string; decisionRecordId?: string };
  "decision.needs_data_identified": { decisionCycleId: string; decisionRecordId?: string };
  "opportunity.proposed": { opportunityId: string; decisionCycleId: string };
  "opportunity.approved": { opportunityId: string; feedbackId?: string };
  "opportunity.rejected": { opportunityId: string; feedbackId?: string };
  "opportunity.snoozed": { opportunityId: string; feedbackId?: string };
  "opportunity.expired": { opportunityId: string };
  "decision.feedback_captured": { opportunityId: string; feedbackId: string };
};

export type DecisionDomainEvent<TName extends DecisionEventName> = DomainEvent<
  DecisionEventPayloads[TName]
> & { eventName: TName };

export const campaignEventNames = [
  "campaign.created",
  "campaign.version_published",
  "campaign.attested",
  "campaign.approved",
  "campaign.approval_invalidated",
  "campaign.scheduled",
  "campaign.cancelled",
] as const;

export type CampaignEventName = (typeof campaignEventNames)[number];

/**
 * Campaign events carry identifiers and bounded state only.
 *
 * No manifest, digest, objective, caption, asset reference, spend amount, or
 * operator statement appears here. An event stream is read by more systems and
 * kept longer than the record it describes, so the campaign's contents stay in
 * the campaign and the event says only that something happened to it.
 */
export type CampaignEventPayloads = {
  "campaign.created": { campaignId: string; sourceKind: "manual_brief" | "decision_opportunity" };
  "campaign.version_published": { campaignId: string; bundleVersionId: string; version: number };
  "campaign.attested": { campaignId: string; bundleVersionId: string };
  "campaign.approved": { campaignId: string; bundleVersionId: string; approvalId: string };
  "campaign.approval_invalidated": {
    campaignId: string;
    bundleVersionId: string;
    reason: "superseded_by_new_version" | "operator_revoked" | "capability_lost";
  };
  "campaign.scheduled": { campaignId: string; bundleVersionId: string; actionCount: number };
  "campaign.cancelled": { campaignId: string };
};

export type CampaignDomainEvent<TName extends CampaignEventName> = DomainEvent<
  CampaignEventPayloads[TName]
> & { eventName: TName };

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
