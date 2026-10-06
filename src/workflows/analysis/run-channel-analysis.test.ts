import { describe, expect, it, vi } from "vitest";

import {
  CHANNEL,
  BRANCH,
  ORGANIZATION,
  point,
  PROJECTION_RUN,
} from "@/domain/analysis/test-fixtures";
import {
  runChannelAnalysis,
  type ChannelAnalysisDependencies,
  type ChannelAnalysisPayload,
} from "@/workflows/analysis/run-channel-analysis";

const RUN = "00000000-0000-4000-8000-0000000000a1";
const CORRELATION = "00000000-0000-4000-8000-0000000000b1";

const basePayload: ChannelAnalysisPayload = {
  organizationId: ORGANIZATION,
  channelId: CHANNEL,
  branchId: BRANCH,
  windowStart: "2026-01-01",
  windowEnd: "2026-01-05",
  periodGrain: "day",
  windowTimezone: "Asia/Dubai",
  analysisRunId: RUN,
  correlationId: CORRELATION,
  idempotencyKey: "channel-analysis-run-0001",
};

function payload(overrides: Partial<ChannelAnalysisPayload> = {}): ChannelAnalysisPayload {
  return { ...basePayload, ...overrides };
}

function dependencies(
  overrides: Partial<ChannelAnalysisDependencies> = {},
): ChannelAnalysisDependencies {
  return {
    // Wide enough to cover every window the tests in this file ask about,
    // since the mock ignores which channel it was asked for.
    loadCoverageSegments: vi.fn(async () => [{ start: "2025-01-01", end: "2026-12-31" }]),
    claim: vi.fn(async (input) => ({
      outcome: "acquired" as const,
      windowTimezone: "Asia/Dubai",
      boundDetectors: input.detectors,
    })),
    loadEvidence: vi.fn(async () => ({
      points: [point("2026-01-01", 120_000), point("2026-01-02", 90_000)],
      exactRangePoints: [],
      incomparablePointCount: 0,
      projectionRuns: [{ projectionRunId: PROJECTION_RUN, absentRowCount: 3 }],
      heldEvidence: [],
    })),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runChannelAnalysis", () => {
  it("binds only the detectors the run's scope and grain support", async () => {
    const deps = dependencies();
    await runChannelAnalysis(payload(), deps);

    expect(deps.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        registryVersion: 9,
        metricKeys: [
          "cost.commission",
          "cost.equipment_fee",
          "cost.food",
          "cost.packaging",
          "cost.payment_processing",
          "customer.new_order_count",
          "customer.returning_order_count",
          "listing.cart_additions",
          "listing.impressions",
          "listing.menu_views",
          "listing.placed_orders",
          "operations.closed_days",
          "operations.closed_minutes",
          "operations.scheduled_minutes",
          "order.avoidable_cancellation_count",
          "order.avoidable_cancellation_reason",
          "order.cancellation_attribution_count",
          "order.total_count",
          "promotion.funding",
          "revenue.company_gross",
          "revenue.gross",
          "revenue.rejection_loss",
        ],
        detectors: [
          { key: "evidence.period_coverage", calculationVersion: 2 },
          { key: "evidence.reconciliation_blocked", calculationVersion: 1 },
          { key: "revenue.period_movement", calculationVersion: 2 },
          { key: "revenue.window_gross", calculationVersion: 2 },
          { key: "funnel.stage_conversion", calculationVersion: 1 },
          { key: "orders.cancellation_loss", calculationVersion: 1 },
          { key: "orders.cancellation_attribution", calculationVersion: 1 },
          { key: "operations.closed_share", calculationVersion: 1 },
          { key: "customer.new_share", calculationVersion: 1 },
          { key: "economics.commission_share", calculationVersion: 1 },
          { key: "economics.channel_cost_load", calculationVersion: 1 },
          { key: "economics.company_cost_structure", calculationVersion: 1 },
        ],
      }),
    );
  });

  it("records every outcome, including the ones that need data", async () => {
    const deps = dependencies({
      loadEvidence: vi.fn(async () => ({
        points: [],
        exactRangePoints: [],
        incomparablePointCount: 0,
        projectionRuns: [],
        heldEvidence: [],
      })),
    });

    const result = await runChannelAnalysis(payload(), deps);

    expect(result.outcome).toBe("completed");
    const call = vi.mocked(deps.complete).mock.calls[0][0];
    const kinds = call.findings.map((finding) => `${finding.detectorKey}:${finding.kind}`);
    expect(kinds).toEqual([
      "evidence.period_coverage:needs_data",
      "evidence.reconciliation_blocked:observation",
      "revenue.period_movement:needs_data",
      "revenue.window_gross:needs_data",
      // Over a window with no evidence at all, every registry-v2 detector
      // answers with a named refusal rather than staying silent.
      "funnel.stage_conversion:needs_data",
      "orders.cancellation_loss:needs_data",
      "orders.cancellation_attribution:needs_data",
      "operations.closed_share:needs_data",
      "customer.new_share:needs_data",
      "economics.commission_share:needs_data",
      "economics.channel_cost_load:needs_data",
      "economics.company_cost_structure:needs_data",
    ]);
    expect(call.findings.every((finding) => finding.calculationDigest.length === 64)).toBe(true);
  });

  it("counts observations in the run summary, not only findings and refusals", async () => {
    // Staging run cb8d3675 filed twelve observations and reported zero of
    // everything, because the summary tallied two of the three kinds a
    // detector can return. The database column has always counted all three.
    const deps = dependencies({
      loadEvidence: vi.fn(async () => ({
        points: [],
        exactRangePoints: [],
        incomparablePointCount: 0,
        projectionRuns: [],
        heldEvidence: [],
      })),
    });

    const result = await runChannelAnalysis(payload(), deps);

    expect(result).toEqual({
      outcome: "completed",
      findingCount: 0,
      observationCount: 1,
      needsDataCount: 11,
    });
  });

  it("sends money as integer strings so nothing rounds on the way to the database", async () => {
    const deps = dependencies();
    await runChannelAnalysis(payload(), deps);

    const movement = vi
      .mocked(deps.complete)
      .mock.calls[0][0].findings.find(
        (finding) => finding.detectorKey === "revenue.period_movement",
      );
    expect(movement).toMatchObject({
      kind: "observation",
      code: "REVENUE_PERIOD_MOVEMENT_DOWN",
      valueKind: "money",
      valueNumerator: "-30000",
      valueDenominator: "120000",
      currency: "AED",
      monetaryImpactMinorUnits: "-30000",
    });
    // An observation carries no severity, and nothing invents one on its behalf.
    expect(movement?.severity).toBeUndefined();
    expect(movement?.priority).toBeUndefined();
  });

  it("binds the cross-channel detector, and only that one, when no channel is named", async () => {
    const deps = dependencies();
    await runChannelAnalysis(payload({ channelId: null }), deps);

    expect(deps.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: null,
        detectors: [{ key: "revenue.channel_share", calculationVersion: 1 }],
      }),
    );
  });

  it("refuses to write today's arithmetic under a run that bound another registry", async () => {
    const deps = dependencies({
      claim: vi.fn(async () => ({
        outcome: "acquired" as const,
        windowTimezone: "Asia/Dubai",
        boundDetectors: [{ key: "evidence.period_coverage", calculationVersion: 7 }],
      })),
    });

    const result = await runChannelAnalysis(payload(), deps);

    expect(result.outcome).toBe("failed");
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "DETECTOR_REGISTRY_MISMATCH" }),
    );
  });

  it("fails the run rather than reporting over evidence it could not read", async () => {
    const deps = dependencies({
      loadEvidence: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });

    const result = await runChannelAnalysis(payload(), deps);

    expect(result.outcome).toBe("failed");
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EVIDENCE_UNAVAILABLE" }),
    );
  });

  it("returns the claim outcome untouched when the lease is held elsewhere", async () => {
    const deps = dependencies({ claim: vi.fn(async () => ({ outcome: "in_progress" as const })) });

    expect(await runChannelAnalysis(payload(), deps)).toEqual({ outcome: "in_progress" });
    // The evidence digest is an argument to the claim call itself, so it is
    // read before the lease outcome is known -- unlike the trust-based path
    // this replaced, which claimed first and read evidence only on a win.
    expect(deps.loadEvidence).toHaveBeenCalled();
  });
});

