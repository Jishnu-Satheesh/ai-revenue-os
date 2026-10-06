import { describe, expect, it } from "vitest";

import {
  buildResearchPipelineView,
  clampHistoryLimit,
  decodeResearchHistoryCursor,
  describeResearchActivityEvent,
  encodeResearchHistoryCursor,
  RESEARCH_HISTORY_DEFAULT_LIMIT,
  RESEARCH_HISTORY_MAX_LIMIT,
  researchRetryPath,
  researchStatusPath,
  resolveRetryEligibility,
  summarizeResearchSettings,
  type ResearchPipelineRowInput,
} from "@/modules/growth-intelligence/application/research-read-model";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000002";
const pipelineId = "30000000-0000-4000-8000-000000000003";
const profileId = "40000000-0000-4000-8000-000000000004";
const versionId = "50000000-0000-4000-8000-000000000005";
const requestId = "60000000-0000-4000-8000-000000000006";

function versionDocument() {
  return {
    schemaVersion: 2,
    branchId,
    topics: [
      { key: "vegan", label: "Vegan options", provenance: "operator" },
      { key: "delivery", label: "Late delivery", provenance: "operator" },
    ],
    competitors: [{ key: "rival", name: "Rival Kitchen" }],
    geographies: [
      { layer: "trade_area", locationRef: " Marina ", name: "Marina" },
      { layer: "city", locationRef: "dubai", name: "Dubai", countryCode: "AE" },
      { layer: "country", locationRef: "ae", name: "UAE", countryCode: "AE" },
    ],
  };
}

function rowInput(overrides: Partial<ResearchPipelineRowInput> = {}): ResearchPipelineRowInput {
  return {
    pipelineId,
    organizationId,
    branchId,
    marketProfileId: profileId,
    marketProfileVersionId: versionId,
    researchRequestId: requestId,
    synthesisRequestId: null,
    stage: "ready",
    coverage: [{ slotKey: "local", kind: "local_market", outcome: "supported" }],
    observedAt: "2026-09-01T08:00:00.000Z",
    stageChangedAt: "2026-09-02T09:00:00.000Z",
    safeFailureCode: null,
    branchName: "Marina",
    versionDocument: versionDocument(),
    currentVersionId: versionId,
    sources: [],
    claimCount: 0,
    ...overrides,
  };
}

describe("buildResearchPipelineView", () => {
  it("returns ids, branch, stage, timestamps, settings, coverage, counts and outcome links", () => {
    const view = buildResearchPipelineView(
      rowInput({
        sources: [
          {
            id: "90000000-0000-4000-8000-000000000009",
            url: "https://example.com/review",
            domain: "example.com",
            publisher: "Example",
            sourceClass: "public_signal",
            availability: "available",
            erasedAt: null,
            retrievedAt: "2026-09-01T10:00:00.000Z",
            publishedAt: null,
            observedAt: null,
          },
        ],
        claimCount: 3,
      }),
    );

    expect(view.pipelineId).toBe(pipelineId);
    expect(view.organizationId).toBe(organizationId);
    expect(view.branchId).toBe(branchId);
    expect(view.scopeLabel).toBe("Marina");
    expect(view.legacyScope).toBe(false);
    expect(view.stage).toBe("ready");
    expect(view.stageDisplay).toBe("Ready");
    expect(view.active).toBe(false);
    expect(view.observedAt).toBe("2026-09-01T08:00:00.000Z");
    expect(view.stageChangedAt).toBe("2026-09-02T09:00:00.000Z");
    expect(view.settingsSummary?.topics).toEqual(["Vegan options", "Late delivery"]);
    expect(view.settingsSummary?.competitorNames).toEqual(["Rival Kitchen"]);
    expect(view.settingsSummary?.city).toBe("Dubai");
    expect(view.settingsSummary?.countryCode).toBe("AE");
    expect(view.settingsMatchCurrent).toBe(true);
    expect(view.coverage).toEqual([
      expect.objectContaining({ slotKey: "local", outcome: "supported" }),
    ]);
    expect(view.sourceCount).toBe(1);
    expect(view.claimCount).toBe(3);
    expect(view.safeFailureCode).toBeNull();
    expect(view.outcomeLinks.self).toBe(researchStatusPath(organizationId, pipelineId));
    expect(view.outcomeLinks.retry).toBeNull();
    expect(view.outcomeLinks.workspace).toContain(organizationId);
  });

  it("keeps prior settings on a failed replacement instead of current settings", () => {
    const view = buildResearchPipelineView(
      rowInput({
        stage: "research_failed",
        safeFailureCode: "SEARCH_TIMEOUT",
        marketProfileVersionId: "50000000-0000-4000-8000-000000000099",
        currentVersionId: versionId,
      }),
    );

    // The row carries its own version document; the builder never substitutes
    // the current profile settings.
    expect(view.settingsSummary?.topics).toEqual(["Vegan options", "Late delivery"]);
    expect(view.settingsMatchCurrent).toBe(false);
    expect(view.safeFailureCode).toBe("SEARCH_TIMEOUT");
  });

  it("labels legacy organization scope when the version document is v1", () => {
    const view = buildResearchPipelineView(
      rowInput({
        branchName: "Marina",
        versionDocument: {
          schemaVersion: 1,
          topics: [{ key: "vegan", label: "Vegan options", provenance: "operator" }],
          competitors: [],
          geographies: [],
        },
      }),
    );

    expect(view.scopeLabel).toBe("Organization");
    expect(view.legacyScope).toBe(true);
  });

  it("labels legacy organization scope when the branch record is gone", () => {
    const view = buildResearchPipelineView(rowInput({ branchName: null }));

    expect(view.scopeLabel).toBe("Organization");
    expect(view.legacyScope).toBe(true);
  });

  it("renders erased and unavailable sources as source-unavailable without raw content", () => {
    const view = buildResearchPipelineView(
      rowInput({
        sources: [
          {
            id: "90000000-0000-4000-8000-000000000009",
            url: "https://example.com/erased",
            domain: "example.com",
            publisher: "Example",
            sourceClass: "public_signal",
            availability: "available",
            erasedAt: "2026-09-03T00:00:00.000Z",
            retrievedAt: "2026-09-01T10:00:00.000Z",
            publishedAt: null,
            observedAt: null,
          },
          {
            id: "90000000-0000-4000-8000-000000000010",
            url: "https://example.com/down",
            domain: "example.com",
            publisher: null,
            sourceClass: "official",
            availability: "unavailable",
            erasedAt: null,
            retrievedAt: "2026-09-01T10:00:00.000Z",
            publishedAt: null,
            observedAt: null,
          },
        ],
      }),
    );

    expect(view.sources.map((source) => source.availability)).toEqual([
      "source-unavailable",
      "source-unavailable",
    ]);
    for (const source of view.sources) {
      expect(source).not.toHaveProperty("excerptText");
      expect(source).not.toHaveProperty("quotation");
      expect(source).not.toHaveProperty("contentDigest");
    }
  });

  it("marks synthesis failure retry-eligible and keeps findings linked", () => {
    const view = buildResearchPipelineView(rowInput({ stage: "synthesis_failed" }));

    expect(view.retry.eligible).toBe(true);
    expect(view.retry.reason).toBeNull();
    expect(view.outcomeLinks.retry).toBe(researchRetryPath(organizationId, pipelineId));
    // Findings stay available after synthesis failure: the workspace link stays live.
    expect(view.outcomeLinks.workspace).toContain(organizationId);
  });

  it("refuses retry for active, ready and replaced stages with honest reasons", () => {
    expect(resolveRetryEligibility("researching").eligible).toBe(false);
    expect(resolveRetryEligibility("ready").eligible).toBe(false);
    expect(resolveRetryEligibility("cancelled").eligible).toBe(false);
    expect(resolveRetryEligibility("research_failed").eligible).toBe(false);
    for (const stage of ["researching", "ready", "cancelled", "research_failed"] as const) {
      expect(resolveRetryEligibility(stage).reason).toMatch(/.{10,}/);
    }
  });

  it("fails closed on unknown stages and malformed coverage", () => {
    expect(() => buildResearchPipelineView(rowInput({ stage: "celebrating" }))).toThrow();
    expect(() => buildResearchPipelineView(rowInput({ coverage: [{ slotKey: "x" }] }))).toThrow();
  });

  it("keeps a null settings summary instead of failing the whole read", () => {
    const view = buildResearchPipelineView(rowInput({ versionDocument: null }));

    expect(view.settingsSummary).toBeNull();
    expect(view.stage).toBe("ready");
  });
});

