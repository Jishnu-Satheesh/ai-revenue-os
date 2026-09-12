import { z } from "zod";

import { MemoryError } from "@/domain/memory/errors";
import { runMemoryRoute } from "@/modules/memory/application/api";

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  manifestId: z.string().uuid(),
});

const manifestRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["ready", "empty", "partial", "unavailable", "disabled"]),
  policy_version: z.string(),
  selected_count: z.number().int().nonnegative(),
  as_of: z.string(),
});

const entryRowSchema = z.object({
  context_ref: z.string(),
  source_kind: z.string(),
  memory_item_id: z.string().uuid().nullable(),
  capture_event_id: z.string().uuid().nullable(),
  business_fact_id: z.string().uuid().nullable(),
  business_profile_id: z.string().uuid().nullable(),
  goal_id: z.string().uuid().nullable(),
  constraint_id: z.string().uuid().nullable(),
  campaign_version_id: z.string().uuid().nullable(),
  observed_at: z.string().nullable(),
  safe_snapshot: z.object({
    title: z.string(),
    summary: z.string(),
  }).catchall(z.unknown()),
});

/**
 * Safe visible manifest plus its pinned entries for the context drawer.
 *
 * Reads ride the caller's RLS session through the member select policies; a
 * manifest from another organization reads as not found, never as forbidden
 * detail. Only the bounded safe title/summary the model already saw travel —
 * no raw bodies, no digests beyond identity, no root internals.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; manifestId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    handler: async ({ context, params: routeParams }) => {
      type ContextQuery = {
        eq(column: string, value: string): ContextQuery;
        order(column: string, options?: { ascending?: boolean }): ContextQuery;
        limit(count: number): PromiseLike<{ data: unknown; error: unknown }>;
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
      const client = context.supabase as unknown as {
        from(table: string): {
          select(columns: string): ContextQuery;
        };
      };

      const manifestResult = await client
        .from("memory_context_manifests")
        .select("id,status,policy_version,selected_count,as_of")
        .eq("organization_id", context.organizationId)
        .eq("id", routeParams.manifestId)
        .maybeSingle();
      if (manifestResult.error) throw new Error("The used context could not be read.");
      if (!manifestResult.data) throw new MemoryError("NOT_FOUND", "Context manifest not found.");
      const manifest = manifestRowSchema.parse(manifestResult.data);

      const entriesResult = await client
        .from("memory_context_entries")
        .select(
          "context_ref,source_kind,memory_item_id,capture_event_id,business_fact_id,business_profile_id,goal_id,constraint_id,campaign_version_id,observed_at,safe_snapshot",
        )
        .eq("organization_id", context.organizationId)
        .eq("manifest_id", manifest.id)
        .order("context_ref", { ascending: true })
        .limit(24);
      if (entriesResult.error) throw new Error("The used context could not be read.");
      const entries = z.array(entryRowSchema).parse(entriesResult.data ?? []).map((row) => ({
        contextRef: row.context_ref,
        title: row.safe_snapshot.title,
        summary: row.safe_snapshot.summary,
        sourceKind: row.source_kind,
        sourceId:
          row.memory_item_id ??
          row.capture_event_id ??
          row.business_fact_id ??
          row.business_profile_id ??
          row.goal_id ??
          row.constraint_id ??
          row.campaign_version_id ??
          "",
        observedAt: row.observed_at,
      }));

      return {
        body: {
          manifest: {
            id: manifest.id,
            status: manifest.status,
            policyVersion: manifest.policy_version,
            selectedCount: manifest.selected_count,
            asOf: manifest.as_of,
          },
          entries,
        },
      };
    },
  });
}
