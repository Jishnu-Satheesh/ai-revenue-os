import { describe, expect, it, vi } from "vitest";

import {
  runChannelRecommendationEvaluations,
  type ChannelRecommendationEvaluationDependencies,
  type UnjudgedRecommendation,
} from "@/workflows/analysis/run-recommendation-evaluations";

const meta = { providerName: "google", modelId: "gemini-test" };

function unjudged(overrides: Partial<UnjudgedRecommendation> = {}): UnjudgedRecommendation {
  return {
    id: "fb230000-0000-4000-8000-000000000801",
    organizationId: "fb230000-0000-4000-8000-000000000201",
    label: "recommendation",
    headline: "Mark items out of stock before service",
    detail: "Every cancellation was ITEM_UNAVAILABLE.",
    limitations: ["Twenty of fifty-nine days carried evidence."],
    promptVersion: 1,
    context: null,
    citations: [
      {
        findingId: "fb230000-0000-4000-8000-000000000a01",
        detectorKey: "orders.cancellation_loss",
        kind: "finding",
        headline: "10 of 26 orders cancelled",
        detail: "Every cancellation was ITEM_UNAVAILABLE.",
        valueSummary: "AED 357.00 reported loss",
        limitations: ["Twenty of fifty-nine days carried evidence."],
      },
    ],
    ...overrides,
  };
}

const validVerdict = {
  citationFaithful: true,
  labelAppropriate: true,
  inventedValueDetected: false,
  uncertaintyHonest: true,
  score: 4,
  issues: [],
  notes: "cites its own run honestly",
};

function deps(overrides: Partial<ChannelRecommendationEvaluationDependencies> = {}) {
  return {
    loadUnjudged: vi.fn(async () => [unjudged()]),
    judge: vi.fn(async () => ({ ...validVerdict })),
    admit: vi.fn(async () => undefined),
    reportRefusal: vi.fn(),
    ...overrides,
  };
}

