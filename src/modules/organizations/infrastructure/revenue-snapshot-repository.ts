import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  revenueScenarioInputSchema,
  type RevenueScenarioInput,
} from "@/domain/organizations/revenue-scenario";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Nightly stored answers behind the home growth outlook (ADR 0060).
 *
 * The worker writes one row per organization per local day; the home loader
 * reads the latest row and falls back to live reads when none validates.
 * Reads through this module are always explicitly organization-scoped; the
 * worker's service client bypasses RLS by design, while session reads stay
 * under the member-read policy. Stored inputs are re-validated on every read
 * — a row that no longer parses is treated as missing, never repaired.
 */

export type RevenueSnapshotRecord = {
  id: string;
  organization_id: string;
  snapshot_date: string;
  scenario_input: unknown;
  ai_note: string | null;
  input_digest: string;
  created_at: string;
};

const SNAPSHOT_COLUMNS =
  "id,organization_id,snapshot_date,scenario_input,ai_note,input_digest,created_at";

/** Stable digest over the stored input: same input, same digest, any key order. */
export function revenueSnapshotDigest(input: RevenueScenarioInput): string {
  const ordered = JSON.stringify(sortDeep(input));
  return createHash("sha256").update(ordered).digest("hex");
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([key, entry]) => [key, sortDeep(entry)]),
    );
  }
  return value;
}

type SnapshotClient = SupabaseClient<Database>;

export type RevenueSnapshotRead =
  | { state: "missing" }
  | { state: "corrupt" }
  | {
      state: "ready";
      snapshotDate: string;
      input: RevenueScenarioInput;
      aiNote: string | null;
      digest: string;
    };

export async function readLatestRevenueSnapshot(
  supabase: SnapshotClient,
  organizationId: string,
): Promise<RevenueSnapshotRead> {
  const { data, error } = await supabase
    .from("organization_revenue_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { state: "missing" };
  const parsed = revenueScenarioInputSchema.safeParse(data.scenario_input);
  if (!parsed.success) return { state: "corrupt" };
  return {
    state: "ready",
    snapshotDate: data.snapshot_date,
    input: parsed.data,
    aiNote: data.ai_note,
    digest: data.input_digest,
  };
}

export async function writeRevenueSnapshot(
  supabase: SnapshotClient,
  snapshot: {
    organizationId: string;
    snapshotDate: string;
    input: RevenueScenarioInput;
    aiNote: string | null;
  },
): Promise<{ id: string }> {
  const parsed = revenueScenarioInputSchema.safeParse(snapshot.input);
  if (!parsed.success) throw new Error("Refusing to store an invalid revenue snapshot input.");
  if (snapshot.organizationId !== parsed.data.organizationId) {
    throw new Error("Refusing to store a revenue snapshot whose owner disagrees with its input.");
  }
  const { error } = await supabase.from("organization_revenue_snapshots").upsert(
    {
      organization_id: snapshot.organizationId,
      snapshot_date: snapshot.snapshotDate,
      scenario_input: parsed.data,
      ai_note: snapshot.aiNote,
      input_digest: revenueSnapshotDigest(parsed.data),
    },
    { onConflict: "organization_id,snapshot_date" },
  );
  if (error) throw new Error("Storing the revenue snapshot failed.");
  return { id: `${snapshot.organizationId}:${snapshot.snapshotDate}` };
}

export async function trimRevenueSnapshots(
  supabase: SnapshotClient,
  organizationId: string,
  keepSinceDate: string,
): Promise<{ removed: number }> {
  const { error, count } = await supabase
    .from("organization_revenue_snapshots")
    .delete()
    .eq("organization_id", organizationId)
    .lt("snapshot_date", keepSinceDate);
  if (error) throw new Error("Trimming old revenue snapshots failed.");
  return { removed: count ?? 0 };
}
