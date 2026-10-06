import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only `buildLearningPrompt` is under test here; it is pure. The module's
// provider factory reads credentials at import time, which a prompt test has no
// business needing.
vi.mock("@/lib/env", () => ({
  env: {
    GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
    CAMPAIGN_TEXT_MODEL: "gemini-text",
    CAMPAIGN_IMAGE_MODEL: "gemini-image",
  },
}));

import { OVERCLAIM_PATTERNS } from "@/domain/campaigns/measurement";
import type { LearningContext } from "@/modules/campaigns/application/learning-service";
import { buildLearningPrompt } from "@/modules/campaigns/infrastructure/learning-drafter";

const context: LearningContext = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  campaignId: "c0000000-0000-4000-8000-000000000001",
  outcomeId: "o0000000-0000-4000-8000-000000000001",
  bundleVersionId: "b0000000-0000-4000-8000-000000000001",
  bundleDigest: "a".repeat(64),
  policyVersionIds: [],
  variantIds: [],
  plannedExposureCount: 3,
  realizedExposureCount: 1,
  verdict: "execution_only",
  evidenceTier: null,
  primaryMetricKey: "margin.contribution",
  attributionMethod: "observational_prepost",
  outcomeWindowDays: 14,
  settlementDelayDays: 2,
  baselineSource: "measured_goal_baseline",
  baselineLookbackDays: 14,
  estimateMinor: null,
  estimateCurrency: null,
  limitations: ["The campaign ran, but no observation of the primary metric was recorded."],
  settledAt: "2026-09-07T08:11:00.000Z",
};

describe("the learning prompt", () => {
  it("names the wording that will be rejected, rather than hoping the model guesses", () => {
    // The first live run of `campaign.propose-learning` drafted a lesson using
    // "because", failed validation, was redrafted, failed again, and wrote
    // nothing. The fence was right both times. The prompt was the problem: it
    // said "do not claim what this campaign earned" and never mentioned that a
    // single causal word is refused outright.
    const prompt = buildLearningPrompt({ context, repairHints: [] });

    expect(prompt).toMatch(/because/i);
    expect(prompt).toMatch(/caused|causal/i);
  });

  it("keeps the prompt honest about every pattern the validator enforces", () => {
    const prompt = buildLearningPrompt({ context, repairHints: [] });

    // Whatever the validator refuses, the prompt warns about. Adding a pattern
    // without a plain-language form should break this, not silently produce a
    // prompt that omits it.
    for (const pattern of OVERCLAIM_PATTERNS) {
      expect(pattern.says.length).toBeGreaterThan(0);
      expect(prompt).toContain(pattern.says);
    }
  });

  it("turns a rejection into an instruction the model can act on", () => {
    // The repair pass previously fed back the bare label -- "resulted-in",
    // "causation" -- which names a concept rather than telling the model what
    // to change.
    const prompt = buildLearningPrompt({ context, repairHints: ["because", "causation"] });

    expect(prompt).toMatch(/previous draft/i);
    expect(prompt).toContain('the word "because"');
    expect(prompt).not.toMatch(/^- because$/m);
  });

  it("says nothing about a repair when there is no previous draft", () => {
    const prompt = buildLearningPrompt({ context, repairHints: [] });

    expect(prompt).not.toMatch(/previous draft/i);
  });

  it("hands the verdict over as a settled fact", () => {
    const prompt = buildLearningPrompt({ context, repairHints: [] });

    expect(prompt).toContain("execution_only");
    expect(prompt).toContain("no observation of the primary metric was recorded");
  });
});