describe("runChannelRecommendationEvaluations", () => {
  it("judges a batch whole: one admit per organization with every verdict", async () => {
    const d = deps();
    const outcome = await runChannelRecommendationEvaluations(meta, d);

    expect(outcome.refusedCount).toBe(0);
    expect(outcome.evaluatedCount).toBe(1);
    expect(d.admit).toHaveBeenCalledTimes(1);
    const call = vi.mocked(d.admit).mock.calls[0]![0];
    expect(call.organizationId).toBe("fb230000-0000-4000-8000-000000000201");
    expect(call.verdicts).toHaveLength(1);
    expect(call.verdicts[0]).toMatchObject({ ...validVerdict, recommendationId: unjudged().id });
    expect(d.judge).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Stored limitations: Twenty of fifty-nine days carried evidence."),
    );
  });

  it("splits a mixed batch into one fenced admit per organization", async () => {
    const otherOrg = unjudged({
      id: "fb230000-0000-4000-8000-000000000802",
      organizationId: "fb230000-0000-4000-8000-000000000202",
    });
    const d = deps({ loadUnjudged: vi.fn(async () => [unjudged(), otherOrg]) });

    const outcome = await runChannelRecommendationEvaluations(meta, d);

    expect(outcome.evaluatedCount).toBe(2);
    expect(d.admit).toHaveBeenCalledTimes(2);
  });

  it("counts an invalid verdict as refused and admits nothing for it", async () => {
    const d = deps({
      judge: vi.fn(async () => ({ score: 9, nonsense: true })),
    });

    const outcome = await runChannelRecommendationEvaluations(meta, d);

    expect(outcome.evaluatedCount).toBe(0);
    expect(outcome.refusedCount).toBe(1);
    expect(d.admit).not.toHaveBeenCalled();
    expect(d.reportRefusal).toHaveBeenCalledWith({
      recommendationId: unjudged().id,
      errorCode: "JUDGE_VERDICT_REFUSED",
    });
  });

  it("keeps judging siblings when one reply is garbage", async () => {
    const second = unjudged({ id: "fb230000-0000-4000-8000-000000000803" });
    let call = 0;
    const d = deps({
      loadUnjudged: vi.fn(async () => [unjudged(), second]),
      judge: vi.fn(async () => {
        call += 1;
        return call === 1 ? "not json at all" : { ...validVerdict };
      }),
    });

    const outcome = await runChannelRecommendationEvaluations(meta, d);

    expect(outcome.evaluatedCount).toBe(1);
    expect(outcome.refusedCount).toBe(1);
    expect(d.admit).toHaveBeenCalledTimes(1);
  });

  it("calls nobody when nothing is unjudged", async () => {
    const d = deps({ loadUnjudged: vi.fn(async () => []) });

    const outcome = await runChannelRecommendationEvaluations(meta, d);

    expect(outcome.evaluatedCount).toBe(0);
    expect(d.judge).not.toHaveBeenCalled();
    expect(d.admit).not.toHaveBeenCalled();
  });

  it("rejects a scalar reply before validation", async () => {
    const d = deps({ judge: vi.fn(async () => "123") });

    const outcome = await runChannelRecommendationEvaluations(meta, d);

    expect(outcome.refusedCount).toBe(1);
    expect(d.admit).not.toHaveBeenCalled();
  });

  it("allows grounded portal how-to while still flagging invented values", async () => {
    // Amendment A: portal how-to steps are grounding-backed operational
    // advice, not invention — but an uncited number, cause, saving,
    // benchmark, attribution, or confidence level still fails the item.
    const d = deps();

    await runChannelRecommendationEvaluations(meta, d);

    const system = vi.mocked(d.judge).mock.calls[0]![0];
    expect(system).toContain("grounding-backed operational advice, not invention");
    expect(system).toMatch(/invented number, cause, saving, benchmark, attribution/);
  });

  it("flags heavy jargon and longwinded prose as a plain-language issue", async () => {
    // Amendment B (prompt v7, judge v3): the narrator must write plain
    // English, so the judge names jargon and longwinded prose in issues and
    // reflects them in score. The verdict shape is unchanged — issues and
    // score already carry it.
    const d = deps();

    await runChannelRecommendationEvaluations(meta, d);

    const system = vi.mocked(d.judge).mock.calls[0]![0];
    expect(system).toContain("basic English");
    expect(system).toMatch(/heavy jargon/);
    expect(system).toMatch(/longwinded prose/);
  });

  it("states the memory non-corroboration rules in the system prompt (judge v4)", async () => {
    const d = deps();

    await runChannelRecommendationEvaluations(meta, d);

    const system = vi.mocked(d.judge).mock.calls[0]![0];
    expect(system).toContain("never independent evidence");
    expect(system).toContain("intent, not proof of execution or success");
    expect(system).toContain("one voice, not");
    expect(system).toContain("does not overrule it");
    expect(system).toContain("Memory alone never creates a finding");
  });

  it("names the absence of shared context instead of implying a memory read", async () => {
    const d = deps();

    await runChannelRecommendationEvaluations(meta, d);

    const user = vi.mocked(d.judge).mock.calls[0]![1];
    expect(user).toContain("(no shared context was recorded for this recommendation)");
    expect(user).not.toContain("<context ref=");
  });

  it("carries a correctly referenced plan to the judge with its kind label", async () => {
    // Spec 023 A05: the operator planned, then the narration cites the plan.
    // The test proves carriage (the judge receives the discriminating
    // evidence), not the verdict a live model would return.
    const d = deps({
      loadUnjudged: vi.fn(async () => [
        unjudged({
          detail: "Per the recorded plan we widened the promise window.",
          context: {
            shareMode: "internal_only",
            manifestDigest: "d".repeat(64),
            refs: [
              {
                ref: "ctx-0001",
                summary: "Operator planned action on ITEM_UNAVAILABLE cancellations.",
                statementKind: "operator_decision",
              },
            ],
          },
        }),
      ]),
    });

    await runChannelRecommendationEvaluations(meta, d);

    const user = vi.mocked(d.judge).mock.calls[0]![1];
    expect(user).toContain('<shared_context mode="internal_only"');
    expect(user).toContain('<context ref="ctx-0001" kind="operator_decision">');
    expect(user).toContain("Operator planned action");
  });

  it("carries stale memory beside the current finding so contradiction is catchable", async () => {
    // Spec 023 A10: a corrected report supersedes the old observation. The
    // judge must see both the current finding and the stale memory entry with
    // their distinct labels; which verdict follows is the model's job.
    const d = deps({
      loadUnjudged: vi.fn(async () => [
        unjudged({
          detail: "Late plates persist at peak per last month's note.",
          citations: [
            {
              findingId: "fb230000-0000-4000-8000-000000000a02",
              detectorKey: "kitchen.timing",
              kind: "finding",
              headline: "Late plates resolved this week",
              detail: "No late plates in the current window.",
              valueSummary: null,
              limitations: [],
            },
          ],
          context: {
            shareMode: "internal_only",
            manifestDigest: null,
            refs: [
              {
                ref: "ctx-0002",
                summary: "Late plates at peak last month.",
                statementKind: "observation",
              },
            ],
          },
        }),
      ]),
    });

    await runChannelRecommendationEvaluations(meta, d);

    const user = vi.mocked(d.judge).mock.calls[0]![1];
    expect(user).toContain("Late plates resolved this week");
    expect(user).toContain("Late plates at peak last month.");
    const system = vi.mocked(d.judge).mock.calls[0]![0];
    expect(system).toContain("does not overrule it");
  });

  it("carries memory text the findings do not contain so invention is catchable", async () => {
    // Spec 023 A12: a memory entry that invents a value must be visible to
    // the judge next to the finding citations, or no verdict could catch it.
    const d = deps({
      loadUnjudged: vi.fn(async () => [
        unjudged({
          detail: "Margins rose 40 percent after the change.",
          context: {
            shareMode: "grounded_share",
            manifestDigest: "e".repeat(64),
            refs: [
              {
                ref: "ctx-0003",
                summary: "Margins rose 40 percent, per an old note.",
                statementKind: "observation",
              },
            ],
          },
        }),
      ]),
    });

    await runChannelRecommendationEvaluations(meta, d);

    const user = vi.mocked(d.judge).mock.calls[0]![1];
    expect(user).toContain('<shared_context mode="grounded_share"');
    expect(user).toContain("Margins rose 40 percent, per an old note.");
    expect(user).toContain("AED 357.00 reported loss");
  });
});
