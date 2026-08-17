import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_DURATION_PAIRS,
  GENERATE_BUNDLE_LEASE_SECONDS,
  GENERATE_BUNDLE_MAX_DURATION_SECONDS,
} from "@/workflows/campaigns/durations";

describe("a generation lease outlives the task it fences", () => {
  it.each(CAMPAIGN_DURATION_PAIRS)(
    "$taskId holds its claim for longer than it may run",
    ({ leaseSeconds, maxDurationSeconds }) => {
      // The failure this prevents is not theoretical. The first real run had a
      // 300s lease against a 600s ceiling: the claim lapsed while the worker was
      // still drawing images, leaving the run open for a second worker to take.
      expect(leaseSeconds).toBeGreaterThan(maxDurationSeconds);
    },
  );

  it.each(CAMPAIGN_DURATION_PAIRS)(
    "$taskId keeps a real margin, not a single second",
    ({ leaseSeconds, maxDurationSeconds }) => {
      // A lease one second longer satisfies the rule and still races the clock.
      // Five minutes covers a slow final write after the ceiling is reached.
      expect(leaseSeconds - maxDurationSeconds).toBeGreaterThanOrEqual(300);
    },
  );

  it("gives generation enough room for the provider's slowest step", () => {
    // Image generation is the slow step and killed the first run at ten
    // minutes. Anything under half an hour is optimism, not a ceiling.
    expect(GENERATE_BUNDLE_MAX_DURATION_SECONDS).toBeGreaterThanOrEqual(1_800);
    expect(GENERATE_BUNDLE_LEASE_SECONDS).toBeGreaterThan(GENERATE_BUNDLE_MAX_DURATION_SECONDS);
  });
});
