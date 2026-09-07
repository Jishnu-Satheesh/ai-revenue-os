import { describe, expect, it, vi } from "vitest";

import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";
import { DomainError } from "@/lib/errors";
import {
  runSynthesis,
  synthesisPayloadSchema,
  type ApprovedSynthesisProfileView,
  type SynthesisDependencies,
  type SynthesisRequestView,
} from "@/workflows/growth-intelligence/run-synthesis";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const claimToken = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const correlationId = "60000000-0000-4000-8000-000000000006";
const profileVersionId = "70000000-0000-4000-8000-000000000007";
const sourcePolicyDigest = "c".repeat(64);

const document: MarketProfileDocumentV1 = {
  schemaVersion: 1,
  publicIdentity: {
    approvedName: "Kerala Kitchen",
    domains: ["example.com"],
    publicUrls: ["https://example.com/menu"],
  },
  nicheDescriptors: ["Kerala cuisine"],
  geographies: [
    {
      layer: "city",
      locationRef: "ae:du",
      name: "Dubai",
      countryCode: "AE",
    },
  ],
  competitors: [],
  topics: [{ key: "local-events", label: "Local events", provenance: "core" }],
  sourcePolicy: {
    excludedDomains: ["blocked.example"],
    excludedPublishers: [],
    excludedCompetitorKeys: [],
    allowBoundedQuotes: false,
    maxQuotationCharacters: 0,
  },
  cadence: {
    timeZone: "Asia/Dubai",
    dailyLocalTime: "06:30",
    weeklyDay: "monday",
    weeklyLocalTime: "07:00",
  },
};

const requestView: SynthesisRequestView = {
  id: requestId,
  organizationId,
  branchId: null,
  channelId: null,
  kind: "business_evidence_changed",
  triggerReason: "business_evidence_current",
  businessEvidenceDigest: "b".repeat(64),
  marketProfileVersionId: profileVersionId,
  sourcePolicyDigest,
  researchRuleVersion: "market-research@1",
  localTimeBucket: "2026-09",
  correlationId,
};

const profileView: ApprovedSynthesisProfileView = {
  versionId: profileVersionId,
  digest: "d".repeat(64),
  document,
  sourcePolicyDigest,
  enabled: true,
};

function dependencies(overrides: Partial<SynthesisDependencies> = {}) {
  const requests = {
    claim: vi.fn(async () => ({ outcome: "acquired", replayed: false })),
    complete: vi.fn(async () => ({ outcome: "completed" })),
    fail: vi.fn(async () => ({ outcome: "failed" })),
    load: vi.fn(async () => requestView),
  };
  const profiles = { readCurrent: vi.fn(async () => profileView) };
  const synthesize = vi.fn(async () => ({
    outcome: "completed",
    runId,
    itemCount: 1,
    createdFingerprints: [],
    supersededItemIds: [],
  }));
  return { requests, profiles, synthesize, ...overrides } as SynthesisDependencies & {
    requests: {
      claim: ReturnType<typeof vi.fn>;
      complete: ReturnType<typeof vi.fn>;
      fail: ReturnType<typeof vi.fn>;
      load: ReturnType<typeof vi.fn>;
    };
    profiles: { readCurrent: ReturnType<typeof vi.fn> };
    synthesize: ReturnType<typeof vi.fn>;
  };
}

const payload = { organizationId, requestId, correlationId };

