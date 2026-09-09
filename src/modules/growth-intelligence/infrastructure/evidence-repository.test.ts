import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DomainError } from "@/lib/errors";
import {
  createMarketEvidenceRepository,
  type MarketEvidencePayload,
  type MarketEvidencePersistence,
} from "@/modules/growth-intelligence/infrastructure/evidence-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const claimToken = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const claimId = "50000000-0000-4000-8000-000000000005";

const payload: MarketEvidencePayload = {
  sources: [
    {
      key: "public-notice",
      url: "https://tourism.example/dubai-notice",
      domain: "tourism.example",
      publisher: "Dubai Tourism",
      sourceClass: "official",
      availability: "available",
      contentDigest: "a".repeat(64),
      safeFailureCode: null,
      retrievedAt: "2026-09-01T10:00:00Z",
      publishedAt: null,
      observedAt: "2026-09-01T09:00:00Z",
    },
  ],
  claims: [
    {
      key: "tourism-demand",
      claimDigest: "b".repeat(64),
      subjectKind: "market",
      subjectRef: "dubai-market",
      claimKind: "demand_signal",
      paraphrase: "A public market signal may affect local demand.",
      quotation: null,
      geographicLayer: "city",
      geographyRef: "ae:du",
      sourceKeys: ["public-notice"],
      freshnessClass: "standard",
      claimCategory: "demand_trend",
      freshnessRegistryVersion: 1,
      publishedAt: null,
      observedAt: "2026-09-01T09:00:00Z",
      staleAt: "2026-09-15T09:00:00Z",
      expiresAt: "2026-10-01T09:00:00Z",
      limitations: ["BROADER_MARKET_INFERENCE"],
    },
  ],
  links: [],
};

function persistence(recordResult: unknown = { runId, claimCount: 1, replayed: false }) {
  const rpc = vi.fn(async (name: string) => {
    const data =
      name === "record_market_evidence_claims"
        ? recordResult
        : name === "append_market_evidence_claim_event"
          ? { claimId, eventId: "70000000-0000-4000-8000-000000000007", replayed: false }
          : {
              runId,
              status: name === "fail_market_research_run" ? "failed" : "partial",
              replayed: false,
            };
    return { data, error: null };
  });
  return { client: { rpc } as MarketEvidencePersistence, rpc };
}