describe("summarizeResearchSettings", () => {
  it("returns null for unknown documents", () => {
    expect(summarizeResearchSettings(null)).toBeNull();
    expect(summarizeResearchSettings({ schemaVersion: 99 })).toBeNull();
  });
});

describe("history pagination", () => {
  it("defaults to 10 and caps at 50", () => {
    expect(RESEARCH_HISTORY_DEFAULT_LIMIT).toBe(10);
    expect(RESEARCH_HISTORY_MAX_LIMIT).toBe(50);
    expect(clampHistoryLimit(undefined)).toBe(10);
    expect(clampHistoryLimit(50)).toBe(50);
    expect(clampHistoryLimit(500)).toBe(50);
    expect(clampHistoryLimit(0)).toBe(10);
  });

  it("round-trips an opaque keyset cursor", () => {
    const cursor = encodeResearchHistoryCursor({
      createdAt: "2026-09-02T09:00:00.000Z",
      id: pipelineId,
    });
    expect(decodeResearchHistoryCursor(cursor)).toEqual({
      createdAt: "2026-09-02T09:00:00.000Z",
      id: pipelineId,
    });
    expect(decodeResearchHistoryCursor(null)).toBeNull();
    expect(decodeResearchHistoryCursor("not-a-cursor")).toBeNull();
  });
});

describe("describeResearchActivityEvent", () => {
  it("names the start and terminal outcome without invented progress", () => {
    const started = describeResearchActivityEvent({
      kind: "started",
      pipelineId,
      branchId,
      scopeLabel: "Marina",
      stage: "researching",
      occurredAt: "2026-09-01T08:00:00.000Z",
    });
    expect(started.title).toContain("Marina");
    expect(started.title).not.toMatch(/%/);

    const finished = describeResearchActivityEvent({
      kind: "finished",
      pipelineId,
      branchId,
      scopeLabel: "Marina",
      stage: "ready",
      occurredAt: "2026-09-02T09:00:00.000Z",
    });
    expect(finished.title).toContain("Ready");
  });

  it("labels retries distinctly", () => {
    const retried = describeResearchActivityEvent({
      kind: "retried",
      pipelineId,
      branchId,
      scopeLabel: "Marina",
      stage: "preparing_insights",
      occurredAt: "2026-09-03T09:00:00.000Z",
    });
    expect(retried.title).toMatch(/retr/i);
  });
});
