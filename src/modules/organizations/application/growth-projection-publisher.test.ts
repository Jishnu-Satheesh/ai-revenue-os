import { describe, expect, it, vi } from "vitest";

import type { FrozenGrowthProjection } from "@/domain/organizations/growth-progress";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";
import {
  buildSnapshotGrowthCandidate,
  publishDueGrowthProjections,
  type GrowthCandidateBuildContext,
  type GrowthProjectionPublisherDependencies,
  type GrowthScheduleSnapshot,
} from "@/modules/organizations/application/growth-projection-publisher";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DIGEST = "a".repeat(64);

/** Dubai local 2026-09-17; New York local 2026-09-16 for the same instant. */
const NOW_ISO = "2026-09-16T20:00:00.000Z";

function material(): { input: RevenueScenarioInput } {
  return {
    input: {
      organizationId: ORG_ID,
      grain: "month",
      history: [{ label: "2026-08", minorUnits: 800_00, currency: "AED" }],
      losses: [],
      actions: [],
      lastObservationDate: "2026-08-31",
      today: "2026-09-17",
      cutoffNote: "Reports through 2026-08-31.",
      coverageNote: "Monthly baseline.",
    },
  };
}

function cannedDocument(context: GrowthCandidateBuildContext, organizationId = ORG_ID) {
  return {
    organizationId,
    scheduleOriginDate: context.scheduleOriginDate,
    horizonMonths: context.horizonMonths,
    cycleIndex: context.cycleIndex,
  } as unknown as FrozenGrowthProjection;
}

function dependencies(
  overrides: Partial<GrowthProjectionPublisherDependencies> = {},
): GrowthProjectionPublisherDependencies & {
  isEnabled: ReturnType<typeof vi.fn>;
  readSchedule: ReturnType<typeof vi.fn>;
  buildCandidate: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
} {
  // Every override at the call sites is a vi.fn; the cast recovers the mock
  // surface the assertions use without weakening the dependency contract.
  return {
    isEnabled: vi.fn(() => true),
    readSchedule: vi.fn(async (): Promise<GrowthScheduleSnapshot> => ({ status: "missing" })),
    buildCandidate: vi.fn(
      async (_material: RevenueScenarioInput, context: GrowthCandidateBuildContext) => ({
        status: "ready" as const,
        document: cannedDocument(context),
      }),
    ),
    publish: vi.fn(async () => ({
      projectionId: "33333333-3333-4333-8333-333333333333",
      digest: DIGEST,
      published: true,
    })),
    ...overrides,
  } as GrowthProjectionPublisherDependencies & {
    isEnabled: ReturnType<typeof vi.fn>;
    readSchedule: ReturnType<typeof vi.fn>;
    buildCandidate: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    nowIso: NOW_ISO,
    timeZone: "Asia/Dubai",
    correlationId: CORRELATION_ID,
    candidateMaterial: material(),
    ...overrides,
  };
}

describe("publishDueGrowthProjections bootstrap", () => {
  it("opens every horizon at cycle 0 from the next-day origin", async () => {
    const deps = dependencies();
    const result = await publishDueGrowthProjections(input(), deps);

    expect(result.results.map((entry) => entry.horizonMonths)).toEqual([1, 3, 6, 12]);
    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "published", reasonCode: null });
    }
    expect(deps.buildCandidate).toHaveBeenCalledTimes(4);
    for (const call of deps.buildCandidate.mock.calls) {
      const context = call[1] as GrowthCandidateBuildContext;
      expect(context).toMatchObject({
        organizationId: ORG_ID,
        scheduleOriginDate: "2026-09-18",
        cycleIndex: 0,
        issuedAt: NOW_ISO,
        sourceCutoffDate: "2026-09-17",
        timeZone: "Asia/Dubai",
      });
    }
    expect(deps.publish).toHaveBeenCalledTimes(4);
    for (const call of deps.publish.mock.calls) {
      const payload = call[0] as { organizationId: string; correlationId: string };
      expect(payload.organizationId).toBe(ORG_ID);
      expect(payload.correlationId).toBe(CORRELATION_ID);
    }
  });

  it("hands candidate documents to the write boundary unchanged", async () => {
    const built: FrozenGrowthProjection[] = [];
    const deps = dependencies({
      buildCandidate: vi.fn(
        async (_material: RevenueScenarioInput, context: GrowthCandidateBuildContext) => {
          const document = cannedDocument(context);
          built.push(document);
          return { status: "ready" as const, document };
        },
      ),
    });
    await publishDueGrowthProjections(input(), deps);

    const published = deps.publish.mock.calls.map(
      (call) => (call[0] as { document: FrozenGrowthProjection }).document,
    );
    // Same objects, same order, untouched: lineage included, nothing re-dated.
    expect(published).toEqual(built);
    for (const [index, document] of published.entries()) {
      expect(document).toBe(built[index]);
    }
  });
});

