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
  type SharePack,
  type SharePackEntry,
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

    expect(result).toEqual({ outcome: "completed", recommendationCount: 1, shareMode: "internal_only", shareEntryCount: 0 });
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

    expect(result).toEqual({ outcome: "completed", recommendationCount: 1, shareMode: "internal_only", shareEntryCount: 0 });
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
      shareMode: "internal_only",
      shareEntryCount: 0,
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

    expect(result).toEqual({ outcome: "completed", recommendationCount: 0, shareMode: "internal_only", shareEntryCount: 0 });
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
        shareMode: "internal_only",
        shareEntryCount: 0,
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
      shareMode: "internal_only",
      shareEntryCount: 0,
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

const UNCITED_FINDING = "00000000-0000-4000-8000-000000000102";

function gapFillReply(): unknown {
  return {
    items: [
      {
        citations: [UNCITED_FINDING],
        limitations: [],
        supportedActions: ["Move two riders to the dinner rush"],
        detail: "The retention mix the detectors measured leaves room to act.",
        headline: "Win back the lapsed dinner orders",
        label: "recommendation",
      },
    ],
  };
}

function gapFillDependencies(
  overrides: Partial<ChannelRecommendationsDependencies> = {},
): ChannelRecommendationsDependencies {
  return dependencies({
    claim: vi.fn(async () => ({
      outcome: "gapfill_acquired" as const,
      window: { windowStart: "2026-01-01", windowEnd: "2026-01-05", periodGrain: "day" },
    })),
    loadFindings: vi.fn(async () => [findingSummary(), findingSummary({ id: UNCITED_FINDING })]),
    loadCitedFindingIds: vi.fn(async () => [FINDING]),
    generator: {
      providerName: "google",
      modelId: "test-model",
      generate: vi.fn(async () => gapFillReply()),
    },
    ...overrides,
  });
}

