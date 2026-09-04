import { describe, expect, it } from "vitest";

import type { MarketProfileView } from "@/modules/growth-intelligence/application/ports";
import {
  buildMarketWatch,
  type MarketWatchInput,
} from "@/modules/growth-intelligence/application/market-watch";

const organizationId = "10000000-0000-4000-8000-000000000001";
const profileVersionId = "70000000-0000-4000-8000-000000000007";
const claimId = "90000000-0000-4000-8000-000000000009";
const sourceId = "91000000-0000-4000-8000-000000000091";
const runId = "40000000-0000-4000-8000-000000000004";

const profile: MarketProfileView = {
  profile: {
    id: "30000000-0000-4000-8000-000000000003",
    currentVersionId: profileVersionId,
    enabled: true,
    nextDailyResearchDueAt: null,
    nextWeeklySynthesisDueAt: null,
  },
  versions: [],
  decisions: [],
};

function input(overrides: Partial<MarketWatchInput> = {}): MarketWatchInput {
  return {
    profile,
    claims: [
      {
        id: claimId,
        runId,
        profileVersionId,
        key: "tourism-demand",
        digest: "b".repeat(64),
        subjectKind: "market",
        subjectRef: "dubai-market",
        claimKind: "demand_signal",
        paraphrase: "A public market signal may affect local demand.",
        quotation: null,
        geographicLayer: "city",
        geographyRef: "ae:du",
        claimCategory: "demand_trend",
        freshnessClass: "standard",
        publishedAt: null,
        observedAt: "2026-09-01T09:00:00Z",
        staleAt: "2026-09-15T09:00:00Z",
        expiresAt: "2026-10-01T09:00:00Z",
        limitations: ["BROADER_MARKET_INFERENCE"],
      },
    ],
    sources: [
      {
        id: sourceId,
        runId,
        profileVersionId,
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
    links: [{ claimId, sourceId, relatedClaimId: null, relation: "supports" }],
    events: [],
    requests: [],
    limit: 20,
    cursor: null,
    geography: null,
    now: "2026-09-02T06:00:00Z",
    allowBoundedQuotes: false,
    ...overrides,
  };
}

describe("buildMarketWatch", () => {
  it("returns current eligible claims with citations, grades, and freshness", () => {
    const watch = buildMarketWatch(input());

    expect(watch.signals).toHaveLength(1);
    expect(watch.signals[0]).toMatchObject({
      claimId,
      subjectRef: "dubai-market",
      paraphrase: "A public market signal may affect local demand.",
      geographicLayer: "city",
      geographyRef: "ae:du",
      supportGrade: "primary",
      freshness: "current",
      state: "current",
      limitations: ["BROADER_MARKET_INFERENCE"],
    });
    expect(watch.signals[0]!.sources).toEqual([
      expect.objectContaining({
        url: "https://tourism.example/dubai-notice",
        publisher: "Dubai Tourism",
        sourceClass: "official",
      }),
    ]);
    expect(watch.profileStatus).toMatchObject({ state: "ready" });
  });

  it("marks stale claims stale and keeps expired ones distinguishable", () => {
    const watch = buildMarketWatch(input({ now: "2026-09-20T06:00:00Z" }));
    expect(watch.signals[0]).toMatchObject({ state: "stale", expired: false });

    const expired = buildMarketWatch(input({ now: "2026-10-02T06:00:00Z" }));
    expect(expired.signals[0]).toMatchObject({ state: "stale", expired: true });
  });

  it("marks withdrawn and excluded claims with their terminal state", () => {
    const withdrawn = buildMarketWatch(
      input({
        events: [{ claimId, eventType: "withdrawn", occurredAt: "2026-09-02T01:00:00Z" }],
      }),
    );
    expect(withdrawn.signals[0]).toMatchObject({ state: "withdrawn" });

    const excluded = buildMarketWatch(
      input({
        events: [{ claimId, eventType: "excluded", occurredAt: "2026-09-02T01:00:00Z" }],
      }),
    );
    expect(excluded.signals[0]).toMatchObject({ state: "excluded" });
  });

  it("marks claims with contradicting evidence conflicted", () => {
    const otherClaimId = "92000000-0000-4000-8000-000000000092";
    const otherSourceId = "93000000-0000-4000-8000-000000000093";
    const watch = buildMarketWatch(
      input({
        claims: [
          ...input().claims,
          {
            ...input().claims[0]!,
            id: otherClaimId,
            key: "tourism-demand-rebuttal",
            digest: "c".repeat(64),
          },
        ],
        sources: [
          ...input().sources,
          {
            ...input().sources[0]!,
            id: otherSourceId,
            key: "operator-note",
            url: "https://operator.example/note",
            domain: "operator.example",
            publisher: null,
            sourceClass: "first_party",
            contentDigest: "d".repeat(64),
          },
        ],
        links: [
          ...input().links,
          { claimId, sourceId: null, relatedClaimId: otherClaimId, relation: "contradicts" },
          {
            claimId: otherClaimId,
            sourceId: otherSourceId,
            relatedClaimId: null,
            relation: "supports",
          },
        ],
      }),
    );

    expect(watch.signals.find((signal) => signal.claimId === claimId)).toMatchObject({
      state: "conflicted",
      supportGrade: "conflicted",
    });
  });

  it("filters by geographic layer without dropping citations", () => {
    const watch = buildMarketWatch(input({ geography: "country" }));
    expect(watch.signals).toEqual([]);

    const city = buildMarketWatch(input({ geography: "city" }));
    expect(city.signals).toHaveLength(1);
  });

  it("paginates with opaque cursors and never triggers work", () => {
    const first = buildMarketWatch(input({ limit: 1 }));
    expect(first.signals).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = buildMarketWatch(input({ limit: 1, cursor: first.nextCursor }));
    expect(second.signals).toEqual([]);
    expect(second.nextCursor).toBeNull();
  });

  it("reports delayed status when the profile cannot support a watch", () => {
    const absent = buildMarketWatch(
      input({ profile: { profile: null, versions: [], decisions: [] } }),
    );
    expect(absent.signals).toEqual([]);
    expect(absent.profileStatus).toMatchObject({ state: "absent" });

    const disabled = buildMarketWatch(
      input({
        profile: {
          ...profile,
          profile: { ...profile.profile!, enabled: false },
        },
      }),
    );
    expect(disabled.profileStatus).toMatchObject({ state: "disabled" });
  });

  it("withholds quotations unless the source policy allows bounded quotes", () => {
    const quoted = buildMarketWatch(
      input({
        claims: [
          {
            ...input().claims[0]!,
            quotation: "Record festival traffic.",
          },
        ],
        allowBoundedQuotes: true,
      }),
    );
    expect(quoted.signals[0]!.quotation).toBe("Record festival traffic.");

    const withheld = buildMarketWatch(
      input({
        claims: [
          {
            ...input().claims[0]!,
            quotation: "Record festival traffic.",
          },
        ],
        allowBoundedQuotes: false,
      }),
    );
    expect(withheld.signals[0]!.quotation).toBeNull();
  });

  it("uses the earliest supporting retrieval for signal freshness", () => {
    const laterSourceId = "94000000-0000-4000-8000-000000000094";
    const watch = buildMarketWatch(
      input({
        sources: [
          ...input().sources,
          {
            ...input().sources[0]!,
            id: laterSourceId,
            key: "public-notice-mirror",
            retrievedAt: "2026-09-01T12:00:00Z",
          },
        ],
        links: [
          ...input().links,
          { claimId, sourceId: laterSourceId, relatedClaimId: null, relation: "supports" },
        ],
      }),
    );

    expect(watch.signals[0]).toMatchObject({ retrievedAt: "2026-09-01T10:00:00Z" });
  });

  it("exposes failed requests for operator retry without mutation", () => {
    const watch = buildMarketWatch(
      input({
        requests: [
          {
            id: "20000000-0000-4000-8000-000000000002",
            kind: "market_research",
            triggerReason: "daily_due",
            status: "failed",
            dueAt: "2026-09-02T06:00:00Z",
            safeFailureCode: "ADAPTER_UNAVAILABLE",
            correlationId: "60000000-0000-4000-8000-000000000006",
            attemptCount: 1,
            maxAttempts: 5,
          },
        ],
      }),
    );

    expect(watch.retryableRequests).toEqual([
      expect.objectContaining({
        requestId: "20000000-0000-4000-8000-000000000002",
        status: "failed",
        safeFailureCode: "ADAPTER_UNAVAILABLE",
      }),
    ]);
  });
});
