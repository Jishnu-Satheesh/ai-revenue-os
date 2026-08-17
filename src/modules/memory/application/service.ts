import type { EventPublisher, MemoryEventName, MemoryEventPayloads } from "@/domain/events/types";
import { memoryError } from "@/domain/memory/errors";
import { deriveFreshness } from "@/domain/memory/freshness";
import { sensitivitiesWithinCeiling } from "@/domain/memory/purposes";
import { deriveTrustRank } from "@/domain/memory/trust";
import type { PersistableMemoryType, Sensitivity } from "@/domain/memory/types";
import {
  assertCanAssignSensitivity,
  assertMemoryPermission,
  operatorCeiling,
  type MemoryActor,
} from "@/modules/memory/application/authorization";
import type {
  ConfirmProposalInput,
  CreateMemoryItemInput,
  RejectProposalInput,
  SupersedeMemoryItemInput,
  UpdateMemoryItemInput,
} from "@/modules/memory/application/api-schemas";
import type { TimelineCursor } from "@/modules/memory/application/api-schemas";
import type {
  BusinessFactRow,
  MemoryBranchOption,
  MemoryItemRow,
  MemorySnapshotCounts,
} from "@/modules/memory/application/ports";
import type { MemoryRepository } from "@/modules/memory/infrastructure/repository";

