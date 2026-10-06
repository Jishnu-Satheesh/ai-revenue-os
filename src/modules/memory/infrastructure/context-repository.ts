import "server-only";

import { memoryError } from "@/domain/memory/errors";

/**
 * Structural client over the governed context RPCs (Spec 023 §§9/10/14).
 * The manifest tables stay untyped RPC-only surfaces, so every answer is
 * parsed defensively following the capture-repository pattern: a shape the
 * database did not promise is a conflict, never a silent default. Nothing
 * here logs entry bodies, queries, or prompts.
 */

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

function contextDatabaseError(cause: unknown): never {
  throw memoryError("CONFLICT", {}, cause);
}

function answerObject(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    contextDatabaseError(new Error("context answer is invalid"));
  }
  return data as Record<string, unknown>;
}

function requiredString(answer: Record<string, unknown>, field: string): string {
  const value = answer[field];
  if (typeof value !== "string" || value.length === 0) {
    contextDatabaseError(new Error("context answer is invalid"));
  }
  return value;
}

function requiredNumber(answer: Record<string, unknown>, field: string): number {
  const value = answer[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    contextDatabaseError(new Error("context answer is invalid"));
  }
  return value;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function requiredDigest(answer: Record<string, unknown>, field: string): string {
  const value = requiredString(answer, field);
  if (!DIGEST_PATTERN.test(value)) contextDatabaseError(new Error("context digest is invalid"));
  return value;
}

export type ContextEntryInput = {
  sourceKind:
    | "memory_item"
    | "capture_event"
    | "business_fact"
    | "business_profile"
    | "goal"
    | "constraint"
    | "campaign_version";
  sourceId: string;
  /** The exact safe summary the assembler derived; the RPC recomputes and refuses mismatches. */
  summary: string;
  priority: number;
  optional: boolean;
  section: "current" | "intent" | "observations" | "lessons";
  statementKind:
    | "observation"
    | "recommendation"
    | "operator_decision"
    | "campaign_state"
    | "measured_outcome"
    | "lesson";
  trustRank: 0 | 1 | 2 | 3 | 4;
  freshness: "fresh" | "aging" | "stale" | "superseded" | "expired";
  sensitivity: "public" | "internal" | "confidential" | "customer_content";
  scopeBranchId?: string | null;
  scopeChannelId?: string | null;
  observedAt?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  reportingStart?: string | null;
  reportingEnd?: string | null;
  rootRefs?: readonly string[];
  useRestriction?: string | null;
};

export type PreparedContext = {
  manifestId: string;
  contextDigest: string;
  status: string;
  selectedCount: number;
  selectedBytes: number;
};

function preparedFrom(answer: Record<string, unknown>): PreparedContext {
  return {
    manifestId: requiredString(answer, "manifestId"),
    contextDigest: requiredDigest(answer, "contextDigest"),
    status: requiredString(answer, "status"),
    selectedCount: requiredNumber(answer, "selectedCount"),
    selectedBytes: requiredNumber(answer, "selectedBytes"),
  };
}

export type RevalidatedContext = {
  manifestId: string;
  status: "valid" | "changed" | "revoked" | "unavailable";
};

function revalidatedFrom(answer: Record<string, unknown>): RevalidatedContext {
  const status = requiredString(answer, "status");
  if (status !== "valid" && status !== "changed" && status !== "revoked" && status !== "unavailable") {
    contextDatabaseError(new Error("context revalidation is invalid"));
  }
  return { manifestId: requiredString(answer, "manifestId"), status };
}

export type ConsumedContext = {
  manifestId: string;
  state: string;
};

export type ContextRepository = {
  /** Worker path: the caller proves authority with a claimed run binding. */
  prepare(input: {
    organizationId: string;
    purpose: string;
    consumerKind: "analysis_run" | "growth_request" | "campaign_generation_run";
    consumerId: string;
    attemptKey: string;
    correlationId: string;
    branchId?: string | null;
    channelId?: string | null;
    campaignId?: string | null;
    policyVersion: string;
    entries: readonly ContextEntryInput[] | null;
    retrievalLatencyMs: number | null;
  }): Promise<PreparedContext>;
  /** Authenticated subject path: the preparation transaction binds the actor. */
  prepareForSubject(input: {
    organizationId: string;
    actorId: string;
    purpose: string;
    correlationId: string;
    branchId?: string | null;
    channelId?: string | null;
    requestFingerprint: string;
    policyVersion: string;
    entries: readonly ContextEntryInput[] | null;
    retrievalLatencyMs: number | null;
  }): Promise<PreparedContext>;
  revalidate(input: { organizationId: string; manifestId: string }): Promise<RevalidatedContext>;
  revalidateForSubject(input: { organizationId: string; manifestId: string }): Promise<RevalidatedContext>;
  consume(input: {
    organizationId: string;
    manifestId: string;
    providerName: string;
    modelId: string;
    modelCalledAt: string;
  }): Promise<ConsumedContext>;
  consumeForSubject(input: {
    organizationId: string;
    manifestId: string;
    providerName: string;
    modelId: string;
    modelCalledAt: string;
  }): Promise<ConsumedContext>;
  eraseSourceContent(input: {
    organizationId: string;
    actorId: string | null;
    sourceKind: string;
    sourceId: string;
    reason: string;
  }): Promise<{ sourceId: string; erasedEvents: number; erasedItems: number; erasedEntries: number }>;
};

function toEntryJson(entry: ContextEntryInput): Record<string, unknown> {
  return {
    sourceKind: entry.sourceKind,
    sourceId: entry.sourceId,
    summary: entry.summary,
    priority: entry.priority,
    optional: entry.optional,
    section: entry.section,
    statementKind: entry.statementKind,
    trustRank: entry.trustRank,
    freshness: entry.freshness,
    sensitivity: entry.sensitivity,
    scopeBranchId: entry.scopeBranchId ?? null,
    scopeChannelId: entry.scopeChannelId ?? null,
    observedAt: entry.observedAt ?? null,
    effectiveFrom: entry.effectiveFrom ?? null,
    effectiveTo: entry.effectiveTo ?? null,
    reportingStart: entry.reportingStart ?? null,
    reportingEnd: entry.reportingEnd ?? null,
    rootRefs: entry.rootRefs ?? [],
    useRestriction: entry.useRestriction ?? null,
  };
}

export function createContextRepository(client: RpcClient): ContextRepository {
  const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const result = await client.rpc(name, args);
    if (result.error) contextDatabaseError(result.error);
    return answerObject(result.data);
  };

  const consumedFrom = (answer: Record<string, unknown>): ConsumedContext => ({
    manifestId: requiredString(answer, "manifestId"),
    state: requiredString(answer, "state"),
  });

  return {
    async prepare(input) {
      return preparedFrom(
        await call("prepare_memory_context", {
          p_organization_id: input.organizationId,
          p_purpose: input.purpose,
          p_consumer_kind: input.consumerKind,
          p_consumer_id: input.consumerId,
          p_attempt_key: input.attemptKey,
          p_correlation_id: input.correlationId,
          p_branch_id: input.branchId ?? null,
          p_channel_id: input.channelId ?? null,
          p_campaign_id: input.campaignId ?? null,
          p_policy_version: input.policyVersion,
          p_entries: input.entries === null ? null : input.entries.map(toEntryJson),
          p_retrieval_latency_ms: input.retrievalLatencyMs,
        }),
      );
    },

    async prepareForSubject(input) {
      return preparedFrom(
        await call("prepare_subject_memory_context", {
          p_organization_id: input.organizationId,
          p_actor_id: input.actorId,
          p_purpose: input.purpose,
          p_correlation_id: input.correlationId,
          p_branch_id: input.branchId ?? null,
          p_channel_id: input.channelId ?? null,
          p_request_fingerprint: input.requestFingerprint,
          p_policy_version: input.policyVersion,
          p_entries: input.entries === null ? null : input.entries.map(toEntryJson),
          p_retrieval_latency_ms: input.retrievalLatencyMs,
        }),
      );
    },

    async revalidate(input) {
      return revalidatedFrom(
        await call("revalidate_memory_context", {
          p_organization_id: input.organizationId,
          p_manifest_id: input.manifestId,
        }),
      );
    },

    async revalidateForSubject(input) {
      return revalidatedFrom(
        await call("revalidate_subject_memory_context", {
          p_organization_id: input.organizationId,
          p_manifest_id: input.manifestId,
        }),
      );
    },

    async consume(input) {
      return consumedFrom(
        await call("consume_memory_context", {
          p_organization_id: input.organizationId,
          p_manifest_id: input.manifestId,
          p_provider_name: input.providerName,
          p_model_id: input.modelId,
          p_model_called_at: input.modelCalledAt,
        }),
      );
    },

    async consumeForSubject(input) {
      return consumedFrom(
        await call("consume_subject_memory_context", {
          p_organization_id: input.organizationId,
          p_manifest_id: input.manifestId,
          p_provider_name: input.providerName,
          p_model_id: input.modelId,
          p_model_called_at: input.modelCalledAt,
        }),
      );
    },

    async eraseSourceContent(input) {
      const answer = await call("erase_memory_source_content", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_source_kind: input.sourceKind,
        p_source_id: input.sourceId,
        p_reason: input.reason,
      });
      return {
        sourceId: requiredString(answer, "sourceId"),
        erasedEvents: requiredNumber(answer, "erasedEvents"),
        erasedItems: requiredNumber(answer, "erasedItems"),
        erasedEntries: requiredNumber(answer, "erasedEntries"),
      };
    },
  };
}
