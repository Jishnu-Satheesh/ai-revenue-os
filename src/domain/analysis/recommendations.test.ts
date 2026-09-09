import { describe, expect, it } from "vitest";

import {
  JUDGE_PROMPT_VERSION,
  MAX_EVALUATION_BATCH,
  MAX_RECOMMENDATIONS_PER_RUN,
  RECOMMENDATION_PROMPT_VERSION,
  evaluationVerdictSchema,
  narratedItemSchema,
  narrationSubmissionSchema,
} from "@/domain/analysis/recommendations";
import type {
  EvaluationVerdict,
  NarratedItem,
  NarrationSubmission,
} from "@/domain/analysis/recommendations";

// Finding ids the canonical fixture cites. They stand in for rows the detector
// slice already wrote; the schemas cannot know they exist, and the completion
// RPC re-checks them against the run later.
const FUNNEL_FINDING_ID = "6f1c26e2-9a41-4b7d-8f3c-0d5a1e2b3c4d";
const LOSS_FINDING_ID = "a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6";

// §3-shaped values: the pilot's own Talabat performance figures, observed not
// assumed -- impressions 18294 narrowing to 949 views, 59 carts, 24 orders,
// and the provider's own reported rejection loss of 35,700 fils.
function talabatFunnelItem(): NarratedItem {
  return {
    label: "observation",
    headline: "Talabat funnel closes at 24 orders from 18,294 impressions",
    detail:
      "Listing impressions narrow through 949 menu views and 59 cart additions to 24 placed " +
      "orders over the window. Every stage restates a governed metric row; nothing is estimated.",
    supportedActions: ["Compare listing availability hours against closed minutes"],
    limitations: ["Stages are provider-reported daily totals summed over the window"],
    citations: [FUNNEL_FINDING_ID],
  };
}

function talabatLossItem(): NarratedItem {
  return {
    label: "recommendation",
    headline: "Rejected orders gave back 35,700 fils of recorded gross",
    detail:
      "The provider's own report carries 35,700 fils of rejection loss across avoidable " +
      "cancellations in the window. The figure is quoted from that report, not recomputed.",
    supportedActions: [
      "Review preparation times for the items most often rejected",
      "Check menu availability windows against closed minutes",
    ],
    limitations: [
      "Loss is the provider's reported figure rather than an independent recomputation",
    ],
    citations: [LOSS_FINDING_ID],
  };
}

function verdictInput(): EvaluationVerdict {
  return {
    citationFaithful: true,
    labelAppropriate: true,
    inventedValueDetected: false,
    uncertaintyHonest: true,
    score: 5,
    issues: [],
    notes: "Every figure traces to a cited finding; the loss is labelled as provider-reported.",
  };
}

describe("the recommendation narration contracts", () => {
  it("pins the prompt versions and bounds the brief fixes", () => {
    // v4: advice became the default rather than the exception. v1-v3 told the
    // narrator what it must never claim and never told it to advise, so every
    // run came back labelled `observation`, repeating each figure back at the
    // operator. ADR 0039 puts the fence on claims about cause and realized
    // result, never on the advice itself.
    // v3: narration prompt gained the one-idea-per-item and keep-it-short rules
    // so a recommendation reads as one plain sentence of advice an owner can
    // act on, never as a crowded restatement of the findings.
    // v2: narration prompt gained the plain-language, highest-leverage advice
    // rules so a recommendation reads as advice a non-technical owner can act
    // on, never as a restatement of the arithmetic.
    // v2: judge allows grounded portal how-to steps while still flagging
    // invented numbers, causes, savings, benchmarks, attribution, and
    // confidence (Amendment A: playbooks removed, grounding primary).
    // v6: narration prompt grounds with Google Search instead of curated
    // playbooks; no URLs emitted; findings remain the only cited evidence.
    // v7: narration prompt rolls grounding plus stored channel context out to
    // every run with findings and requires plain English globally
    // (Amendment B). v3: judge names heavy jargon and longwinded prose in
    // issues and reflects them in score; the verdict shape is unchanged.
    expect(RECOMMENDATION_PROMPT_VERSION).toBe(7);
    expect(JUDGE_PROMPT_VERSION).toBe(3);
    expect(MAX_RECOMMENDATIONS_PER_RUN).toBe(6);
    expect(MAX_EVALUATION_BATCH).toBe(200);
  });

  it("accepts a submission shaped like the pilot's real Talabat findings", () => {
    const submission: NarrationSubmission = narrationSubmissionSchema.parse({
      items: [talabatFunnelItem(), talabatLossItem()],
    });

    expect(submission.items.map((item) => item.label)).toEqual(["observation", "recommendation"]);
    expect(submission.items[0].citations).toEqual([FUNNEL_FINDING_ID]);
    expect(submission.items[1].detail).toContain("35,700 fils");
  });

  it("rejects an unknown label, including the detector-only kind", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      label: "finding",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a submission with no items", () => {
    const result = narrationSubmissionSchema.safeParse({ items: [] });

    expect(result.success).toBe(false);
  });

  it("rejects more items than one run may carry", () => {
    const result = narrationSubmissionSchema.safeParse({
      items: Array.from({ length: MAX_RECOMMENDATIONS_PER_RUN + 1 }, () => talabatFunnelItem()),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a recommendation that cites nothing", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      citations: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a citation that is not a uuid", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      citations: ["orders.cancellation_loss"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a headline longer than 200 characters", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      headline: "x".repeat(201),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty or whitespace headline", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      headline: "   ",
    });

    expect(result.success).toBe(false);
  });

  it("rejects detail longer than 1000 characters", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      detail: "x".repeat(1001),
    });

    expect(result.success).toBe(false);
  });

  it("rejects more than five supported actions", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      supportedActions: ["a", "b", "c", "d", "e", "f"].map((action) => `Action ${action}`),
    });

    expect(result.success).toBe(false);
  });

  it("rejects more than five limitations", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      limitations: ["1", "2", "3", "4", "5", "6"],
    });

    expect(result.success).toBe(false);
  });

  it("refuses fields the schema never declared", () => {
    const result = narratedItemSchema.safeParse({
      ...talabatFunnelItem(),
      confidence: 0.9,
    });

    expect(result.success).toBe(false);
  });

  it("accepts a complete judge verdict", () => {
    const parsed: EvaluationVerdict = evaluationVerdictSchema.parse(verdictInput());

    expect(parsed.score).toBe(5);
    expect(parsed.inventedValueDetected).toBe(false);
  });

  it("rejects a score above the scale", () => {
    const result = evaluationVerdictSchema.safeParse({ ...verdictInput(), score: 6 });

    expect(result.success).toBe(false);
  });

  it("rejects a score below the scale and a fractional score", () => {
    expect(evaluationVerdictSchema.safeParse({ ...verdictInput(), score: 0 }).success).toBe(false);
    expect(evaluationVerdictSchema.safeParse({ ...verdictInput(), score: 4.5 }).success).toBe(
      false,
    );
  });

  it("rejects a verdict with a non-boolean flag", () => {
    const result = evaluationVerdictSchema.safeParse({
      ...verdictInput(),
      citationFaithful: "yes",
    });

    expect(result.success).toBe(false);
  });
});