export type MemoryTransactionPort = {
  createItem(input: {
    organizationId: string;
    actorId: string;
    memoryType: "note" | "document";
    title: string;
    body?: string;
    branchId?: string;
    sensitivity: Sensitivity;
    markVerified: boolean;
    reviewDueAt?: string;
    expiresAt?: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ item: MemoryItemRow; replayed: boolean }>;
  updateItem(input: {
    organizationId: string;
    actorId: string;
    itemId: string;
    action: UpdateMemoryItemInput["action"];
    reason?: string;
    sensitivity?: Sensitivity;
    reviewDueAt?: string | null;
    setReviewDueAt: boolean;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ item: MemoryItemRow; replayed: boolean }>;
  confirmProposal(input: {
    organizationId: string;
    actorId: string;
    itemId: string;
    overrideVerified: boolean;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<MemoryProposalConfirmation>;
  rejectProposal(input: {
    organizationId: string;
    actorId: string;
    itemId: string;
    reason: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<MemoryProposalRejection>;
  supersede(input: {
    organizationId: string;
    actorId: string;
    itemId: string;
    title: string;
    body?: string;
    sensitivity: Sensitivity;
    reason: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ replacementId: string; supersededId: string; replayed: boolean }>;
};

export type MemoryFactPromotion = {
  itemId: string;
  factId: string;
  promoted: true;
  factKey: string;
  branchScoped: boolean;
  overrodeVerified: boolean;
  /**
   * The RPC returns `true` only when the idempotency operation already held a
   * committed response. It is transport metadata, never event payload data.
   */
  replayed: boolean;
};

export type MemoryNonFactProposalConfirmation = {
  itemId: string;
  factId: null;
  promoted: false;
  memoryType: string;
  origin: string;
  sensitivity: Sensitivity;
  verificationState: "verified";
  replayed: boolean;
};

export type MemoryProposalConfirmation = MemoryFactPromotion | MemoryNonFactProposalConfirmation;

export type MemoryProposalRejection = {
  itemId: string;
  memoryType: string;
  origin: string;
  sensitivity: Sensitivity;
  verificationState: "rejected";
  replayed: boolean;
};

export type MemoryCacheInvalidator = {
  invalidateOrganization(organizationId: string): Promise<void>;
};

export type MemoryServiceDependencies = {
  repository: MemoryRepository;
  events: EventPublisher;
  transactions?: MemoryTransactionPort;
  cache?: MemoryCacheInvalidator | null;
  logger?: { warn: (message: string, context?: Record<string, unknown>) => void };
  now?: () => Date;
};

export type MemoryItemView = {
  id: string;
  memoryType: PersistableMemoryType;
  title: string;
  body?: string;
  structuredValue?: unknown;
  origin: string;
  sourceTier: number;
  sourceSystem?: string;
  verificationState: string;
  sensitivity: Sensitivity;
  confidence?: number;
  trustRank: number;
  freshness: string;
  observedAt?: string;
  reviewDueAt?: string;
  expiresAt?: string;
  supersededById?: string;
  supersessionReason?: string;
  rejectionReason?: string;
  proposedFactKey?: string;
  proposedFactValue?: unknown;
  embeddingStatus: string;
  verifiedAt?: string;
  createdAt: string;
};

export type MemorySnapshot = {
  counts: MemorySnapshotCounts;
  recent: MemoryItemView[];
  reviewQueue: MemoryItemView[];
  /** Branch filter options, read under the caller's own RLS context. */
  branches: MemoryBranchOption[];
  ceiling: Sensitivity;
  serverTime: string;
};

export type MemoryLinkView = {
  id: string;
  relation: "derived_from" | "supports" | "contradicts" | "explains";
  direction: "from" | "to";
  relatedItemId: string;
};

/**
 * The comparison side of a fact proposal. It is a deliberate projection of
 * `business_facts`, not the row: ownership columns, the internal source
 * reference, and the surrogate id stay server-side because a reviewer needs to
 * judge the value, not to address the record.
 */
export type MemoryCurrentFactView = {
  factKey: string;
  value: unknown;
  branchId: string | null;
  branchScoped: boolean;
  status: string;
  confidence?: number;
  lastVerifiedAt?: string;
  updatedAt: string;
};

export type MemoryItemDetail = {
  item: MemoryItemView;
  chain: readonly MemoryItemView[];
  links: readonly MemoryLinkView[];
  /** Null for a non-proposal, and for a proposal with no fact recorded yet. */
  currentFact: MemoryCurrentFactView | null;
};

export function toCurrentFactView(row: BusinessFactRow | null): MemoryCurrentFactView | null {
  if (!row) return null;
  return {
    factKey: row.fact_key,
    value: row.value,
    branchId: row.branch_id,
    branchScoped: row.branch_id !== null,
    status: row.status,
    confidence: row.confidence ?? undefined,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function toMemoryItemView(row: MemoryItemRow, now: Date): MemoryItemView {
  const freshness = deriveFreshness({
    now,
    expiresAt: row.expires_at ?? undefined,
    effectiveTo: row.effective_to ?? undefined,
    supersededById: row.superseded_by_id ?? undefined,
    reviewDueAt: row.review_due_at ?? undefined,
  });

  return {
    id: row.id,
    memoryType: row.memory_type,
    title: row.title,
    body: row.body ?? undefined,
    structuredValue: row.structured_value ?? undefined,
    origin: row.origin,
    sourceTier: row.source_tier,
    sourceSystem: row.source_system ?? undefined,
    verificationState: row.verification_state,
    sensitivity: row.sensitivity,
    confidence: row.confidence ?? undefined,
    trustRank: deriveTrustRank({
      verificationState: row.verification_state,
      sourceTier: row.source_tier,
    }),
    freshness,
    observedAt: row.observed_at ?? undefined,
    reviewDueAt: row.review_due_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    supersededById: row.superseded_by_id ?? undefined,
    supersessionReason: row.supersession_reason ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    proposedFactKey: row.proposed_fact_key ?? undefined,
    proposedFactValue: row.proposed_fact_value ?? undefined,
    embeddingStatus: row.embedding_status,
    verifiedAt: row.verified_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function createMemoryService(dependencies: MemoryServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  /**
   * Invalidation runs after the database has committed, never before, and a
   * failure is logged and swallowed: a cache that could fail a write which
   * already succeeded would be worse than a stale cache.
   */
  const invalidate = async (organizationId: string) => {
    if (!dependencies.cache) return;
    try {
      await dependencies.cache.invalidateOrganization(organizationId);
    } catch (error) {
      dependencies.logger?.warn("memory.cache_invalidation_failed", { organizationId, error });
    }
  };

  const publish = async <TName extends MemoryEventName>(
    organizationId: string,
    actor: MemoryActor,
    eventName: TName,
    payload: MemoryEventPayloads[TName],
    correlationId: string,
  ) => {
    try {
      await dependencies.events.publish({
        eventId: crypto.randomUUID(),
        eventName,
        occurredAt: now().toISOString(),
        organizationId,
        actorType: "user",
        actorId: actor.userId,
        correlationId,
        schemaVersion: 1,
        payload,
      });
    } catch (error) {
      // Database state is authoritative and already committed. Publishing is
      // deliberately best-effort until a durable outbox replaces this boundary.
      dependencies.logger?.warn("memory.event_publish_failed", {
        organizationId,
        eventName,
        error,
      });
    }
  };

  const requireItem = async (organizationId: string, itemId: string): Promise<MemoryItemRow> => {
    const row = await dependencies.repository.getItem({ organizationId, itemId });
    if (!row) throw memoryError("NOT_FOUND");
    return row;
  };

  return {
    async createItem(input: {
      organizationId: string;
      actor: MemoryActor;
      body: CreateMemoryItemInput;
      correlationId?: string;
    }): Promise<MemoryItemView> {
      assertMemoryPermission(input.actor, "memory.write");
      assertCanAssignSensitivity(input.actor, input.body.sensitivity);

      if (!dependencies.transactions) throw memoryError("CONFLICT");
      const correlationId = input.correlationId ?? crypto.randomUUID();
      const result = await dependencies.transactions.createItem({
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        memoryType: input.body.memoryType,
        title: input.body.title,
        body: input.body.body,
        branchId: input.body.branchId,
        sensitivity: input.body.sensitivity,
        markVerified: input.body.markVerified,
        reviewDueAt: input.body.reviewDueAt,
        expiresAt: input.body.expiresAt,
        idempotencyKey: input.body.idempotencyKey,
        correlationId,
      });
      const row = result.item;
      if (!result.replayed)
        await publish(
          input.organizationId,
          input.actor,
          "memory.item_created",
          {
            itemId: row.id,
            memoryType: row.memory_type,
            origin: row.origin,
            verificationState: row.verification_state,
            sensitivity: row.sensitivity,
          },
          correlationId,
        );
      await invalidate(input.organizationId);

      return toMemoryItemView(row, now());
    },

    async updateItem(input: {
      organizationId: string;
      actor: MemoryActor;
      itemId: string;
      body: UpdateMemoryItemInput;
      correlationId?: string;
    }): Promise<MemoryItemView> {
      if (input.body.action === "verify" || input.body.action === "reject")
        assertMemoryPermission(input.actor, "memory.verify");
      else {
        assertMemoryPermission(input.actor, "memory.write");
        if (input.body.sensitivity) assertCanAssignSensitivity(input.actor, input.body.sensitivity);
      }
      if (!dependencies.transactions) throw memoryError("CONFLICT");
      const correlationId = input.correlationId ?? crypto.randomUUID();
      const result = await dependencies.transactions.updateItem({
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        itemId: input.itemId,
        action: input.body.action,
        reason: input.body.reason,
        sensitivity: input.body.sensitivity,
        reviewDueAt: input.body.reviewDueAt,
        setReviewDueAt: Object.hasOwn(input.body, "reviewDueAt"),
        idempotencyKey: input.body.idempotencyKey,
        correlationId,
      });
      const row = result.item;
      if (!result.replayed && input.body.action === "verify")
        await publish(
          input.organizationId,
          input.actor,
          "memory.item_verified",
          {
            itemId: row.id,
            memoryType: row.memory_type,
            origin: row.origin,
            verificationState: row.verification_state,
            sensitivity: row.sensitivity,
          },
          correlationId,
        );
      if (!result.replayed && input.body.action === "reject")
        await publish(
          input.organizationId,
          input.actor,
          "memory.item_rejected",
          {
            itemId: row.id,
            memoryType: row.memory_type,
            origin: row.origin,
            verificationState: row.verification_state,
            sensitivity: row.sensitivity,
            reasonProvided: Boolean(input.body.reason),
          },
          correlationId,
        );
      await invalidate(input.organizationId);
      return toMemoryItemView(row, now());
    },

    async supersedeItem(input: {
      organizationId: string;
      actor: MemoryActor;
      itemId: string;
      body: SupersedeMemoryItemInput;
      correlationId?: string;
    }): Promise<{ replacementId: string; supersededId: string }> {
      assertMemoryPermission(input.actor, "memory.supersede");
      assertCanAssignSensitivity(input.actor, input.body.sensitivity);

      if (!dependencies.transactions) {
        // Without the atomic operation the replacement and the state change
        // could half-apply, so refuse rather than write a partial correction.
        throw memoryError("CONFLICT", {}, "memory supersession transaction unavailable");
      }

      const correlationId = input.correlationId ?? crypto.randomUUID();
      const result = await dependencies.transactions.supersede({
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        itemId: input.itemId,
        title: input.body.title,
        body: input.body.body,
        sensitivity: input.body.sensitivity,
        reason: input.body.reason,
        idempotencyKey: input.body.idempotencyKey,
        correlationId,
      });
      if (!result.replayed) {
        const existing = await requireItem(input.organizationId, input.itemId);
        await publish(
          input.organizationId,
          input.actor,
          "memory.item_superseded",
          {
            itemId: result.supersededId,
            memoryType: existing.memory_type,
            origin: existing.origin,
            verificationState: existing.verification_state,
            sensitivity: existing.sensitivity,
            replacementId: result.replacementId,
          },
          correlationId,
        );
      }
      await invalidate(input.organizationId);

      return { replacementId: result.replacementId, supersededId: result.supersededId };
    },

    async confirmProposal(input: {
      organizationId: string;
      actor: MemoryActor;
      itemId: string;
      body: ConfirmProposalInput;
      correlationId?: string;
    }): Promise<MemoryProposalConfirmation> {
      assertMemoryPermission(input.actor, "memory.promote_fact");
      if (!dependencies.transactions) {
        throw memoryError("CONFLICT", {}, "memory promotion transaction unavailable");
      }

      const correlationId = input.correlationId ?? crypto.randomUUID();
      const result = await dependencies.transactions.confirmProposal({
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        itemId: input.itemId,
        overrideVerified: input.body.overrideVerified,
        idempotencyKey: input.body.idempotencyKey,
        correlationId,
      });

      await invalidate(input.organizationId);
      // An idempotent replay may have a different authenticated caller and a
      // fresh correlation/event ID. It must still refresh cache after the
      // already-committed write, but must never create a second event.
      if (result.replayed === false) {
        if (result.promoted) {
          await publish(
            input.organizationId,
            input.actor,
            "memory.fact_promoted",
            {
              itemId: result.itemId,
              factKey: result.factKey,
              branchScoped: result.branchScoped,
              overrodeVerified: result.overrodeVerified,
            },
            correlationId,
          );
        } else {
          await publish(
            input.organizationId,
            input.actor,
            "memory.proposal_confirmed",
            {
              itemId: result.itemId,
              memoryType: result.memoryType,
              origin: result.origin,
              verificationState: result.verificationState,
              sensitivity: result.sensitivity,
            },
            correlationId,
          );
        }
      }
      return result;
    },

    async rejectProposal(input: {
      organizationId: string;
      actor: MemoryActor;
      itemId: string;
      body: RejectProposalInput;
      correlationId?: string;
    }): Promise<MemoryProposalRejection> {
      assertMemoryPermission(input.actor, "memory.verify");
      if (!dependencies.transactions) {
        throw memoryError("CONFLICT", {}, "memory proposal rejection transaction unavailable");
      }
      const correlationId = input.correlationId ?? crypto.randomUUID();
      const result = await dependencies.transactions.rejectProposal({
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        itemId: input.itemId,
        reason: input.body.reason,
        idempotencyKey: input.body.idempotencyKey,
        correlationId,
      });
      await invalidate(input.organizationId);
      if (result.replayed === false) {
        await publish(
          input.organizationId,
          input.actor,
          "memory.item_rejected",
          {
            itemId: result.itemId,
            memoryType: result.memoryType,
            origin: result.origin,
            verificationState: result.verificationState,
            sensitivity: result.sensitivity,
            reasonProvided: true,
          },
          correlationId,
        );
      }
      return result;
    },

    async getSnapshot(input: {
      organizationId: string;
      actor: MemoryActor;
    }): Promise<MemorySnapshot> {
      assertMemoryPermission(input.actor, "memory.read");
      const ceiling = operatorCeiling(input.actor);
      const sensitivities = sensitivitiesWithinCeiling(ceiling);
      const evaluatedAt = now();

      const [counts, recent, reviewQueue, branches] = await Promise.all([
        dependencies.repository.countsFor({ organizationId: input.organizationId }),
        dependencies.repository.listByTypes({
          organizationId: input.organizationId,
          sensitivities,
          memoryTypes: ["note", "document", "episode", "decision", "outcome", "lesson"],
          verificationStates: ["unverified", "verified"],
          limit: 20,
        }),
        dependencies.repository.listByTypes({
          organizationId: input.organizationId,
          sensitivities,
          memoryTypes: [
            "note",
            "document",
            "episode",
            "decision",
            "outcome",
            "lesson",
            "fact_proposal",
          ],
          verificationStates: ["proposed"],
          limit: 50,
        }),
        dependencies.repository.listBranchOptions({ organizationId: input.organizationId }),
      ]);

      return {
        counts,
        recent: recent.map((row) => toMemoryItemView(row, evaluatedAt)),
        reviewQueue: reviewQueue.map((row) => toMemoryItemView(row, evaluatedAt)),
        branches,
        ceiling,
        serverTime: evaluatedAt.toISOString(),
      };
    },

    async listTimeline(input: {
      organizationId: string;
      actor: MemoryActor;
      branchId?: string;
      sourceSystems?: readonly string[];
      limit: number;
      cursor?: TimelineCursor;
    }): Promise<{ items: MemoryItemView[]; nextCursor?: TimelineCursor }> {
      assertMemoryPermission(input.actor, "memory.read");
      const evaluatedAt = now();
      const { items, hasMore } = await dependencies.repository.listTimeline({
        organizationId: input.organizationId,
        sensitivities: sensitivitiesWithinCeiling(operatorCeiling(input.actor)),
        branchId: input.branchId,
        sourceSystems: input.sourceSystems,
        limit: input.limit,
        cursor: input.cursor,
      });
      // The cursor addresses the last row the caller actually received, so the
      // next page resumes exactly where this one ended. It is withheld unless a
      // further page exists, because a cursor is a promise that one does.
      const final = items.at(-1);
      return {
        items: items.map((row) => toMemoryItemView(row, evaluatedAt)),
        nextCursor:
          hasMore && final
            ? {
                observedAt: final.observed_at,
                createdAt: final.created_at,
                id: final.id,
              }
            : undefined,
      };
    },

    async listLessons(input: {
      organizationId: string;
      actor: MemoryActor;
      limit: number;
    }): Promise<{ items: MemoryItemView[]; evidence: Record<string, string[]> }> {
      assertMemoryPermission(input.actor, "memory.read");
      const evaluatedAt = now();
      const rows = await dependencies.repository.listByTypes({
        organizationId: input.organizationId,
        sensitivities: sensitivitiesWithinCeiling(operatorCeiling(input.actor)),
        memoryTypes: ["lesson", "decision", "outcome"],
        verificationStates: ["unverified", "verified"],
        limit: input.limit,
      });
      const links = await dependencies.repository.listLinks({
        organizationId: input.organizationId,
        itemIds: rows.map((row) => row.id),
      });
      const derivedFrom = links.filter((link) => link.relation === "derived_from");
      const hydrated = await dependencies.repository.hydrateByIds({
        organizationId: input.organizationId,
        ids: [...new Set(derivedFrom.map((link) => link.to_item_id))],
        sensitivities: sensitivitiesWithinCeiling(operatorCeiling(input.actor)),
        includeSuperseded: false,
        includeExpired: false,
      });
      const visibleIds = new Set(hydrated.map((row) => row.id));
      const evidence = derivedFrom.reduce<Record<string, string[]>>((accumulator, link) => {
        if (!visibleIds.has(link.to_item_id)) return accumulator;
        accumulator[link.from_item_id] = [
          ...(accumulator[link.from_item_id] ?? []),
          link.to_item_id,
        ];
        return accumulator;
      }, {});
      return { items: rows.map((row) => toMemoryItemView(row, evaluatedAt)), evidence };
    },

    async getItemDetail(input: {
      organizationId: string;
      actor: MemoryActor;
      itemId: string;
    }): Promise<MemoryItemDetail> {
      assertMemoryPermission(input.actor, "memory.read");
      const detail = await dependencies.repository.getItemDetail({
        organizationId: input.organizationId,
        itemId: input.itemId,
        sensitivities: sensitivitiesWithinCeiling(operatorCeiling(input.actor)),
      });
      if (!detail) throw memoryError("NOT_FOUND");
      const evaluatedAt = now();
      // A reviewer confirming a fact proposal is about to overwrite whatever
      // the Digital Twin holds today, so the comparison is read here under the
      // same authenticated client and the same identity the promotion locks on.
      const currentFact =
        detail.item.memory_type === "fact_proposal" && detail.item.proposed_fact_key
          ? toCurrentFactView(
              await dependencies.repository.getCurrentFact({
                organizationId: input.organizationId,
                factKey: detail.item.proposed_fact_key,
                branchId: detail.item.proposed_branch_id ?? null,
              }),
            )
          : null;
      return {
        item: toMemoryItemView(detail.item, evaluatedAt),
        chain: detail.chain.map((row) => toMemoryItemView(row, evaluatedAt)),
        links: detail.links,
        currentFact,
      };
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
