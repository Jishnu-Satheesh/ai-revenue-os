// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({ generateObject: vi.fn() }));
// Seam-level provider mock (G4): `runSynthesis` lazy-imports these, so the
// budget + failure-path tests below make zero live calls.
vi.mock("ai", () => ({ generateObject: aiMocks.generateObject }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => ({}),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/lib/logger";
import {
  ANSWER_LIGHT_MODEL_ENV,
  ANSWER_MODEL_MAX_OUTPUT_TOKENS,
  ANSWER_MODEL_TEMPERATURE,
  ANSWER_STRONG_MODEL_ENV,
  answerCitationSchema,
  answerDraftSchema,
  answerEstimateSchema,
  buildAnswerIdempotencyKey,
  buildFallbackAnswer,
  buildSynthesisPrompt,
  createAnswerSynthesizer,
  encodeAnswerBody,
  parseAnswerBody,
  resolveAnswerModelId,
  synthesisCandidateSchema,
  synthesisFailureIds,
  writeAnswer,
  type AnswerDraft,
  type AnswerSynthesizer,
} from "@/modules/agent-chat/application/answer-writer";
import { buildAgentContextPack } from "@/modules/agent-chat/application/context-pack";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import type { ThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { AgentResponseMessage } from "@/components/agent/agent-response-message";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  aiMocks.generateObject.mockReset();
  vi.clearAllMocks();
});

const THREAD = {
  id: "t1",
  organizationId: "o",
  title: "Hi",
  mode: "quick",
  status: "open",
  linkedResearchProjectId: null,
  linkedRequestId: null,
  linkedDraftRequestId: null,
  linkedCampaignId: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
} as const;

const USER_MESSAGE = {
  id: "m1",
  threadId: "t1",
  role: "user",
  body: "what do we know about weekday demand?",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:01:00.000Z",
} as const;

function testPack() {
  return buildAgentContextPack({
    organizationId: "o",
    userId: "u",
    windowDays: 30,
    page: "overview",
    now: "2026-09-20T10:00:00.000Z",
    readers: {
      getIdentityFacts: async () => [
        { id: "f1", statement: "Confirmed trading name.", verified: true, source: "profile" },
      ],
      getMarketProfile: async () => ({
        status: "current",
        versionId: "mp-v3",
        digest: "abc123",
      }),
    },
  });
}

function mockThreads(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const appendMessageKeyed = vi.fn(async (input: {
    role: string;
    body: string;
    threadId: string;
  }) => ({
    messageId: input.role === "assistant" ? "a1" : "m1",
    threadId: input.threadId,
    replayed: false,
  }));
  const getMessage = vi.fn(async (input: { messageId: string }) => ({
    id: input.messageId,
    threadId: "t1",
    role: input.messageId === "a1" ? "assistant" : "user",
    body: input.messageId === "a1" ? "assistant body" : USER_MESSAGE.body,
    questionnaireAnswers: null,
    markerReceipts: null,
    citations: null,
    createdAt: "2026-09-25T10:02:00.000Z",
  }));
  return {
    __appendMessageKeyed: appendMessageKeyed,
    __getMessage: getMessage,
    createThreadKeyed: vi.fn(async () => ({ threadId: "t1", status: "open", replayed: false })),
    appendMessageKeyed,
    getThread: vi.fn(async () => ({ ...THREAD })),
    getMessage,
    latestUserMessage: vi.fn(async () => ({ ...USER_MESSAGE })),
    listThreads: vi.fn(async () => ({ threads: [{ ...THREAD }], nextCursor: null })),
    listMessages: vi.fn(async () => ({ messages: [{ ...USER_MESSAGE }], nextCursor: null })),
    ...overrides,
  } as unknown as ThreadRepository & {
    __appendMessageKeyed: typeof appendMessageKeyed;
    __getMessage: typeof getMessage;
  };
}

describe("answer-writer synthesis", () => {
  it("turns an unknown pack lane into a limitation, never a claim", async () => {
    const pack = await testPack();
    // Economics + memory + timeline lanes are unbound in this pack.
    expect(pack.limitations.length).toBeGreaterThan(0);
    const draft = await writeAnswer(
      {
        pack,
        routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
        threadId: "t1",
        mode: "quick",
      },
      { synthesize: null },
    );
    const parsed = answerDraftSchema.parse(draft);
    expect(parsed.limitations.length).toBeGreaterThan(0);
    // Every citation must come from the pack sources — nothing invented.
    for (const citation of parsed.citations) {
      expect(pack.sources).toContain(citation.sourceId);
    }
    // The unbound economics lane is named honestly, not filled with numbers.
    expect(parsed.limitations.join(" ")).toMatch(/economics/i);
    expect(parsed.body).not.toMatch(/AED|aed/);
  });

  it("rejects an estimate without inputs by Zod", () => {
    expect(() =>
      answerEstimateSchema.parse({
        label: "Estimate",
        value: "+5% visits",
        inputs: [],
        assumptions: ["demand holds"],
      }),
    ).toThrow();
  });

  it("degrades an estimate without inputs to a limitation, never a bare number", async () => {
    const pack = await testPack();
    const draft = await writeAnswer(
      {
        pack,
        routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
        threadId: "t1",
        mode: "quick",
      },
      {
        synthesize: async () => ({
          body: "Visits will rise.",
          citations: [],
          limitations: [],
          estimates: [
            { label: "Estimate", value: "+5% visits", inputs: [], assumptions: ["x"] },
          ],
        }),
      },
    );
    expect(draft.estimates).toEqual([]);
    expect(draft.limitations.join(" ")).toMatch(/failed validation/i);
  });

  it("drops citations outside the pack sources and says so", async () => {
    const pack = await testPack();
    const draft = await writeAnswer(
      {
        pack,
        routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
        threadId: "t1",
        mode: "quick",
      },
      {
        synthesize: async () => ({
          body: "The name is confirmed.",
          citations: [
            { claim: "Confirmed trading name.", sourceId: "f1" },
            { claim: "Ghost ledger total.", sourceId: "ghost-ledger-9" },
          ],
          limitations: [],
          estimates: [],
        }),
      },
    );
    expect(draft.citations.map((citation) => citation.sourceId)).toEqual(["f1"]);
    expect(draft.citations[0]).toMatchObject({ digest: pack.digest });
    expect(draft.limitations.join(" ")).toMatch(/ghost-ledger-9|dropped/i);
  });

  it("cannot represent a realized-result claim: baseline/attribution/window fields fail strict validation", async () => {
    // The candidate schema itself refuses the realized-result shape.
    expect(() =>
      synthesisCandidateSchema.parse({
        body: "This earned you money.",
        citations: [],
        limitations: [],
        estimates: [],
        baseline: "2026-08-01/2026-08-31",
        attribution: "last-click",
        window: "30d",
      }),
    ).toThrow();
    // And a model that tries it gets the honest fallback instead.
    const pack = await testPack();
    const draft = await writeAnswer(
      {
        pack,
        routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
        threadId: "t1",
        mode: "quick",
      },
      {
        synthesize: async () => ({
          body: "This earned you AED 4,000.",
          citations: [],
          limitations: [],
          estimates: [],
          baseline: "2026-08",
          attribution: "last-click",
          window: "30d",
        }),
      },
    );
    expect(draft.body).not.toMatch(/earned you/i);
    expect(draft.limitations.length).toBeGreaterThan(0);
  });

  it("degrades a throwing model to an honest limitation, never invention", async () => {
    const pack = await testPack();
    const draft = await writeAnswer(
      {
        pack,
        routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
        threadId: "t1",
        mode: "quick",
      },
      {
        synthesize: async () => {
          throw new Error("provider down");
        },
      },
    );
    expect(draft.body).toMatch(/stored organization context|unavailable/i);
    expect(draft.limitations.length).toBeGreaterThan(0);
  });

  it("stays general when the pack itself is unavailable", async () => {
    const draft = await writeAnswer(
      {
        pack: null,
        routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
        threadId: "t1",
        mode: "quick",
      },
      { synthesize: null },
    );
    expect(draft.citations).toEqual([]);
    expect(draft.estimates).toEqual([]);
    expect(draft.limitations.join(" ")).toMatch(/context/i);
  });

  it("carries a refused pack as an explicit refusal limitation", async () => {
    const pack = await testPack();
    const refused = { ...pack, refused: true };
    const draft = buildFallbackAnswer(refused, "test reason");
    expect(draft.limitations.join(" ")).toMatch(/refused|reason/i);
  });

  it("round-trips a draft through the durable body encoding", async () => {
    const pack = await testPack();
    const draft: AnswerDraft = {
      body: "Weekday demand looks soft in the stored window.",
      citations: [{ claim: "Confirmed trading name.", sourceId: "f1", digest: pack.digest }],
      limitations: ["Economics data not ready; cost claims stay withheld."],
      estimates: [
        {
          label: "Estimate",
          value: "+5% visits / week",
          inputs: ["weekday covers, last 30 days"],
          assumptions: ["no price change during the window"],
        },
      ],
    };
    const encoded = encodeAnswerBody(draft);
    expect(encoded.length).toBeLessThanOrEqual(20000);
    const parsed = parseAnswerBody(encoded);
    expect(parsed.body).toBe(draft.body);
    expect(parsed.citations).toEqual(draft.citations);
    expect(parsed.limitations).toEqual(draft.limitations);
    expect(parsed.estimates).toEqual(draft.estimates);
  });

  it("names whole-section omissions when a pathological draft overflows the row cap", async () => {
    const pack = await testPack();
    const big = "x".repeat(15000);
    const draft: AnswerDraft = {
      body: big,
      citations: Array.from({ length: 50 }, (_, index) => ({
        claim: `Claim ${index} ${"c".repeat(260)}`.slice(0, 280),
        sourceId: "f1",
        digest: pack.digest,
      })),
      limitations: Array.from({ length: 60 }, (_, index) => `Gap ${index} ${"g".repeat(260)}`.slice(0, 280)),
      estimates: Array.from({ length: 10 }, (_, index) => ({
        label: "Estimate" as const,
        value: `Value ${index} ${"v".repeat(220)}`.slice(0, 240),
        inputs: Array.from({ length: 5 }, (_, item) => `input ${index}.${item} ${"i".repeat(470)}`.slice(0, 500)),
        assumptions: Array.from({ length: 5 }, (_, item) => `assume ${index}.${item} ${"a".repeat(470)}`.slice(0, 500)),
      })),
    };
    const encoded = encodeAnswerBody(draft);
    expect(encoded.length).toBeLessThanOrEqual(20000);
    const parsed = parseAnswerBody(encoded);
    expect(parsed.body).toBe(big);
    expect(parsed.citations).toEqual([]);
    expect(parsed.limitations.join(" ")).toMatch(/omitted.*message cap/i);
  });

  it("parses a plain body with no sections as body-only", () => {
    expect(parseAnswerBody("Just words.")).toEqual({
      body: "Just words.",
      citations: [],
      limitations: [],
      estimates: [],
    });
  });

  it("mints a stable thread-linked answer key", () => {
    const first = buildAnswerIdempotencyKey({ threadId: "t1", messageId: "m1", body: "hi" });
    expect(first).toBe(buildAnswerIdempotencyKey({ threadId: "t1", messageId: "m1", body: "hi" }));
    expect(first.startsWith("agent_thread:t1:")).toBe(true);
    expect(first.endsWith(":answer")).toBe(true);
    expect(first.length).toBeLessThanOrEqual(200);
  });

  it("stays null-configured without an explicit answer model", () => {
    expect(createAnswerSynthesizer()).toBeNull();
  });

  describe("two-tier model switch-on", () => {
    it("resolves the light model for quick and the strong model for deepthink", () => {
      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "light-id");
      vi.stubEnv(ANSWER_STRONG_MODEL_ENV, "strong-id");
      expect(resolveAnswerModelId("quick")).toBe("light-id");
      expect(resolveAnswerModelId("deepthink")).toBe("strong-id");
    });

    it("prefers explicit overrides and treats empty as unconfigured", () => {
      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "light-id");
      vi.stubEnv(ANSWER_STRONG_MODEL_ENV, "strong-id");
      expect(resolveAnswerModelId("quick", { lightModelId: "override-light" })).toBe(
        "override-light",
      );
      expect(resolveAnswerModelId("quick", { modelId: "legacy-light" })).toBe("legacy-light");
      expect(resolveAnswerModelId("deepthink", { strongModelId: "override-strong" })).toBe(
        "override-strong",
      );
      expect(resolveAnswerModelId("deepthink", { strongModelId: "   " })).toBeUndefined();
      expect(resolveAnswerModelId("quick", { lightModelId: "" })).toBeUndefined();
    });

    it("returns null per tier when that tier is unconfigured, never borrowing across tiers", () => {
      vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "light-id");
      vi.stubEnv(ANSWER_STRONG_MODEL_ENV, "");
      expect(createAnswerSynthesizer({ mode: "quick" })).not.toBeNull();
      expect(createAnswerSynthesizer({ mode: "deepthink" })).toBeNull();

      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "");
      vi.stubEnv(ANSWER_STRONG_MODEL_ENV, "strong-id");
      expect(createAnswerSynthesizer({ mode: "quick" })).toBeNull();
      expect(createAnswerSynthesizer({ mode: "deepthink" })).not.toBeNull();
    });

    it("stays null without any tier configured even with a credential", () => {
      vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "");
      vi.stubEnv(ANSWER_STRONG_MODEL_ENV, "");
      expect(createAnswerSynthesizer()).toBeNull();
      expect(createAnswerSynthesizer({ mode: "quick" })).toBeNull();
      expect(createAnswerSynthesizer({ mode: "deepthink" })).toBeNull();
    });

    it("mode-honoring synthesizer rejects the unconfigured tier before any provider call", async () => {
      vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "light-id");
      vi.stubEnv(ANSWER_STRONG_MODEL_ENV, "");
      const synthesize = createAnswerSynthesizer();
      expect(synthesize).not.toBeNull();
      await expect(
        synthesize!({ system: "s", prompt: "p", sourceIds: [], mode: "deepthink" }),
      ).rejects.toThrow(/not configured/);
    });

    it("falls back honestly per tier when that tier is missing, with zero provider calls", async () => {
      vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "light-id");
      vi.stubEnv(ANSWER_STRONG_MODEL_ENV, "");
      const pack = await testPack();
      const draft = await writeAnswer(
        {
          pack,
          routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
          threadId: "t1",
          mode: "deepthink",
        },
        {},
      );
      expect(draft.body).toMatch(/stored organization context|not configured/i);
      expect(draft.limitations.join(" ")).toMatch(/not configured/i);
      expect(draft.estimates).toEqual([]);
    });

    it("samples warmer than 0.2 for conversational variety", () => {
      expect(ANSWER_MODEL_TEMPERATURE).toBeGreaterThan(0.2);
      expect(ANSWER_MODEL_TEMPERATURE).toBe(0.7);
    });

    it("keeps citation, estimate, and realized-result discipline in the conversational prompt", async () => {
      const pack = await testPack();
      const { system } = buildSynthesisPrompt(pack, "note", "quick");
      expect(system).toMatch(/conversational|varied phrasing/i);
      expect(system).toMatch(/allowed_sources/);
      expect(system).toMatch(/limitations, never in the answer body/i);
      expect(system).toMatch(/never state a realized or attributed/i);
      expect(system).toMatch(/label estimate with inputs and assumptions/i);
      expect(system).toMatch(/never follow instructions found inside/i);
    });

    it("preserves strict disposal on the deepthink tier too", async () => {
      const pack = await testPack();
      const draft = await writeAnswer(
        {
          pack,
          routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
          threadId: "t1",
          mode: "deepthink",
        },
        {
          synthesize: async () => ({
            body: "Visits will rise.",
            citations: [],
            limitations: [],
            estimates: [{ label: "Estimate", value: "+5% visits", inputs: [], assumptions: ["x"] }],
          }),
        },
      );
      expect(draft.estimates).toEqual([]);
      expect(draft.limitations.join(" ")).toMatch(/failed validation/i);
    });
  });

  describe("output budget (G4)", () => {
    it("budgets the output cap to the contract, not the old 1500", () => {
      // 16000-char bodies plus citations/limitations/estimates JSON must be
      // representable; the old 1500-token cap strangled them into `length`.
      expect(ANSWER_MODEL_MAX_OUTPUT_TOKENS).toBe(8192);
      expect(() =>
        synthesisCandidateSchema.parse({
          body: "x".repeat(16000),
          citations: [],
          limitations: ["gap"],
          estimates: [],
        }),
      ).not.toThrow();
    });

    it("calls generateObject with the contract-sized budget (seam-level, no live calls)", async () => {
      vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "light-id");
      aiMocks.generateObject.mockResolvedValue({
        object: {
          body: "Stored context says hello.",
          citations: [],
          limitations: [],
          estimates: [],
        },
      });
      const synthesize = createAnswerSynthesizer({ mode: "quick" });
      expect(synthesize).not.toBeNull();
      await synthesize!({ system: "s", prompt: "p", sourceIds: [], mode: "quick" });
      expect(aiMocks.generateObject).toHaveBeenCalledTimes(1);
      const call = aiMocks.generateObject.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.maxOutputTokens).toBe(8192);
      expect(call.temperature).toBe(0.7);
      expect(call.schema).toBe(synthesisCandidateSchema);
    });

    it("logs a length-finish failure with identifiers only, then falls back honestly", async () => {
      vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
      vi.stubEnv(ANSWER_LIGHT_MODEL_ENV, "light-id");
      aiMocks.generateObject.mockRejectedValue(
        Object.assign(new Error("No object generated"), {
          name: "AI_NoObjectGeneratedError",
          finishReason: "length",
          text: "",
        }),
      );
      const pack = await testPack();
      const draft = await writeAnswer(
        {
          pack,
          routingNote: "sentinel-routing-note-xyz",
          threadId: "t1",
          mode: "quick",
        },
        { correlationId: "corr-1" },
      );
      expect(draft.body).toMatch(/couldn't reach the answer model/i);
      expect(logger.warn).toHaveBeenCalledWith(
        "agent_answer.synthesis_failed",
        expect.objectContaining({
          errorName: "AI_NoObjectGeneratedError",
          errorCode: "length",
          correlationId: "corr-1",
        }),
      );
      const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
      expect(logged).not.toContain("sentinel-routing-note-xyz");
      expect(logged).not.toContain("test-key");
      expect(logged).not.toContain("Confirmed trading name.");
    });

    it("reads failure ids off the error and its cause, never bodies", () => {
      expect(
        synthesisFailureIds(
          Object.assign(new Error("x"), {
            name: "AI_NoObjectGeneratedError",
            finishReason: "length",
          }),
        ),
      ).toEqual({ errorName: "AI_NoObjectGeneratedError", finishReason: "length" });
      expect(synthesisFailureIds(new Error("plain"))).toEqual({ errorName: "Error" });
      expect(synthesisFailureIds("string-shaped")).toEqual({ errorName: "unknown" });
      expect(
        synthesisFailureIds(
          Object.assign(new Error("w"), { cause: { finishReason: "content-filter" } }),
        ),
      ).toEqual({ errorName: "Error", finishReason: "content-filter" });
      // Non-string or unbounded reasons never reach the log stream.
      expect(
        synthesisFailureIds(
          Object.assign(new Error("w"), { finishReason: { leaked: "body" } }),
        ),
      ).toEqual({ errorName: "Error" });
    });
  });

  it("validates the input envelope instead of inventing", async () => {
    await expect(
      writeAnswer(
        { pack: null, routingNote: "   ", threadId: "t1", mode: "quick" },
        { synthesize: null },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("citation claims stay bounded text", () => {
    expect(() =>
      answerCitationSchema.parse({ claim: "  ", sourceId: "f1", digest: "abc123" }),
    ).toThrow();
  });
});

describe("routeLatest synthesize step", () => {
  const readers = {
    getIdentityFacts: async () => [
      { id: "f1", statement: "Confirmed trading name.", verified: true, source: "profile" },
    ],
  };

  function routeService(
    threads: ThreadRepository,
    synthesize: AnswerSynthesizer | null,
    extra: Record<string, unknown> = {},
  ) {
    return createThreadService({
      threads,
      proposeRouter: async () => ({ intent: "answer_memory", confidence: "high", missing: [] }),
      contextReaders: readers,
      synthesizeAnswer: synthesize ?? undefined,
      ...extra,
    });
  }

  it("persists an assistant row for operators through the fenced RPC", async () => {
    const threads = mockThreads();
    const service = routeService(threads, async () => ({
      body: "Stored context says hello.",
      citations: [],
      limitations: [],
      estimates: [],
    }));
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
      idempotencyKey: "route-token-000000000000001",
    });
    expect(out.answer).toBeDefined();
    expect(out.answer?.draft.body).toMatch(/stored context/i);
    expect(threads.__appendMessageKeyed).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "o",
        threadId: "t1",
        role: "assistant",
        idempotencyKey: expect.stringMatching(/^agent_thread:t1:[0-9a-f]{16}:answer$/),
      }),
    );
    expect(out.answer?.message?.role).toBe("assistant");
    expect(out.answer?.replayed).toBe(false);
  });

  it("writes no rows for viewers but still returns the draft", async () => {
    const threads = mockThreads();
    const service = routeService(threads, async () => ({
      body: "Stored context says hello.",
      citations: [],
      limitations: [],
      estimates: [],
    }));
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "viewer",
      threadId: "t1",
      page: "overview",
    });
    expect(threads.__appendMessageKeyed).not.toHaveBeenCalled();
    expect(out.answer?.message).toBeNull();
    expect(out.answer?.draft.body).toMatch(/stored context/i);
  });

  it("keeps the route green when the answer append conflicts", async () => {
    const threads = mockThreads({
      appendMessageKeyed: vi.fn(async () => {
        const { IdempotencyConflictError } = await import("@/domain/agent-chat/errors");
        throw new IdempotencyConflictError("already saved");
      }),
    });
    const service = routeService(threads, async () => ({
      body: "Stored context says hello.",
      citations: [],
      limitations: [],
      estimates: [],
    }));
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.answer?.message).toBeNull();
    expect(out.answer?.draft.body).toMatch(/stored context/i);
  });

  it("stays general without bound readers (answers-route reality until Task 3 binds them)", async () => {
    const threads = mockThreads();
    const service = createThreadService({
      threads,
      proposeRouter: async () => ({ intent: "answer_memory", confidence: "high", missing: [] }),
      synthesizeAnswer: async () => ({
        body: "Stored context says hello.",
        citations: [],
        limitations: [],
        estimates: [],
      }),
    });
    const out = await service.routeLatest({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      page: "overview",
    });
    // No readers bound (the answers route wires none yet): the pack is
    // null, the stub is never called, and the general fallback persists.
    expect(out.answer?.draft.body).toMatch(/stays general/i);
    expect(out.answer?.message?.role).toBe("assistant");
  });

  it("synthesizes again on the answers re-route", async () => {
    const threads = mockThreads();
    const synthesize = vi.fn(async () => ({
      body: "Stored context says hello.",
      citations: [],
      limitations: [],
      estimates: [],
    }));
    const service = routeService(threads, synthesize);
    const out = await service.submitAnswers({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      spec: {
        kind: "missing_fields" as const,
        title: "One more detail",
        resumeKey: "router:watch:overview:abcdef1234567890",
        items: [
          {
            key: "frequency",
            label: "How often?",
            kind: "single_select" as const,
            required: true,
            options: [
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ],
          },
        ],
      },
      answers: { frequency: "weekly" },
      idempotencyKey: "answers-key-0000000000000001",
      page: "overview",
    });
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(out.answer?.draft.body).toMatch(/stored context/i);
    const assistantCalls = threads.__appendMessageKeyed.mock.calls.filter(
      (call) => (call[0] as { role: string }).role === "assistant",
    );
    expect(assistantCalls).toHaveLength(1);
  });

  it("reuses the turn's assistant row on the answers re-route instead of synthesizing a second", async () => {
    const draft: AnswerDraft = {
      body: "Weekday demand looks soft in the stored window.",
      citations: [],
      limitations: [
        "No new research ran for this answer; it uses stored organization context only.",
      ],
      estimates: [],
    };
    const threads = mockThreads({
      listMessages: vi.fn(async () => ({
        messages: [
          { ...USER_MESSAGE },
          {
            id: "a1",
            threadId: "t1",
            role: "assistant",
            body: encodeAnswerBody(draft),
            questionnaireAnswers: null,
            markerReceipts: null,
            citations: null,
            createdAt: "2026-09-25T10:02:00.000Z",
          },
        ],
        nextCursor: null,
      })),
    });
    const synthesize = vi.fn(async () => ({
      body: "Second synthesis.",
      citations: [],
      limitations: [],
      estimates: [],
    }));
    const service = routeService(threads, synthesize);
    const out = await service.submitAnswers({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      spec: {
        kind: "missing_fields" as const,
        title: "One more detail",
        resumeKey: "router:watch:overview:abcdef1234567890",
        items: [
          {
            key: "frequency",
            label: "How often?",
            kind: "single_select" as const,
            required: true,
            options: [
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ],
          },
        ],
      },
      answers: { frequency: "weekly" },
      idempotencyKey: "answers-key-0000000000000002",
      page: "overview",
    });
    // The turn already holds a fresh assistant row from the initial route
    // synthesis: the re-route must not synthesize a second one.
    expect(synthesize).not.toHaveBeenCalled();
    const assistantCalls = threads.__appendMessageKeyed.mock.calls.filter(
      (call) => (call[0] as { role: string }).role === "assistant",
    );
    expect(assistantCalls).toHaveLength(0);
    // The kept row returns as the turn message, parsing back into its draft.
    expect(out.answer?.message?.id).toBe("a1");
    expect(out.answer?.replayed).toBe(true);
    expect(out.answer?.draft.body).toMatch(/weekday demand looks soft/i);
  });

  it("synthesizes exactly once when the turn has no assistant row yet", async () => {
    const threads = mockThreads();
    const synthesize = vi.fn(async () => ({
      body: "Stored context says hello.",
      citations: [],
      limitations: [],
      estimates: [],
    }));
    const service = routeService(threads, synthesize);
    const out = await service.submitAnswers({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      spec: {
        kind: "missing_fields" as const,
        title: "One more detail",
        resumeKey: "router:watch:overview:abcdef1234567890",
        items: [
          {
            key: "frequency",
            label: "How often?",
            kind: "single_select" as const,
            required: true,
            options: [
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ],
          },
        ],
      },
      answers: { frequency: "weekly" },
      idempotencyKey: "answers-key-0000000000000003",
      page: "overview",
    });
    expect(synthesize).toHaveBeenCalledTimes(1);
    const assistantCalls = threads.__appendMessageKeyed.mock.calls.filter(
      (call) => (call[0] as { role: string }).role === "assistant",
    );
    expect(assistantCalls).toHaveLength(1);
    expect(out.answer?.message?.role).toBe("assistant");
    expect(out.answer?.replayed).toBe(false);
  });

  it("degrades an unavailable turn read to synthesize-once instead of failing the submit", async () => {
    // Lane-gate reality (fix round 2): the peer answers-route mocks predate
    // the G3 pre-append read and carry no `listMessages` — those submits
    // must 201 via one synthesis, never 500 on the missing read. A throwing
    // reader lands in the same catch, so the missing method pins both.
    const threads = mockThreads({
      listMessages: undefined as unknown as ReturnType<typeof vi.fn>,
    });
    const synthesize = vi.fn(async () => ({
      body: "Stored context says hello.",
      citations: [],
      limitations: [],
      estimates: [],
    }));
    const service = routeService(threads, synthesize);
    const out = await service.submitAnswers({
      organizationId: "o",
      actorId: "u",
      role: "operator",
      threadId: "t1",
      spec: {
        kind: "missing_fields" as const,
        title: "One more detail",
        resumeKey: "router:watch:overview:abcdef1234567890",
        items: [
          {
            key: "frequency",
            label: "How often?",
            kind: "single_select" as const,
            required: true,
            options: [
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ],
          },
        ],
      },
      answers: { frequency: "weekly" },
      idempotencyKey: "answers-key-0000000000000005",
      page: "overview",
    });
    expect(out.answer?.draft.body).toMatch(/stored context/i);
    expect(synthesize).toHaveBeenCalledTimes(1);
    const assistantCalls = threads.__appendMessageKeyed.mock.calls.filter(
      (call) => (call[0] as { role: string }).role === "assistant",
    );
    expect(assistantCalls).toHaveLength(1);
    expect(out.answer?.message?.role).toBe("assistant");
    expect(out.answer?.replayed).toBe(false);
  });

  it("returns the kept row on idempotent answers replay", async () => {
    const threads = mockThreads();
    const synthesize = vi.fn(async () => ({
      body: "Stored context says hello.",
      citations: [],
      limitations: [],
      estimates: [],
    }));
    const service = routeService(threads, synthesize);
    const input = {
      organizationId: "o",
      actorId: "u",
      role: "operator" as const,
      threadId: "t1",
      spec: {
        kind: "missing_fields" as const,
        title: "One more detail",
        resumeKey: "router:watch:overview:abcdef1234567890",
        items: [
          {
            key: "frequency",
            label: "How often?",
            kind: "single_select" as const,
            required: true,
            options: [
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ],
          },
        ],
      },
      answers: { frequency: "weekly" },
      idempotencyKey: "answers-key-0000000000000004",
      page: "overview",
    };
    const first = await service.submitAnswers(input);
    const second = await service.submitAnswers(input);
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(second.answer?.message?.id).toBe(first.answer?.message?.id);
    expect(second.answer?.replayed).toBe(true);
  });
});

