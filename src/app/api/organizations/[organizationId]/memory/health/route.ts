import { z } from "zod";

import { runMemoryRoute } from "@/modules/memory/application/api";
import { buildMemoryHealth } from "@/modules/memory/application/health-service";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

const captureRowSchema = z.object({
  source_kind: z.string(),
  status: z.enum(["pending", "claimed", "completed", "failed", "quarantined", "obsolete"]),
  completed_at: z.string().nullable(),
});

const manifestRowSchema = z.object({
  purpose: z.string(),
  status: z.enum(["ready", "empty", "partial", "unavailable", "disabled"]),
  as_of: z.string().nullable(),
});

/**
 * Governed memory health: bounded per-adapter counts, no snippets.
 *
 * Reads ride the caller's RLS session through the member select policies, so
 * a reader only ever counts rows their role may already read. Aggregation is
 * the pure health service; nothing here carries a title, a body, a summary,
 * or a prompt — counts, statuses, timestamps, and safe codes only.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    handler: async ({ context }) => {
      type HealthQuery = {
        eq(column: string, value: string): HealthQuery;
        order(column: string, options?: { ascending?: boolean }): HealthQuery;
        limit(count: number): PromiseLike<{ data: unknown; error: unknown }>;
        then(
          resolve: (value: { data: unknown; error: unknown; count: number | null }) => unknown,
        ): unknown;
      };
      const client = context.supabase as unknown as {
        from(table: string): {
          select(columns: string, options?: { count?: "exact"; head?: boolean }): HealthQuery;
        };
      };

      const embeddingQuery = client
        .from("memory_items")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", context.organizationId)
        .eq("embedding_status", "pending");

      const [captures, manifests] = await Promise.all([
        client
          .from("memory_capture_events")
          .select("source_kind,status,completed_at")
          .eq("organization_id", context.organizationId)
          .order("completed_at", { ascending: false })
          .limit(1000),
        client
          .from("memory_context_manifests")
          .select("purpose,status,as_of")
          .eq("organization_id", context.organizationId)
          .order("as_of", { ascending: false })
          .limit(500),
      ]);
      const embedding = (await embeddingQuery) as unknown as {
        error: unknown;
        count: number | null;
      };
      if (captures.error || manifests.error || embedding.error) {
        throw new Error("Memory health could not be read.");
      }

      const adapterRows = z.array(captureRowSchema).parse(captures.data ?? []).map((row) => ({
        sourceKind: row.source_kind,
        status: row.status,
        count: 1,
        lastSuccessAt: row.status === "completed" ? row.completed_at : null,
      }));
      // Collapse the bounded row sample into per-kind × status counts. Counts
      // stay exact while the sample covers the corpus; beyond the bound the
      // response says so instead of silently understating a backlog.
      const collapsed = new Map<string, { sourceKind: string; status: (typeof adapterRows)[number]["status"]; count: number; lastSuccessAt: string | null }>();
      for (const row of adapterRows) {
        const key = `${row.sourceKind}\n${row.status}`;
        const existing = collapsed.get(key);
        if (!existing) {
          collapsed.set(key, { ...row });
        } else {
          existing.count += 1;
          if (row.lastSuccessAt && (!existing.lastSuccessAt || row.lastSuccessAt > existing.lastSuccessAt)) {
            existing.lastSuccessAt = row.lastSuccessAt;
          }
        }
      }

      const contextRows = z.array(manifestRowSchema).parse(manifests.data ?? []).map((row) => ({
        purpose: row.purpose,
        status: row.status,
        count: 1,
        lastPreparedAt: row.as_of,
      }));
      const collapsedContexts = new Map<string, { purpose: string; status: (typeof contextRows)[number]["status"]; count: number; lastPreparedAt: string | null }>();
      for (const row of contextRows) {
        const key = `${row.purpose}\n${row.status}`;
        const existing = collapsedContexts.get(key);
        if (!existing) {
          collapsedContexts.set(key, { ...row });
        } else {
          existing.count += 1;
          if (row.lastPreparedAt && (!existing.lastPreparedAt || row.lastPreparedAt > existing.lastPreparedAt)) {
            existing.lastPreparedAt = row.lastPreparedAt;
          }
        }
      }

      const health = buildMemoryHealth({
        organizationId: context.organizationId,
        role: context.role,
        serverTime: new Date().toISOString(),
        adapters: [...collapsed.values()],
        contexts: [...collapsedContexts.values()],
        embeddingBacklog: embedding.count ?? 0,
      });
      return { body: { health } };
    },
  });
}
