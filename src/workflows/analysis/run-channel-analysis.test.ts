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
} from "@/workflows/analysis/run-channel-analysis";

const RUN = "00000000-0000-4000-8000-0000000000a1";
const CORRELATION = "00000000-0000-4000-8000-0000000000b1";

const payload = {
  organizationId: ORGANIZATION,
  channelId: CHANNEL,
  branchId: BRANCH,
  windowStart: "2026-01-01",
  windowEnd: "2026-01-05",
  periodGrain: "day" as const,
  analysisRunId: RUN,
  correlationId: CORRELATION,
  idempotencyKey: "channel-analysis-run-0001",
};

function dependencies(
  overrides: Partial<ChannelAnalysisDependencies> = {},
): ChannelAnalysisDependencies {
  return {
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
    await runChannelAnalysis(payload, deps);

    expect(deps.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        registryVersion: 5,
        metricKeys: [
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
          { key: "operations.closed_share", calculationVersion: 1 },
          { key: "customer.new_share", calculationVersion: 1 },
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

    const result = await runChannelAnalysis(payload, deps);

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
      "operations.closed_share:needs_data",
      "customer.new_share:needs_data",
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

    const result = await runChannelAnalysis(payload, deps);

    expect(result).toEqual({
      outcome: "completed",
      findingCount: 0,
      observationCount: 1,
      needsDataCount: 7,
    });
  });

  it("sends money as integer strings so nothing rounds on the way to the database", async () => {
    const deps = dependencies();
    await runChannelAnalysis(payload, deps);

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
    await runChannelAnalysis({ ...payload, channelId: null }, deps);

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

    const result = await runChannelAnalysis(payload, deps);

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

    const result = await runChannelAnalysis(payload, deps);

    expect(result.outcome).toBe("failed");
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EVIDENCE_UNAVAILABLE" }),
    );
  });

  it("returns the claim outcome untouched when the lease is held elsewhere", async () => {
    const deps = dependencies({ claim: vi.fn(async () => ({ outcome: "in_progress" as const })) });

    expect(await runChannelAnalysis(payload, deps)).toEqual({ outcome: "in_progress" });
    expect(deps.loadEvidence).not.toHaveBeenCalled();
  });
});
