import { describe, expect, it, vi } from "vitest";

import {
  consolidateMarketEvidence,
  consolidationPayloadSchema,
} from "@/workflows/growth-intelligence/consolidate-market-evidence";
import type {
  ApprovedMarketProfileView,
  GrowthIntelligenceRequestView,
} from "@/workflows/growth-intelligence/run-market-research";
import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const correlationId = "60000000-0000-4000-8000-000000000006";
const profileVersionId = "70000000-0000-4000-8000-000000000007";
const sourcePolicyDigest = "c".repeat(64);

const document = {
  schemaVersion: 1,
  publicIdentity: {
    approvedName: "Kerala Kitchen",
    domains: ["example.com"],
    publicUrls: ["https://example.com/menu"],
  },
  nicheDescriptors: ["Kerala cuisine"],
  geographies: [{ layer: "city", locationRef: "ae:du", name: "Dubai", countryCode: "AE" }],
  competitors: [],
  topics: [{ key: "local-events", label: "Local events", provenance: "core" }],
  sourcePolicy: {
    excludedDomains: [],
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
} as MarketProfileDocumentV1;

const requestView: GrowthIntelligenceRequestView = {
  id: requestId,
  organizationId,
  branchId: null,
  channelId: null,
  kind: "weekly_synthesis",
  triggerReason: "weekly_due",
  businessEvidenceDigest: null,
  marketProfileVersionId: profileVersionId,
  sourcePolicyDigest,
  researchRuleVersion: "market-research@1",
  localTimeBucket: "weekly:2026-08-31",
  correlationId,
};

const profileView: ApprovedMarketProfileView = {
  versionId: profileVersionId,
  digest: "d".repeat(64),
  document,
  sourcePolicyDigest,
  enabled: true,
};

const quietWeek = {
  currentClaimCount: 4,
  expiredCount: 0,
  excludedCount: 0,
  withdrawnCount: 0,
  changedCount: 0,
};

function dependencies(overrides = {}) {
  const requests = {
    claim: vi.fn(async () => ({ outcome: "acquired", replayed: false })),
    complete: vi.fn(async () => ({ outcome: "completed" })),
    fail: vi.fn(async () => ({ outcome: "failed" })),
    load: vi.fn(async () => requestView),
    enqueue: vi.fn(
      async (_input: { organizationId: string; request: Record<string, string | null> }) => ({
        requestId: "80000000-0000-4000-8000-000000000008",
        replayed: false,
      }),
    ),
  };
  const profiles = { readCurrent: vi.fn(async () => profileView) };
  const state = { load: vi.fn(async () => quietWeek) };
  return { requests, profiles, state, ...overrides };
}

const payload = { organizationId, requestId, correlationId };

describe("consolidationPayloadSchema", () => {
  it("accepts identifier-only payloads and rejects anything wider", () => {
    expect(consolidationPayloadSchema.parse(payload)).toEqual(payload);
    expect(() =>
      consolidationPayloadSchema.parse({ ...payload, kind: "weekly_synthesis" }),
    ).toThrow();
  });
});

describe("consolidateMarketEvidence", () => {
  it("returns not_acquired without side effects when the lease is held", async () => {
    const deps = dependencies();
    deps.requests.claim.mockResolvedValueOnce({ outcome: "in_progress", replayed: false });

    const result = await consolidateMarketEvidence(payload, deps);

    expect(result).toEqual({ outcome: "not_acquired", claimOutcome: "in_progress" });
    expect(deps.state.load).not.toHaveBeenCalled();
    expect(deps.requests.enqueue).not.toHaveBeenCalled();
  });

  it("completes quietly when no source state changed", async () => {
    const deps = dependencies();

    const result = await consolidateMarketEvidence(payload, deps);

    expect(result).toEqual({
      outcome: "consolidated",
      requestId,
      currentClaimCount: 4,
      reassessmentEnqueued: false,
    });
    expect(deps.requests.enqueue).not.toHaveBeenCalled();
    expect(deps.requests.complete).toHaveBeenCalledWith({
      organizationId,
      requestId,
      claimToken: expect.any(String),
    });
  });

  it("enqueues evidence reassessment when sources expired, and still completes", async () => {
    const deps = dependencies();
    deps.state.load.mockResolvedValueOnce({ ...quietWeek, expiredCount: 2 });

    const result = await consolidateMarketEvidence(payload, deps);

    expect(result).toMatchObject({ outcome: "consolidated", reassessmentEnqueued: true });
    expect(deps.requests.enqueue).toHaveBeenCalledOnce();
    const enqueued = deps.requests.enqueue.mock.calls[0]![0];
    expect(enqueued.request.kind).toBe("evidence_reassessment");
    expect(enqueued.request.triggerReason).toBe("evidence_expired");
    expect(enqueued.request.localTimeBucket).toBe("immediate");
  });

  it("uses source_changed when withdrawals or exclusions move without expiry", async () => {
    const deps = dependencies();
    deps.state.load.mockResolvedValueOnce({ ...quietWeek, withdrawnCount: 1 });

    await consolidateMarketEvidence(payload, deps);

    const enqueued = deps.requests.enqueue.mock.calls[0]![0];
    expect(enqueued.request.triggerReason).toBe("source_changed");
  });

  it("fails closed when the profile moved under the claimed request", async () => {
    const deps = dependencies();
    deps.profiles.readCurrent.mockResolvedValueOnce({ ...profileView, enabled: false });

    const result = await consolidateMarketEvidence(payload, deps);

    expect(result).toEqual({ outcome: "failed", code: "PROFILE_DISABLED" });
    expect(deps.requests.complete).not.toHaveBeenCalled();
  });

  it("fails closed for non-weekly request kinds", async () => {
    const deps = dependencies();
    deps.requests.load.mockResolvedValueOnce({ ...requestView, kind: "market_research" });

    const result = await consolidateMarketEvidence(payload, deps);

    expect(result).toEqual({ outcome: "failed", code: "REQUEST_KIND_UNSUPPORTED" });
    expect(deps.state.load).not.toHaveBeenCalled();
  });

  it("returns claim_lost without throwing when completion loses the lease", async () => {
    const deps = dependencies();
    deps.requests.complete.mockResolvedValueOnce({ outcome: "claim_lost" });

    const result = await consolidateMarketEvidence(payload, deps);

    expect(result).toEqual({ outcome: "claim_lost" });
  });

  it("returns cancelled before claiming when the signal is already aborted", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();

    const result = await consolidateMarketEvidence(payload, { ...deps, signal: controller.signal });

    expect(result).toEqual({ outcome: "cancelled" });
    expect(deps.requests.claim).not.toHaveBeenCalled();
  });
});
