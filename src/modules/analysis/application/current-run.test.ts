import { describe, expect, it } from "vitest";

import {
  createAnalysisEvidenceDigest,
  createWindowAnalysisCacheKey,
} from "@/domain/analysis/digest";
import {
  CHANNEL_ANALYSIS_REGISTRY_VERSION,
  requiredMetricKeys,
  selectDetectors,
} from "@/domain/analysis/registry";
import { resolveCurrentChannelRun } from "@/modules/analysis/application/current-run";

const ORG = "10000000-0000-4000-8000-000000000001";
const CHANNEL = "20000000-0000-4000-8000-000000000002";
const evidence = {
  points: [],
  exactRangePoints: [],
  projectionRuns: [],
  heldEvidence: [],
  incomparablePointCount: 0,
};
const scope = {
  organizationId: ORG,
  channelId: CHANNEL,
  branchId: null,
  windowStart: "2026-08-01",
  windowEnd: "2026-08-31",
  grain: "month" as const,
  timeZone: "Asia/Dubai",
};

const detectors = selectDetectors({ scope: "channel", grain: "month" });
const cacheKey = createWindowAnalysisCacheKey({
  organizationId: ORG,
  channelId: CHANNEL,
  branchId: null,
  windowStart: "2026-08-01",
  windowEnd: "2026-08-31",
  timeZone: "Asia/Dubai",
  grain: "month",
  registryVersion: CHANNEL_ANALYSIS_REGISTRY_VERSION,
  detectorVersions: detectors.map(({ key, calculationVersion }) => ({ key, calculationVersion })),
  metricKeys: requiredMetricKeys(detectors).sort(),
  evidenceDigest: createAnalysisEvidenceDigest(evidence),
});

describe("current channel analysis reuse", () => {
  it("waits for narration of observations even when there are no problem findings", async () => {
    const result = await resolveCurrentChannelRun(scope, {
      loadRun: async () => ({
        id: "run-1",
        status: "completed",
        cacheKey,
        findingCount: 0,
        observationCount: 14,
        needsDataCount: 5,
        recommendationCount: 0,
      }),
      loadEvidence: async () => evidence,
    });
    expect(result).toEqual({ kind: "narrating", analysisRunId: "run-1" });
  });
  it("reuses a completed run with zero findings when the evidence key matches", async () => {
    const result = await resolveCurrentChannelRun(scope, {
      loadRun: async () => ({
        id: "run-1",
        status: "completed",
        cacheKey,
        findingCount: 0,
        recommendationCount: 0,
      }),
      loadEvidence: async () => evidence,
    });
    expect(result).toEqual({ kind: "ready", analysisRunId: "run-1" });
  });

  it("rejects a previously completed run when governed evidence changed", async () => {
    const result = await resolveCurrentChannelRun(scope, {
      loadRun: async () => ({
        id: "run-1",
        status: "completed",
        cacheKey: "a".repeat(64),
        findingCount: 2,
        recommendationCount: 3,
      }),
      loadEvidence: async () => evidence,
    });
    expect(result).toEqual({ kind: "stale" });
  });

  it("asks to wake narration for current findings with no filed recommendations", async () => {
    const result = await resolveCurrentChannelRun(scope, {
      loadRun: async () => ({
        id: "run-1",
        status: "completed",
        cacheKey,
        findingCount: 2,
        recommendationCount: 0,
      }),
      loadEvidence: async () => evidence,
    });
    expect(result).toEqual({ kind: "narrating", analysisRunId: "run-1" });
  });
});
