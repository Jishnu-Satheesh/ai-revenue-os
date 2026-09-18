import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { PublishGrowthProjectionInput } from "@/modules/organizations/application/growth-progress-ports";

vi.mock("server-only", () => ({}));

/**
 * Worker-only publication adapter (data contract D04/D07).
 *
 * Like a guarded deposit slot: the worker hands over a sealed envelope with
 * its own key, and the slot either files the original or hands back the
 * already-filed one — it never rewrites, never falls back, never recalculates.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const DEF = "22222222-2222-4222-8222-222222222222";
const CORRELATION = "66666666-6666-4666-8666-666666666666";

type PointShape = {
  date: string;
  lowMinor: number;
  centralMinor: number;
  highMinor: number;
  anchor: boolean;
};

function points(days: number): PointShape[] {
  const list: PointShape[] = [
    { date: "2030-01-01", lowMinor: 0, centralMinor: 0, highMinor: 0, anchor: true },
  ];
  for (let day = 1; day <= days; day += 1) {
    list.push({
      date: `2030-01-${String(day).padStart(2, "0")}`,
      lowMinor: 1000 * day,
      centralMinor: 1100 * day,
      highMinor: 1200 * day,
      anchor: false,
    });
  }
  return list;
}

function document(): PublishGrowthProjectionInput["document"] {
  return {
    organizationId: ORG,
    scheduleOriginDate: "2030-01-01",
    cycleIndex: 0,
    horizonMonths: 1 as const,
    startDate: "2030-01-01",
    endDateExclusive: "2030-02-01",
    issuedAt: "2030-01-02T00:00:00Z",
    sourceCutoffDate: "2030-01-01",
    timeZone: "Asia/Dubai",
    currency: "AED",
    metricKey: "revenue.gross",
    scopePartitions: [
      {
        partitionKey: "pk-1",
        channelId: null,
        branchId: null,
        metricDefinitionId: DEF,
        dimensionsDigest: "empty",
        periodTimezone: "Asia/Dubai",
      },
    ],
    baselineWindow: { startDate: "2029-12-01", endDateExclusive: "2030-01-01" },
    monthlyLowMinor: 31000,
    monthlyHighMinor: 37200,
    points: points(31),
    sources: [],
    actionAssumptions: [],
    limitations: ["Seeded capacity note."],
  };
}

const STORED_ID = "77777777-7777-4777-8777-777777777777";
const STORED_DIGEST = "c".repeat(64);

function serviceClient(
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return rpc(name, args);
    }),
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe("growth-projection repository", () => {
  it("publishes through the worker-only RPC and returns its identity", async () => {
    const { createGrowthProjectionRepository } = await import(
      "@/modules/organizations/infrastructure/growth-projection-repository"
    );
    const { client, calls } = serviceClient(async () => ({
      data: [{ projection_id: STORED_ID, digest: STORED_DIGEST, published: true }],
      error: null,
    }));
    const result = await createGrowthProjectionRepository(client).publish({
      organizationId: ORG,
      document: document(),
      correlationId: CORRELATION,
    });
    expect(result).toEqual({ projectionId: STORED_ID, digest: STORED_DIGEST, published: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("publish_organization_growth_projection");
    expect(calls[0]?.args).toMatchObject({
      p_organization_id: ORG,
      p_correlation_id: CORRELATION,
    });
  });

  it("replays the stored identity when the candidate differs", async () => {
    const { createGrowthProjectionRepository } = await import(
      "@/modules/organizations/infrastructure/growth-projection-repository"
    );
    const seen: unknown[] = [];
    const { client, calls } = serviceClient(async (_name, args) => {
      seen.push(args.p_document);
      return {
        data: [{ projection_id: STORED_ID, digest: STORED_DIGEST, published: false }],
        error: null,
      };
    });
    const repository = createGrowthProjectionRepository(client);
    const first = await repository.publish({
      organizationId: ORG,
      document: document(),
      correlationId: CORRELATION,
    });
    const changed = {
      ...document(),
      monthlyHighMinor: 99999,
      points: points(31).map((point) => ({ ...point })),
    };
    const second = await repository.publish({
      organizationId: ORG,
      document: changed,
      correlationId: CORRELATION,
    });
    expect(first).toEqual({ projectionId: STORED_ID, digest: STORED_DIGEST, published: false });
    // The stored identity stands even though the candidate changed.
    expect(second).toEqual({ projectionId: STORED_ID, digest: STORED_DIGEST, published: false });
    expect(calls).toHaveLength(2);
    expect(seen).toHaveLength(2);
  });

  it("refuses mismatched tenants and malformed answers without a fallback", async () => {
    const { createGrowthProjectionRepository } = await import(
      "@/modules/organizations/infrastructure/growth-projection-repository"
    );
    const { client, calls } = serviceClient(async () => ({
      data: [{ projection_id: STORED_ID, digest: STORED_DIGEST, published: true }],
      error: null,
    }));
    const repository = createGrowthProjectionRepository(client);
    await expect(
      repository.publish({
        organizationId: "99999999-9999-4999-8999-999999999999",
        document: document(),
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    // The refused call never reaches the database: no live-scenario fallback,
    // no per-viewer recalculation, no second attempt.
    expect(calls).toHaveLength(0);

    await expect(
      repository.publish({
        organizationId: ORG,
        document: { nonsense: true } as unknown as ReturnType<typeof document>,
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(calls).toHaveLength(0);
  });

  it("maps RPC failures to typed codes and never retries a denial", async () => {
    const { createGrowthProjectionRepository } = await import(
      "@/modules/organizations/infrastructure/growth-projection-repository"
    );
    const cases: Array<[unknown, string]> = [
      [{ code: "PGR01", message: "envelope" }, "INVALID_DOCUMENT"],
      [{ code: "PGR02", message: "tenant" }, "TENANT_MISMATCH"],
      [{ code: "PGR03", message: "started" }, "PERIOD_ALREADY_STARTED"],
      [{ code: "PGR04", message: "schedule" }, "SCHEDULE_MISMATCH"],
      [{ code: "PGR05", message: "curve" }, "INVALID_CURVE"],
      [{ code: "PGR06", message: "immutable" }, "IMMUTABLE_ROW"],
      [{ code: "42501", message: "denied" }, "PERMISSION_DENIED"],
      [{ code: "XX000", message: "boom" }, "PUBLISH_FAILED"],
    ];
    for (const [error, code] of cases) {
      const { client, calls } = serviceClient(async () => ({ data: null, error }));
      await expect(
        createGrowthProjectionRepository(client).publish({
          organizationId: ORG,
          document: document(),
          correlationId: CORRELATION,
        }),
      ).rejects.toMatchObject({ code });
      // Exactly one attempt: a denial is reported, never worked around.
      expect(calls).toHaveLength(1);
    }

    const malformed = serviceClient(async () => ({ data: [], error: null }));
    await expect(
      createGrowthProjectionRepository(malformed.client).publish({
        organizationId: ORG,
        document: document(),
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ code: "PUBLISH_FAILED" });
  });

  it("hashes canonical digests independently of key order", async () => {
    const { sha256HexCanonical } = await import(
      "@/modules/organizations/infrastructure/growth-projection-repository"
    );
    const left = sha256HexCanonical({ b: 2, a: { y: 2, x: 1 } });
    const right = sha256HexCanonical({ a: { x: 1, y: 2 }, b: 2 });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256HexCanonical({ a: 1 })).not.toBe(sha256HexCanonical({ a: 2 }));
  });

  it("stays server-only so no client bundle can reach it", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/modules/organizations/infrastructure/growth-projection-repository.ts",
      ),
      "utf8",
    );
    expect(source).toContain('import "server-only"');
  });
});
