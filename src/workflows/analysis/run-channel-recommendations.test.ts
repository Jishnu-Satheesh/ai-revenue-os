import { describe, expect, it, vi } from "vitest";

import {
  RECOMMENDATION_PROMPT_VERSION,
  type NarratedItem,
} from "@/domain/analysis/recommendations";
import { ORGANIZATION, CHANNEL } from "@/domain/analysis/test-fixtures";
import { sha256Hex } from "@/workflows/analysis/recommendation-prompt";
import {
  runChannelRecommendations,
  type ChannelRecommendationsDependencies,
} from "@/workflows/analysis/run-channel-recommendations";

const RUN = "00000000-0000-4000-8000-0000000000c1";
const CORRELATION = "00000000-0000-4000-8000-0000000000d1";
const FINDING = "00000000-0000-4000-8000-000000000101";

const payload = {
  organizationId: ORGANIZATION,
  channelId: CHANNEL,
  analysisRunId: RUN,
  correlationId: CORRELATION,
};

function findingSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING,
    detectorKey: "orders.cancellation_loss",
    kind: "finding",
    code: "ORDERS_AVOIDABLE_CANCELLATION_LOSS",
    headline: "Avoidable cancellations cost AED 300.00",
    detail: "Five orders were cancelled after acceptance.",
    valueSummary: "AED 300.00 across 5 orders",
    limitations: ["Courier data partial"],
    ...overrides,
  };
}

/** Key order is deliberately unlike the schema's, so parse-normalization is visible. */
function validReply(): unknown {
  return {
    items: [
      {
        citations: [FINDING],
        limitations: ["Estimate only"],
        supportedActions: ["Contact the courier about the five orders"],
        detail: "Cancellations after acceptance drove the loss the detectors measured.",
        headline: "  Recover the avoidable cancellation loss  ",
        label: "recommendation",
      },
    ],
  };
}

