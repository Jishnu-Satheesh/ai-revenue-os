import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readLatestRevenueSnapshot,
  revenueSnapshotDigest,
  trimRevenueSnapshots,
  writeRevenueSnapshot,
  type RevenueSnapshotRecord,
} from "@/modules/organizations/infrastructure/revenue-snapshot-repository";
import type { Database } from "@/lib/supabase/database.types";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function scenarioInput(): RevenueScenarioInput {
  return {
    organizationId: ORG_ID,
    grain: "month",
    history: [{ label: "2026-08", minorUnits: 800_00, currency: "AED" }],
    losses: [],
    actions: [],
    lastObservationDate: "2026-08-31",
    today: "2026-09-16",
    cutoffNote: "Reports through 2026-08-31.",
    coverageNote: "1 reporting channel · monthly buckets.",
  };
}

function fakePersistence(row: RevenueSnapshotRecord | null, error: unknown = null) {
  const terminal = { maybeSingle: vi.fn(async () => ({ data: row, error })) };
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => terminal);
  return {
    from: vi.fn(() => ({ select: vi.fn(() => chain) })),
    __chain: chain,
    __terminal: terminal,
  };
}

type FakeClient = SupabaseClient<Database>;

function asClient(fake: { from: unknown }): FakeClient {
  return fake as unknown as FakeClient;
}

function fakeWriter(upsertError: unknown = null, deleteError: unknown = null) {
  const upsert = vi.fn(async (row: Record<string, unknown>, options?: { onConflict?: string }) => ({
    data: null,
    error: upsertError,
    row,
    options,
  }));
  const lt = vi.fn(async () => ({ data: null, error: deleteError, count: 2 }));
  const deleteQuery = { eq: vi.fn(() => ({ lt })) };
  return {
    persistence: {
      from: vi.fn(() => ({
        select: vi.fn(),
        upsert,
        delete: vi.fn(() => deleteQuery),
      })),
    } as unknown as FakeClient,
    upsert,
    lt,
  };
}

describe("revenue snapshot repository", () => {
  it("digests the same input identically regardless of key order", () => {
    const input = scenarioInput();
    const reordered = Object.fromEntries(Object.entries(input).reverse()) as RevenueScenarioInput;
    expect(revenueSnapshotDigest(input)).toBe(revenueSnapshotDigest(reordered));
    expect(revenueSnapshotDigest(input)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reads the latest row and re-validates its input", async () => {
    const fake = fakePersistence({
      id: "snap-1",
      organization_id: ORG_ID,
      snapshot_date: "2026-09-16",
      scenario_input: scenarioInput(),
      ai_note: "Model-proposed ranges applied.",
      input_digest: "digest",
      created_at: "2026-09-16T00:00:00.000Z",
    });
    const read = await readLatestRevenueSnapshot(asClient(fake), ORG_ID);
    expect(fake.from).toHaveBeenCalledWith("organization_revenue_snapshots");
    if (read.state !== "ready") throw new Error("expected ready");
    expect(read.snapshotDate).toBe("2026-09-16");
    expect(read.input.history).toHaveLength(1);
    expect(read.aiNote).toBe("Model-proposed ranges applied.");
  });

  it("treats missing and unparsable rows as absent, never repaired", async () => {
    const missing = await readLatestRevenueSnapshot(
      fakePersistence(null) as unknown as FakeClient,
      ORG_ID,
    );
    expect(missing).toEqual({ state: "missing" });

    const corrupt = await readLatestRevenueSnapshot(
      fakePersistence({
        id: "snap-2",
        organization_id: ORG_ID,
        snapshot_date: "2026-09-16",
        scenario_input: { nonsense: true },
        ai_note: null,
        input_digest: "digest",
        created_at: "2026-09-16T00:00:00.000Z",
      }) as unknown as FakeClient,
      ORG_ID,
    );
    expect(corrupt).toEqual({ state: "corrupt" });
  });

  it("upserts one row per org-day and trims old rows", async () => {
    const { persistence, upsert, lt } = fakeWriter();
    await writeRevenueSnapshot(persistence, {
      organizationId: ORG_ID,
      snapshotDate: "2026-09-16",
      input: scenarioInput(),
      aiNote: null,
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[1]).toMatchObject({
      onConflict: "organization_id,snapshot_date",
    });

    const trimmed = await trimRevenueSnapshots(persistence, ORG_ID, "2025-08-16");
    expect(lt).toHaveBeenCalledWith("snapshot_date", "2025-08-16");
    expect(trimmed.removed).toBe(2);
  });

  it("refuses invalid inputs and failed writes loudly", async () => {
    const { persistence } = fakeWriter();
    await expect(
      writeRevenueSnapshot(persistence, {
        organizationId: "not-a-uuid",
        snapshotDate: "2026-09-16",
        input: scenarioInput(),
        aiNote: null,
      }),
    ).rejects.toThrow(/disagrees/);

    const failing = fakeWriter(new Error("db down"));
    await expect(
      writeRevenueSnapshot(failing.persistence, {
        organizationId: ORG_ID,
        snapshotDate: "2026-09-16",
        input: scenarioInput(),
        aiNote: null,
      }),
    ).rejects.toThrow(/Storing the revenue snapshot failed/);
  });
});
