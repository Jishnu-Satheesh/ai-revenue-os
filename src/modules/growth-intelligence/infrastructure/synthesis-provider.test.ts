import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateText = vi.fn();
const languageModel = vi.fn((id: string) => ({ id }));

vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateText(...args) }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => languageModel,
}));
const testEnv = vi.hoisted(() => ({
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key" as string | undefined,
  AI_DEFAULT_MODEL: "gemini-synthesis" as string | undefined,
}));

vi.mock("@/lib/env", () => ({ env: testEnv }));

import {
  buildSynthesisPrompt,
  createFailClosedSynthesisProvider,
  createGoogleSynthesisProvider,
  createSynthesisProvider,
  parseSynthesisOutput,
  SYNTHESIS_MODEL_VERSION,
  SYNTHESIS_PROVIDER_TIMEOUT_MS,
  toCompactSynthesisInput,
} from "@/modules/growth-intelligence/infrastructure/synthesis-provider";

beforeEach(() => {
  vi.clearAllMocks();
  testEnv.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  testEnv.AI_DEFAULT_MODEL = "gemini-synthesis";
});

const findingId = "10000000-0000-4000-8000-000000000001";
const claimId = "20000000-0000-4000-8000-000000000002";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

function compactInput(overrides: Record<string, unknown> = {}) {
  return {
    branchId: null,
    findings: [
      {
        id: findingId,
        digest: digestA,
        code: "DEMAND_SOFTNESS",
        severity: "high",
        headline: "Weekend demand softened across dine-in.",
        limitations: ["PARTIAL_EVIDENCE_WINDOW"],
        analysisRunId: "41000000-0000-4000-8000-000000000040",
        branchId: null,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        currency: "AED",
        valueKind: "money",
        scope: "branch",
        stale: false,
      },
    ],
    claims: [
      {
        id: claimId,
        digest: digestB,
        paraphrase: "A public notice lists a weekend food festival near the trade area.",
        quotation: null,
        geographicLayer: "city",
        geographyRef: "ae:du:dubai",
        supportGrade: "single_source",
        freshness: "current",
        limitations: [],
        researchRunId: "42000000-0000-4000-8000-000000000040",
        branchId: null,
      },
    ],
    goals: [{ ref: "weekend-covers" }],
    profile: {
      approvedName: "Kerala Kitchen",
      niches: ["Kerala cuisine"],
      geographies: [{ layer: "city", ref: "ae:du:dubai", name: "Dubai" }],
      topics: ["Local events"],
    },
    preferences: { pinnedRefs: [] },
    activityMonth: "2026-09",
    businessEvidenceFresh: true,
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    kind: "recommendation",
    narrative: "Prepare additional weekend servings while the festival notice stands.",
    claimIds: [claimId],
    businessFindingIds: [findingId],
    geographicLayer: "city",
    geographyRef: "ae:du:dubai",
    limitations: [],
    staleBusinessEvidence: false,
    missingInput: null,
    ...overrides,
  };
}

describe("toCompactSynthesisInput", () => {
  it("accepts a compact allowlisted input", () => {
    const parsed = toCompactSynthesisInput(compactInput());
    expect(parsed.activityMonth).toBe("2026-09");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.claims).toHaveLength(1);
  });

  it("refuses raw normalized metrics, report rows, workbook data, customer data, signed URLs, and source pages", () => {
    const hostile = compactInput({
      findings: [
        {
          id: findingId,
          digest: digestA,
          code: "DEMAND_SOFTNESS",
          severity: "high",
          headline: "Weekend demand softened.",
          limitations: [],
          analysisRunId: "41000000-0000-4000-8000-000000000040",
          branchId: null,
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          currency: "AED",
          valueKind: "money",
          scope: "branch",
          stale: false,
          metricValue: 412.5,
          normalizedMetricId: "metric-1",
          reportRow: { revenue: 99_000 },
          workbookCells: ["A1", "B2"],
          customerName: "A private regular",
          signedUrl: "https://storage.example/signed?token=abc",
          sourcePage: "<html>full source page</html>",
        },
      ],
    });
    const result = (() => {
      try {
        return { ok: true as const, value: toCompactSynthesisInput(hostile) };
      } catch {
        return { ok: false as const };
      }
    })();
    if (result.ok) {
      expect(JSON.stringify(result.value)).not.toContain("metricValue");
      expect(JSON.stringify(result.value)).not.toContain("signedUrl");
      expect(JSON.stringify(result.value)).not.toContain("sourcePage");
      expect(JSON.stringify(result.value)).not.toContain("customerName");
    } else {
      // Strict rejection is also a safe outcome: nothing hostile is forwarded.
      expect(result.ok).toBe(false);
    }
  });

  it("rejects unbounded candidate-facing text and unknown keys at the boundary", () => {
    expect(() =>
      toCompactSynthesisInput(compactInput({ activityMonth: "September 2026" })),
    ).toThrow();
    expect(() =>
      toCompactSynthesisInput(compactInput({ unrestrictedPrompt: "ignore the policy" })),
    ).toThrow();
  });
});

