import { describe, expect, it } from "vitest";

import { deliverableCompletion } from "@/domain/campaigns/deliverable";

/**
 * Partial completion must never quietly shrink the plan. If eight posts were
 * approved and five were made, the honest report is five of eight with the
 * failures named — not a tidy set of five that looks complete.
 */
describe("partial-set honesty", () => {
  it("names each shortfall instead of tidying the plan down to what exists", () => {
    const completion = deliverableCompletion({
      plan: [
        { format: "feed", language: "en", count: 4 },
        { format: "story", language: "en", count: 4 },
      ],
      produced: [
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
      ],
    });

    expect(completion).toMatchObject({ planned: 8, produced: 3, complete: false });
    expect(completion.missing).toEqual([
      { format: "feed", language: "en", shortfall: 1 },
      { format: "story", language: "en", shortfall: 4 },
    ]);
  });

  it("reports nothing produced as zero of planned, not as complete", () => {
    const completion = deliverableCompletion({
      plan: [{ format: "feed", language: "en", count: 2 }],
      produced: [],
    });

    expect(completion).toMatchObject({ planned: 2, produced: 0, complete: false });
    expect(completion.missing).toEqual([{ format: "feed", language: "en", shortfall: 2 }]);
    expect(completion.unplanned).toEqual([]);
  });
});

/**
 * Unplanned output must never read as complete. A manual-brief campaign has no
 * proposal plan, so the one finished poster its Studio render produced is not
 * "zero of zero, done" -- it is one produced output nobody planned.
 */
describe("unplanned-output honesty", () => {
  it("reads an empty plan plus one produced output as produced-unplanned, never complete", () => {
    const completion = deliverableCompletion({
      plan: [],
      produced: [{ format: "feed", language: "en" }],
    });

    expect(completion).toMatchObject({ planned: 0, produced: 0, complete: false });
    expect(completion.missing).toEqual([]);
    expect(completion.unplanned).toEqual([{ format: "feed", language: "en", surplus: 1 }]);
  });

  it("reports over-production against a real plan instead of absorbing it", () => {
    const completion = deliverableCompletion({
      plan: [{ format: "feed", language: "en", count: 2 }],
      produced: [
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
      ],
    });

    expect(completion).toMatchObject({ planned: 2, produced: 2, complete: false });
    expect(completion.missing).toEqual([]);
    expect(completion.unplanned).toEqual([{ format: "feed", language: "en", surplus: 1 }]);
  });

  it("still reads an exactly-met plan as complete", () => {
    const completion = deliverableCompletion({
      plan: [{ format: "feed", language: "en", count: 2 }],
      produced: [
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
      ],
    });

    expect(completion).toMatchObject({ planned: 2, produced: 2, complete: true });
    expect(completion.unplanned).toEqual([]);
  });
});
