import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { memoryError } from "@/domain/memory/errors";
import type { Database } from "@/lib/supabase/database.types";
import type { MemoryWorkerRepository } from "@/workflows/memory/contracts";

type WorkerQuery = {
  eq(column: string, value: string): WorkerQuery;
  neq(column: string, value: string): WorkerQuery;
  in(column: string, values: readonly string[]): WorkerQuery;
  is(column: string, value: null): WorkerQuery;
  or(filter: string): WorkerQuery;
  order(column: string, options?: { ascending?: boolean }): WorkerQuery;
  limit(count: number): WorkerQuery;
  select(columns: string): WorkerQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};

const embeddingColumns = [
  "id",
  "organization_id",
  "title",
  "body",
  "verification_state",
  "expires_at",
  "effective_to",
  "superseded_by_id",
  "embedding_status",
  "updated_at",
].join(", ");

function workerDatabaseError(cause: unknown): never {
  throw memoryError("CONFLICT", {}, cause);
}

/**
 * Service-role adapter used only by memory Trigger tasks. Its column list is
 * deliberately smaller than the read adapter's and includes title/body only
 * because those values are passed to the embedding provider.
 */
export function createSupabaseMemoryWorkerRepository(
  serviceSupabase: SupabaseClient<Database>,
): MemoryWorkerRepository {
  const client = serviceSupabase as unknown as {
    from(table: "memory_items"): {
      select(columns: string): WorkerQuery;
      update(values: unknown): WorkerQuery;
    };
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };

  const updated = async (operation: unknown): Promise<boolean> => {
    const result = (await operation) as { data: { id: string } | null; error: unknown };
    if (result.error) workerDatabaseError(result.error);
    return result.data !== null;
  };

  return {
    async claimPendingEmbeddingItems({ organizationId, idempotencyKey, claimToken, limit }) {
      const result = await client.rpc("claim_memory_embedding_items", {
        p_organization_id: organizationId,
        p_idempotency_key: idempotencyKey,
        p_claim_token: claimToken,
        p_limit: limit,
      });
      if (result.error) workerDatabaseError(result.error);
      return (result.data ?? []) as Awaited<
        ReturnType<MemoryWorkerRepository["claimPendingEmbeddingItems"]>
      >;
    },

    async getEmbeddingBatchState({ organizationId, idempotencyKey, claimToken }) {
      const result = await client.rpc("get_memory_embedding_batch_state", {
        p_organization_id: organizationId,
        p_idempotency_key: idempotencyKey,
        p_claim_token: claimToken,
      });
      if (result.error) workerDatabaseError(result.error);
      const state = result.data;
      if (
        state !== "active" &&
        state !== "completed" &&
        state !== "expired" &&
        state !== "missing" &&
        state !== "owned"
      ) {
        workerDatabaseError(new Error("embedding batch claim state is invalid"));
      }
      return state;
    },

    async getEmbeddingItem({ organizationId, itemId }) {
      const result = (await client
        .from("memory_items")
        .select(embeddingColumns)
        .eq("organization_id", organizationId)
        .eq("id", itemId)
        .maybeSingle()) as { data: unknown; error: unknown };
      if (result.error) workerDatabaseError(result.error);
      return result.data as Awaited<ReturnType<MemoryWorkerRepository["getEmbeddingItem"]>>;
    },

    async completeEmbedding({
      organizationId,
      itemId,
      claimToken,
      itemRevision,
      embedding,
      embeddingModel,
      embeddingStatus,
      embeddingUpdatedAt,
    }) {
      const result = await client.rpc("complete_memory_embedding", {
        p_organization_id: organizationId,
        p_item_id: itemId,
        p_claim_token: claimToken,
        p_item_revision: itemRevision,
        p_embedding: embedding ? `[${embedding.join(",")}]` : null,
        p_embedding_model: embeddingModel,
        p_embedding_status: embeddingStatus,
        p_embedding_updated_at: embeddingUpdatedAt,
      });
      if (result.error) workerDatabaseError(result.error);
      return result.data === true;
    },

    async completeEmbeddingBatch({ organizationId, idempotencyKey, claimToken }) {
      const result = await client.rpc("complete_memory_embedding_batch", {
        p_organization_id: organizationId,
        p_idempotency_key: idempotencyKey,
        p_claim_token: claimToken,
      });
      if (result.error) workerDatabaseError(result.error);
      return result.data === true;
    },

    async resetEmbedding({ organizationId, itemId, expectedRevision, now, embeddingUpdatedAt }) {
      return updated(
        client
          .from("memory_items")
          .update({
            embedding: null,
            embedding_model: null,
            embedding_status: "pending",
            embedding_updated_at: embeddingUpdatedAt,
          })
          .eq("organization_id", organizationId)
          .eq("id", itemId)
          .eq("updated_at", expectedRevision)
          .in("embedding_status", ["ready", "failed"])
          .in("verification_state", ["unverified", "verified"])
          .is("superseded_by_id", null)
          .or(`expires_at.is.null,expires_at.gte.${now}`)
          .or(`effective_to.is.null,effective_to.gte.${now}`)
          .select("id")
          .maybeSingle(),
      );
    },

    async skipExpiredOrSuperseded({ organizationId, now }) {
      const request = client
        .from("memory_items")
        .update({ embedding_status: "skipped" })
        .eq("organization_id", organizationId)
        .neq("embedding_status", "skipped")
        .in("verification_state", ["unverified", "verified"])
        .or(`superseded_by_id.not.is.null,expires_at.lt.${now},effective_to.lt.${now}`)
        .select("id");
      const result = (await (request as unknown)) as {
        data: { id: string }[] | null;
        error: unknown;
      };
      if (result.error) workerDatabaseError(result.error);
      return result.data?.length ?? 0;
    },
  };
}
