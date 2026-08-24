import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateText = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateText(...args),
}));

const languageModel = vi.fn((id: string) => ({ id }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => languageModel,
}));

vi.mock("@/lib/env", () => ({
  env: {
    GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
    RECOMMENDATION_TEXT_MODEL: "gemini-narration",
  },
}));

import {
  createRecommendationGenerationProvider,
  extractJsonText,
} from "@/modules/analysis/infrastructure/recommendation-generation-provider";

function lastTextCall() {
  return generateText.mock.calls.at(-1)?.[0] as {
    model: { id: string };
    system: string;
    prompt: string;
    abortSignal: AbortSignal;
  };
}

beforeEach(() => {
  generateText.mockReset();
  languageModel.mockClear();
});

describe("extractJsonText", () => {
  it("parses bare JSON", () => {
    expect(extractJsonText('{"summary":"ok"}')).toEqual({ summary: "ok" });
    expect(extractJsonText('  {"n":1}  ')).toEqual({ n: 1 });
  });

  it("parses JSON inside a fenced ```json block", () => {
    const fenced = '```json\n{"summary":"framed"}\n```';
    expect(extractJsonText(fenced)).toEqual({ summary: "framed" });
  });

  it("rejects chatty preamble with a domain error instead of guessing", () => {
    expect(() =>
      extractJsonText('Here is your answer!\n```json\n{"a":1}\n```'),
    ).toThrowError(/not usable JSON/);
  });

  it("keeps provider text out of the rejection message", () => {
    const leaky = 'Sorry, the prompt said "secret customer note" so I cannot comply.';
    try {
      extractJsonText(leaky);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("secret customer note");
      expect((error as Error).message).not.toContain("Sorry");
    }
  });
});

describe("recommendation generation provider", () => {
  it("names Google and carries the configured model id", () => {
    const provider = createRecommendationGenerationProvider({ modelId: "gemini-2.0-flash" });
    expect(provider.providerName).toBe("google");
    expect(provider.modelId).toBe("gemini-2.0-flash");
  });

  it("returns the model reply parsed to unknown", async () => {
    generateText.mockResolvedValue({ text: '{"narrative":"A good month."}' });
    const provider = createRecommendationGenerationProvider({ modelId: "gemini-2.0-flash" });

    const output: unknown = await provider.generate("Be factual.", "Narrate January.");
    expect(output).toEqual({ narrative: "A good month." });
  });

  it("sends system and user parts to the configured model under a time budget", async () => {
    generateText.mockResolvedValue({ text: "{}" });
    const provider = createRecommendationGenerationProvider({ modelId: "gemini-2.0-flash" });

    await provider.generate("You narrate results.", "Some evidence.");

    const call = lastTextCall();
    expect(call.model.id).toBe("gemini-2.0-flash");
    expect(call.system).toBe("You narrate results.");
    expect(call.prompt).toBe("Some evidence.");
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("unwraps a fenced JSON answer from the model", async () => {
    generateText.mockResolvedValue({ text: '```json\n{"ok":true}\n```' });
    const provider = createRecommendationGenerationProvider({ modelId: "gemini-2.0-flash" });

    await expect(provider.generate("s", "u")).resolves.toEqual({ ok: true });
  });

  it("turns a non-JSON answer into a domain error, not a parse crash", async () => {
    generateText.mockResolvedValue({ text: "I could not do that." });
    const provider = createRecommendationGenerationProvider({ modelId: "gemini-2.0-flash" });

    await expect(provider.generate("s", "u")).rejects.toThrow(/not usable JSON/);
  });

  it("never lets a provider failure message reach the caller", async () => {
    generateText.mockRejectedValue(new Error("400: prompt contained 'secret customer note'"));
    const provider = createRecommendationGenerationProvider({ modelId: "gemini-2.0-flash" });

    await expect(provider.generate("s", "u")).rejects.toThrow(
      "The generation provider could not complete this request.",
    );
    await expect(provider.generate("s", "u")).rejects.not.toThrow(/secret customer note/);
  });

  it("refuses when no credential is configured", () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({ env: { GOOGLE_GENERATIVE_AI_API_KEY: undefined } }));
    vi.doMock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: () => languageModel }));

    return import(
      "@/modules/analysis/infrastructure/recommendation-generation-provider"
    ).then(({ createRecommendationGenerationProvider: create }) => {
      expect(() => create({ modelId: "gemini-2.0-flash" })).toThrow(
        /No Google Generative AI credential/,
      );
    });
  });
});
