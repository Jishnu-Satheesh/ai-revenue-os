import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateText = vi.fn();
const languageModel = vi.fn((id: string) => ({ id }));

vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateText(...args) }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => languageModel,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  createResearchModelTransport,
  RESEARCH_MODEL_TRANSPORT_TIMEOUT_MS,
} from "@/modules/growth-intelligence/infrastructure/research/research-model-transport";

const API_KEY = "research-test-key-never-sent-live";
const MODEL_ID = "gemini-research-test";

function openGate() {
  return { isAvailable: () => true };
}

function closedGate() {
  return { isAvailable: () => false };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("research model transport wired path", () => {
  it("calls the Google backend through the established bounded pattern", async () => {
    generateText.mockResolvedValueOnce({ text: "[]" });
    const transport = createResearchModelTransport({
      modelId: MODEL_ID,
      apiKey: API_KEY,
      gate: openGate(),
    });

    const result = await transport.complete({
      phase: "extraction",
      prompt: '{"phase":"extraction"}',
      maxInputTokens: 12_000,
      maxOutputTokens: 4_000,
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    const call = generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({
      model: { id: MODEL_ID },
      temperature: 0.1,
      maxOutputTokens: 4_000,
    });
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(typeof call.system).toBe("string");
    expect(call.prompt).toBe('{"phase":"extraction"}');
    expect(result.text).toBe("[]");
    expect(result.usage).toEqual({ kind: "unknown" });
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(RESEARCH_MODEL_TRANSPORT_TIMEOUT_MS).toBe(90_000);
  });

  it("clamps output tokens to the caller budget instead of widening bounds", async () => {
    generateText.mockResolvedValueOnce({ text: "[]" });
    const transport = createResearchModelTransport({
      modelId: MODEL_ID,
      apiKey: API_KEY,
      gate: openGate(),
    });

    await transport.complete({
      phase: "support_review",
      prompt: '{"phase":"support_review"}',
      maxInputTokens: 12_000,
      maxOutputTokens: 1_000,
    });

    const call = generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({ maxOutputTokens: 1_000 });
  });
});

describe("research model transport fail-closed refusals", () => {
  it("refuses a closed gate without calling the model backend", async () => {
    const transport = createResearchModelTransport({
      modelId: MODEL_ID,
      apiKey: API_KEY,
      gate: closedGate(),
    });

    await expect(
      transport.complete({
        phase: "extraction",
        prompt: '{"phase":"extraction"}',
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      transport.complete({
        phase: "extraction",
        prompt: '{"phase":"extraction"}',
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses a missing credential without calling the model backend", async () => {
    const transport = createResearchModelTransport({
      modelId: MODEL_ID,
      apiKey: "   ",
      gate: openGate(),
    });

    await expect(
      transport.complete({
        phase: "extraction",
        prompt: '{"phase":"extraction"}',
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses a missing model id without calling the model backend", async () => {
    const transport = createResearchModelTransport({
      modelId: "  ",
      apiKey: API_KEY,
      gate: openGate(),
    });

    await expect(
      transport.complete({
        phase: "support_review",
        prompt: '{"phase":"support_review"}',
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("maps a backend outage to a safe integration error without leaking detail", async () => {
    generateText.mockRejectedValueOnce(new Error("503 echoed secret input"));
    const transport = createResearchModelTransport({
      modelId: MODEL_ID,
      apiKey: API_KEY,
      gate: openGate(),
    });

    await expect(
      transport.complete({
        phase: "extraction",
        prompt: '{"phase":"extraction"}',
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
      }),
    ).rejects.toMatchObject({ name: "DomainError", code: "INTEGRATION_ERROR" });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("emits an attributed per-phase log with identifiers and codes but never the secret", async () => {
    const organizationId = "10000000-0000-4000-8000-000000000001";
    const correlationId = "60000000-0000-4000-8000-000000000006";
    generateText.mockRejectedValueOnce(new Error("boom with secret input"));
    const transport = createResearchModelTransport({
      modelId: MODEL_ID,
      apiKey: API_KEY,
      gate: openGate(),
      logging: { organizationId, correlationId },
    });

    await expect(
      transport.complete({
        phase: "support_review",
        prompt: '{"phase":"support_review"}',
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, context] = vi.mocked(logger.error).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toBe("growth_intelligence.research_support_review_failed");
    expect(context).toEqual({ organizationId, correlationId, errorCode: "Error" });
    const serialized = JSON.stringify([message, context]);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain('{"phase":"support_review"}');
    expect(serialized).not.toContain("boom with secret input");
  });

  it("names the extraction phase in its failure event with only the available keys", async () => {
    generateText.mockRejectedValueOnce(new Error("socket hang up"));
    const transport = createResearchModelTransport({
      modelId: MODEL_ID,
      apiKey: API_KEY,
      gate: openGate(),
    });

    await expect(
      transport.complete({
        phase: "extraction",
        prompt: '{"phase":"extraction"}',
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });

    const [message, context] = vi.mocked(logger.error).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toBe("growth_intelligence.research_extraction_failed");
    expect(context).toEqual({ errorCode: "Error" });
  });

  it("fails the extraction batch closed with unknown-cost accounting, never a worker throw", async () => {
    const { extractResearchClaims } = await import(
      "@/modules/growth-intelligence/infrastructure/research/claim-extraction"
    );
    const transport = createResearchModelTransport({
      modelId: MODEL_ID,
      apiKey: API_KEY,
      gate: closedGate(),
    });
    const reserve = vi.fn(async () => ({
      attemptId: "10000000-0000-4000-8000-000000000001",
    }));
    const settle = vi.fn(async () => {});

    const result = await extractResearchClaims({
      scope: {
        publicBusinessName: "Harbor Eats",
        approvedDomains: ["harboreats.example"],
        niches: ["Seafood"],
        city: "Dubai",
        countryCode: "AE",
        topics: ["weekend footfall"],
        competitors: [],
      },
      sources: [
        {
          sourceKey: "src-0-aabbccddeeff",
          sourceUrl: "https://tourism.example/dubai-notice",
          excerptText: "Harbor Eats saw record weekend footfall near the marina promenade.",
          excerptDigest: "a".repeat(64),
          retrievedAt: "2026-09-01T10:00:00Z",
        },
      ],
      budget: {
        phase: "extraction",
        maxCalls: 4,
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
        maxSourcesPerBatch: 10,
      },
      transport,
      spender: { reserve, settle },
      modelId: MODEL_ID,
    });

    expect(result.candidates).toEqual([]);
    expect(result.batchesFailed).toBeGreaterThan(0);
    expect(result.usages).toEqual([{ kind: "unknown" }]);
    expect(settle).toHaveBeenCalledWith({
      attemptId: "10000000-0000-4000-8000-000000000001",
      usage: { kind: "unknown" },
    });
  });
});