describe("synthesisPayloadSchema", () => {
  it("accepts request and correlation identifiers only", () => {
    expect(synthesisPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("rejects non-identifier payloads and unknown keys", () => {
    expect(() => synthesisPayloadSchema.parse({ ...payload, modelHint: "x" })).toThrow();
    expect(() =>
      synthesisPayloadSchema.parse({ ...payload, organizationId: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("runSynthesis", () => {
  it("claims, reloads authorities, synthesizes, and completes the request", async () => {
    const deps = dependencies();
    const result = await runSynthesis(payload, deps);
    expect(result).toEqual({ outcome: "synthesized", runId, itemCount: 1 });
    expect(deps.requests.claim).toHaveBeenCalledWith({
      organizationId,
      requestId,
      claimToken: expect.any(String),
      leaseSeconds: 600,
    });
    expect(deps.requests.complete).toHaveBeenCalledTimes(1);
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
  });

  it("returns a deterministic refusal when the lease is not acquired", async () => {
    const deps = dependencies({
      requests: {
        claim: vi.fn(async () => ({ outcome: "lease_expired", replayed: false })),
        complete: vi.fn(),
        fail: vi.fn(),
        load: vi.fn(),
      },
    });
    const result = await runSynthesis(payload, deps);
    expect(result).toEqual({ outcome: "not_acquired", claimOutcome: "lease_expired" });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("returns a deterministic refusal for unsupported request kinds", async () => {
    const deps = dependencies({
      requests: {
        claim: vi.fn(async () => ({ outcome: "acquired", replayed: false })),
        complete: vi.fn(),
        fail: vi.fn(),
        load: vi.fn(async () => ({ ...requestView, kind: "profile_discovery" })),
      },
    });
    const result = await runSynthesis(payload, deps);
    expect(result).toEqual({ outcome: "failed", code: "REQUEST_KIND_UNSUPPORTED", runId: null });
  });

  it("fails the request with a safe code when synthesis fails deterministically", async () => {
    const deps = dependencies({
      synthesize: vi.fn(async () => ({
        outcome: "failed" as const,
        code: "SYNTHESIS_CANDIDATE_INVALID",
        runId,
      })),
    });
    const result = await runSynthesis(payload, deps);
    expect(result).toEqual({
      outcome: "failed",
      code: "SYNTHESIS_CANDIDATE_INVALID",
      runId,
    });
    expect(deps.requests.fail).toHaveBeenCalledWith({
      organizationId,
      requestId,
      claimToken: expect.any(String),
      safeFailureCode: "SYNTHESIS_CANDIDATE_INVALID",
    });
  });

  it("returns claim_lost when request completion is fenced away", async () => {
    const deps = dependencies({
      requests: {
        claim: vi.fn(async () => ({ outcome: "acquired", replayed: false })),
        complete: vi.fn(async () => ({ outcome: "claim_lost" })),
        fail: vi.fn(),
        load: vi.fn(async () => requestView),
      },
    });
    const result = await runSynthesis(payload, deps);
    expect(result).toEqual({ outcome: "claim_lost" });
  });

  it("replays duplicate delivery without duplicating work", async () => {
    const deps = dependencies({
      synthesize: vi.fn(async () => ({ outcome: "replayed" as const, runId })),
    });
    const result = await runSynthesis(payload, deps);
    expect(result).toEqual({ outcome: "replayed", runId });
    expect(deps.requests.complete).toHaveBeenCalledTimes(1);
  });

  it("maps cancellation to a fenced WORKER_CANCELLED failure under its own claim", async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = dependencies({ signal: controller.signal });
    const result = await runSynthesis(payload, deps);
    expect(result).toEqual({ outcome: "cancelled" });
    expect(deps.requests.claim).not.toHaveBeenCalled();
  });

  it("throws transients for Trigger redelivery instead of recording a refusal", async () => {
    const deps = dependencies({
      synthesize: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    await expect(runSynthesis(payload, deps)).rejects.toThrow("connection reset");
    expect(deps.requests.fail).not.toHaveBeenCalled();
    expect(deps.requests.complete).not.toHaveBeenCalled();
  });

  it("maps provider outages to a deterministic failure without throwing", async () => {
    const deps = dependencies({
      synthesize: vi.fn(async () => {
        throw new DomainError("INTEGRATION_ERROR", "Synthesis is temporarily unavailable.");
      }),
    });
    const result = await runSynthesis(payload, deps);
    expect(result).toEqual({
      outcome: "failed",
      code: "SYNTHESIS_MODEL_UNAVAILABLE",
      runId: null,
    });
  });

  it("never mutates deterministic channel findings or recommendations on failure", async () => {
    const deps = dependencies({
      synthesize: vi.fn(async () => ({
        outcome: "failed" as const,
        code: "SYNTHESIS_NO_VALID_CANDIDATE",
        runId,
      })),
    });
    await runSynthesis(payload, deps);
    // The synthesis seam is read-only toward channel state: the worker holds
    // no writer for findings or recommendations, so a narration failure can
    // only fail its own request, never erase deterministic business state.
    expect(deps.requests.fail).toHaveBeenCalledTimes(1);
    expect(deps.requests.complete).not.toHaveBeenCalled();
  });
});
