import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const testEnv = vi.hoisted(() => ({
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key" as string | undefined,
  AI_DEFAULT_MODEL: "test-model" as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env: testEnv }));

const mocks = vi.hoisted(() => ({
  readRevenueSource: vi.fn(),
}));

vi.mock("@/modules/organizations/infrastructure/revenue-source", () => ({
  readRevenueSource: mocks.readRevenueSource,
}));

import {
  isOrgLocalMidnightHour,
  mergeSnapshotDispatchCandidates,
  REVENUE_SNAPSHOT_KEEP_MONTHS,
  runRevenueSnapshotBuild,
  selectDueSnapshotOrgs,
  throwIfSnapshotBuildFailed,
  toSnapshotBuildOutput,
} from "@/modules/organizations/application/revenue-snapshot";
import type { PublishDueGrowthProjectionsResult } from "@/modules/organizations/application/growth-projection-publisher";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const FINDING_A = "22222222-2222-4222-8222-222222222221";

function scenarioInput(): RevenueScenarioInput {
  return {
    organizationId: ORG_ID,
    grain: "month",
    history: [{ label: "2026-08", minorUnits: 800_00, currency: "AED" }],
    losses: [{ findingId: FINDING_A, minorUnits: 200_00, currency: "AED" }],
    actions: [
      {
        id: "rec-1",
        title: "Recover avoidable cancellations",
        kind: "recommendation",
        status: "Planned",
        href: null,
        citedFindingId: FINDING_A,
        citedBasisMinorUnits: 200_00,
        citedCurrency: "AED",
        assumptionLow: null,
        assumptionHigh: null,
      },
    ],
    lastObservationDate: "2026-08-31",
    today: "2026-09-16",
    cutoffNote: "Reports through 2026-08-31.",
    coverageNote: "1 reporting channel · monthly buckets.",
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    reads: {} as never,
    readSource: mocks.readRevenueSource,
    maxProposalActions: 10,
    proposeRanges: vi.fn(async () => [
      {
        actionId: "rec-1",
        citedFindingId: FINDING_A,
        citedBasisMinorUnits: 200_00,
        currency: "AED",
        low: 0.1,
        high: 0.3,
      },
    ]),
    writeSnapshot: vi.fn(
      async (snapshot: {
        organizationId: string;
        snapshotDate: string;
        input: RevenueScenarioInput;
        aiNote: string | null;
      }) => {
        expect(snapshot.organizationId).toBe(ORG_ID);
        return {};
      },
    ),
    trimSnapshots: vi.fn(async () => ({})),
    onFailure: vi.fn(),
    ...overrides,
  };
}

function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    snapshotDate: "2026-09-16",
    timeZone: "Asia/Dubai",
    nowIso: "2026-09-15T20:00:00.000Z",
    gates: { growth: true, campaigns: true },
    correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ...overrides,
  };
}

describe("isOrgLocalMidnightHour", () => {
  it("fires inside the first local hour only", () => {
    expect(isOrgLocalMidnightHour("Asia/Dubai", new Date("2026-09-15T20:15:00.000Z"))).toBe(true);
    expect(isOrgLocalMidnightHour("Asia/Dubai", new Date("2026-09-15T21:05:00.000Z"))).toBe(false);
    expect(isOrgLocalMidnightHour("America/New_York", new Date("2026-09-15T20:15:00.000Z"))).toBe(
      false,
    );
    expect(isOrgLocalMidnightHour("Not/AZone", new Date())).toBe(false);
  });
});

describe("selectDueSnapshotOrgs", () => {
  it("picks only orgs inside their local midnight hour", () => {
    const now = new Date("2026-09-15T20:15:00.000Z");
    const { due, skipped } = selectDueSnapshotOrgs(
      [
        { organizationId: "org-dubai", timeZone: "Asia/Dubai" },
        { organizationId: "org-ny", timeZone: "America/New_York" },
        { organizationId: "org-broken", timeZone: "Not/AZone" },
      ],
      now,
    );
    expect(due).toEqual([
      { organizationId: "org-dubai", snapshotDate: "2026-09-16", timeZone: "Asia/Dubai" },
    ]);
    expect(skipped).toBe(0);
  });
});

