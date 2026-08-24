import { logger, schedules, schemaTask } from "@trigger.dev/sdk";

import { findingHeadline, needsDataSentence } from "@/domain/analysis/copy";
import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";
import { createAnalysisWorkerServiceClient } from "@/lib/supabase/service";
import { createRecommendationGenerationProvider } from "@/modules/analysis/infrastructure/recommendation-generation-provider";
import type { NarrationPromptFinding } from "@/workflows/analysis/recommendation-prompt";
import {
  channelRecommendationsTaskSchema,
  runChannelRecommendations,
  type ChannelRecommendationsClaim,
  type ChannelRecommendationWindow,
} from "@/workflows/analysis/run-channel-recommendations";

/**
 * The narrator's Trigger wiring.
 *
 * Two tasks, both thin: every rule lives in the workflow module or in the
 * database fence, and this file only builds the courier — a service client for
 * the fenced RPCs, a findings reader scoped to one run, and the configured
 * generation provider — then hands them over.
 *
 * See `specs/018-governed-channel-intelligence.md` sections 11.3–11.4 and
 * ADRs 0037–0038.
 */

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

export { channelRecommendationsTaskSchema };

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * One stored finding row becomes the narrator's folder entry.
 *
 * The headline and the needs-data sentence are the same deterministic copy the
 * workspace renders (`read-model.ts`), so a recommendation can never describe a
 * finding in words the operator was not already shown. `valueSummary` stays
 * null: no figure travels to the model that the finding row itself does not
 * state, and composing prose around numbers is not this layer's job.
 */
function toNarrationFinding(row: {
  id: string;
  detector_key: string;
  kind: string;
  code: string;
  needs_data_reason: string | null;
  limitations: unknown;
}): NarrationPromptFinding {
  return {
    id: row.id,
    detectorKey: row.detector_key,
    kind: row.kind,
    code: row.code,
    headline: findingHeadline(row.code),
    detail: row.needs_data_reason ? needsDataSentence(row.needs_data_reason) : null,
    valueSummary: null,
    limitations: toStringArray(row.limitations),
  };
}

/**
 * The claim RPC's answer, trusted only after its shape is checked.
 *
 * The same defensive read-back as the analysis worker: a resumed lease belongs
 * to whatever the first attempt bound, so the window is echoed by the database,
 * never reconstructed here.
 */
function toClaim(data: Record<string, unknown> | null): ChannelRecommendationsClaim {
  const outcome = typeof data?.outcome === "string" ? data.outcome : "conflict";
  if (outcome !== "acquired") {
    // Anything outside the RPC's own vocabulary lands on conflict, the one
    // refusal that claims nothing about why.
    return {
      outcome:
        outcome === "completed" ||
        outcome === "not_found" ||
        outcome === "not_ready" ||
        outcome === "in_progress"
          ? outcome
          : "conflict",
    };
  }
  const windowStart = data?.windowStart;
  const windowEnd = data?.windowEnd;
  const periodGrain = data?.periodGrain;
  if (
    typeof windowStart !== "string" ||
    typeof windowEnd !== "string" ||
    typeof periodGrain !== "string"
  ) {
    return { outcome: "conflict" };
  }
  const window: ChannelRecommendationWindow = { windowStart, windowEnd, periodGrain };
  return { outcome: "acquired", window };
}

function recommendationGenerator() {
  const modelId = env.RECOMMENDATION_TEXT_MODEL;
  if (!modelId) {
    throw new DomainError(
      "INTEGRATION_ERROR",
      "No recommendation text model is configured (RECOMMENDATION_TEXT_MODEL).",
    );
  }
  return createRecommendationGenerationProvider({ modelId });
}

export const channelRecommendationsTask = schemaTask({
  id: "channel-recommendations.generate",
  schema: channelRecommendationsTaskSchema,
  retry,
  maxDuration: 300,
  queue: { concurrencyLimit: 2 },
  run: async (payload) => {
    // Built after the strict payload parse, never at module scope: the service
    // credential must not exist for a request nobody validated.
    const supabase = createAnalysisWorkerServiceClient();
    const rpc = async <
      Name extends
        | "claim_channel_recommendations"
        | "complete_channel_recommendations"
        | "fail_channel_recommendations",
    >(
      name: Name,
      args: Database["public"]["Functions"][Name]["Args"],
    ) => {
      const { data, error } = await supabase.rpc(name, args);
      if (error) throw new Error(`Channel recommendation state transition failed: ${error.code}`);
      return data;
    };

    const result = await runChannelRecommendations(payload, {
      async claim(input) {
        const data = await rpc("claim_channel_recommendations", {
          p_organization_id: input.organizationId,
          p_analysis_run_id: input.analysisRunId,
          p_correlation_id: input.correlationId,
          p_claim_token: input.claimToken,
        });
        return toClaim(data);
      },
      async loadFindings(input) {
        const { data, error } = await supabase
          .from("channel_findings")
          .select("id, detector_key, kind, code, needs_data_reason, limitations")
          .eq("organization_id", input.organizationId)
          .eq("analysis_run_id", input.analysisRunId);
        if (error) throw new Error(`Channel findings load failed: ${error.code}`);
        return (data ?? []).map(toNarrationFinding);
      },
      generator: recommendationGenerator(),
      async complete(input) {
        await rpc("complete_channel_recommendations", {
          p_organization_id: input.organizationId,
          p_analysis_run_id: input.analysisRunId,
          p_claim_token: input.claimToken,
          p_provider: input.provider,
          p_model_id: input.modelId,
          p_prompt_version: input.promptVersion,
          p_prompt_digest: input.promptDigest,
          p_output_digest: input.outputDigest,
          p_result_digest: input.resultDigest,
          p_recommendations: input.items,
        });
      },
      async fail(input) {
        await rpc("fail_channel_recommendations", {
          p_organization_id: input.organizationId,
          p_analysis_run_id: input.analysisRunId,
          p_claim_token: input.claimToken,
          p_failure_code: input.code,
          p_result_digest: input.resultDigest,
        });
      },
    });

    // Counts and identifiers only. No figure and no cited row travels to a log.
    logger.info("channel_recommendations.run_completed", {
      organizationId: payload.organizationId,
      channelId: payload.channelId,
      analysisRunId: payload.analysisRunId,
      correlationId: payload.correlationId,
      outcome: result.outcome,
      recommendationCount: result.recommendationCount,
    });
    return result;
  },
});

/**
 * The quality judge's slot (ADR 0038), every forty-eight hours at 03:00 UTC.
 *
 * Task 13 ships the evaluation workflow this delegates to; until it lands the
 * schedule fires into an honest refusal rather than a silent success. The body
 * stays thin so wiring Task 13 in is swapping one import.
 *
 * `schedules.task` rather than `schemaTask`: the cron payload is fixed by
 * Trigger.dev, so there is no caller-supplied payload to validate.
 */
export const evaluateRecommendationsTask = schedules.task({
  id: "channel-recommendations.evaluate",
  cron: "0 3 */2 * *",
  retry,
  maxDuration: 300,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    throw new Error(
      "NOT_IMPLEMENTED: channel-recommendation evaluations arrive with Task 13 (runChannelRecommendationEvaluations).",
    );
  },
});
