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
});