describe("publishDueGrowthProjections scheduling", () => {
  it("rolls each horizon on its own cycle from the stored origin", async () => {
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-08-18"],
        }),
      ),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    // Only the 1-month horizon opens a new period on 2026-09-17: its cycle-1
    // issue date. Longer horizons stay quiet until their own issue day.
    expect(result.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    expect(result.results.slice(1)).toMatchObject([
      { horizonMonths: 3, status: "skipped", reasonCode: "NOT_DUE" },
      { horizonMonths: 6, status: "skipped", reasonCode: "NOT_DUE" },
      { horizonMonths: 12, status: "skipped", reasonCode: "NOT_DUE" },
    ]);
    expect(deps.buildCandidate).toHaveBeenCalledTimes(1);
    expect(deps.publish).toHaveBeenCalledTimes(1);
    const context = deps.buildCandidate.mock.calls[0]?.[1] as GrowthCandidateBuildContext;
    expect(context).toMatchObject({
      scheduleOriginDate: "2026-08-18",
      horizonMonths: 1,
      cycleIndex: 1,
    });
  });

  it("anchors later months to the original day, never to a clamped month", async () => {
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-01-31"],
        }),
      ),
    });
    // Dubai local 2026-03-30: the issue day for the period starting 2026-03-31,
    // which is origin + 2 months — not origin + 1 month + 1 month (03-28).
    const result = await publishDueGrowthProjections(
      input({ nowIso: "2026-03-29T20:00:00.000Z", timeZone: "Asia/Dubai" }),
      deps,
    );

    expect(result.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    const context = deps.buildCandidate.mock.calls[0]?.[1] as GrowthCandidateBuildContext;
    expect(context).toMatchObject({
      scheduleOriginDate: "2026-01-31",
      horizonMonths: 1,
      cycleIndex: 2,
    });
  });

  it("bypasses quiet days without building, publishing or calling a model", async () => {
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-09-18"],
        }),
      ),
    });
    // Dubai local 2026-09-20: no horizon opens a period on 2026-09-21.
    const result = await publishDueGrowthProjections(
      input({ nowIso: "2026-09-19T20:00:00.000Z" }),
      deps,
    );

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "NOT_DUE" });
    }
    expect(deps.buildCandidate).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("reads the organization's own calendar, so the same instant differs by zone", async () => {
    const schedule: GrowthScheduleSnapshot = { status: "ready", origins: ["2026-09-18"] };
    const dubaiDeps = dependencies({ readSchedule: vi.fn(async () => schedule) });
    const yorkDeps = dependencies({ readSchedule: vi.fn(async () => schedule) });

    // 2026-09-16T20:00Z is 2026-09-17 in Dubai (issue day) but 2026-09-16 in
    // New York (a quiet day for the same schedule).
    const dubai = await publishDueGrowthProjections(input({ timeZone: "Asia/Dubai" }), dubaiDeps);
    const york = await publishDueGrowthProjections(
      input({ timeZone: "America/New_York" }),
      yorkDeps,
    );

    expect(dubai.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    for (const entry of york.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "NOT_DUE" });
    }
    expect(yorkDeps.publish).not.toHaveBeenCalled();
  });
});

describe("publishDueGrowthProjections gating", () => {
  it("leaves disabled organizations untouched before any read", async () => {
    const deps = dependencies({ isEnabled: vi.fn(() => false) });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "DISABLED" });
    }
    expect(deps.readSchedule).not.toHaveBeenCalled();
    expect(deps.buildCandidate).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("skips due horizons with a typed code when the snapshot never stored", async () => {
    const deps = dependencies();
    const result = await publishDueGrowthProjections(input({ candidateMaterial: null }), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "CANDIDATE_UNAVAILABLE" });
    }
    expect(deps.buildCandidate).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("refuses a schedule with two origins instead of guessing one", async () => {
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-09-18", "2026-09-19"],
        }),
      ),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "SCHEDULE_CORRUPT" });
    }
    expect(deps.buildCandidate).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("fails closed when the schedule cannot be read", async () => {
    for (const schedule of [
      { status: "unavailable", reasonCode: "SCHEDULE_READ_FAILED" },
      { status: "unavailable", reasonCode: "SCHEDULE_DENIED" },
    ] as GrowthScheduleSnapshot[]) {
      const deps = dependencies({ readSchedule: vi.fn(async () => schedule) });
      const result = await publishDueGrowthProjections(input(), deps);
      for (const entry of result.results) {
        expect(entry.status).toBe("skipped");
      }
      expect(deps.publish).not.toHaveBeenCalled();
    }
  });

  it("carries a refused candidate as a skipped horizon with its reason", async () => {
    const deps = dependencies({
      buildCandidate: vi.fn(async () => ({
        status: "refused" as const,
        reason: "BASELINE_STALE" as const,
        detail: "The baseline month ended too long before issue.",
      })),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "CANDIDATE_BASELINE_STALE" });
    }
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("fails a horizon whose document names another tenant without publishing", async () => {
    const deps = dependencies({
      buildCandidate: vi.fn(
        async (_material: RevenueScenarioInput, context: GrowthCandidateBuildContext) => ({
          status: "ready" as const,
          document: cannedDocument(context, OTHER_ORG_ID),
        }),
      ),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "failed", reasonCode: "TENANT_MISMATCH" });
    }
    expect(deps.publish).not.toHaveBeenCalled();
  });
});

