import { describe, expect, it } from "vitest";

import { revenueChannelShareDetector } from "@/domain/analysis/detectors/revenue-channel-share";
import { CHANNEL, evidence, OTHER_CHANNEL, point, window } from "@/domain/analysis/test-fixtures";

const organizationWindow = window({ channelId: null });

describe("revenue.channel_share", () => {
  it("stores each share as a numerator and a denominator, never a quotient", () => {
    const outcomes = revenueChannelShareDetector.run(
      evidence({
        window: organizationWindow,
        points: [
          point("2026-01-01", 120_000),
          point("2026-01-01", 80_000, { channelId: OTHER_CHANNEL }),
        ],
      }),
    );

    expect(outcomes).toHaveLength(2);
    const [first] = outcomes;
    expect(first.code).toBe("CHANNEL_REVENUE_SHARE");
    expect(first.channelId).toBe(CHANNEL);
    expect(first.kind === "observation" && first.measurement).toEqual({
      valueKind: "ratio",
      numerator: 120_000,
      denominator: 200_000,
      currency: "AED",
    });
  });

  it("refuses two currencies rather than converting them", () => {
    const [outcome] = revenueChannelShareDetector.run(
      evidence({
        window: organizationWindow,
        points: [
          point("2026-01-01", 120_000),
          point("2026-01-01", 80_000, { channelId: OTHER_CHANNEL, currency: "SAR" }),
        ],
      }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe("MIXED_CURRENCY");
    expect(outcome.evidence).toHaveLength(0);
  });

  it("needs data when only one channel reported", () => {
    const [outcome] = revenueChannelShareDetector.run(
      evidence({ window: organizationWindow, points: [point("2026-01-01", 120_000)] }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "SINGLE_CHANNEL_IN_WINDOW",
    );
  });

  it("needs data when nothing governed exists in the window", () => {
    const [outcome] = revenueChannelShareDetector.run(
      evidence({ window: organizationWindow, points: [] }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "NO_GOVERNED_EVIDENCE_IN_WINDOW",
    );
  });

  it("needs data when the window total is zero, because no share is defined", () => {
    const [outcome] = revenueChannelShareDetector.run(
      evidence({
        window: organizationWindow,
        points: [point("2026-01-01", 0), point("2026-01-01", 0, { channelId: OTHER_CHANNEL })],
      }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe("WINDOW_TOTAL_IS_ZERO");
  });

  it("shows how many periods each channel actually reported", () => {
    const outcomes = revenueChannelShareDetector.run(
      evidence({
        window: organizationWindow,
        points: [
          point("2026-01-01", 100_000),
          point("2026-01-02", 100_000),
          point("2026-01-01", 50_000, { channelId: OTHER_CHANNEL }),
        ],
      }),
    );

    const sparse = outcomes.find((outcome) => outcome.channelId === OTHER_CHANNEL);
    expect(sparse?.expectedPeriodCount).toBe(5);
    expect(sparse?.observedPeriodCount).toBe(1);
    expect(sparse?.absentPeriodCount).toBe(4);
  });

  it("cites every figure that fed its own numerator", () => {
    const outcomes = revenueChannelShareDetector.run(
      evidence({
        window: organizationWindow,
        points: [
          point("2026-01-01", 100_000),
          point("2026-01-02", 100_000),
          point("2026-01-01", 50_000, { channelId: OTHER_CHANNEL }),
        ],
      }),
    );

    const first = outcomes.find((outcome) => outcome.channelId === CHANNEL);
    expect(first?.evidence).toEqual([
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-01-${CHANNEL}` },
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-02-${CHANNEL}` },
    ]);
  });
});
