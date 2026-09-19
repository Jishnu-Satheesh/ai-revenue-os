import { describe, expect, it, vi } from "vitest";

import { addLocalMonths } from "@/domain/organizations/growth-periods";
import type { ScopePartition } from "@/domain/organizations/growth-progress";
import type { GrowthAdviceCandidate } from "@/modules/organizations/application/growth-advice";
import { loadGrowthProgress } from "@/modules/organizations/application/growth-progress-service";
import type {
  GrowthProgressReadPort,
  StoredGrowthProjection,
} from "@/modules/organizations/application/growth-progress-ports";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_A = "99999999-9999-4999-8999-999999999991";
const ACTOR_B = "99999999-9999-4999-8999-999999999992";
const DEF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001";
const NOW_ISO = "2026-09-20T12:00:00.000Z";
const TIME_ZONE = "Asia/Dubai";
const ORIGIN = "2026-09-17";

const SCOPE: ScopePartition = {
  partitionKey: "pk-org",
  channelId: null,
  branchId: null,
  metricDefinitionId: DEF_ID,
  dimensionsDigest: "empty",
  periodTimezone: TIME_ZONE,
};

function points(startDate: string, days: number, low: number, central: number, high: number) {
  const rows = [{ date: startDate, lowMinor: 0, centralMinor: 0, highMinor: 0, anchor: true }];
  let current = new Date(`${startDate}T00:00:00Z`);
  for (let day = 1; day <= days; day += 1) {
    const date = current.toISOString().slice(0, 10);
    rows.push({
      date,
      lowMinor: low * day,
      centralMinor: central * day,
      highMinor: high * day,
      anchor: false,
    });
    current = new Date(current.getTime() + 86_400_000);
  }
  return rows;
}