describe("Market Evidence repository", () => {
  it("sends only compact cited claim and source metadata through the fenced RPC", async () => {
    const db = persistence();

    const result = await createMarketEvidenceRepository(db.client).record({
      organizationId,
      requestId,
      claimToken,
      runId,
      payload,
    });

    expect(result).toEqual({ runId, claimCount: 1, replayed: false });
    expect(db.rpc).toHaveBeenCalledWith("record_market_evidence_claims", {
      p_organization_id: organizationId,
      p_request_id: requestId,
      p_claim_token: claimToken,
      p_market_research_run_id: runId,
      p_payload: payload,
    });
    expect(JSON.stringify(db.rpc.mock.calls[0])).not.toMatch(
      /rawHtml|pageContent|fullPage|sourceText|customer|workbook/i,
    );
  });

  it("refuses a raw page field before it can cross the persistence boundary", async () => {
    const db = persistence();
    const unsafePayload = {
      ...payload,
      sources: [{ ...payload.sources[0], rawHtml: "<html>untrusted page</html>" }],
    } as unknown as MarketEvidencePayload;

    await expect(
      createMarketEvidenceRepository(db.client).record({
        organizationId,
        requestId,
        claimToken,
        runId,
        payload: unsafePayload,
      }),
    ).rejects.toMatchObject({
      code: "DOMAIN_ERROR",
      message: "Market Evidence must contain compact citations and claims only.",
    } satisfies Partial<DomainError>);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refuses a citation whose declared domain does not match its public URL", async () => {
    const db = persistence();
    const mismatchedPayload = {
      ...payload,
      sources: [{ ...payload.sources[0], url: "https://other.example/public-notice" }],
    } as unknown as MarketEvidencePayload;

    await expect(
      createMarketEvidenceRepository(db.client).record({
        organizationId,
        requestId,
        claimToken,
        runId,
        payload: mismatchedPayload,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "DOMAIN_ERROR",
        message: "Market Evidence must contain compact citations and claims only.",
      }),
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("uses the exact worker-fenced arguments for start, completion, failure, and append", async () => {
    const db = persistence();
    const repository = createMarketEvidenceRepository(db.client);

    await repository.begin({
      organizationId,
      requestId,
      claimToken,
      metadata: {
        adapterProvider: "qualified-research",
        adapterVersion: "market-research@1",
        modelProvider: null,
        modelVersion: null,
        runFingerprint: "c".repeat(64),
        queryPlanDigest: "e".repeat(64),
        correlationId: "60000000-0000-4000-8000-000000000006",
      },
    });
    await repository.complete({
      organizationId,
      requestId,
      claimToken,
      runId,
      result: {
        outcome: "partial",
        resultDigest: "d".repeat(64),
        sourceAttemptCount: 1,
        sourceSuccessCount: 1,
        adapterCostMicrosUsd: 42_000,
        adapterLatencyMs: 721,
      },
    });
    await repository.fail({
      organizationId,
      requestId,
      claimToken,
      runId,
      failure: {
        safeFailureCode: "ADAPTER_UNAVAILABLE",
        adapterCostMicrosUsd: 4_200,
        adapterLatencyMs: 91,
      },
    });
    await repository.appendEvent({
      organizationId,
      requestId,
      claimToken,
      eventType: "withdrawn",
      event: {
        claimId,
        reasonCode: "SOURCE_WITHDRAWN",
        occurredAt: "2026-09-02T10:00:00Z",
      },
    });

    expect(db.rpc.mock.calls).toEqual([
      [
        "begin_market_research_run",
        {
          p_organization_id: organizationId,
          p_request_id: requestId,
          p_claim_token: claimToken,
          p_metadata: expect.any(Object),
        },
      ],
      [
        "complete_market_research_run",
        {
          p_organization_id: organizationId,
          p_request_id: requestId,
          p_claim_token: claimToken,
          p_market_research_run_id: runId,
          p_result: expect.any(Object),
        },
      ],
      [
        "fail_market_research_run",
        {
          p_organization_id: organizationId,
          p_request_id: requestId,
          p_claim_token: claimToken,
          p_market_research_run_id: runId,
          p_failure: {
            safeFailureCode: "ADAPTER_UNAVAILABLE",
            adapterCostMicrosUsd: 4_200,
            adapterLatencyMs: 91,
          },
        },
      ],
      [
        "append_market_evidence_claim_event",
        {
          p_organization_id: organizationId,
          p_request_id: requestId,
          p_claim_token: claimToken,
          p_event_type: "withdrawn",
          p_event: expect.any(Object),
        },
      ],
    ]);
  });

  it("returns safe persistence copy instead of exposing a worker database error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "market_evidence_source_excluded: raw provider body" },
    });

    await expect(
      createMarketEvidenceRepository({ rpc }).record({
        organizationId,
        requestId,
        claimToken,
        runId,
        payload,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "DOMAIN_ERROR",
        message: "Market Evidence could not be recorded.",
      }),
    );
  });

  it("returns safe persistence copy when the RPC transport rejects", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("connection reset with raw provider response"));

    await expect(
      createMarketEvidenceRepository({ rpc }).record({
        organizationId,
        requestId,
        claimToken,
        runId,
        payload,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "DOMAIN_ERROR",
        message: "Market Evidence could not be recorded.",
      }),
    );
  });

  it("admits a bounded excerpt with its qualification and retain-until policy", async () => {
    const db = persistence();
    const provenancedPayload: MarketEvidencePayload = {
      ...payload,
      sources: [
        {
          ...payload.sources[0]!,
          excerptText: "A public notice about weekend demand near the marina.",
          excerptDigest: "b".repeat(64),
          qualificationVersion: "BRAVE-ORDER-2026-09-08",
          retainUntil: "2027-09-01T00:00:00Z",
        },
      ],
    };

    const result = await createMarketEvidenceRepository(db.client).record({
      organizationId,
      requestId,
      claimToken,
      runId,
      payload: provenancedPayload,
    });

    expect(result).toEqual({ runId, claimCount: 1, replayed: false });
    expect(db.rpc).toHaveBeenCalledWith(
      "record_market_evidence_claims",
      expect.objectContaining({ p_payload: provenancedPayload }),
    );
  });

  it("surfaces a lost lease distinctly so the worker stops mutating evidence", async () => {
    const lost = { message: "market_research_claim_lost" };
    const recordRpc = vi.fn().mockResolvedValue({ data: null, error: lost });
    const repository = createMarketEvidenceRepository({ rpc: recordRpc });

    await expect(
      repository.record({ organizationId, requestId, claimToken, runId, payload }),
    ).rejects.toMatchObject({ code: "RESEARCH_CLAIM_LOST" });
    expect(recordRpc).toHaveBeenCalledOnce();

    const throwingRpc = vi.fn().mockRejectedValue(new Error("market_research_claim_lost"));
    await expect(
      createMarketEvidenceRepository({ rpc: throwingRpc }).record({
        organizationId,
        requestId,
        claimToken,
        runId,
        payload,
      }),
    ).rejects.toMatchObject({ code: "RESEARCH_CLAIM_LOST" });

    const completeRpc = vi.fn().mockResolvedValue({ data: null, error: lost });
    await expect(
      createMarketEvidenceRepository({ rpc: completeRpc }).complete({
        organizationId,
        requestId,
        claimToken,
        runId,
        result: {
          outcome: "partial",
          resultDigest: "d".repeat(64),
          sourceAttemptCount: 1,
          sourceSuccessCount: 1,
          adapterCostMicrosUsd: 42_000,
          adapterLatencyMs: 721,
        },
      }),
    ).rejects.toMatchObject({ code: "RESEARCH_CLAIM_LOST" });
  });

  it("refuses claims that cite unavailable or excluded sources before any RPC", async () => {
    const db = persistence();
    for (const availability of ["unavailable", "excluded"] as const) {
      const inadmissible = {
        ...payload,
        sources: [
          {
            ...payload.sources[0]!,
            availability,
            contentDigest: null,
            safeFailureCode: "SOURCE_ACCESS_REFUSED",
          },
        ],
      } as unknown as MarketEvidencePayload;

      await expect(
        createMarketEvidenceRepository(db.client).record({
          organizationId,
          requestId,
          claimToken,
          runId,
          payload: inadmissible,
        }),
      ).rejects.toEqual(
        expect.objectContaining({
          code: "DOMAIN_ERROR",
          message: "Market Evidence must contain compact citations and claims only.",
        }),
      );
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refuses an excerpt without its digest, and an over-long excerpt", async () => {
    const db = persistence();
    const digestlessPayload = {
      ...payload,
      sources: [{ ...payload.sources[0], excerptText: "A notice without a digest." }],
    } as unknown as MarketEvidencePayload;

    await expect(
      createMarketEvidenceRepository(db.client).record({
        organizationId,
        requestId,
        claimToken,
        runId,
        payload: digestlessPayload,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "DOMAIN_ERROR",
        message: "Market Evidence must contain compact citations and claims only.",
      }),
    );

    const oversizedPayload = {
      ...payload,
      sources: [
        {
          ...payload.sources[0],
          excerptText: "x".repeat(2_001),
          excerptDigest: "b".repeat(64),
          qualificationVersion: "BRAVE-ORDER-2026-09-08",
          retainUntil: "2027-09-01T00:00:00Z",
        },
      ],
    } as unknown as MarketEvidencePayload;

    await expect(
      createMarketEvidenceRepository(db.client).record({
        organizationId,
        requestId,
        claimToken,
        runId,
        payload: oversizedPayload,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "DOMAIN_ERROR",
        message: "Market Evidence must contain compact citations and claims only.",
      }),
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("Market Evidence repository pipeline handoff", () => {
  const pipelineId = "60000000-0000-4000-8000-000000000006";
  const synthesisRunId = "70000000-0000-4000-8000-000000000007";

  const completionResult = {
    outcome: "completed" as const,
    resultDigest: "d".repeat(64),
    sourceAttemptCount: 1,
    sourceSuccessCount: 1,
    adapterCostMicrosUsd: 42_000,
    adapterLatencyMs: 721,
  };

  const coverage = [
    {
      slotKey: "local_market",
      kind: "local_market" as const,
      outcome: "supported" as const,
      attemptIds: ["11111111-1111-4111-8111-111111111111"],
      acceptedClaimIds: [] as string[],
    },
  ];

  it("completes research and schedules synthesis through one fenced call", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        runId,
        pipelineStage: "preparing_insights",
        synthesisRequestId: "80000000-0000-4000-8000-000000000008",
        eligibleClaimCount: 1,
        replayed: false,
      },
      error: null,
    }));
    const repository = createMarketEvidenceRepository({ rpc });

    const result = await repository.completePipeline({
      organizationId,
      pipelineId,
      requestId,
      claimToken,
      runId,
      result: completionResult,
      coverage,
    });

    expect(result).toEqual({
      runId,
      pipelineStage: "preparing_insights",
      synthesisRequestId: "80000000-0000-4000-8000-000000000008",
      eligibleClaimCount: 1,
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "complete_market_research_pipeline",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_pipeline_id: pipelineId,
        p_request_id: requestId,
        p_claim_token: claimToken,
        p_market_research_run_id: runId,
      }),
    );
  });

  it("rejects unbounded coverage before any pipeline RPC", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repository = createMarketEvidenceRepository({ rpc });

    await expect(
      repository.completePipeline({
        organizationId,
        pipelineId,
        requestId,
        claimToken,
        runId,
        result: completionResult,
        coverage: Array.from({ length: 27 }, (_, index) => ({
          slotKey: `topic-${index}`,
          kind: "topic" as const,
          outcome: "supported" as const,
        })),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "DOMAIN_ERROR" }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a lost pipeline lease distinctly", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "market_research_claim_lost" },
    }));
    const repository = createMarketEvidenceRepository({ rpc });

    await expect(
      repository.completePipeline({
        organizationId,
        pipelineId,
        requestId,
        claimToken,
        runId,
        result: completionResult,
        coverage,
      }),
    ).rejects.toMatchObject({ code: "RESEARCH_CLAIM_LOST" });
  });

  it("finalizes synthesis items, request and pipeline through one fenced call", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        runId: synthesisRunId,
        itemCount: 2,
        supersededItemIds: [],
        pipelineStage: "ready",
        replayed: false,
      },
      error: null,
    }));
    const repository = createMarketEvidenceRepository({ rpc });

    const result = await repository.completeSynthesisPipeline({
      organizationId,
      requestId,
      claimToken,
      runId: synthesisRunId,
      result: {
        outcome: "completed",
        resultDigest: "e".repeat(64),
        items: [],
      },
    });

    expect(result).toEqual({
      runId: synthesisRunId,
      itemCount: 2,
      supersededItemIds: [],
      pipelineStage: "ready",
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "complete_market_synthesis_pipeline",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_request_id: requestId,
        p_claim_token: claimToken,
        p_synthesis_run_id: synthesisRunId,
      }),
    );
  });

  it("fails synthesis runs through the fenced pipeline fail path", async () => {
    const rpc = vi.fn(async () => ({
      data: { runId: synthesisRunId, pipelineStage: "synthesis_failed", replayed: false },
      error: null,
    }));
    const repository = createMarketEvidenceRepository({ rpc });

    const result = await repository.failSynthesisPipeline({
      organizationId,
      requestId,
      claimToken,
      runId: synthesisRunId,
      failureCode: "SYNTHESIS_NO_VALID_CANDIDATE",
    });

    expect(result).toEqual({
      runId: synthesisRunId,
      pipelineStage: "synthesis_failed",
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_market_synthesis_pipeline",
      expect.objectContaining({ p_safe_failure_code: "SYNTHESIS_NO_VALID_CANDIDATE" }),
    );
  });
});