describe("runChannelAnalysis content-addressed claim", () => {
  it("claims with the evidence digest and cache key it just computed", async () => {
    const deps = dependencies();
    const result = await runChannelAnalysis(payload(), deps);

    expect(result.outcome).toBe("completed");
    const claimCall = vi.mocked(deps.claim).mock.calls[0][0];
    expect(claimCall.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(claimCall.cacheKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the reused run without writing when the claim reports a cache hit", async () => {
    const deps = dependencies({
      claim: vi.fn(async () => ({
        outcome: "cached" as const,
        analysisRunId: "reused-run-id",
      })),
    });

    expect(await runChannelAnalysis(payload(), deps)).toEqual({
      outcome: "cached",
      analysisRunId: "reused-run-id",
    });
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("fails when the claim binds a different timezone than the key was computed under", async () => {
    const deps = dependencies({
      claim: vi.fn(async (input) => ({
        outcome: "acquired" as const,
        windowTimezone: "Asia/Kolkata",
        boundDetectors: input.detectors,
      })),
    });

    const result = await runChannelAnalysis(payload(), deps);

    expect(result.outcome).toBe("failed");
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "WINDOW_CONTEXT_UNAVAILABLE" }),
    );
  });
});

describe("the worker's own coverage check", () => {
  it("refuses a window the channel's reports do not declare", async () => {
    // The route checks this too. This is the check that still holds when the
    // route is bypassed, and the one that still holds when a package was
    // withdrawn between the operator pressing Apply and the worker claiming.
    const claim = vi.fn();
    const result = await runChannelAnalysis(
      payload({ windowStart: "2026-03-01", windowEnd: "2026-03-04" }),
      dependencies({
        loadCoverageSegments: vi
          .fn()
          .mockResolvedValue([{ start: "2026-01-01", end: "2026-02-28" }]),
        claim,
      }),
    );

    expect(result.outcome).toBe("failed");
    expect(claim).not.toHaveBeenCalled();
  });

  it("claims a covered window with a key built from the window, not a month", async () => {
    const claim = vi.fn().mockResolvedValue({
      outcome: "acquired",
      windowTimezone: "Asia/Dubai",
      boundDetectors: [],
    });

    await runChannelAnalysis(
      payload({ windowStart: "2026-01-01", windowEnd: "2026-01-04" }),
      dependencies({
        loadCoverageSegments: vi
          .fn()
          .mockResolvedValue([{ start: "2026-01-01", end: "2026-02-28" }]),
        claim,
      }),
    );

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        windowStart: "2026-01-01",
        windowEnd: "2026-01-04",
        cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
});