function stored(
  horizonMonths: 1 | 3 | 6 | 12,
  overrides: Record<string, unknown> = {},
): StoredGrowthProjection {
  const startDate = ORIGIN;
  const endDateExclusive = addLocalMonths(ORIGIN, horizonMonths);
  const days = horizonMonths === 1 ? 5 : 3;
  return {
    projectionId: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${horizonMonths}`,
    digest: "c".repeat(64),
    document: {
      organizationId: ORG_ID,
      scheduleOriginDate: ORIGIN,
      cycleIndex: 0,
      horizonMonths,
      startDate,
      endDateExclusive,
      issuedAt: "2026-09-16T20:00:00.000Z",
      sourceCutoffDate: "2026-09-16",
      timeZone: TIME_ZONE,
      currency: "AED",
      metricKey: "revenue.gross",
      scopePartitions: [SCOPE],
      baselineWindow: { startDate: "2026-08-01", endDateExclusive: "2026-09-01" },
      monthlyLowMinor: 30_000_00,
      monthlyHighMinor: 36_000_00,
      points: points(startDate, days, 1_000_00, 1_100_00, 1_200_00),
      sources: [],
      actionAssumptions: [],
      limitations: ["Even-pace estimate."],
      ...overrides,
    },
  } as unknown as StoredGrowthProjection;
}

function fact(day: string, amountMinor: number, overrides: Record<string, unknown> = {}) {
  const end = new Date(`${day}T00:00:00Z`);
  const start = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);
  return {
    sourceTable: "normalized_metrics",
    rowId: `row-${day}`,
    organizationId: ORG_ID,
    partitionKey: "pk-org",
    startDate: start,
    endDateExclusive: day,
    amountMinor,
    currency: "AED",
    createdAt: "2026-09-16T00:00:00.000Z",
    reconciliationDigest: `digest-${day}`,
    ...overrides,
  };
}

function candidate(overrides: Partial<GrowthAdviceCandidate> = {}): GrowthAdviceCandidate {
  return {
    id: "cand-1",
    kind: "recommendation",
    title: "Review cancellation findings",
    supportingText: "Reports from 2026-08-01–2026-08-31.",
    href: `/organizations/${ORG_ID}/growth-intelligence`,
    key: null,
    sourceRevision: null,
    sourceWindowStart: "2026-08-01",
    sourceWindowEnd: "2026-08-31",
    channelIds: [],
    branchIds: [],
    sourceStatus: null,
    evidenceRefs: [],
    relation: "general",
    permission: "growth_intelligence.read",
    ...overrides,
  };
}

function deps(
  overrides: {
    projections?:
      | StoredGrowthProjection[]
      | { status: "denied" | "missing" | "corrupt" | "failed" };
    facts?: Record<string, unknown>[];
    factsEnvelope?: "denied" | "limited" | "failed";
    candidates?: GrowthAdviceCandidate[];
    laneErrors?: Record<string, string>;
  } = {},
) {
  const readProjections = vi.fn(async () => {
    if (Array.isArray(overrides.projections)) {
      return { status: "ready" as const, projections: overrides.projections };
    }
    const status = overrides.projections === undefined ? "missing" : overrides.projections.status;
    if (status === "denied")
      return { status: "denied" as const, reason: "PERMISSION_DENIED" as const };
    if (status === "corrupt")
      return { status: "corrupt" as const, reason: "PROJECTION_CORRUPT" as const };
    if (status === "failed")
      return { status: "failed" as const, reason: "SOURCE_READ_FAILED" as const };
    return { status: "missing" as const, reason: "PROJECTION_MISSING" as const };
  });
  const readRevenueFacts = vi.fn(async (query: { organizationId: string }) => {
    // The fake honors tenant scoping like the real port: a foreign
    // organization reads as a failure, never as another tenant's facts.
    if (query.organizationId !== ORG_ID) {
      return { status: "failed" as const, reason: "SOURCE_READ_FAILED" as const };
    }
    if (overrides.factsEnvelope === "denied")
      return { status: "denied" as const, reason: "PERMISSION_DENIED" as const };
    if (overrides.factsEnvelope === "limited") {
      return { status: "limited" as const, reason: "SOURCE_LIMIT_EXCEEDED" as const };
    }
    if (overrides.factsEnvelope === "failed") {
      return { status: "failed" as const, reason: "SOURCE_READ_FAILED" as const };
    }
    return { status: "ready" as const, facts: (overrides.facts ?? []) as never };
  });
  const readAdvice = vi.fn(async () => ({
    candidates: overrides.candidates ?? [],
    laneErrors: overrides.laneErrors ?? {},
  }));
  const progressReads: GrowthProgressReadPort = {
    readProjections: readProjections as never,
    readRevenueFacts: readRevenueFacts as never,
  };
  return { readProjections, readRevenueFacts, readAdvice, progressReads };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    actorId: ACTOR_A,
    nowIso: NOW_ISO,
    timeZone: TIME_ZONE,
    permissions: { canReadProjections: true, canReadGrowth: true, canReadCampaigns: true },
    ...overrides,
  };
}

describe("ready composition", () => {
  it("batches one union fact read per scope and composes behind with recovery-first advice", async () => {
    const h1 = stored(1);
    const h3 = stored(3);
    // Three daily facts of 100_00: cumulative 300_00 at 2026-09-20 against
    // day-4 bounds (low 4000_00), so the comparison lands behind.
    const d = deps({
      projections: [h1, h3],
      facts: [fact("2026-09-18", 100_00), fact("2026-09-19", 100_00), fact("2026-09-20", 100_00)],
      candidates: [
        candidate({ id: "g1", kind: "insight", relation: "general", title: "General context" }),
        candidate({ id: "r1", relation: "recovery", title: "Recovery fix" }),
      ],
    });

    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    expect(section.state).toBe("ready");
    if (section.state !== "ready") return;
    expect(section.initialHorizon).toBe(1);
    // One union read covers both horizons sharing the scope.
    expect(d.readRevenueFacts).toHaveBeenCalledTimes(1);
    expect(d.readRevenueFacts.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG_ID,
      from: ORIGIN,
      toExclusive: addLocalMonths(ORIGIN, 3),
    });
    // One advice read serves the whole section.
    expect(d.readAdvice).toHaveBeenCalledTimes(1);

    const view = section.views[1];
    expect(view.state).toBe("ready");
    expect(view.projectionId).toBe(h1.projectionId);
    expect(view.projectionDigest).toBe(h1.digest);
    expect(view.latestComparableDate).toBe("2026-09-20");
    expect(view.latestComparison?.state).toBe("behind");
    expect(view.adviceRows.map((row) => row.id)).toEqual(["r1", "g1"]);
    expect(view.currency).toBe("AED");
    expect(view.scopeLabel).toBe("Organization total");
    expect(view.sources).toEqual([]);
  });

  it("picks the latest complete endpoint, not the newest single report", async () => {
    // Cover runs 09-17→09-18 only; a lone 09-20 fact without 09-19 cannot
    // complete, so the comparison stays at 09-18.
    const d = deps({
      projections: [stored(1)],
      facts: [fact("2026-09-18", 500_00), fact("2026-09-20", 900_00)],
      candidates: [],
    });

    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    if (section.state !== "ready") throw new Error("expected ready");
    expect(section.views[1].latestComparableDate).toBe("2026-09-18");
  });

  it("breaks the blue line across gaps instead of bridging them", async () => {
    const doc = stored(1);
    const d = deps({
      projections: [doc],
      facts: [fact("2026-09-18", 500_00)],
      candidates: [],
    });

    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    if (section.state !== "ready") throw new Error("expected ready");
    const view = section.views[1];
    // Day-ends 09-17..09-21 (5 days); only 09-18 has a value.
    expect(view.points.map((point) => point.date)).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ]);
    expect(view.points.map((point) => point.breakBefore)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("denial hides without recomputing", () => {
  it("never calls the projection reader when access is denied upfront", async () => {
    const d = deps({ projections: [stored(1)] });

    const section = await loadGrowthProgress(
      input({
        permissions: { canReadProjections: false, canReadGrowth: false, canReadCampaigns: false },
      }),
      { progressReads: d.progressReads, readAdvice: d.readAdvice },
    );

    expect(d.readProjections).not.toHaveBeenCalled();
    expect(d.readRevenueFacts).not.toHaveBeenCalled();
    expect(d.readAdvice).not.toHaveBeenCalled();
    if (section.state !== "ready") throw new Error("expected ready");
    for (const horizon of [1, 3, 6, 12] as const) {
      expect(section.views[horizon]).toMatchObject({
        state: "unavailable",
        reasonCode: "PERMISSION_DENIED",
        projectionId: null,
        latestComparison: null,
        adviceRows: [],
      });
    }
  });

  it("keeps stored identity but no numbers when facts are denied", async () => {
    const h1 = stored(1);
    const d = deps({ projections: [h1], factsEnvelope: "denied" });

    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    if (section.state !== "ready") throw new Error("expected ready");
    expect(section.views[1]).toMatchObject({
      state: "unavailable",
      reasonCode: "PERMISSION_DENIED",
      projectionId: h1.projectionId,
      projectionDigest: h1.digest,
      points: [],
      latestComparison: null,
    });
  });

  it("gives two viewers the same numbers for the same projection id", async () => {
    const h1 = stored(1);
    const base = {
      projections: [h1],
      facts: [fact("2026-09-18", 500_00), fact("2026-09-19", 500_00)],
      candidates: [candidate({ id: "g1" })],
    };
    const first = deps(base);
    const second = deps(base);

    const forA = await loadGrowthProgress(input({ actorId: ACTOR_A }), {
      progressReads: first.progressReads,
      readAdvice: first.readAdvice,
    });
    const forB = await loadGrowthProgress(input({ actorId: ACTOR_B }), {
      progressReads: second.progressReads,
      readAdvice: second.readAdvice,
    });

    if (forA.state !== "ready" || forB.state !== "ready") throw new Error("expected ready");
    expect(forB.views[1].projectionId).toBe(forA.views[1].projectionId);
    expect(forB.views[1].points).toEqual(forA.views[1].points);
    expect(forB.views[1].latestComparison).toEqual(forA.views[1].latestComparison);
  });
});

describe("state coverage", () => {
  it("reports missing, corrupt and failed envelopes without advice reads", async () => {
    for (const envelope of ["missing", "corrupt", "failed"] as const) {
      const d = deps({ projections: { status: envelope } });
      const section = await loadGrowthProgress(input(), {
        progressReads: d.progressReads,
        readAdvice: d.readAdvice,
      });
      if (section.state !== "ready") throw new Error("expected ready");
      const expected =
        envelope === "missing"
          ? { state: "missing", reasonCode: "PROJECTION_MISSING" }
          : envelope === "corrupt"
            ? { state: "unavailable", reasonCode: "PROJECTION_CORRUPT" }
            : { state: "unavailable", reasonCode: "SOURCE_READ_FAILED" };
      expect(section.views[1]).toMatchObject(expected);
      expect(d.readRevenueFacts).not.toHaveBeenCalled();
      expect(d.readAdvice).not.toHaveBeenCalled();
    }
  });

  it("shows upcoming with the curve but no comparison", async () => {
    const d = deps({ projections: [stored(1)], candidates: [candidate({ id: "g1" })] });
    const section = await loadGrowthProgress(input({ nowIso: "2026-09-10T12:00:00.000Z" }), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    if (section.state !== "ready") throw new Error("expected ready");
    const view = section.views[1];
    expect(view.state).toBe("upcoming");
    expect(view.reasonCode).toBe("PROJECTION_UPCOMING");
    expect(view.projectionId).not.toBeNull();
    expect(view.latestComparison).toBeNull();
    expect(view.points.every((point) => point.currentMinor === null)).toBe(true);
    expect(view.points.every((point) => point.projectedCentralMinor !== null)).toBe(true);
    expect(view.adviceRows.map((row) => row.id)).toEqual(["g1"]);
    // Nothing to compare yet, so no fact read is scheduled.
    expect(d.readRevenueFacts).not.toHaveBeenCalled();
  });

  it("waits for reports when nothing comparable exists yet", async () => {
    const d = deps({ projections: [stored(1)], facts: [], candidates: [] });
    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    if (section.state !== "ready") throw new Error("expected ready");
    const view = section.views[1];
    expect(view.state).toBe("awaiting_reports");
    expect(view.latestComparison).toBeNull();
    // A visible difference does not exist yet, so no neutral fallback either.
    expect(view.adviceRows).toEqual([]);
  });

  it("falls back neutrally when a visible gap has no qualified rows", async () => {
    const d = deps({
      projections: [stored(1)],
      facts: [fact("2026-09-18", 100_00)],
      candidates: [],
    });
    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    if (section.state !== "ready") throw new Error("expected ready");
    expect(section.views[1].adviceRows).toHaveLength(1);
    expect(section.views[1].adviceRows[0]!.id).toBe("neutral-fallback");
  });

  it("omits the fallback link when growth reads are not permitted", async () => {
    const d = deps({
      projections: [stored(1)],
      facts: [fact("2026-09-18", 100_00)],
      candidates: [],
    });
    const section = await loadGrowthProgress(
      input({
        permissions: { canReadProjections: true, canReadGrowth: false, canReadCampaigns: false },
      }),
      { progressReads: d.progressReads, readAdvice: d.readAdvice },
    );

    if (section.state !== "ready") throw new Error("expected ready");
    expect(d.readAdvice).not.toHaveBeenCalled();
    expect(section.views[1].adviceRows).toHaveLength(1);
    expect(section.views[1].adviceRows[0]!.href).toBeNull();
  });

  it("fails only on unusable input", async () => {
    const d = deps({});
    const section = await loadGrowthProgress(input({ organizationId: "not-a-uuid" }), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });
    expect(section).toEqual({ state: "failed", reasonCode: "INVALID_INPUT", retainedView: null });
    expect(d.readProjections).not.toHaveBeenCalled();
  });
});

describe("independent errors and scope discipline", () => {
  it("reads distinct scopes separately and preserves one group's failure", async () => {
    const otherScope: ScopePartition = {
      ...SCOPE,
      partitionKey: "pk-branch",
      channelId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002",
      branchId: null,
    };
    const h1 = stored(1);
    const h3 = stored(3, { scopePartitions: [otherScope] });
    const readRevenueFacts = vi.fn(async (query: { scopePartitions: ScopePartition[] }) => {
      if (query.scopePartitions[0]!.partitionKey === "pk-org") {
        return { status: "ready" as const, facts: [fact("2026-09-18", 100_00)] as never };
      }
      return { status: "failed" as const, reason: "SOURCE_READ_FAILED" as const };
    });
    const readProjections = vi.fn(async () => ({
      status: "ready" as const,
      projections: [h1, h3],
    }));
    const readAdvice = vi.fn(async () => ({ candidates: [], laneErrors: {} }));

    const section = await loadGrowthProgress(input(), {
      progressReads: {
        readProjections: readProjections as never,
        readRevenueFacts: readRevenueFacts as never,
      },
      readAdvice,
    });

    expect(readRevenueFacts).toHaveBeenCalledTimes(2);
    if (section.state !== "ready") throw new Error("expected ready");
    expect(section.views[1].state).toBe("ready");
    expect(section.views[3]).toMatchObject({
      state: "unavailable",
      reasonCode: "SOURCE_READ_FAILED",
      projectionId: h3.projectionId,
    });
  });

  it("surfaces lane failures as a visible note, never silence", async () => {
    const d = deps({
      projections: [stored(1)],
      facts: [fact("2026-09-18", 100_00)],
      candidates: [candidate({ id: "g1" })],
      laneErrors: { items: "SOURCE_READ_FAILED" },
    });
    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    if (section.state !== "ready") throw new Error("expected ready");
    expect(section.views[1].limitations).toContain("Advice is temporarily unavailable.");
    expect(section.views[1].adviceRows.map((row) => row.id)).toEqual(["g1"]);
  });

  it("keeps channel-scoped advice out of the organization-total view", async () => {
    const d = deps({
      projections: [stored(1)],
      facts: [fact("2026-09-18", 100_00)],
      candidates: [
        candidate({
          id: "ch1",
          channelIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002"],
          sourceWindowEnd: "2026-08-31",
        }),
      ],
    });
    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    if (section.state !== "ready") throw new Error("expected ready");
    // The channel row cannot advise the org-total scope, so the neutral
    // fallback explains the visible gap instead.
    expect(section.views[1].adviceRows.map((row) => row.id)).toEqual(["neutral-fallback"]);
  });

  it("serializes no amounts beyond the frozen numbers", async () => {
    const d = deps({
      projections: [stored(1)],
      facts: [fact("2026-09-18", 100_00)],
      candidates: [candidate({ id: "g1" })],
    });
    const section = await loadGrowthProgress(input(), {
      progressReads: d.progressReads,
      readAdvice: d.readAdvice,
    });

    const serialized = JSON.stringify(section);
    expect(serialized).not.toContain("minorUnits");
    expect(serialized).not.toContain("assumption");
  });
});
