import { describe, expect, it } from "vitest";

import {
  createResearchManifestReader,
  type ManifestListAnswer,
} from "./research-manifest-reader";

const ORGANIZATION_ID = "2dda45b8-82db-4f5f-b17d-611b9bbb7846";

/**
 * Columns of public.memory_context_manifests per migration
 * 20260911144805. There is deliberately no created_at: recency is as_of.
 * The fake answers like PostgREST — an unknown selected or ordered column
 * is an error, not an empty list — so a reader that names a column the
 * table never had fails here the way the deployed sweep failed every hour.
 */
const MANIFEST_COLUMNS = new Set([
  "id",
  "organization_id",
  "purpose",
  "schema_version",
  "policy_version",
  "context_digest",
  "as_of",
  "branch_id",
  "channel_id",
  "campaign_id",
  "actor_id",
  "correlation_id",
  "status",
  "exclusion_counts",
  "degraded_reasons",
  "selected_count",
  "selected_bytes",
  "retrieval_latency_ms",
  "analysis_run_id",
  "growth_request_id",
  "campaign_generation_run_id",
  "subject_operation_id",
  "attempt_key",
  "state",
  "model_called_at",
  "completed_at",
  "provider_name",
  "model_id",
]);

function fakePostgrest(
  rows: Record<string, unknown>[] | null,
  error: ManifestListAnswer["error"] = null,
) {
  const calls: { table: string; columns: string; orders: [string, boolean][]; limit: number }[] = [];
  const state = { table: "", columns: "", orders: [] as [string, boolean][], limit: 0 };
  const chain = {
    eq: () => chain,
    order: (column: string, options?: { ascending?: boolean }) => {
      state.orders.push([column, options?.ascending ?? true]);
      return chain;
    },
    limit: (count: number) => {
      state.limit = count;
      return chain;
    },
    then: <TResult1 = ManifestListAnswer, TResult2 = never>(
      onfulfilled?:
        | ((value: ManifestListAnswer) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> => {
      calls.push({ table: state.table, columns: state.columns, orders: state.orders, limit: state.limit });
      const unknown = state.columns
        .split(",")
        .map((column) => column.trim())
        .filter((column) => column.length > 0 && !MANIFEST_COLUMNS.has(column));
      const unordered = state.orders
        .map(([column]) => column)
        .filter((column) => !MANIFEST_COLUMNS.has(column));
      const answer: ManifestListAnswer =
        unknown.length > 0 || unordered.length > 0
          ? { data: null, error: { code: "42703", message: "column does not exist" } }
          : { data: rows, error };
      return Promise.resolve(answer).then(onfulfilled ?? undefined, onrejected ?? undefined);
    },
  };
  return {
    calls,
    from: (table: string) => ({
      select: (columns: string) => {
        state.table = table;
        state.columns = columns;
        return chain;
      },
    }),
  };
}

describe("research manifest reader", () => {
  it("reads the latest manifest digest for the organization", async () => {
    const client = fakePostgrest([
      { id: "b1c2d3e4-0000-4000-8000-000000000001", context_digest: "a".repeat(64) },
    ]);
    const reader = createResearchManifestReader(client);

    const manifest = await reader.readManifestDigest({ organizationId: ORGANIZATION_ID });

    expect(manifest).toEqual({
      digest: "a".repeat(64),
      revision: "b1c2d3e4-0000-4000-8000-000000000001",
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].table).toBe("memory_context_manifests");
    expect(client.calls[0].orders).toEqual([["as_of", false]]);
    expect(client.calls[0].limit).toBe(1);
  });

  it("returns null when the organization has no manifest", async () => {
    const client = fakePostgrest([]);
    const reader = createResearchManifestReader(client);

    await expect(
      reader.readManifestDigest({ organizationId: ORGANIZATION_ID }),
    ).resolves.toBeNull();
  });

  it("throws when the manifest cannot be read", async () => {
    const client = fakePostgrest(null, { code: "PGRST000", message: "unreadable" });
    const reader = createResearchManifestReader(client);

    await expect(
      reader.readManifestDigest({ organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow("The memory manifest could not be read.");
  });
});
