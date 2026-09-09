import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExtractedClaimCandidate } from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import {
  buildCorroborationLinks,
  reviewResearchClaimSupport,
  selectAdmissibleClaims,
  type ReviewedClaimSupport,
} from "@/modules/growth-intelligence/infrastructure/research/claim-support-review";
import type {
  ResearchModelSpender,
  ResearchModelTransport,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import type { ApprovedResearchScope } from "@/modules/growth-intelligence/infrastructure/research/ports";

const scope: ApprovedResearchScope = {
  publicBusinessName: "Harbor Eats",
  approvedDomains: ["harboreats.example"],
  niches: ["Seafood"],
  city: "Dubai",
  countryCode: "AE",
  topics: ["weekend footfall"],
  competitors: [{ name: "Marina Diner", publicUrl: "https://marinadiner.example/" }],
};

const budget = {
  phase: "support_review" as const,
  maxCalls: 4,
  maxInputTokens: 12_000,
  maxOutputTokens: 4_000,
  maxSourcesPerBatch: 10,
};

const excerptText = "Harbor Eats saw record weekend footfall near the marina promenade.";
const sources = [
  {
    sourceKey: "src-0-aabbccddeeff",
    sourceUrl: "https://tourism.example/dubai-notice",
    excerptText,
    excerptDigest: "a".repeat(64),
    retrievedAt: "2026-09-01T10:00:00Z",
  },
];

function candidate(overrides: Partial<ExtractedClaimCandidate> = {}): ExtractedClaimCandidate {
  return {
    candidateKey: "marina-footfall",
    subjectKind: "market",
    subjectRef: "dubai marina footfall",
    claimKind: "demand_signal",
    paraphrase: "Weekend footfall near the marina promenade reached a record level.",
    quotation: null,
    claimCategory: "demand_trend",
    geographicLayer: "city",
    geographyRef: "ae:du",
    citations: [
      { sourceKey: "src-0-aabbccddeeff", spanStart: 0, spanEnd: 66, quotedText: excerptText },
    ],
    sourceKeys: ["src-0-aabbccddeeff"],
    publishedAt: null,
    observedAt: "2026-09-01T09:00:00Z",
    limitations: [],
    ...overrides,
  };
}

function reviewTransport(
  verdicts: Array<{ candidateKey: string; verdict: string; limitations?: string[] }>,
) {
  const prompts: string[] = [];
  const queue = [...verdicts];
  const transport: ResearchModelTransport = {
    complete: vi.fn(async (input) => {
      prompts.push(input.prompt);
      const batch = queue.splice(0, 10);
      return {
        text: JSON.stringify(
          batch.map((item) => ({
            candidateKey: item.candidateKey,
            verdict: item.verdict,
            limitations: item.limitations ?? [],
          })),
        ),
        usage: { kind: "reported" as const, microsUsd: 90 },
        latencyMs: 80,
      };
    }),
  };
  return { transport, prompts };
}

function spender(): ResearchModelSpender {
  return {
    reserve: vi.fn(async () => ({ attemptId: "20000000-0000-4000-8000-000000000001" })),
    settle: vi.fn(async () => {}),
  };
}

const eligible = ["src-0-aabbccddeeff"];

describe("reviewResearchClaimSupport adversarial cases", () => {
  it("marks unsupported when the cited span text is unrelated to the claim", async () => {
    const { transport } = reviewTransport([
      {
        candidateKey: "marina-footfall",
        verdict: "unsupported",
        limitations: ["SPAN_DOES_NOT_SUPPORT_CLAIM"],
      },
    ]);

    const result = await reviewResearchClaimSupport({
      candidates: [candidate()],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({
      candidateKey: "marina-footfall",
      verdict: "unsupported",
    });
    expect(result.unsupportedCount).toBe(1);
  });

  it("marks unsupported without a model call when a citation invents a source ID", async () => {
    const { transport } = reviewTransport([]);
    const bad = candidate({
      candidateKey: "invented",
      citations: [{ sourceKey: "src-99-ffff", spanStart: 0, spanEnd: 5, quotedText: null }],
      sourceKeys: ["src-99-ffff"],
    });

    const result = await reviewResearchClaimSupport({
      candidates: [bad],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    expect(result.reviews[0]).toMatchObject({ verdict: "unsupported" });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("marks unsupported without a model call when span offsets escape the stored excerpt", async () => {
    const { transport } = reviewTransport([]);
    const bad = candidate({
      citations: [
        { sourceKey: "src-0-aabbccddeeff", spanStart: 60, spanEnd: 600, quotedText: null },
      ],
    });

    const result = await reviewResearchClaimSupport({
      candidates: [bad],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    expect(result.reviews[0]).toMatchObject({ verdict: "unsupported" });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("marks uncertain when competitor identity matches no approved scope lead", async () => {
    const { transport } = reviewTransport([]);
    const ambiguous = candidate({
      candidateKey: "rival-launch",
      subjectKind: "competitor",
      subjectRef: "Harbor Mystery Rival",
    });

    const result = await reviewResearchClaimSupport({
      candidates: [ambiguous],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    expect(result.reviews[0]).toMatchObject({
      verdict: "uncertain",
      limitations: expect.arrayContaining(["AMBIGUOUS_COMPETITOR_IDENTITY"]),
    });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("marks uncertain with a conflict limitation when two candidates date the same subject differently", async () => {
    const first = candidate({ candidateKey: "festival-a", observedAt: "2026-09-01T09:00:00Z" });
    const second = candidate({ candidateKey: "festival-b", observedAt: "2026-08-20T09:00:00Z" });
    const { transport } = reviewTransport([
      { candidateKey: "festival-a", verdict: "supported" },
      { candidateKey: "festival-b", verdict: "supported" },
    ]);

    const result = await reviewResearchClaimSupport({
      candidates: [first, second],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    expect(result.uncertainCount).toBe(2);
    for (const review of result.reviews) {
      expect(review.limitations).toContain("CONFLICTING_DATES");
    }
  });

  it("marks unsupported when a candidate cites an excluded source", async () => {
    const { transport } = reviewTransport([]);

    const result = await reviewResearchClaimSupport({
      candidates: [candidate()],
      sources,
      scope,
      eligibleSourceKeys: [],
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    expect(result.reviews[0]).toMatchObject({
      verdict: "unsupported",
      limitations: expect.arrayContaining(["SOURCE_INELIGIBLE"]),
    });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("keeps a stale but otherwise supported candidate with a stale limitation", async () => {
    const stale = candidate({ observedAt: "2026-06-01T09:00:00Z" });
    const { transport } = reviewTransport([
      { candidateKey: stale.candidateKey, verdict: "supported" },
    ]);

    const result = await reviewResearchClaimSupport({
      candidates: [stale],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
      now: () => new Date("2026-09-08T00:00:00Z"),
    });

    expect(result.reviews[0]).toMatchObject({ verdict: "supported" });
    expect(result.reviews[0]!.limitations).toContain("STALE_EVIDENCE");
  });

  it("caps a malformed model answer at uncertain after one bounded repair", async () => {
    let calls = 0;
    const transport: ResearchModelTransport = {
      complete: vi.fn(async () => {
        calls += 1;
        return { text: "not-json", usage: { kind: "unknown" as const }, latencyMs: 10 };
      }),
    };

    const result = await reviewResearchClaimSupport({
      candidates: [candidate()],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    expect(calls).toBe(2);
    expect(result.reviews[0]).toMatchObject({ verdict: "uncertain" });
  });

  it("rejects an invented verdict value from the model", async () => {
    const transport: ResearchModelTransport = {
      complete: vi.fn(async () => ({
        text: JSON.stringify([
          { candidateKey: "marina-footfall", verdict: "proven", limitations: [] },
        ]),
        usage: { kind: "reported" as const, microsUsd: 10 },
        latencyMs: 10,
      })),
    };

    const result = await reviewResearchClaimSupport({
      candidates: [candidate()],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    expect(result.reviews[0]!.verdict).not.toBe("proven");
    expect(["uncertain", "unsupported"]).toContain(result.reviews[0]!.verdict);
  });

  it("records reviewer provenance without raw excerpt content in the review record", async () => {
    const { transport } = reviewTransport([
      { candidateKey: "marina-footfall", verdict: "supported" },
    ]);

    const result = await reviewResearchClaimSupport({
      candidates: [candidate()],
      sources,
      scope,
      eligibleSourceKeys: eligible,
      budget,
      transport,
      spender: spender(),
      modelId: "gemini-fixture-1",
    });

    const review = result.reviews[0]!;
    expect(review.reviewerRef).toBe("gemini-fixture-1");
    expect(review.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(review)).not.toContain(excerptText);
  });
});

describe("selectAdmissibleClaims", () => {
  function reviewed(overrides: Partial<ReviewedClaimSupport> = {}): ReviewedClaimSupport {
    return {
      candidateKey: "marina-footfall",
      verdict: "supported",
      limitations: [],
      reviewerRef: "gemini-fixture-1",
      reviewedAt: "2026-09-01T11:00:00Z",
      ...overrides,
    };
  }

  it("admits only eligible supported candidates", () => {
    const supported = candidate();
    const uncertain = candidate({ candidateKey: "maybe" });
    const reviews = [reviewed(), reviewed({ candidateKey: "maybe", verdict: "uncertain" })];

    const result = selectAdmissibleClaims({
      candidates: [supported, uncertain],
      reviews,
      eligibleSourceKeys: eligible,
    });

    expect(result.admitted.map((item) => item.candidateKey)).toEqual(["marina-footfall"]);
    expect(result.uncertainCount).toBe(1);
  });

  it("refuses a supported verdict when its source lost eligibility after review", () => {
    const result = selectAdmissibleClaims({
      candidates: [candidate()],
      reviews: [reviewed()],
      eligibleSourceKeys: [],
    });

    expect(result.admitted).toEqual([]);
    expect(result.rejectedCount).toBe(1);
  });

  it("proves erased sources cannot support new claims", () => {
    const erased: ReviewedClaimSupport = reviewed();
    const result = selectAdmissibleClaims({
      candidates: [candidate()],
      reviews: [erased],
      eligibleSourceKeys: [],
    });

    expect(result.admitted).toEqual([]);
  });
});

describe("buildCorroborationLinks", () => {
  it("links two admitted claims that cite independent publishers on the same subject", () => {
    const first = candidate({ candidateKey: "alpha" });
    const second = candidate({
      candidateKey: "beta",
      citations: [{ sourceKey: "src-1-001122334455", spanStart: 0, spanEnd: 5, quotedText: null }],
      sourceKeys: ["src-1-001122334455"],
    });

    const links = buildCorroborationLinks({
      admitted: [first, second],
      keyOf: (item) => `claim-${item.candidateKey}`,
      publishersOf: (item) =>
        item.candidateKey === "alpha" ? ["Dubai Tourism"] : ["Dubai Calendar"],
    });

    expect(links).toEqual([
      { fromClaimKey: "claim-alpha", toClaimKey: "claim-beta", relation: "corroborates" },
    ]);
  });

  it("emits no link when both claims share a single publisher", () => {
    const first = candidate({ candidateKey: "alpha" });
    const second = candidate({ candidateKey: "beta" });

    const links = buildCorroborationLinks({
      admitted: [first, second],
      keyOf: (item) => `claim-${item.candidateKey}`,
      publishersOf: () => ["Dubai Tourism"],
    });

    expect(links).toEqual([]);
  });
});
