import { logger, schemaTask, tasks } from "@trigger.dev/sdk";

import { createAnalysisWorkerServiceClient } from "@/lib/supabase/service";
import { createChannelAnalysisEvidenceRepository } from "@/modules/analysis/infrastructure/evidence-repository";
import { createGovernedMetricWindowRepository } from "@/modules/metrics/infrastructure/repository";
import type { channelRecommendationsTask } from "@/trigger/recommendations";
import {
  channelAnalysisTaskSchema,
  runChannelAnalysis,
} from "@/workflows/analysis/run-channel-analysis";

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

export const channelAnalysisTask = schemaTask({
  id: "channel-analysis.run",
  schema: channelAnalysisTaskSchema,
  retry,
  maxDuration: 300,
  queue: { concurrencyLimit: 2 },
  run: async (payload) => {
    const supabase = createAnalysisWorkerServiceClient();
    const rpc = async <T>(
      name: "claim_channel_analysis" | "complete_channel_analysis" | "fail_channel_analysis",
      args: Record<string, unknown>,
    ) => {
      const { data, error } = await supabase.rpc(name, args as never);
      if (error) throw new Error(`Channel analysis state transition failed: ${error.code}`);
      return data as T;
    };
    const evidence = createChannelAnalysisEvidenceRepository(
      supabase,
      createGovernedMetricWindowRepository(supabase),
    );

    const result = await runChannelAnalysis(payload, {
      async claim(input) {
        const data = await rpc<Record<string, unknown> | null>("claim_channel_analysis", {
          p_organization_id: input.organizationId,
          p_channel_id: input.channelId,
          p_branch_id: input.branchId,
          p_window_start: input.windowStart,
          p_window_end: input.windowEnd,
          p_period_grain: input.periodGrain,
          p_analysis_run_id: input.analysisRunId,
          p_registry_version: input.registryVersion,
          p_detectors: input.detectors,
          p_metric_keys: input.metricKeys,
          p_idempotency_key: input.idempotencyKey,
          p_claim_token: input.claimToken,
          p_correlation_id: input.correlationId,
        });
        const outcome = typeof data?.outcome === "string" ? data.outcome : "conflict";
        if (outcome !== "acquired") {
          return {
            outcome: outcome as
              | "completed"
              | "not_found"
              | "not_ready"
              | "in_progress"
              | "conflict",
          };
        }
        const run = data?.analysisRun;
        const windowTimezone = data?.windowTimezone;
        if (!run || typeof run !== "object" || typeof windowTimezone !== "string") {
          return { outcome: "conflict" };
        }
        // Read back from the run rather than echoed from the request: a resumed
        // lease belongs to whatever the first attempt bound, and that is what
        // the findings will be filed under.
        const bound = (run as { detector_versions?: unknown }).detector_versions;
        if (!Array.isArray(bound)) return { outcome: "conflict" };
        return {
          outcome: "acquired",
          windowTimezone,
          boundDetectors: bound as { key: string; calculationVersion: number }[],
        };
      },
      async loadEvidence(input) {
        return evidence.load(input);
      },
      async complete(input) {
        await rpc("complete_channel_analysis", {
          p_organization_id: input.organizationId,
          p_analysis_run_id: input.analysisRunId,
          p_claim_token: input.claimToken,
          p_result_digest: input.resultDigest,
          p_findings: input.findings,
        });
      },
      async fail(input) {
        await rpc("fail_channel_analysis", {
          p_organization_id: input.organizationId,
          p_analysis_run_id: input.analysisRunId,
          p_claim_token: input.claimToken,
          p_failure_code: input.code,
          p_result_digest: input.resultDigest,
        });
      },
    });

    // A completed detector run wakes the narrator (ADR 0037). The dispatch is
    // best-effort by design: a missed narration must never fail the run that
    // already counted, and the claim fence makes a duplicate wake harmless.
    if (result.outcome === "completed") {
      try {
        await tasks.trigger<typeof channelRecommendationsTask>("channel-recommendations.generate", {
          organizationId: payload.organizationId,
          channelId: payload.channelId,
          analysisRunId: payload.analysisRunId,
          correlationId: payload.correlationId,
        });
      } catch (error) {
        logger.warn("channel_recommendations.dispatch_failed", {
          organizationId: payload.organizationId,
          channelId: payload.channelId,
          analysisRunId: payload.analysisRunId,
          correlationId: payload.correlationId,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
      }
    }

    // Counts and identifiers only. No figure and no cited row travels to a log.
    logger.info("channel_analysis.run_completed", {
      organizationId: payload.organizationId,
      channelId: payload.channelId,
      branchId: payload.branchId,
      analysisRunId: payload.analysisRunId,
      correlationId: payload.correlationId,
      outcome: result.outcome,
      findingCount: result.findingCount,
      needsDataCount: result.needsDataCount,
    });
    return result;
  },
});
