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
  });
});
