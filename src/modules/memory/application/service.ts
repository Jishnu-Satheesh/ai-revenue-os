import type { EventPublisher } from "@/domain/events/types";
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
  CreateMemoryItemInput,
  SupersedeMemoryItemInput,
  UpdateMemoryItemInput,
} from "@/modules/memory/application/api-schemas";
import type { MemoryItemRow, MemorySnapshotCounts } from "@/modules/memory/application/ports";
import type { MemoryRepository } from "@/modules/memory/infrastructure/repository";

export type MemoryTransactionPort = {
  supersede(input: {
    organizationId: string;
    actorId: string;
    itemId: string;
    title: string;
    body?: string;
    sensitivity: Sensitivity;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ replacementId: string; supersededId: string }>;
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
  ceiling: Sensitivity;
  serverTime: string;
};

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

  const publish = async (
    organizationId: string,
    actor: MemoryActor,
    eventName: string,
    payload: Record<string, unknown>,
  ) => {
    await dependencies.events.publish({
      eventId: crypto.randomUUID(),
      eventName,
      occurredAt: now().toISOString(),
      organizationId,
      actorType: "user",
      actorId: actor.userId,
      correlationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload,
    });
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
    }): Promise<MemoryItemView> {
      assertMemoryPermission(input.actor, "memory.write");
      assertCanAssignSensitivity(input.actor, input.body.sensitivity);

      const timestamp = now().toISOString();
      const row = await dependencies.repository.insertItem({
        organization_id: input.organizationId,
        branch_id: input.body.branchId ?? null,
        memory_type: input.body.memoryType,
        title: input.body.title,
        body: input.body.body ?? null,
        // A browser session may only ever author direct user input. The RLS
        // insert policy enforces the same thing independently.
        origin: "user_verified",
        sensitivity: input.body.sensitivity,
        verification_state: input.body.markVerified ? "verified" : "unverified",
        review_due_at: input.body.reviewDueAt ?? null,
        expires_at: input.body.expiresAt ?? null,
        created_by: input.actor.userId,
        verified_by: input.body.markVerified ? input.actor.userId : null,
        verified_at: input.body.markVerified ? timestamp : null,
      });

      await publish(input.organizationId, input.actor, "memory.item_created", {
        itemId: row.id,
        memoryType: row.memory_type,
        origin: row.origin,
        verificationState: row.verification_state,
        sensitivity: row.sensitivity,
      });
      await invalidate(input.organizationId);

      return toMemoryItemView(row, now());
    },

    async updateItem(input: {
      organizationId: string;
      actor: MemoryActor;
      itemId: string;
      body: UpdateMemoryItemInput;
    }): Promise<MemoryItemView> {
      const existing = await requireItem(input.organizationId, input.itemId);
      const timestamp = now().toISOString();

      if (input.body.action === "verify") {
        assertMemoryPermission(input.actor, "memory.verify");
        // A model cannot confirm its own proposal; only a person can.
        if (existing.verification_state === "rejected") {
          throw memoryError("CONFLICT");
        }
        const row = await dependencies.repository.updateItem({
          organizationId: input.organizationId,
          itemId: input.itemId,
          patch: {
            verification_state: "verified",
            verified_by: input.actor.userId,
            verified_at: timestamp,
          },
        });
        await publish(input.organizationId, input.actor, "memory.item_verified", {
          itemId: row.id,
          memoryType: row.memory_type,
          origin: row.origin,
          verificationState: row.verification_state,
          sensitivity: row.sensitivity,
        });
        await invalidate(input.organizationId);
        return toMemoryItemView(row, now());
      }

      if (input.body.action === "reject") {
        assertMemoryPermission(input.actor, "memory.verify");
        const row = await dependencies.repository.updateItem({
          organizationId: input.organizationId,
          itemId: input.itemId,
          patch: {
            verification_state: "rejected",
            rejection_reason: input.body.reason ?? null,
          },
        });
        await publish(input.organizationId, input.actor, "memory.item_rejected", {
          itemId: row.id,
          memoryType: row.memory_type,
          origin: row.origin,
          verificationState: row.verification_state,
          sensitivity: row.sensitivity,
          reasonProvided: Boolean(input.body.reason),
        });
        await invalidate(input.organizationId);
        return toMemoryItemView(row, now());
      }

      assertMemoryPermission(input.actor, "memory.write");
      if (input.body.sensitivity) {
        assertCanAssignSensitivity(input.actor, input.body.sensitivity);
      }
      const row = await dependencies.repository.updateItem({
        organizationId: input.organizationId,
        itemId: input.itemId,
        patch: {
          sensitivity: input.body.sensitivity,
          review_due_at: input.body.reviewDueAt ?? undefined,
        },
      });
      await invalidate(input.organizationId);
      return toMemoryItemView(row, now());
    },

    async supersedeItem(input: {
      organizationId: string;
      actor: MemoryActor;
      itemId: string;
      body: SupersedeMemoryItemInput;
    }): Promise<{ replacementId: string; supersededId: string }> {
      assertMemoryPermission(input.actor, "memory.supersede");
      assertCanAssignSensitivity(input.actor, input.body.sensitivity);

      const existing = await requireItem(input.organizationId, input.itemId);
      if (existing.superseded_by_id) throw memoryError("MEMORY_SUPERSESSION_INVALID");

      if (!dependencies.transactions) {
        // Without the atomic operation the replacement and the state change
        // could half-apply, so refuse rather than write a partial correction.
        throw memoryError("CONFLICT", {}, "memory supersession transaction unavailable");
      }

      const result = await dependencies.transactions.supersede({
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        itemId: input.itemId,
        title: input.body.title,
        body: input.body.body,
        sensitivity: input.body.sensitivity,
        reason: input.body.reason,
        idempotencyKey: input.body.idempotencyKey,
      });

      await publish(input.organizationId, input.actor, "memory.item_superseded", {
        itemId: result.supersededId,
        memoryType: existing.memory_type,
        origin: existing.origin,
        verificationState: existing.verification_state,
        sensitivity: existing.sensitivity,
        replacementId: result.replacementId,
      });
      await invalidate(input.organizationId);

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

      const [counts, recent, reviewQueue] = await Promise.all([
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
      ]);

      return {
        counts,
        recent: recent.map((row) => toMemoryItemView(row, evaluatedAt)),
        reviewQueue: reviewQueue.map((row) => toMemoryItemView(row, evaluatedAt)),
        ceiling,
        serverTime: evaluatedAt.toISOString(),
      };
    },

    async listTimeline(input: {
      organizationId: string;
      actor: MemoryActor;
      branchId?: string;
      limit: number;
      before?: string;
    }): Promise<MemoryItemView[]> {
      assertMemoryPermission(input.actor, "memory.read");
      const evaluatedAt = now();
      const rows = await dependencies.repository.listTimeline({
        organizationId: input.organizationId,
        sensitivities: sensitivitiesWithinCeiling(operatorCeiling(input.actor)),
        branchId: input.branchId,
        limit: input.limit,
        before: input.before,
      });
      return rows.map((row) => toMemoryItemView(row, evaluatedAt));
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
      const evidence = links.reduce<Record<string, string[]>>((accumulator, link) => {
        if (link.relation !== "derived_from") return accumulator;
        accumulator[link.from_item_id] = [
          ...(accumulator[link.from_item_id] ?? []),
          link.to_item_id,
        ];
        return accumulator;
      }, {});
      return { items: rows.map((row) => toMemoryItemView(row, evaluatedAt)), evidence };
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