describe("publishDueGrowthProjections idempotency", () => {
  it("replays an already-stored identity instead of moving the frozen line", async () => {
    const deps = dependencies({
      publish: vi.fn(async () => ({
        projectionId: "33333333-3333-4333-8333-333333333333",
        digest: DIGEST,
        published: false,
      })),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({
        status: "replayed",
        projectionId: "33333333-3333-4333-8333-333333333333",
        digest: DIGEST,
        reasonCode: null,
      });
    }
  });

  it("keeps one identity across duplicate deliveries and retries", async () => {
    const seen = new Map<string, { projectionId: string; digest: string; published: boolean }>();
    const deps = dependencies({
      publish: vi.fn(async ({ document }: { document: FrozenGrowthProjection }) => {
        const key = `${document.horizonMonths}:${document.cycleIndex}`;
        const existing = seen.get(key);
        // Mirrors the database authority: the first delivery files the
        // original (and its single audit event); every redelivery replays the
        // stored identity with no second event and no changed numbers.
        if (existing) return { ...existing, published: false };
        const stored = {
          projectionId: "33333333-3333-4333-8333-333333333333",
          digest: DIGEST,
          published: true,
        };
        seen.set(key, stored);
        return stored;
      }),
    });

    const first = await publishDueGrowthProjections(input(), deps);
    const second = await publishDueGrowthProjections(input(), deps);

    expect(first.results.map((entry) => entry.status)).toEqual([
      "published",
      "published",
      "published",
      "published",
    ]);
    expect(second.results.map((entry) => entry.status)).toEqual([
      "replayed",
      "replayed",
      "replayed",
      "replayed",
    ]);
    for (const [index, entry] of second.results.entries()) {
      expect(entry).toMatchObject({
        projectionId: (first.results[index] as { projectionId: string }).projectionId,
        digest: (first.results[index] as { digest: string }).digest,
      });
    }
  });

  it("maps a retry across the start boundary to a failed horizon, not a backfill", async () => {
    const deps = dependencies({
      publish: vi.fn(async () => {
        throw { code: "PERIOD_ALREADY_STARTED" };
      }),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "failed", reasonCode: "PERIOD_ALREADY_STARTED" });
    }
  });

  it("exposes publication failure per horizon, never hidden behind a stored flag", async () => {
    const deps = dependencies({
      publish: vi.fn(async ({ document }: { document: FrozenGrowthProjection }) =>
        document.horizonMonths === 3
          ? Promise.reject({ code: "PUBLISH_FAILED" })
          : {
              projectionId: "33333333-3333-4333-8333-333333333333",
              digest: DIGEST,
              published: true,
            },
      ),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    // The envelope carries no snapshot `stored` field at all: a frozen-line
    // failure stands beside neighboring successes, each with its own code.
    expect("stored" in result).toBe(false);
    expect("snapshotStored" in result).toBe(false);
    expect(result.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    expect(result.results[1]).toMatchObject({
      horizonMonths: 3,
      status: "failed",
      reasonCode: "PUBLISH_FAILED",
    });
  });
});

describe("buildSnapshotGrowthCandidate", () => {
  it("refuses honestly until ledger-bound baseline inputs arrive", () => {
    const refused = buildSnapshotGrowthCandidate(material().input, {
      organizationId: ORG_ID,
      scheduleOriginDate: "2026-09-18",
      horizonMonths: 1,
      cycleIndex: 0,
      issuedAt: NOW_ISO,
      sourceCutoffDate: "2026-09-17",
      timeZone: "Asia/Dubai",
    });
    expect(refused).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });
});