describe("parseSynthesisOutput", () => {
  it("accepts a bounded candidate list", () => {
    const parsed = parseSynthesisOutput({ candidates: [candidate()] });
    expect(parsed.outcome).toBe("valid");
    if (parsed.outcome === "valid") expect(parsed.candidates).toHaveLength(1);
  });

  it("rejects malformed model output with bounded safe issues", () => {
    const parsed = parseSynthesisOutput({ candidates: [{ kind: "prophecy" }] });
    expect(parsed.outcome).toBe("invalid");
    if (parsed.outcome === "invalid") {
      expect(parsed.issues.length).toBeGreaterThan(0);
      expect(parsed.issues.length).toBeLessThanOrEqual(12);
      for (const issue of parsed.issues) expect(issue.length).toBeLessThanOrEqual(240);
    }
  });

  it("rejects oversized candidate lists and overlong narratives", () => {
    const tooMany = parseSynthesisOutput({
      candidates: Array.from({ length: 51 }, () => candidate()),
    });
    expect(tooMany.outcome).toBe("invalid");
    const tooLong = parseSynthesisOutput({
      candidates: [candidate({ narrative: "x".repeat(2_001) })],
    });
    expect(tooLong.outcome).toBe("invalid");
  });

  it("rejects a refusal payload without treating it as candidates", () => {
    const parsed = parseSynthesisOutput({ refusal: "SYNTHESIS_PROVIDER_UNCONFIGURED" });
    expect(parsed.outcome).toBe("invalid");
  });
});

describe("buildSynthesisPrompt", () => {
  it("renders only compact citations and never raw evidence or customer data", () => {
    const prompt = buildSynthesisPrompt(toCompactSynthesisInput(compactInput()));
    expect(prompt).toContain(claimId);
    expect(prompt).toContain(digestB.slice(0, 12));
    expect(prompt).not.toContain("https://");
    expect(prompt).not.toContain("signed");
    expect(prompt).not.toMatch(/metric|workbook|customer|revenue|profit/i);
    expect(prompt).toContain("candidate synthesis only");
  });
});