describe("runRevenueSnapshotBuild", () => {
  it("stores the union input with attached ranges and trims old rows", async () => {
    mocks.readRevenueSource.mockResolvedValue({
      status: "ready",
      input: scenarioInput(),
      fetchedAt: "2026-09-16T00:00:00.000Z",
    });
    const deps = dependencies();

    const result = await runRevenueSnapshotBuild(buildInput(), deps);

    expect(result).toMatchObject({ stored: true, acceptedCount: 1, rejectedCount: 0 });
    const written = deps.writeSnapshot.mock.calls[0]?.[0] as {
      organizationId: string;
      snapshotDate: string;
      input: RevenueScenarioInput;
      aiNote: string | null;
    };
    expect(written.organizationId).toBe(ORG_ID);
    expect(written.snapshotDate).toBe("2026-09-16");
    const stored = written.input.actions.find((action) => action.id === "rec-1");
    expect(stored).toMatchObject({ assumptionLow: 0.1, assumptionHigh: 0.3 });
    expect(written.aiNote).toMatch(/Nightly/);
    expect(deps.trimSnapshots).toHaveBeenCalledWith(ORG_ID, "2025-08-01");
    expect(REVENUE_SNAPSHOT_KEEP_MONTHS).toBe(13);
  });

  it("holds the current course when the model is unavailable", async () => {
    mocks.readRevenueSource.mockResolvedValue({
      status: "ready",
      input: scenarioInput(),
      fetchedAt: "2026-09-16T00:00:00.000Z",
    });
    const deps = dependencies({
      proposeRanges: vi.fn(async () => {
        throw new Error("provider down");
      }),
    });

    const result = await runRevenueSnapshotBuild(buildInput(), deps);

    expect(result).toMatchObject({ stored: true, acceptedCount: 0 });
    const written = deps.writeSnapshot.mock.calls[0]?.[0] as { aiNote: string | null };
    expect(written.aiNote).toMatch(/unavailable/);
  });

  it("writes nothing when the reads are not ready", async () => {
    mocks.readRevenueSource.mockResolvedValue({ status: "failed" });
    const deps = dependencies();

    const result = await runRevenueSnapshotBuild(buildInput(), deps);

    expect(result).toMatchObject({ stored: false });
    expect(result.candidateMaterial).toBeNull();
    expect(deps.writeSnapshot).not.toHaveBeenCalled();
    expect(deps.onFailure).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  it("hands the validated union input to publication without a second proposal", async () => {
    mocks.readRevenueSource.mockResolvedValue({
      status: "ready",
      input: scenarioInput(),
      fetchedAt: "2026-09-16T00:00:00.000Z",
    });
    const deps = dependencies();

    const result = await runRevenueSnapshotBuild(buildInput(), deps);

    expect(result.stored).toBe(true);
    // The material carries the same applied ranges the snapshot stored, so
    // the publication phase reuses them instead of calling the model again.
    const written = deps.writeSnapshot.mock.calls[0]?.[0] as { input: RevenueScenarioInput };
    expect(result.candidateMaterial).toEqual({ input: written.input });
    expect(
      result.candidateMaterial?.input.actions.find((action) => action.id === "rec-1"),
    ).toMatchObject({
      assumptionLow: 0.1,
      assumptionHigh: 0.3,
    });
    expect(deps.proposeRanges).toHaveBeenCalledTimes(1);
  });
});

describe("mergeSnapshotDispatchCandidates", () => {
  const scanned = [
    { organizationId: "org-1", timeZone: "Asia/Dubai" },
    { organizationId: "org-2", timeZone: "Asia/Dubai" },
  ];

  it("keeps scan order and appends allowlisted extras outside the scan", () => {
    const merged = mergeSnapshotDispatchCandidates(scanned, [
      { organizationId: "org-501", timeZone: "Asia/Dubai" },
    ]);

    // The 501st organization never appears in the capped scan, yet its
    // nightly publication still gets a run.
    expect(merged.map((org) => org.organizationId)).toEqual(["org-1", "org-2", "org-501"]);
  });

  it("schedules an organization shared by both lists exactly once", () => {
    const merged = mergeSnapshotDispatchCandidates(scanned, [
      { organizationId: "org-2", timeZone: "Asia/Dubai" },
      { organizationId: "org-501", timeZone: "Asia/Dubai" },
    ]);

    expect(merged.map((org) => org.organizationId)).toEqual(["org-1", "org-2", "org-501"]);
  });

  it("leaves the legacy scan untouched when no allowlist is configured", () => {
    expect(mergeSnapshotDispatchCandidates(scanned, [])).toEqual(scanned);
  });

  it("dedupes across letter casing", () => {
    const merged = mergeSnapshotDispatchCandidates(
      [{ organizationId: "org-2", timeZone: "Asia/Dubai" }],
      [{ organizationId: "ORG-2", timeZone: "Asia/Dubai" }],
    );

    expect(merged).toHaveLength(1);
  });
});

describe("toSnapshotBuildOutput", () => {
  const publication: PublishDueGrowthProjectionsResult = {
    results: [
      {
        horizonMonths: 1,
        status: "published",
        projectionId: "33333333-3333-4333-8333-333333333333",
        digest: "a".repeat(64),
        reasonCode: null,
      },
    ],
  };

  it("strips financial inputs from the worker run output", () => {
    const output = toSnapshotBuildOutput(
      {
        stored: true,
        acceptedCount: 1,
        rejectedCount: 0,
        trimmed: true,
        candidateMaterial: { input: scenarioInput() },
      },
      publication,
    );

    expect(output).toEqual({
      stored: true,
      acceptedCount: 1,
      rejectedCount: 0,
      trimmed: true,
      growthPublication: publication,
    });
    // Trigger persists run outputs outside the database: no history
    // amounts, actions or assumptions may ride along.
    expect("candidateMaterial" in output).toBe(false);
    const serialized = JSON.stringify(output);
    for (const leaked of [
      "minorUnits",
      "assumptionLow",
      "assumptionHigh",
      "citedFindingId",
      "80000",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("keeps the failed short shape without material", () => {
    const output = toSnapshotBuildOutput(
      { stored: false, reason: "reads failed", candidateMaterial: null },
      publication,
    );

    expect(output).toEqual({
      stored: false,
      reason: "reads failed",
      growthPublication: publication,
    });
  });
});

describe("throwIfSnapshotBuildFailed", () => {
  const skippedPublication: PublishDueGrowthProjectionsResult = {
    results: [
      { horizonMonths: 1, status: "skipped", projectionId: null, digest: null, reasonCode: "NOT_DUE" },
      {
        horizonMonths: 3,
        status: "skipped",
        projectionId: null,
        digest: null,
        reasonCode: "CANDIDATE_BASELINE_INCOMPLETE",
      },
    ],
  };

  it("stays silent on a stored snapshot with honest skips", () => {
    expect(() =>
      throwIfSnapshotBuildFailed(
        { stored: true, acceptedCount: 0, rejectedCount: 0, trimmed: true, growthPublication: skippedPublication },
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      ),
    ).not.toThrow();
  });

  it("fails red when the snapshot was not stored", () => {
    expect(() =>
      throwIfSnapshotBuildFailed(
        { stored: false, reason: "reads not ready", growthPublication: skippedPublication },
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      ),
    ).toThrow(/not stored.*reads not ready/);
  });

  it("fails red when any horizon errored, even with a stored snapshot", () => {
    expect(() =>
      throwIfSnapshotBuildFailed(
        {
          stored: true,
          acceptedCount: 0,
          rejectedCount: 0,
          trimmed: true,
          growthPublication: {
            results: [
              ...skippedPublication.results,
              {
                horizonMonths: 6,
                status: "failed",
                projectionId: null,
                digest: null,
                reasonCode: "PUBLISH_FAILED",
              },
            ],
          },
        },
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      ),
    ).toThrow(/publication errored/);
  });
});
