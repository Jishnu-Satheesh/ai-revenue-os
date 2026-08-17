import { z } from "zod";

import type { EventPublisher } from "@/domain/events/types";
import { memoryError } from "@/domain/memory/errors";
import type { MemoryItemRow } from "@/modules/memory/application/ports";
import type { EmbeddingProvider } from "@/modules/memory/infrastructure/embedding-provider";

export const MAX_EMBEDDING_BATCH_SIZE = 64;
export const MAX_EMBEDDING_ATTEMPTS = 3;

export const memoryTaskNames = [
  "memory.embed-items",
  "memory.reembed-item",
  "memory.expire-items",
] as const;

export type MemoryTaskName = (typeof memoryTaskNames)[number];

const taskNameSchema = z.enum(memoryTaskNames);
const basePayloadSchema = z
  .object({
    taskName: taskNameSchema,
    organizationId: z.string().uuid(),
    correlationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

const embedItemsPayloadSchema = basePayloadSchema.extend({
  taskName: z.literal("memory.embed-items"),
});
const reembedItemPayloadSchema = basePayloadSchema.extend({
  taskName: z.literal("memory.reembed-item"),
  itemId: z.string().uuid(),
});
const expireItemsPayloadSchema = basePayloadSchema.extend({
  taskName: z.literal("memory.expire-items"),
});

export type EmbedItemsPayload = z.infer<typeof embedItemsPayloadSchema>;
export type ReembedItemPayload = z.infer<typeof reembedItemPayloadSchema>;
export type ExpireItemsPayload = z.infer<typeof expireItemsPayloadSchema>;
export type MemoryTaskPayload = EmbedItemsPayload | ReembedItemPayload | ExpireItemsPayload;

export type MemoryEmbeddingItem = Pick<
  MemoryItemRow,
  | "id"
  | "organization_id"
  | "title"
  | "body"
  | "verification_state"
  | "expires_at"
  | "effective_to"
  | "superseded_by_id"
  | "embedding_status"
  | "updated_at"
>;

export type ClaimedMemoryEmbeddingItem = MemoryEmbeddingItem & {
  claim_token: string;
  item_revision: string;
};

/**
 * Worker-only repository boundary. Every operation repeats the organization ID
 * even though the runner has validated it, keeping the service-role boundary
 * defence-in-depth scoped.
 */
export type MemoryWorkerRepository = {
  claimPendingEmbeddingItems(input: {
    organizationId: string;
    idempotencyKey: string;
    claimToken: string;
    limit: number;
  }): Promise<readonly ClaimedMemoryEmbeddingItem[]>;
  getEmbeddingBatchState(input: {
    organizationId: string;
    idempotencyKey: string;
    claimToken: string;
  }): Promise<"active" | "completed" | "expired" | "missing" | "owned">;
  getEmbeddingItem(input: {
    organizationId: string;
    itemId: string;
  }): Promise<MemoryEmbeddingItem | null>;
  completeEmbedding(input: {
    organizationId: string;
    itemId: string;
    claimToken: string;
    itemRevision: string;
    embedding: readonly number[] | null;
    embeddingModel: string | null;
    embeddingStatus: "ready" | "failed";
    embeddingUpdatedAt: string;
  }): Promise<boolean>;
  completeEmbeddingBatch(input: {
    organizationId: string;
    idempotencyKey: string;
    claimToken: string;
  }): Promise<boolean>;
  resetEmbedding(input: {
    organizationId: string;
    itemId: string;
    expectedRevision: string;
    now: string;
    embeddingUpdatedAt: null;
  }): Promise<boolean>;
  skipExpiredOrSuperseded(input: { organizationId: string; now: string }): Promise<number>;
};

export type MemoryWorkerDependencies = {
  repository: MemoryWorkerRepository;
  embeddings: EmbeddingProvider | null;
  events: Pick<EventPublisher, "publish">;
  cache?: { invalidateOrganization(organizationId: string): Promise<void> } | null;
  isCancelled?: (input: {
    organizationId: string;
    taskName: MemoryTaskName;
    idempotencyKey: string;
  }) => Promise<boolean>;
  logger?: { warn(message: string, context?: { organizationId?: string; itemId?: string }): void };
  signal?: AbortSignal;
  now?: () => Date;
};

export function createMemoryWorkerDependencies(
  dependencies: MemoryWorkerDependencies,
): MemoryWorkerDependencies {
  return dependencies;
}

function taskValidationError(): never {
  throw memoryError("VALIDATION_ERROR");
}

export function parseMemoryTaskPayload<TTaskName extends MemoryTaskName>(
  taskName: TTaskName,
  input: unknown,
): Extract<MemoryTaskPayload, { taskName: TTaskName }> {
  const schema =
    taskName === "memory.embed-items"
      ? embedItemsPayloadSchema
      : taskName === "memory.reembed-item"
        ? reembedItemPayloadSchema
        : expireItemsPayloadSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return taskValidationError();
  return parsed.data as Extract<MemoryTaskPayload, { taskName: TTaskName }>;
}

export function nowIso(dependencies: MemoryWorkerDependencies): string {
  return (dependencies.now ?? (() => new Date()))().toISOString();
}

export function isEligibleForEmbedding(item: MemoryEmbeddingItem, now: string): boolean {
  if (item.embedding_status === "skipped") return false;
  if (item.verification_state === "proposed" || item.verification_state === "rejected")
    return false;
  if (item.superseded_by_id) return false;
  const nowMs = Date.parse(now);
  const isPast = (timestamp: string | null) => {
    if (!timestamp) return false;
    const time = Date.parse(timestamp);
    return Number.isFinite(time) && time < nowMs;
  };
  return !isPast(item.expires_at) && !isPast(item.effective_to);
}

export async function isCancelled(
  payload: MemoryTaskPayload,
  dependencies: MemoryWorkerDependencies,
): Promise<boolean> {
  return (
    dependencies.signal?.aborted ||
    ((await dependencies.isCancelled?.({
      organizationId: payload.organizationId,
      taskName: payload.taskName,
      idempotencyKey: payload.idempotencyKey,
    })) ??
      false)
  );
}

/** Cache is derived only; a completed database mutation always wins. */
export async function invalidateAfterCommit(
  organizationId: string,
  dependencies: MemoryWorkerDependencies,
): Promise<void> {
  if (!dependencies.cache) return;
  try {
    await dependencies.cache.invalidateOrganization(organizationId);
  } catch {
    dependencies.logger?.warn("memory.cache_invalidation_failed", { organizationId });
  }
}