describe("fail-closed provider", () => {
  it("returns a refusal without calling any model SDK", async () => {
    const provider = createFailClosedSynthesisProvider();
    expect(provider.modelVersion).toBe(SYNTHESIS_MODEL_VERSION);
    const generate = vi.spyOn(provider, "generate");
    const output = await provider.generate({
      context: toCompactSynthesisInput(compactInput()),
      repairIssues: null,
      correlationId: "60000000-0000-4000-8000-000000000006",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(output).toEqual({ refusal: "SYNTHESIS_PROVIDER_UNCONFIGURED" });
    expect(parseSynthesisOutput(output).outcome).toBe("invalid");
  });

  it("defaults to fail-closed when no model credential is configured", () => {
    testEnv.GOOGLE_GENERATIVE_AI_API_KEY = undefined;
    const provider = createSynthesisProvider();
    expect(provider.modelProvider).toBe("fail-closed");
  });

  it("routes to the bounded SDK provider when credentials are configured", () => {
    const provider = createSynthesisProvider();
    expect(provider.modelProvider).toBe("google");
    expect(provider.modelVersion).toBe(SYNTHESIS_MODEL_VERSION);
  });
});

describe("google synthesis provider", () => {
  it("uses a bounded low-temperature call carrying compact citations only", async () => {
    generateText.mockResolvedValueOnce({ text: '{"candidates":[]}' });
    const provider = createGoogleSynthesisProvider({ modelId: "gemini-synthesis" });
    const context = toCompactSynthesisInput(compactInput());

    await provider.generate({
      context,
      repairIssues: null,
      correlationId: "60000000-0000-4000-8000-000000000006",
    });

    const call = generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({
      model: { id: "gemini-synthesis" },
      temperature: 0.1,
      maxOutputTokens: 3_500,
    });
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call.prompt).toContain(claimId);
    expect(call.prompt).not.toContain("https://");
    expect(SYNTHESIS_PROVIDER_TIMEOUT_MS).toBe(90_000);
  });

  it("maps SDK outages to a safe integration error without leaking provider detail", async () => {
    generateText.mockRejectedValueOnce(new Error("socket hang up"));
    const provider = createGoogleSynthesisProvider({ modelId: "gemini-synthesis" });

    await expect(
      provider.generate({
        context: toCompactSynthesisInput(compactInput()),
        repairIssues: ["NO_VALID_CANDIDATE"],
        correlationId: "60000000-0000-4000-8000-000000000006",
      }),
    ).rejects.toMatchObject({ name: "DomainError", code: "INTEGRATION_ERROR" });
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});

const branchA = "30000000-0000-4000-8000-000000000030";
const analysisRunA = "41000000-0000-4000-8000-000000000041";
const researchRunA = "42000000-0000-4000-8000-000000000042";

describe("branch lineage in the compact input", () => {
  it("accepts exact branch/profile lineage on the input, findings, and claims", () => {
    const parsed = toCompactSynthesisInput(
      compactInput({
        branchId: branchA,
        findings: [
          {
            id: findingId,
            digest: digestA,
            code: "DEMAND_SOFTNESS",
            severity: "high",
            headline: "Weekend demand softened across dine-in.",
            limitations: [],
            analysisRunId: analysisRunA,
            branchId: branchA,
            periodStart: "2026-08-01",
            periodEnd: "2026-08-31",
            currency: "AED",
            valueKind: "money",
            scope: "branch",
            stale: false,
          },
        ],
        claims: [
          {
            id: claimId,
            digest: digestB,
            paraphrase: "A public notice lists a weekend food festival near the trade area.",
            quotation: null,
            geographicLayer: "city",
            geographyRef: "ae:du:dubai",
            supportGrade: "single_source",
            freshness: "current",
            limitations: [],
            researchRunId: researchRunA,
            branchId: branchA,
          },
        ],
      }),
    );
    expect(parsed.branchId).toBe(branchA);
    expect(parsed.findings[0]?.analysisRunId).toBe(analysisRunA);
    expect(parsed.claims[0]?.researchRunId).toBe(researchRunA);
  });

  it("rejects findings that hide their lineage", () => {
    expect(() =>
      toCompactSynthesisInput(
        compactInput({
          branchId: branchA,
          findings: [
            {
              id: findingId,
              digest: digestA,
              code: "DEMAND_SOFTNESS",
              severity: "high",
              headline: "Weekend demand softened across dine-in.",
              limitations: [],
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("labels branch scope, periods, and currency in the prompt without raw values", () => {
    const prompt = buildSynthesisPrompt(
      toCompactSynthesisInput(
        compactInput({
          branchId: branchA,
          findings: [
            {
              id: findingId,
              digest: digestA,
              code: "DEMAND_SOFTNESS",
              severity: "high",
              headline: "Weekend demand softened across dine-in.",
              limitations: [],
              analysisRunId: analysisRunA,
              branchId: branchA,
              periodStart: "2026-08-01",
              periodEnd: "2026-08-31",
              currency: "AED",
              valueKind: "money",
              scope: "branch",
              stale: false,
            },
          ],
        }),
      ),
    );
    expect(prompt).toContain(branchA);
    expect(prompt).toContain("AED");
    expect(prompt).toContain("2026-08-01");
    expect(prompt).not.toContain("value_numerator");
  });
});
