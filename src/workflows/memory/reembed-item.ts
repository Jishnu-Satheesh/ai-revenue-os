import { memoryError } from "@/domain/memory/errors";
import {
  invalidateAfterCommit,
  isCancelled,
  isEligibleForEmbedding,
  nowIso,
  parseMemoryTaskPayload,
  type MemoryWorkerDependencies,
} from "@/workflows/memory/contracts";

export type ReembedItemOutcome =
  | { outcome: "cancelled"; reset: false }
  | { outcome: "succeeded"; reset: boolean };

/** Resets a changed eligible row; a subsequent bounded batch owns embedding it. */
export async function runReembedItem(
  input: unknown,
  dependencies: MemoryWorkerDependencies,
): Promise<ReembedItemOutcome> {
  const payload = parseMemoryTaskPayload("memory.reembed-item", input);
  if (await isCancelled(payload, dependencies)) return { outcome: "cancelled", reset: false };

  const item = await dependencies.repository.getEmbeddingItem({
    organizationId: payload.organizationId,
    itemId: payload.itemId,
  });
  if (!item || item.organization_id !== payload.organizationId)
    throw memoryError("TENANT_SCOPE_ERROR");

  const now = nowIso(dependencies);
  if (!isEligibleForEmbedding(item, now)) return { outcome: "succeeded", reset: false };
  const reset = await dependencies.repository.resetEmbedding({
    organizationId: payload.organizationId,
    itemId: payload.itemId,
    expectedRevision: item.updated_at,
    now,
    embeddingUpdatedAt: null,
  });
  if (reset) await invalidateAfterCommit(payload.organizationId, dependencies);
  return { outcome: "succeeded", reset };
}
