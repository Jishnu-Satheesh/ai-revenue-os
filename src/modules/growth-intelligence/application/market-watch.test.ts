import { describe, expect, it } from "vitest";

import type { MarketProfileView } from "@/modules/growth-intelligence/application/ports";
import {
  buildMarketWatch,
  buildMarketWatchProjectList,
  countMarketWatchProjectsByStatus,
  filterMarketWatchProjects,
  selectFeaturedMarketWatchReport,
  type MarketWatchInput,
  type MarketWatchProjectFailedUpdate,
  type MarketWatchProjectListItem,
  type MarketWatchProjectRecord,
  type MarketWatchProjectReportSummary,
  type MarketWatchProjectRevisionSummary,
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

const downtownId = "20000000-0000-4000-8000-000000000002";
const marinaId = "21000000-0000-4000-8000-000000000021";

function projectRecord(overrides: Partial<MarketWatchProjectRecord> = {}): MarketWatchProjectRecord {
  return {
    projectId: "50000000-0000-4000-8000-000000000005",
    organizationId,
    branchId: downtownId,
    branchName: "Downtown",
    title: "Prepare for National Day",
    question: "How should we prepare for National Day?",
    mode: "one-time",
    lifecycle: "active",
    createdAt: "2026-09-10T10:00:00Z",
    ...overrides,
  };
}

function reportSummary(
  overrides: Partial<MarketWatchProjectReportSummary> = {},
): MarketWatchProjectReportSummary {
  return {
    reportVersionId: "60000000-0000-4000-8000-000000000006",
    briefRevisionId: "61000000-0000-4000-8000-000000000061",
    reviewState: "pending_review",
    createdAt: "2026-09-12T10:00:00Z",
    takeaway: "Compare family offers and check delivery capacity before choosing a promotion.",
    ...overrides,
  };
}

function revisionSummary(
  overrides: Partial<MarketWatchProjectRevisionSummary> = {},
): MarketWatchProjectRevisionSummary {
  return {
    revisionId: "61000000-0000-4000-8000-000000000061",
    revisionNumber: 1,
    pinnedToUpdateId: "62000000-0000-4000-8000-000000000062",
    createdAt: "2026-09-10T11:00:00Z",
    ...overrides,
  };
}

function projectList(
  records: MarketWatchProjectRecord[],
  reports: Record<string, MarketWatchProjectReportSummary[]> = {},
  revisions: Record<string, MarketWatchProjectRevisionSummary[]> = {},
  failed: Record<string, MarketWatchProjectFailedUpdate[]> = {},
): MarketWatchProjectListItem[] {
  return buildMarketWatchProjectList({
    projects: records,
    reportsByProject: new Map(Object.entries(reports)),
    revisionsByProject: new Map(Object.entries(revisions)),
    failedUpdatesByProject: new Map(Object.entries(failed)),
  });
}

describe("buildMarketWatchProjectList", () => {
  it("marks a project ready when its latest brief scope has a persisted report", () => {
    const record = projectRecord();
    const [item] = projectList([record], { [record.projectId]: [reportSummary()] }, {
      [record.projectId]: [revisionSummary()],
    });

    expect(item!.displayState).toBe("ready");
    expect(item!.stateLabel).toBe("Ready to review");
    expect(item!.latestReport?.takeaway).toContain("delivery capacity");
    expect(item!.priorReport).toBeNull();
  });

  it("marks a pinned scope without a report as researching and retains the prior report", () => {
    const record = projectRecord();
    const prior = reportSummary({
      reportVersionId: "63000000-0000-4000-8000-000000000063",
      briefRevisionId: "64000000-0000-4000-8000-000000000064",
      createdAt: "2026-09-08T10:00:00Z",
    });
    const [item] = projectList(
      [record],
      { [record.projectId]: [prior] },
      {
        [record.projectId]: [
          revisionSummary({ revisionId: "65000000-0000-4000-8000-000000000065", revisionNumber: 2 }),
        ],
      },
    );

    expect(item!.displayState).toBe("researching");
    expect(item!.stateLabel).toBe("Researching");
    expect(item!.priorReport?.reportVersionId).toBe(prior.reportVersionId);
  });

  it("keeps paused projects distinct and links their prior report", () => {
    const record = projectRecord({ lifecycle: "paused", title: "Local customer feedback" });
    const [item] = projectList([record], { [record.projectId]: [reportSummary()] }, {
      [record.projectId]: [revisionSummary()],
    });

    expect(item!.displayState).toBe("paused");
    expect(item!.stateLabel).toBe("Monitoring paused");
    expect(item!.priorReport?.reportVersionId).toBe("60000000-0000-4000-8000-000000000006");
  });

  it("marks an active project with nothing pinned and nothing persisted as needing attention", () => {
    const record = projectRecord({ title: "Weekend delivery opportunity" });
    const [item] = projectList([record]);

    expect(item!.displayState).toBe("needs_attention");
    expect(item!.stateLabel).toBe("Needs attention");
    expect(item!.latestReport).toBeNull();
    expect(item!.priorReport).toBeNull();
  });

  it("marks a pinned scope whose update terminally failed with no report as failed, not researching", () => {
    const record = projectRecord();
    const revision = revisionSummary();
    const [item] = projectList(
      [record],
      {},
      { [record.projectId]: [revision] },
      {
        [record.projectId]: [{ updateId: revision.pinnedToUpdateId!, stage: "research_failed" }],
      },
    );

    expect(item!.displayState).toBe("failed");
    expect(item!.stateLabel).toBe("Research could not finish");
    expect(item!.priorReport).toBeNull();
  });

  it("keeps a failed update for an older pin from shadowing the latest researching scope", () => {
    const record = projectRecord();
    const latest = revisionSummary({
      revisionId: "66000000-0000-4000-8000-000000000066",
      revisionNumber: 2,
      pinnedToUpdateId: "67000000-0000-4000-8000-000000000067",
    });
    const [item] = projectList(
      [record],
      {},
      { [record.projectId]: [latest] },
      {
        [record.projectId]: [
          { updateId: "62000000-0000-4000-8000-000000000062", stage: "research_failed" },
        ],
      },
    );

    expect(item!.displayState).toBe("researching");
  });

  it("keeps a reported revision ready even when its update also settled terminally", () => {
    const record = projectRecord();
    const revision = revisionSummary();
    const [item] = projectList(
      [record],
      { [record.projectId]: [reportSummary({ briefRevisionId: revision.revisionId })] },
      { [record.projectId]: [revision] },
      { [record.projectId]: [{ updateId: revision.pinnedToUpdateId!, stage: "research_failed" }] },
    );

    expect(item!.displayState).toBe("ready");
  });

  it("never invents progress figures or promises on any row", () => {
    const items = projectList(
      [projectRecord(), projectRecord({ projectId: "51000000-0000-4000-8000-000000000051" })],
      {},
      {},
    );

    for (const item of items) {
      expect(JSON.stringify(item)).not.toMatch(/percent|progress|eta|complete in/i);
    }
  });
});

describe("filterMarketWatchProjects", () => {
  const ready = projectRecord();
  const researching = projectRecord({
    projectId: "51000000-0000-4000-8000-000000000051",
    title: "Competitor monitoring",
    question: "Which nearby competitors changed their offers this week?",
    mode: "recurring",
  });
  const paused = projectRecord({
    projectId: "52000000-0000-4000-8000-000000000052",
    branchId: marinaId,
    branchName: "Marina",
    title: "Local customer feedback",
    question: "What do regulars praise or complain about?",
    lifecycle: "paused",
  });
  const items = projectList(
    [ready, researching, paused],
    {
      [ready.projectId]: [reportSummary()],
      [paused.projectId]: [reportSummary({ reportVersionId: "66000000-0000-4000-8000-000000000066" })],
    },
    {
      [ready.projectId]: [revisionSummary()],
      [researching.projectId]: [
        revisionSummary({ revisionId: "67000000-0000-4000-8000-000000000067", revisionNumber: 1 }),
      ],
      [paused.projectId]: [revisionSummary()],
    },
  );

  it("filters the list and the featured report by location consistently", () => {
    const downtown = filterMarketWatchProjects(items, {
      branchId: downtownId,
      search: "",
      status: "all",
    });

    expect(downtown.map((item) => item.projectId).sort()).toEqual(
      [ready.projectId, researching.projectId].sort(),
    );
    expect(selectFeaturedMarketWatchReport(downtown)?.projectId).toBe(ready.projectId);

    const marina = filterMarketWatchProjects(items, {
      branchId: marinaId,
      search: "",
      status: "all",
    });
    expect(selectFeaturedMarketWatchReport(marina)).toBeNull();
  });

  it("matches search text literally across title, question and location", () => {
    const matched = filterMarketWatchProjects(items, {
      branchId: null,
      search: "national day",
      status: "all",
    });
    expect(matched.map((item) => item.projectId)).toEqual([ready.projectId]);

    const none = filterMarketWatchProjects(items, {
      branchId: null,
      search: "no such project here",
      status: "all",
    });
    expect(none).toEqual([]);
  });

  it("counts each status once for the compact filter buttons", () => {
    expect(countMarketWatchProjectsByStatus(items)).toEqual({
      all: 3,
      ready: 1,
      in_progress: 1,
      paused: 1,
      needs_attention: 0,
    });
  });

  it("features the first ready report and nothing when no report is ready", () => {
    expect(selectFeaturedMarketWatchReport(items)?.projectId).toBe(ready.projectId);
    const withoutReady = filterMarketWatchProjects(items, {
      branchId: null,
      search: "",
      status: "in_progress",
    });
    expect(selectFeaturedMarketWatchReport(withoutReady)).toBeNull();
  });

  it("counts failed rows under needs attention and keeps them out of in progress", () => {
    const record = projectRecord({ projectId: "53000000-0000-4000-8000-000000000053" });
    const revision = revisionSummary();
    const failed = projectList(
      [record],
      {},
      { [record.projectId]: [revision] },
      {
        [record.projectId]: [{ updateId: revision.pinnedToUpdateId!, stage: "synthesis_failed" }],
      },
    );

    expect(countMarketWatchProjectsByStatus(failed)).toMatchObject({
      all: 1,
      in_progress: 0,
      needs_attention: 1,
    });
    expect(
      filterMarketWatchProjects(failed, { branchId: null, search: "", status: "needs_attention" }),
    ).toHaveLength(1);
    expect(
      filterMarketWatchProjects(failed, { branchId: null, search: "", status: "in_progress" }),
    ).toHaveLength(0);
  });
});