function dependencies(
  overrides: Partial<ChannelRecommendationsDependencies> = {},
): ChannelRecommendationsDependencies {
  return {
    claim: vi.fn(async () => ({
      outcome: "acquired" as const,
      window: { windowStart: "2026-01-01", windowEnd: "2026-01-05", periodGrain: "day" },
    })),
    loadFindings: vi.fn(async () => [findingSummary()]),
    generator: {
      providerName: "google",
      modelId: "test-model",
      generate: vi.fn(async () => validReply()),
    },
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runChannelRecommendations", () => {
  it("files one parsed submission through complete with both digests", async () => {
    const deps = dependencies();

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({ outcome: "completed", recommendationCount: 1 });
    expect(deps.generator.generate).toHaveBeenCalledTimes(1);
    const [system, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).toContain(`<finding id="${FINDING}">`);
    expect(system).toContain("output_contract");

    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.fail).not.toHaveBeenCalled();
    const call = vi.mocked(deps.complete).mock.calls[0][0];
    expect(call.organizationId).toBe(ORGANIZATION);
    expect(call.analysisRunId).toBe(RUN);
    expect(call.claimToken).toEqual(expect.any(String));
    expect(call.provider).toBe("google");
    expect(call.modelId).toBe("test-model");
    expect(call.promptVersion).toBe(RECOMMENDATION_PROMPT_VERSION);
    for (const digest of [call.promptDigest, call.outputDigest, call.resultDigest]) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
    // The submission handed over is the parsed, normalized one: trims applied,
    // key order folded back to the schema's.
    const items = call.items as NarratedItem[];
    expect(items[0]!.headline).toBe("Recover the avoidable cancellation loss");
    expect(items[0]!.citations).toEqual([FINDING]);
    // The result digest describes exactly what was handed over.
    expect(call.resultDigest).toBe(sha256Hex(JSON.stringify({ items })));
  });

  it("retries generation once when the first reply is unusable, then files the good one", async () => {
    const generate = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(validReply());
    const deps = dependencies({ generator: { providerName: "google", modelId: "m", generate } });

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({ outcome: "completed", recommendationCount: 1 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("fails NARRATION_VALIDATION_FAILED after two unusable replies and never completes", async () => {
    const generate = vi.fn(async () => ({}));
    const deps = dependencies({ generator: { providerName: "google", modelId: "m", generate } });

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({
      outcome: "failed",
      recommendationCount: 0,
      failureCode: "NARRATION_VALIDATION_FAILED",
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).toHaveBeenCalledTimes(1);
    const fail = vi.mocked(deps.fail).mock.calls[0][0];
    expect(fail.code).toBe("NARRATION_VALIDATION_FAILED");
    expect(fail.resultDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retries raw provider text as a format miss rather than calling it an outage", async () => {
    // The provider hands back the answer it could not parse as JSON instead of
    // throwing, so the one designed retry actually runs. Before this, an
    // unusable reply was reported as MODEL_PROVIDER_UNAVAILABLE and the retry
    // was unreachable in production.
    const generate = vi.fn(async () => "I could not do that.");
    const deps = dependencies({ generator: { providerName: "google", modelId: "m", generate } });

    const result = await runChannelRecommendations(payload, deps);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.failureCode).toBe("NARRATION_VALIDATION_FAILED");
    expect(vi.mocked(deps.fail).mock.calls[0][0].code).toBe("NARRATION_VALIDATION_FAILED");
  });

  it("rejects a bare scalar reply defensively, without handing it to the schema", async () => {
    const generate = vi.fn(async () => 42);
    const deps = dependencies({ generator: { providerName: "google", modelId: "m", generate } });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("failed");
    expect(deps.complete).not.toHaveBeenCalled();
    expect(vi.mocked(deps.fail).mock.calls[0][0].code).toBe("NARRATION_VALIDATION_FAILED");
  });

  it("rejects extra fields and missing citations as narration-invalid before complete", async () => {
    const generate = vi.fn(async () => ({
      items: [
        {
          label: "recommendation",
          headline: "Recover the avoidable cancellation loss",
          detail: "Cancellations after acceptance drove the loss.",
          supportedActions: [],
          limitations: [],
          confidence: 0.9,
        },
      ],
    }));
    const deps = dependencies({ generator: { providerName: "google", modelId: "m", generate } });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("failed");
    expect(deps.complete).not.toHaveBeenCalled();
    expect(vi.mocked(deps.fail).mock.calls[0][0].code).toBe("NARRATION_VALIDATION_FAILED");
  });

  it("short-circuits a run whose recommendations already exist, generating nothing", async () => {
    const deps = dependencies({
      claim: vi.fn(async () => ({ outcome: "completed" as const })),
    });

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({ outcome: "completed", recommendationCount: 0 });
    expect(deps.loadFindings).not.toHaveBeenCalled();
    expect(deps.generator.generate).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("skips every other non-acquired claim outcome", async () => {
    for (const outcome of ["not_found", "not_ready", "in_progress", "conflict"] as const) {
      const deps = dependencies({ claim: vi.fn(async () => ({ outcome })) });

      expect(await runChannelRecommendations(payload, deps)).toEqual({
        outcome: "skipped",
        recommendationCount: 0,
      });
      expect(deps.loadFindings).not.toHaveBeenCalled();
      expect(deps.generator.generate).not.toHaveBeenCalled();
    }
  });

  it("reports an unavailable provider once and does not retry it", async () => {
    const generate = vi.fn(async () => {
      throw new Error("provider exploded");
    });
    const deps = dependencies({ generator: { providerName: "google", modelId: "m", generate } });

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({
      outcome: "failed",
      recommendationCount: 0,
      failureCode: "MODEL_PROVIDER_UNAVAILABLE",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(deps.complete).not.toHaveBeenCalled();
    expect(vi.mocked(deps.fail).mock.calls[0][0].code).toBe("MODEL_PROVIDER_UNAVAILABLE");
  });

  it("fails processing when the findings cannot be read or are empty", async () => {
    const throwing = dependencies({
      loadFindings: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    expect((await runChannelRecommendations(payload, throwing)).outcome).toBe("failed");
    expect(throwing.generator.generate).not.toHaveBeenCalled();
    expect(vi.mocked(throwing.fail).mock.calls[0][0].code).toBe("NARRATION_PROCESSING_FAILED");

    const empty = dependencies({ loadFindings: vi.fn(async () => []) });
    expect((await runChannelRecommendations(payload, empty)).outcome).toBe("failed");
    expect(empty.generator.generate).not.toHaveBeenCalled();
    expect(vi.mocked(empty.fail).mock.calls[0][0].code).toBe("NARRATION_PROCESSING_FAILED");
  });
});
