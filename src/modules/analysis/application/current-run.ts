import {
  createAnalysisEvidenceDigest,
  createWindowAnalysisCacheKey,
} from "@/domain/analysis/digest";
import {
  CHANNEL_ANALYSIS_REGISTRY_VERSION,
  requiredMetricKeys,
  selectDetectors,
} from "@/domain/analysis/registry";
import type { AnalysisGrain } from "@/domain/analysis/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ChannelAnalysisEvidenceLoad } from "@/workflows/analysis/run-channel-analysis";

export type CurrentChannelRunScope = {
  organizationId: string;
  channelId: string;
  branchId: string | null;
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
  timeZone: string;
};

export type CurrentChannelRunResult =
  | { kind: "missing" | "stale" | "running" | "failed" }
  | { kind: "ready" | "narrating"; analysisRunId: string };

/** Same evidence identity as the worker claim, checked before a cached HTTP response. */
export async function resolveCurrentChannelRun(
  scope: CurrentChannelRunScope,
  reads: {
    loadRun: () => Promise<{
      id: string;
      status: "running" | "completed" | "failed";
      cacheKey: string | null;
      findingCount: number;
      observationCount?: number;
      needsDataCount?: number;
      recommendationCount: number;
    } | null>;
    loadEvidence: (metricKeys: readonly string[]) => Promise<ChannelAnalysisEvidenceLoad>;
  },
): Promise<CurrentChannelRunResult> {
  const run = await reads.loadRun();
  if (!run) return { kind: "missing" };
  if (run.status === "running") return { kind: "running" };
  if (run.status === "failed") return { kind: "failed" };
  if (!run.cacheKey) return { kind: "stale" };

  const detectors = selectDetectors({ scope: "channel", grain: scope.grain });
  if (detectors.length === 0) return { kind: "stale" };
  const metricKeys = requiredMetricKeys(detectors);
  const evidence = await reads.loadEvidence(metricKeys);
  const currentKey = createWindowAnalysisCacheKey({
    organizationId: scope.organizationId,
    channelId: scope.channelId,
    branchId: scope.branchId,
    windowStart: scope.windowStart,
    windowEnd: scope.windowEnd,
    timeZone: scope.timeZone,
    grain: scope.grain,
    registryVersion: CHANNEL_ANALYSIS_REGISTRY_VERSION,
    detectorVersions: detectors.map(({ key, calculationVersion }) => ({ key, calculationVersion })),
    metricKeys: [...metricKeys].sort(),
    evidenceDigest: createAnalysisEvidenceDigest(evidence),
  });
  if (run.cacheKey !== currentKey) return { kind: "stale" };
  const outcomeCount = run.findingCount + (run.observationCount ?? 0) + (run.needsDataCount ?? 0);
  if (outcomeCount === 0 || run.recommendationCount > 0) {
    return { kind: "ready", analysisRunId: run.id };
  }
  return { kind: "narrating", analysisRunId: run.id };
}

/** Session client only: RLS and tenant predicates also apply to the digest read. */
export async function resolveCurrentChannelRunForRequest(
  supabase: SupabaseClient<Database>,
  scope: CurrentChannelRunScope,
): Promise<CurrentChannelRunResult> {
  const [analysisModule, evidenceModule, metricsModule] = await Promise.all([
    import("@/modules/analysis/infrastructure/read-repository"),
    import("@/modules/analysis/infrastructure/evidence-repository"),
    import("@/modules/metrics/infrastructure/repository"),
  ]);
  const runs = analysisModule.createAuthenticatedChannelAnalysisRepository(supabase);
  const evidence = evidenceModule.createChannelAnalysisEvidenceRepository(
    supabase,
    metricsModule.createGovernedMetricWindowRepository(supabase),
  );
  return resolveCurrentChannelRun(scope, {
    loadRun: () =>
      runs.loadRunForWindow({
        organizationId: scope.organizationId,
        channelId: scope.channelId,
        branchId: scope.branchId,
        windowStart: scope.windowStart,
        windowEnd: scope.windowEnd,
      }),
    loadEvidence: (metricKeys) =>
      evidence.load({
        window: {
          organizationId: scope.organizationId,
          channelId: scope.channelId,
          branchId: scope.branchId,
          windowStart: scope.windowStart,
          windowEnd: scope.windowEnd,
          grain: scope.grain,
          timeZone: scope.timeZone,
        },
        metricKeys,
      }),
  });
}
