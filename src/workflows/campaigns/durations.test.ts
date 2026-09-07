import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_DURATION_PAIRS,
  EDIT_PLATE_MAX_DURATION_SECONDS,
  GENERATE_BUNDLE_LEASE_SECONDS,
  GENERATE_BUNDLE_MAX_DURATION_SECONDS,
  RENDER_POSTER_MAX_DURATION_SECONDS,
} from "@/workflows/campaigns/durations";

/**
 * The two Studio workers hold no lease, so the pair rules above say nothing
 * about them. What still has to hold is that each ceiling outlives the slowest
 * thing the task waits on -- otherwise the task is killed mid-call and the
 * operator reads a failure that was really a deadline.
 */
describe("the Studio workers outlive what they wait on", () => {
  it("gives an edit room for the image model's own two-minute timeout", () => {
    // The planner aborts at 120s. The ceiling has to cover that plus the object
    // reads, the composite and the successor version write.
    expect(EDIT_PLATE_MAX_DURATION_SECONDS).toBeGreaterThanOrEqual(300);
    expect(EDIT_PLATE_MAX_DURATION_SECONDS).toBeGreaterThan(RENDER_POSTER_MAX_DURATION_SECONDS);
  });
});

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