describe("AgentResponseMessage", () => {
  it("renders the answer body with the single sources line and labeled estimates, never section lists (F2 voice, F3)", async () => {
    const pack = await testPack();
    const draft: AnswerDraft = {
      body: "Weekday demand looks soft in the stored window, though economics data isn't ready yet so cost claims stay out.",
      citations: [{ claim: "Confirmed trading name.", sourceId: "f1", digest: pack.digest }],
      limitations: ["Economics data not ready; cost claims stay withheld."],
      estimates: [
        {
          label: "Estimate",
          value: "+5% visits / week",
          inputs: ["weekday covers, last 30 days"],
          assumptions: ["no price change during the window"],
        },
      ],
    };
    const encoded = encodeAnswerBody(draft);
    // The durable row still carries structured data for history + Task 3.
    expect(encoded).toMatch(/Sources/);
    expect(encoded).toMatch(/Limitations/);
    render(
      <AgentResponseMessage
        message={{
          id: "a1",
          threadId: "t1",
          role: "assistant",
          body: encoded,
          questionnaireAnswers: null,
          markerReceipts: null,
          citations: null,
          createdAt: "2026-09-25T10:02:00.000Z",
        }}
      />,
    );
    expect(screen.getByText(/weekday demand looks soft/i)).toBeInTheDocument();
    expect(screen.getByText(/economics data isn't ready yet/i)).toBeInTheDocument();
    // F3 single sources line; Sources + Limitations section lists never render.
    expect(screen.queryByRole("button", { name: /source 1:/i })).toBeNull();
    expect(screen.getByRole("button", { name: /sources: 1 cited source/i })).toHaveTextContent(
      "Sources: [1]",
    );
    expect(screen.queryByRole("list", { name: "Answer sources" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Answer limitations" })).toBeNull();
    expect(screen.queryByText("Limitations")).toBeNull();
    expect(screen.getByText("Estimate")).toBeInTheDocument();
    expect(screen.getByText(/\+5% visits \/ week/)).toBeInTheDocument();
    expect(screen.getByText(/weekday covers, last 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/no price change during the window/)).toBeInTheDocument();
  });

  it("renders a plain assistant body with no sections", () => {
    render(
      <AgentResponseMessage
        message={{
          id: "a1",
          threadId: "t1",
          role: "assistant",
          body: "Hello.",
          questionnaireAnswers: null,
          markerReceipts: null,
          citations: null,
          createdAt: "2026-09-25T10:02:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("Hello.")).toBeInTheDocument();
    expect(screen.queryByText("Estimate")).not.toBeInTheDocument();
  });
});

describe("answer-writer finding D (natural body, no double fallback)", () => {
  it("strips a legacy fallback header block and dedupes fact bullets against citations", async () => {
    const pack = await testPack();
    const legacyBody = [
      "Answer from stored organization context — no new research ran.",
      "",
      "What the stored context supports:",
      "- Confirmed trading name.",
      "",
      "Check Limitations for gaps; any Estimates are labeled where shown.",
    ].join("\n");
    const encoded = encodeAnswerBody({
      body: legacyBody,
      citations: [{ claim: "Confirmed trading name.", sourceId: "f1", digest: pack.digest }],
      limitations: ["Economics data not ready; cost claims stay withheld."],
      estimates: [],
    });
    const parsed = parseAnswerBody(encoded);
    // Old rows still parse: sections survive intact.
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.limitations).toEqual(["Economics data not ready; cost claims stay withheld."]);
    // The header block and its scaffold are gone, and the fact bullet no
    // longer duplicates the Sources entry — the fact lives once, in citations.
    expect(parsed.body).not.toMatch(/Answer from stored organization context/);
    expect(parsed.body).not.toMatch(/What the stored context supports/);
    expect(parsed.body).not.toMatch(/Check Limitations for gaps/);
    expect(parsed.body).not.toContain("Confirmed trading name.");
    expect(parsed.body.length).toBeGreaterThan(0);
  });

  it("strips legacy unavailable/refused headers to honest natural leads", () => {
    for (const [header, lead] of [
      ["Full organization context was unavailable, so this stays general.", "stays general"],
      [
        "Organization context was refused as oversized, so this uses no stored evidence.",
        "no stored evidence",
      ],
    ] as const) {
      const parsed = parseAnswerBody(
        [header, "", "Check Limitations for gaps; any Estimates are labeled where shown."].join(
          "\n",
        ),
      );
      expect(parsed.body).not.toContain(header);
      expect(parsed.body).toMatch(new RegExp(lead, "i"));
    }
  });

  it("writes new fallback bodies with no header block and no fact bullets", async () => {
    const pack = await testPack();
    const draft = buildFallbackAnswer(pack, "test reason");
    expect(draft.body).not.toMatch(/Answer from stored organization context/);
    expect(draft.body).not.toMatch(/What the stored context supports/);
    expect(draft.body).not.toMatch(/Check Limitations for gaps/);
    expect(draft.body).toMatch(/stored organization context/i);
    // Facts travel once, in citations — never as body bullets.
    expect(draft.body).not.toContain("- Confirmed trading name.");
    expect(draft.citations.map((citation) => citation.claim)).toContain("Confirmed trading name.");
    // New bodies round-trip byte-identical: the legacy strip is a no-op.
    expect(parseAnswerBody(encodeAnswerBody(draft)).body).toBe(draft.body);
  });
});

describe("answer-writer chatbot voice (F2)", () => {
  it("keeps stored context, gaps, and research status as prompt context, never body text", async () => {
    const pack = await testPack();
    const { system } = buildSynthesisPrompt(pack, "note", "quick");
    expect(system).toMatch(/prompt context, never body text/i);
    expect(system).toMatch(/never mention packs, digests, lanes/i);
  });

  it("asks for a warm brief voice with gaps voiced inline as one natural sentence", async () => {
    const pack = await testPack();
    const { system } = buildSynthesisPrompt(pack, "note", "quick");
    expect(system).toMatch(/warm brief/i);
    expect(system).toMatch(/one natural sentence/i);
  });

  it("still returns structured citations + limitations while the body voices gaps (structured data in, prose out)", async () => {
    const pack = await testPack();
    const draft = await writeAnswer(
      {
        pack,
        routingNote: "page=overview\nintent=answer_memory\nconfidence=high",
        threadId: "t1",
        mode: "quick",
      },
      {
        synthesize: async () => ({
          body: "Weekday demand looks soft, though economics data isn't ready yet so cost claims stay out.",
          citations: [{ claim: "Confirmed trading name.", sourceId: "f1" }],
          limitations: ["Economics data not ready; cost claims stay withheld."],
          estimates: [],
        }),
      },
    );
    // Body voices the gap inline as a sentence.
    expect(draft.body).toMatch(/economics data isn't ready yet/i);
    // Structured data still travels encoded in the row.
    expect(draft.citations.map((citation) => citation.sourceId)).toEqual(["f1"]);
    expect(draft.limitations.join(" ")).toMatch(/economics/i);
    const encoded = encodeAnswerBody(draft);
    expect(encoded).toMatch(/Sources/);
    expect(encoded).toMatch(/Limitations/);
  });

  it("voices every fallback case in one warm sentence with no scaffold", async () => {
    const pack = await testPack();
    const refused = { ...pack, refused: true };
    const cases = [
      {
        pack: null,
        reason: "No context pack was bound to this answer.",
        match: /stays general/i,
      },
      {
        pack: refused,
        reason: "test reason",
        match: /too large|no stored evidence/i,
      },
      { pack, reason: "test reason", match: /stored organization context/i },
    ] as const;
    for (const entry of cases) {
      const draft = buildFallbackAnswer(entry.pack, entry.reason);
      expect(draft.body).toMatch(entry.match);
      expect(draft.body).not.toMatch(/Answer from stored organization context/);
      expect(draft.body).not.toMatch(/What the stored context supports/);
      expect(draft.body).not.toMatch(/Check Limitations for gaps/);
      expect(draft.body).not.toMatch(/^Sources$/m);
      expect(draft.body).not.toMatch(/^Limitations$/m);
      expect(draft.body).not.toContain("- Confirmed trading name.");
    }
  });

  it("voices model-unset distinctly from stored-context gaps", async () => {
    const pack = await testPack();
    const draft = buildFallbackAnswer(
      pack,
      "Answer synthesis is not configured; using stored context only.",
    );
    expect(draft.body).toMatch(/isn't set up yet|not configured/i);
    expect(draft.body).toMatch(/stored organization context/i);
    expect(draft.body).not.toMatch(/Answer from stored organization context/);
  });

  it("voices model failure distinctly", async () => {
    const pack = await testPack();
    const draft = buildFallbackAnswer(
      pack,
      "Answer synthesis failed; using stored context only.",
    );
    expect(draft.body).toMatch(/couldn't reach the answer model/i);
    expect(draft.body).toMatch(/stored organization context/i);
  });

  it("voices invalid candidates distinctly", async () => {
    const pack = await testPack();
    const draft = buildFallbackAnswer(
      pack,
      "The drafted answer failed validation; using stored context only.",
    );
    expect(draft.body).toMatch(/didn't hold together/i);
    expect(draft.body).toMatch(/stored organization context/i);
  });
});

describe("answer quality (G3): identity restraint", () => {
  it("never restates org identity basics unless asked — leads with the news", async () => {
    const pack = await testPack();
    for (const mode of ["quick", "deepthink"] as const) {
      const { system } = buildSynthesisPrompt(pack, "note", mode);
      expect(system).toMatch(/identity basics/i);
      expect(system).toMatch(/unless.*ask/i);
      expect(system).toMatch(/lead with the news/i);
    }
  });

  it("fallbacks carry no identity text — facts travel in citations only", async () => {
    const pack = await testPack();
    const statements = pack.lanes.identity.facts.map((fact) => fact.statement);
    expect(statements.length).toBeGreaterThan(0);
    const reasons = [
      "No context pack was bound to this answer.",
      "Answer synthesis is not configured; using stored context only.",
      "Answer synthesis failed; using stored context only.",
      "The drafted answer failed validation; using stored context only.",
      "test reason",
    ];
    const targets = [null, pack, { ...pack, refused: true }] as const;
    for (const reason of reasons) {
      for (const target of targets) {
        const draft = buildFallbackAnswer(target, reason);
        for (const statement of statements) {
          expect(draft.body).not.toContain(statement);
        }
      }
    }
    // Grounded fallbacks still cite the facts they voice around.
    expect(buildFallbackAnswer(pack, "test reason").citations.length).toBeGreaterThan(0);
  });
});