describe("runChannelRecommendations gap-fill narration", () => {
  it("scopes the prompt to findings no filed item cites yet", async () => {
    const deps = gapFillDependencies();

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({ outcome: "completed", recommendationCount: 1, shareMode: "internal_only", shareEntryCount: 0 });
    const [system, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).toContain(`<finding id="${UNCITED_FINDING}">`);
    expect(user).not.toContain(`<finding id="${FINDING}">`);
    expect(system).toContain("output_contract");
    const call = vi.mocked(deps.complete).mock.calls[0][0];
    expect(call.items).toHaveLength(1);
    expect(call.items[0]!.citations).toEqual([UNCITED_FINDING]);
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("fails processing when the cited set cannot be read or is missing", async () => {
    const throwing = gapFillDependencies({
      loadCitedFindingIds: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    expect((await runChannelRecommendations(payload, throwing)).outcome).toBe("failed");
    expect(throwing.generator.generate).not.toHaveBeenCalled();
    expect(vi.mocked(throwing.fail).mock.calls[0][0].code).toBe("NARRATION_PROCESSING_FAILED");

    const missing = dependencies({
      claim: vi.fn(async () => ({
        outcome: "gapfill_acquired" as const,
        window: { windowStart: "2026-01-01", windowEnd: "2026-01-05", periodGrain: "day" },
      })),
    });
    expect((await runChannelRecommendations(payload, missing)).outcome).toBe("failed");
    expect(vi.mocked(missing.fail).mock.calls[0][0].code).toBe("NARRATION_PROCESSING_FAILED");
  });

  it("fails processing when every finding is already cited", async () => {
    const deps = gapFillDependencies({ loadCitedFindingIds: vi.fn(async () => [FINDING, UNCITED_FINDING]) });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("failed");
    expect(deps.generator.generate).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(vi.mocked(deps.fail).mock.calls[0][0].code).toBe("NARRATION_PROCESSING_FAILED");
  });
});

describe("runChannelRecommendations gap-fill headroom", () => {
  // Prod run run_06g8l0bf99rpqlavml9alnpj01: five filed, four chapters
  // uncovered, cap eight. The model filed one item per chapter and the fence
  // refused 5+4>8 on every attempt, because nothing told the prompt about the
  // budget the fence enforces.
  const FUNNEL_UNCITED = "00000000-0000-4000-8000-000000000103";
  const RETENTION_UNCITED = "00000000-0000-4000-8000-000000000104";

  function headroomDependencies(
    overrides: Partial<ChannelRecommendationsDependencies> = {},
  ): ChannelRecommendationsDependencies {
    return gapFillDependencies({
      loadFindings: vi.fn(async () => [
        findingSummary({ id: FUNNEL_UNCITED, detectorKey: "funnel.stage_conversion" }),
        findingSummary({ id: RETENTION_UNCITED, detectorKey: "customer.new_share" }),
      ]),
      loadCitedFindingIds: vi.fn(async () => []),
      loadFiledRecommendationCount: vi.fn(async () => 7),
      generator: {
        providerName: "google",
        modelId: "test-model",
        generate: vi.fn(async () => ({
          items: [
            {
              citations: [FUNNEL_UNCITED, RETENTION_UNCITED],
              limitations: [],
              supportedActions: ["Review the funnel and mix together on Monday"],
              detail: "The funnel and the customer mix leave one shared action.",
              headline: "Recover the funnel and the lapsed mix in one move",
              label: "recommendation",
            },
          ],
        })),
      },
      ...overrides,
    });
  }

  it("binds the gap-fill prompt to the free slots when chapters outnumber them", async () => {
    const deps = headroomDependencies();

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({ outcome: "completed", recommendationCount: 1, shareMode: "internal_only", shareEntryCount: 0 });
    const [system, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(system).toContain("file at most 1 more");
    expect(system).toContain("more than one key");
    expect(user).toContain(`<finding id="${FUNNEL_UNCITED}">`);
    expect(user).toContain(`<finding id="${RETENTION_UNCITED}">`);
    expect(vi.mocked(deps.loadFiledRecommendationCount)).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      analysisRunId: RUN,
    });
  });

  it("carries no budget line when the filed count loader is absent", async () => {
    const deps = gapFillDependencies();

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("completed");
    const [system] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(system).not.toContain("gap-fill");
  });

  it("fails fast without generating when no slot is free", async () => {
    const deps = headroomDependencies({
      loadFiledRecommendationCount: vi.fn(async () => 8),
    });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("failed");
    expect(deps.generator.generate).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(vi.mocked(deps.fail).mock.calls[0][0].code).toBe("NARRATION_PROCESSING_FAILED");
  });

  it("fails processing when the filed count cannot be read", async () => {
    const deps = headroomDependencies({
      loadFiledRecommendationCount: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("failed");
    expect(deps.generator.generate).not.toHaveBeenCalled();
    expect(vi.mocked(deps.fail).mock.calls[0][0].code).toBe("NARRATION_PROCESSING_FAILED");
  });
});

describe("runChannelRecommendations channel context threading", () => {
  const pilotContext = {
    channelContext: {
      organizationName: "ACME Restaurants",
      industry: "restaurant",
      countryCode: "AE",
      baseCurrency: "AED",
      organizationTimezone: "Asia/Dubai",
      channelKey: "talabat",
      channelDisplayName: "Talabat",
      channelCategory: "marketplace",
      templateKey: "talabat_v1",
      branchName: "Marina",
      branchTimezone: "Asia/Dubai",
    },
  };

  it("threads stored context into the prompt and digests exactly what was sent", async () => {
    const deps = dependencies({ loadPilotContext: vi.fn(async () => pilotContext) });

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({ outcome: "completed", recommendationCount: 1, shareMode: "internal_only", shareEntryCount: 0 });
    expect(deps.loadPilotContext).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      analysisRunId: RUN,
      findings: [findingSummary()],
    });
    const [system, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).toContain("<channel_context>");
    expect(user).toContain("Talabat");
    // The digest covers the new inputs because it digests the rendered
    // system+user strings rather than the pre-pilot fields.
    const call = vi.mocked(deps.complete).mock.calls[0][0];
    expect(call.promptDigest).toBe(sha256Hex(JSON.stringify({ system, user })));
  });

  it("fails open to the v4 shape when the pilot loader throws, and still completes", async () => {
    const deps = dependencies({
      loadPilotContext: vi.fn(async () => {
        throw new Error("database unreachable");
      }),
    });

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({ outcome: "completed", recommendationCount: 1, shareMode: "internal_only", shareEntryCount: 0 });
    const [, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).not.toContain("<channel_context>");
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.fail).not.toHaveBeenCalled();
  });
});

describe("runChannelRecommendations grounding switch", () => {
  it("grounds every run with findings: the generator receives useGrounding true", async () => {
    // Amendment B retired the 3-key pilot gate. Previously non-pilot
    // detectors — funnel, retention, commission, revenue — ground exactly
    // like the pilot chapters once did.
    for (const detectorKey of [
      "orders.cancellation_loss",
      "orders.cancellation_attribution",
      "operations.closed_share",
      "funnel.stage_conversion",
      "revenue.period_movement",
      "economics.commission_share",
    ]) {
      const deps = dependencies({
        loadFindings: vi.fn(async () => [findingSummary({ detectorKey })]),
      });

      const result = await runChannelRecommendations(payload, deps);

      expect(result.outcome).toBe("completed");
      expect(vi.mocked(deps.generator.generate).mock.calls[0][2]).toEqual({
        useGrounding: true,
      });
    }
  });

  it("keeps the tool on even when the context loader fails open", async () => {
    // Grounding follows the run having findings, not the loader's luck: a
    // context miss renders the v4 shape but still searches.
    const deps = dependencies({
      loadFindings: vi.fn(async () => [findingSummary({ detectorKey: "revenue.period_movement" })]),
      loadPilotContext: vi.fn(async () => {
        throw new Error("database unreachable");
      }),
    });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("completed");
    const [, user, options] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(options).toEqual({ useGrounding: true });
    expect(user).not.toContain("<channel_context>");
  });
});

describe("runChannelRecommendations share mode (Spec 024)", () => {
  it("stays internal-only without a share dependency and sends no shared block", async () => {
    const deps = dependencies();

    const result = await runChannelRecommendations(payload, deps);

    expect(result.shareMode).toBe("internal_only");
    expect(result.shareEntryCount).toBe(0);
    const [, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).not.toContain("<shared_business_context>");
  });

  it("completes internal-only when the share loader throws, without blocking narration", async () => {
    const deps = dependencies({
      loadShareContext: vi.fn(async () => {
        throw new Error("status check failed");
      }),
    });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("completed");
    expect(result.shareMode).toBe("internal_only");
    expect(result.shareEntryCount).toBe(0);
    const [, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).not.toContain("<shared_business_context>");
  });

  it("places allowlisted entries in the prompt when sharing is active", async () => {
    const deps = dependencies({
      loadShareContext: vi.fn(async () => ({
        mode: "grounded_share" as const,
        entries: [{ title: "Friday plan", summary: "Check capacity before the mall event." }],
        excludedCount: 2,
        reason: "ready" as const,
      })),
    });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.outcome).toBe("completed");
    expect(result.shareMode).toBe("grounded_share");
    expect(result.shareEntryCount).toBe(1);
    const [, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).toContain("<shared_business_context>");
    expect(user).toContain("Friday plan");
  });

  it("keeps the prompt byte-identical for an active-but-empty share", async () => {
    const without = dependencies();
    await runChannelRecommendations(payload, without);
    const [systemBefore, userBefore] = vi.mocked(without.generator.generate).mock.calls[0];

    const active = dependencies({
      loadShareContext: vi.fn(async () => ({
        mode: "grounded_share" as const,
        entries: [],
        excludedCount: 3,
        reason: "corpus_unqualified" as const,
      })),
    });
    const result = await runChannelRecommendations(payload, active);
    const [systemAfter, userAfter] = vi.mocked(active.generator.generate).mock.calls[0];

    expect(result.shareMode).toBe("grounded_share");
    expect(result.shareEntryCount).toBe(0);
    expect(systemAfter).toBe(systemBefore);
    expect(userAfter).toBe(userBefore);
  });
});

function packEntry(overrides: Partial<SharePackEntry> & { contextRef: string }): SharePackEntry {
  return {
    title: `Title ${overrides.contextRef}`,
    summary: `Summary ${overrides.contextRef}.`,
    sensitivity: "internal",
    reuseClass: "qualified_reusable",
    knowledgeKind: "observation",
    hasMoneyAmount: false,
    hasPii: false,
    rootsLive: true,
    scopeOk: true,
    isLegacyUnqualified: false,
    priority: 0,
    ...overrides,
  };
}

function packDependencies(
  pack: SharePack,
  overrides: Partial<ChannelRecommendationsDependencies> = {},
): ChannelRecommendationsDependencies {
  return dependencies({
    loadShareContext: vi.fn(async () => ({
      mode: "grounded_share" as const,
      entries: [],
      excludedCount: 0,
      reason: "ready" as const,
    })),
    prepareSharePack: vi.fn(async () => pack),
    ...overrides,
  });
}

describe("runChannelRecommendations share packs (Spec 023 §7)", () => {
  it("threads an allowlisted pack into the prompt and pins the manifest for completion", async () => {
    const deps = packDependencies({
      manifestId: "44444444-4444-4444-8444-444444444444",
      status: "ready",
      entries: [packEntry({ contextRef: "ctx-0001" }), packEntry({ contextRef: "ctx-0002" })],
    });

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({
      outcome: "completed",
      recommendationCount: 1,
      shareMode: "grounded_share",
      shareEntryCount: 2,
    });
    const [, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).toContain("<shared_business_context>");
    expect(user).toContain("Title ctx-0001");
    const call = vi.mocked(deps.complete).mock.calls[0][0];
    expect(call.shareManifestId).toBe("44444444-4444-4444-8444-444444444444");
    expect(call.shareMode).toBe("grounded_share");
    expect(call.shareProvidedRefs).toEqual(["ctx-0001", "ctx-0002"]);
  });

  it("subsets pack entries through the domain allowlist: 8 entries, no money, no PII, no confidential", async () => {
    const entries: SharePackEntry[] = Array.from({ length: 10 }, (_, index) =>
      packEntry({ contextRef: `ctx-${String(index + 1).padStart(4, "0")}`, priority: index }),
    );
    entries.push(
      packEntry({ contextRef: "ctx-money", hasMoneyAmount: true, priority: -1 }),
      packEntry({ contextRef: "ctx-pii", hasPii: true, priority: -1 }),
      packEntry({ contextRef: "ctx-secret", sensitivity: "confidential", priority: -1 }),
      packEntry({ contextRef: "ctx-legacy", isLegacyUnqualified: true, priority: -1 }),
    );
    const deps = packDependencies({ manifestId: "44444444-4444-4444-8444-444444444444", status: "ready", entries });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.shareMode).toBe("grounded_share");
    expect(result.shareEntryCount).toBe(8);
    const [, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    // The lowest-priority eligible tail drops; the ineligible never render even
    // though they outranked everything eligible.
    expect(user).toContain("Title ctx-0001");
    expect(user).toContain("Title ctx-0008");
    expect(user).not.toContain("Title ctx-0009");
    expect(user).not.toContain("Title ctx-money");
    expect(user).not.toContain("Title ctx-pii");
    expect(user).not.toContain("Title ctx-secret");
    expect(user).not.toContain("Title ctx-legacy");
    const call = vi.mocked(deps.complete).mock.calls[0][0];
    expect(call.shareProvidedRefs).toHaveLength(8);
  });

  it("keeps the prompt byte-identical when the pack subsets to nothing", async () => {
    const without = dependencies();
    await runChannelRecommendations(payload, without);
    const [systemBefore, userBefore] = vi.mocked(without.generator.generate).mock.calls[0];

    const deps = packDependencies({
      manifestId: "44444444-4444-4444-8444-444444444444",
      status: "empty",
      entries: [packEntry({ contextRef: "ctx-0001", sensitivity: "confidential" })],
    });
    const result = await runChannelRecommendations(payload, deps);
    const [systemAfter, userAfter] = vi.mocked(deps.generator.generate).mock.calls[0];

    expect(result.shareMode).toBe("grounded_share");
    expect(result.shareEntryCount).toBe(0);
    expect(systemAfter).toBe(systemBefore);
    expect(userAfter).toBe(userBefore);
  });

  it("completes evidence-only when pack preparation throws, never faking provenance", async () => {
    const deps = packDependencies(
      { manifestId: "unused", status: "ready", entries: [] },
      {
        prepareSharePack: vi.fn(async () => {
          throw new Error("retrieval exploded");
        }),
      },
    );

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({
      outcome: "completed",
      recommendationCount: 1,
      shareMode: "internal_only",
      shareEntryCount: 0,
    });
    const [, user] = vi.mocked(deps.generator.generate).mock.calls[0];
    expect(user).not.toContain("<shared_business_context>");
    const call = vi.mocked(deps.complete).mock.calls[0][0];
    expect(call.shareManifestId).toBeNull();
  });

  it("completes evidence-only for an unavailable pack status", async () => {
    const deps = packDependencies({ manifestId: "unused", status: "unavailable", entries: [] });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.shareMode).toBe("internal_only");
    expect(result.shareEntryCount).toBe(0);
    expect(vi.mocked(deps.complete).mock.calls[0][0].shareManifestId).toBeNull();
  });

  it("never calls pack preparation for an internal-only gate", async () => {
    const prepareSharePack = vi.fn(async () => ({
      manifestId: "44444444-4444-4444-8444-444444444444",
      status: "ready" as const,
      entries: [packEntry({ contextRef: "ctx-0001" })],
    }));
    const deps = dependencies({ prepareSharePack });

    const result = await runChannelRecommendations(payload, deps);

    expect(result.shareMode).toBe("internal_only");
    expect(prepareSharePack).not.toHaveBeenCalled();
  });
});

