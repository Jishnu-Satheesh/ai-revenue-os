import { randomUUID } from "node:crypto";

import { embeddingTextFor } from "@/domain/memory/embedding-text";
import { MemoryError, safeMemoryErrorCopy } from "@/domain/memory/errors";
import {
  MAX_EMBEDDING_ATTEMPTS,
  MAX_EMBEDDING_BATCH_SIZE,
  invalidateAfterCommit,
  isCancelled,
  isEligibleForEmbedding,
  nowIso,
  parseMemoryTaskPayload,
  type MemoryWorkerDependencies,
} from "@/workflows/memory/contracts";

export type EmbedItemsOutcome =
  | { outcome: "cancelled"; embedded: number; failed: number; skipped: number }
  | {
      outcome: "succeeded" | "partially_succeeded";
      embedded: number;
      failed: number;
      skipped: number;
    };

function retryableEmbeddingBatchConflict(): MemoryError {
  return new MemoryError("CONFLICT", safeMemoryErrorCopy.CONFLICT, true);
}

async function embedWithBoundedAttempts(
  dependencies: MemoryWorkerDependencies,
  payload: ReturnType<typeof parseMemoryTaskPayload>,
  organizationId: string,
  correlationId: string,
  text: string,
): Promise<readonly number[] | null> {
  if (!dependencies.embeddings) throw new Error("embedding provider is unavailable");
  let error: unknown;
  for (let attempts = 1; attempts <= MAX_EMBEDDING_ATTEMPTS; attempts += 1) {
    if (await isCancelled(payload, dependencies)) return null;
    try {
      const vectors = await dependencies.embeddings.embed({
        organizationId,
        correlationId,
        texts: [text],
        signal: dependencies.signal,
      });
      if (await isCancelled(payload, dependencies)) return null;
      const vector = vectors[0];
      if (!vector || vectors.length !== 1 || vector.length !== dependencies.embeddings.dimensions) {
        throw new Error("embedding response did not contain exactly one valid vector");
      }
      return vector;
    } catch (caught) {
      if (await isCancelled(payload, dependencies)) return null;
      error = caught;
    }
  }
  throw error;
}

/** Embeds one tenant-scoped bounded batch. Failed rows remain lexical-only. */
export async function runEmbedItems(
  input: unknown,
  dependencies: MemoryWorkerDependencies,
): Promise<EmbedItemsOutcome> {
  const payload = parseMemoryTaskPayload("memory.embed-items", input);
  if (await isCancelled(payload, dependencies)) {
    return { outcome: "cancelled", embedded: 0, failed: 0, skipped: 0 };
  }

  const now = nowIso(dependencies);
  const claimToken = randomUUID();
  const items = await dependencies.repository.claimPendingEmbeddingItems({
    organizationId: payload.organizationId,
    idempotencyKey: payload.idempotencyKey,
    claimToken,
    limit: MAX_EMBEDDING_BATCH_SIZE,
  });
  const batchState = await dependencies.repository.getEmbeddingBatchState({
    organizationId: payload.organizationId,
    idempotencyKey: payload.idempotencyKey,
    claimToken,
  });
  if (batchState === "active") throw retryableEmbeddingBatchConflict();
  if (batchState === "completed") {
    await invalidateAfterCommit(payload.organizationId, dependencies);
    return { outcome: "succeeded", embedded: 0, failed: 0, skipped: 0 };
  }
  if (batchState !== "owned") throw retryableEmbeddingBatchConflict();
  let embedded = 0;
  let failed = 0;
  let skipped = 0;
  let mutationMayHaveCommitted = false;
  let invalidated = false;
  const invalidateCommitted = async () => {
    if (invalidated || (!mutationMayHaveCommitted && embedded === 0 && failed === 0)) return;
    invalidated = true;
    await invalidateAfterCommit(payload.organizationId, dependencies);
  };

  try {
    for (const item of items.slice(0, MAX_EMBEDDING_BATCH_SIZE)) {
      if (await isCancelled(payload, dependencies)) {
        await dependencies.repository.completeEmbeddingBatch({
          organizationId: payload.organizationId,
          idempotencyKey: payload.idempotencyKey,
          claimToken,
        });
        await invalidateCommitted();
        return { outcome: "cancelled", embedded, failed, skipped };
      }
      if (item.organization_id !== payload.organizationId || !isEligibleForEmbedding(item, now)) {
        skipped += 1;
        continue;
      }
      if (!dependencies.embeddings) {
        skipped += 1;
        continue;
      }
      let embedding: readonly number[] | null;
      try {
        embedding = await embedWithBoundedAttempts(
          dependencies,
          payload,
          payload.organizationId,
          payload.correlationId,
          embeddingTextFor(item),
        );
      } catch {
        mutationMayHaveCommitted = true;
        const markedFailed = await dependencies.repository.completeEmbedding({
          organizationId: payload.organizationId,
          itemId: item.id,
          claimToken: item.claim_token,
          itemRevision: item.item_revision,
          embedding: null,
          embeddingModel: null,
          embeddingStatus: "failed",
          embeddingUpdatedAt: now,
        });
        if (!markedFailed) {
          skipped += 1;
          continue;
        }
        failed += 1;
        await dependencies.events.publish({
          eventId: randomUUID(),
          eventName: "memory.embedding_failed",
          occurredAt: now,
          organizationId: payload.organizationId,
          actorType: "system",
          correlationId: payload.correlationId,
          schemaVersion: 1,
          payload: { itemId: item.id, attempts: MAX_EMBEDDING_ATTEMPTS },
        });
        continue;
      }
      if (embedding === null) {
        await dependencies.repository.completeEmbeddingBatch({
          organizationId: payload.organizationId,
          idempotencyKey: payload.idempotencyKey,
          claimToken,
        });
        await invalidateCommitted();
        return { outcome: "cancelled", embedded, failed, skipped };
      }

      mutationMayHaveCommitted = true;
      const written = await dependencies.repository.completeEmbedding({
        organizationId: payload.organizationId,
        itemId: item.id,
        claimToken: item.claim_token,
        itemRevision: item.item_revision,
        embedding,
        embeddingModel: dependencies.embeddings.model,
        embeddingStatus: "ready",
        embeddingUpdatedAt: now,
      });
      if (written) embedded += 1;
      else skipped += 1;
    }

    if (await isCancelled(payload, dependencies)) {
      await dependencies.repository.completeEmbeddingBatch({
        organizationId: payload.organizationId,
        idempotencyKey: payload.idempotencyKey,
        claimToken,
      });
      await invalidateCommitted();
      return { outcome: "cancelled", embedded, failed, skipped };
    }
    const batchCompleted = await dependencies.repository.completeEmbeddingBatch({
      organizationId: payload.organizationId,
      idempotencyKey: payload.idempotencyKey,
      claimToken,
    });
    if (!batchCompleted) throw retryableEmbeddingBatchConflict();
    await invalidateCommitted();
    return {
      outcome: failed > 0 ? "partially_succeeded" : "succeeded",
      embedded,
      failed,
      skipped,
    };
  } catch (error) {
    await invalidateCommitted();
    throw error;
  }
}