describe("runChannelRecommendations share revalidation (Spec 023 §9)", () => {
  it("completes with the pinned manifest when revalidation is valid", async () => {
    const revalidateSharePack = vi.fn(async () => "valid" as const);
    const deps = packDependencies(
      {
        manifestId: "44444444-4444-4444-8444-444444444444",
        status: "ready",
        entries: [packEntry({ contextRef: "ctx-0001" })],
      },
      { revalidateSharePack },
    );

    const result = await runChannelRecommendations(payload, deps);

    expect(result.shareMode).toBe("grounded_share");
    expect(revalidateSharePack).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      manifestId: "44444444-4444-4444-8444-444444444444",
    });
    expect(vi.mocked(deps.complete).mock.calls[0][0].shareManifestId).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("takes one bounded fresh attempt on changed and completes with the new manifest", async () => {
    const freshId = "55555555-5555-4555-8555-555555555555";
    const prepareSharePack = vi
      .fn()
      .mockResolvedValueOnce({
        manifestId: "44444444-4444-4444-8444-444444444444",
        status: "ready",
        entries: [packEntry({ contextRef: "ctx-0001" })],
      })
      .mockResolvedValueOnce({
        manifestId: freshId,
        status: "ready",
        entries: [packEntry({ contextRef: "ctx-0002" })],
      });
    const revalidateSharePack = vi
      .fn()
      .mockResolvedValueOnce("changed" as const)
      .mockResolvedValueOnce("valid" as const);
    const deps = packDependencies(
      { manifestId: "unused", status: "ready", entries: [] },
      { prepareSharePack, revalidateSharePack },
    );

    const result = await runChannelRecommendations(payload, deps);

    expect(result.shareMode).toBe("grounded_share");
    expect(result.shareEntryCount).toBe(1);
    expect(prepareSharePack).toHaveBeenCalledTimes(2);
    const [, secondUser] = vi.mocked(deps.generator.generate).mock.calls[1];
    expect(secondUser).toContain("Title ctx-0002");
    const call = vi.mocked(deps.complete).mock.calls[0][0];
    expect(call.shareManifestId).toBe(freshId);
    expect(call.shareProvidedRefs).toEqual(["ctx-0002"]);
  });

  it("falls back to one evidence-only generation when the fresh pack is still changed", async () => {
    const prepareSharePack = vi.fn(async () => ({
      manifestId: "44444444-4444-4444-8444-444444444444",
      status: "ready" as const,
      entries: [packEntry({ contextRef: "ctx-0001" })],
    }));
    const revalidateSharePack = vi.fn(async () => "changed" as const);
    const deps = packDependencies(
      { manifestId: "unused", status: "ready", entries: [] },
      { prepareSharePack, revalidateSharePack },
    );

    const result = await runChannelRecommendations(payload, deps);

    expect(result).toEqual({
      outcome: "completed",
      recommendationCount: 1,
      shareMode: "internal_only",
      shareEntryCount: 0,
    });
    // Original + fresh + evidence-only fallback: bounded at three prompts.
    expect(vi.mocked(deps.generator.generate).mock.calls).toHaveLength(3);
    const [, fallbackUser] = vi.mocked(deps.generator.generate).mock.calls[2];
    expect(fallbackUser).not.toContain("<shared_business_context>");
    expect(vi.mocked(deps.complete).mock.calls[0][0].shareManifestId).toBeNull();
  });

  it("regenerates evidence-only on revoked without a second pack attempt", async () => {
    const prepareSharePack = vi.fn(async () => ({
      manifestId: "44444444-4444-4444-8444-444444444444",
      status: "ready" as const,
      entries: [packEntry({ contextRef: "ctx-0001" })],
    }));
    const revalidateSharePack = vi.fn(async () => "revoked" as const);
    const deps = packDependencies(
      { manifestId: "unused", status: "ready", entries: [] },
      { prepareSharePack, revalidateSharePack },
    );

    const result = await runChannelRecommendations(payload, deps);

    expect(result.shareMode).toBe("internal_only");
    expect(result.shareEntryCount).toBe(0);
    expect(prepareSharePack).toHaveBeenCalledTimes(1);
    const [, fallbackUser] = vi.mocked(deps.generator.generate).mock.calls[1];
    expect(fallbackUser).not.toContain("<shared_business_context>");
  });
});
