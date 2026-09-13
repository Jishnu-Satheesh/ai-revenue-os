import { logger, schedules, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { findingHeadline, needsDataSentence } from "@/domain/analysis/copy";
import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";
import { createAnalysisWorkerServiceClient } from "@/lib/supabase/service";
import { createRecommendationGenerationProvider } from "@/modules/analysis/infrastructure/recommendation-generation-provider";
import { createRecommendationJudgeProvider } from "@/modules/analysis/infrastructure/recommendation-judge-provider";
import type { NarrationPromptFinding } from "@/workflows/analysis/recommendation-prompt";
import {
  channelRecommendationsTaskSchema,
  runChannelRecommendations,
  type ChannelRecommendationsClaim,
  type ChannelRecommendationWindow,
} from "@/workflows/analysis/run-channel-recommendations";
import {
  isShareActiveStatus,
  resolveShareContext,
  type ShareContext,
} from "@/workflows/analysis/grounded-share-mode";
import {
  runChannelRecommendationEvaluations,
  type UnjudgedRecommendation,
} from "@/workflows/analysis/run-recommendation-evaluations";
import { loadRecommendationPilotContext } from "./recommendation-pilot-context";

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

/**
 * What the judge's loader accepts back from the database. The shape is the
 * workflow's `UnjudgedRecommendation` before its citations are flattened;
 * parsing here keeps a schema drift from reaching the judge as prose.
 */
const unjudgedRecommendationShape = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  label: z.enum(["observation", "recommendation", "needs_data"]),
  headline: z.string(),
  detail: z.string(),
  limitations: z.array(z.string()),
  prompt_version: z.number().int().min(1),
  channel_recommendation_citations: z.array(
    z.object({
      finding_id: z.string().uuid(),
      // A single embedded object, not an array: the citation's finding_id is
      // a many-to-one foreign key, and PostgREST embeds a to-one relationship
      // as one object (or null), never a list.
      channel_findings: z
        .object({
          detector_key: z.string().nullable(),
          kind: z.string().nullable(),
          code: z.string(),
          needs_data_reason: z.string().nullable(),
          value_kind: z.enum(["money", "count", "ratio"]).nullable(),
          value_numerator: z.number().nullable(),
          value_denominator: z.number().nullable(),
          monetary_impact_minor_units: z.number().nullable(),
          currency: z.string().nullable(),
          limitations: z.unknown(),
        })
        .nullable(),
    }),
  ),
  // Reverse embed over the provenance primary key (organization_id,
  // recommendation_id): zero rows when the narration ran evidence-only,
  // exactly one when it pinned a manifest. An array in PostgREST shape,
  // like the evaluations anti-join above. Default [] keeps older fixtures
  // (evidence-only by construction) parsing as context null.
  channel_recommendation_contexts: z
    .array(
      z.object({
        manifest_id: z.string().uuid(),
        share_mode: z.enum(["internal_only", "grounded_share"]),
        provided_refs: z.array(z.string()),
        cited_refs: z.array(z.string()),
      }),
    )
    .default([]),
});

export type ContextLookup = {
  manifestDigest: string | null;
  entries: { ref: string; summary: string; statementKind: string }[];
};

function toUnjudged(
  row: z.infer<typeof unjudgedRecommendationShape>,
  resolveContext: (manifestId: string) => ContextLookup | null = () => null,
): UnjudgedRecommendation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    label: row.label,
    headline: row.headline,
    detail: row.detail,
    limitations: row.limitations,
    promptVersion: row.prompt_version,
    citations: row.channel_recommendation_citations.map((citation) => {
      const finding = citation.channel_findings;
      return {
        findingId: citation.finding_id,
        detectorKey: finding?.detector_key ?? null,
        kind: finding?.kind ?? null,
        headline: finding ? findingHeadline(finding.code) : null,
        detail: finding?.needs_data_reason ? needsDataSentence(finding.needs_data_reason) : null,
        valueSummary: finding ? findingValueSummary(finding) : null,
        limitations: toStringArray(finding?.limitations),
      };
    }),
    context: contextFor(row, resolveContext),
  };
}

/**
 * The judge sees what the narration claims to rest on: cited refs resolved
 * against the pinned manifest, with the share mode that governed the call.
 * Provided-but-uncited entries informed wording, not claims, so they stay
 * out. Without a provenance row the answer is evidence-only and context is
 * null rather than an invented empty set.
 */
function contextFor(
  row: z.infer<typeof unjudgedRecommendationShape>,
  resolveContext: (manifestId: string) => ContextLookup | null,
): UnjudgedRecommendation["context"] {
  const provenance = row.channel_recommendation_contexts[0];
  if (!provenance) return null;
  const lookup = resolveContext(provenance.manifest_id);
  return {
    shareMode: provenance.share_mode,
    manifestDigest: lookup?.manifestDigest ?? null,
    refs: (lookup?.entries ?? [])
      .filter((entry) => provenance.cited_refs.includes(entry.ref))
      .map((entry) => ({
        ref: entry.ref,
        summary: entry.summary,
        statementKind: entry.statementKind,
      })),
  };
}

type WorkerSupabase = {
  from(table: string): {
    select(columns: string): UntypedSelect;
  };
};

type UntypedSelect = PromiseLike<{
  data: Record<string, unknown>[] | null;
  error: { code?: string; message?: string } | null;
}> & {
  eq(column: string, value: string): UntypedSelect;
  in(column: string, values: readonly string[]): UntypedSelect;
};

/**
 * One batched read of manifests and pinned entries for every provenance row
 * in the batch, keyed by organization and manifest. Entries carry bounded
 * safe snapshots, never prompts: the judge is an approved model boundary for
 * internal context, same as narration. Reads stay explicitly
 * organization-scoped even though the worker is service_role.
 */
async function loadContextLookups(
  supabase: WorkerSupabase,
  keys: { organizationId: string; manifestId: string }[],
): Promise<Map<string, ContextLookup>> {
  const lookups = new Map<string, ContextLookup>();
  if (keys.length === 0) return lookups;
  const organizationIds = [...new Set(keys.map((key) => key.organizationId))];
  const manifestIds = [...new Set(keys.map((key) => key.manifestId))];

  const manifests = await supabase
    .from("memory_context_manifests")
    .select("id,organization_id,context_digest")
    .in("organization_id", organizationIds)
    .in("id", manifestIds);
  if (manifests.error) {
    throw new Error(`Context manifest load failed: ${manifests.error.code ?? "unknown"}.`);
  }
  const digestByKey = new Map(
    (manifests.data ?? [])
      .filter(
        (row): row is { id: string; organization_id: string; context_digest: string } =>
          typeof row.id === "string" &&
          typeof row.organization_id === "string" &&
          typeof row.context_digest === "string",
      )
      .map((row) => [`${row.organization_id}:${row.id}`, row.context_digest]),
  );

  const entries = await supabase
    .from("memory_context_entries")
    .select("manifest_id,organization_id,context_ref,summary,statement_kind")
    .in("organization_id", organizationIds)
    .in("manifest_id", manifestIds);
  if (entries.error) {
    throw new Error(`Context entry load failed: ${entries.error.code ?? "unknown"}.`);
  }
  const entriesByKey = new Map<string, ContextLookup["entries"]>();
  for (const row of entries.data ?? []) {
    if (
      typeof row.manifest_id !== "string" ||
      typeof row.organization_id !== "string" ||
      typeof row.context_ref !== "string" ||
      typeof row.summary !== "string" ||
      typeof row.statement_kind !== "string"
    ) {
      continue;
    }
    const key = `${row.organization_id as string}:${row.manifest_id as string}`;
    const list = entriesByKey.get(key) ?? [];
    list.push({
      ref: row.context_ref as string,
      summary: row.summary as string,
      statementKind: row.statement_kind as string,
    });
    entriesByKey.set(key, list);
  }

  for (const key of keys) {
    const mapKey = `${key.organizationId}:${key.manifestId}`;
    lookups.set(mapKey, {
      manifestDigest: digestByKey.get(mapKey) ?? null,
      entries: entriesByKey.get(mapKey) ?? [],
    });
  }
  return lookups;
}

export { channelRecommendationsTaskSchema };
// Exported for the loadUnjudged row-shape regression test only: production
// code reaches these solely through the evaluate task's own closure.
export { unjudgedRecommendationShape, toUnjudged };

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function findingValueSummary(finding: {
  value_kind: "money" | "count" | "ratio" | null;
  value_numerator: number | null;
  value_denominator: number | null;
  monetary_impact_minor_units: number | null;
  currency: string | null;
}): string | null {
  const stored: string[] = [];
  if (finding.value_numerator !== null) {
    if (finding.value_kind === "ratio" && finding.value_denominator !== null) {
      stored.push(
        `stored ratio numerator ${finding.value_numerator}; denominator ${finding.value_denominator}`,
      );
    } else if (finding.value_kind === "money") {
      stored.push(
        `stored money ${finding.currency ?? "currency unspecified"} ${finding.value_numerator} minor units`,
      );
    } else if (finding.value_kind === "count") {
      stored.push(`stored count ${finding.value_numerator}`);
    }
  }
  if (finding.monetary_impact_minor_units !== null) {
    stored.push(
      `stored monetary impact ${finding.currency ?? "currency unspecified"} ${finding.monetary_impact_minor_units} minor units`,
    );
  }
  return stored.length ? stored.join("; ") : null;
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
  if (outcome !== "acquired" && outcome !== "gapfill_acquired") {
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
  return { outcome, window };
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

    // The run's filed items, read once and shared: gap-fill scoping needs
    // the cited set, and the headroom budget needs the count, and both read
    // the same rows. One query, memoized for the run, so the two can never
    // disagree about what this run holds.
    let filedRecommendationIds: readonly string[] | null = null;
    async function loadFiledRecommendationIds(
      organizationId: string,
      analysisRunId: string,
    ): Promise<readonly string[]> {
      if (filedRecommendationIds === null) {
        const { data: items, error: itemsError } = await supabase
          .from("channel_recommendations")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("analysis_run_id", analysisRunId);
        if (itemsError) throw new Error(`Channel cited findings load failed: ${itemsError.code}`);
        filedRecommendationIds = (items ?? []).map((item) => item.id);
      }
      return filedRecommendationIds;
    }

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
      async loadCitedFindingIds(input) {
        // The receipts of what the run's filed items already rest on. Read
        // through the worker client because citations are worker-owned rows;
        // scoped to this run's items so another window's narration can never
        // shrink this run's gap-fill folder.
        const recommendationIds = await loadFiledRecommendationIds(
          input.organizationId,
          input.analysisRunId,
        );
        if (recommendationIds.length === 0) return [];
        const { data: citations, error: citationsError } = await supabase
          .from("channel_recommendation_citations")
          .select("finding_id")
          .eq("organization_id", input.organizationId)
          .in("recommendation_id", recommendationIds);
        if (citationsError) {
          throw new Error(`Channel cited findings load failed: ${citationsError.code}`);
        }
        return [...new Set((citations ?? []).map((citation) => citation.finding_id))];
      },
      async loadFiledRecommendationCount(input) {
        // The headroom budget for the gap-fill prompt: how many items this
        // run already filed. Same rows the cited set reads above, so the
        // budget and the scoping can never disagree.
        return (await loadFiledRecommendationIds(input.organizationId, input.analysisRunId)).length;
      },
      async loadPilotContext(input) {
        return loadRecommendationPilotContext(supabase, input);
      },
      async loadShareContext(input): Promise<ShareContext> {
        // Consent-gated sharing (Spec 024): the worker asks the database
        // whether this organization currently pairs an active consent with a
        // current Google qualification. Entries stay empty until Spec 023
        // capture lands qualified rows — an active share with no qualified
        // corpus proceeds grounded over findings only, honestly labeled.
        // A status miss throws and the workflow completes internal-only.
        const { data, error } = await supabase.rpc("grounded_share_status", {
          p_organization_id: input.organizationId,
        });
        if (error) throw new Error(`Grounded share status check failed: ${error.code}`);
        return resolveShareContext({
          shareActive: isShareActiveStatus(data),
          entries: [],
          excludedCount: 0,
        });
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

    // Counts, identifiers, and the fence's own failure vocabulary. No figure
    // and no cited row travels to a log — and no shared entry body either,
    // only the mode and its counts.
    logger.info("channel_recommendations.run_completed", {
      organizationId: payload.organizationId,
      channelId: payload.channelId,
      analysisRunId: payload.analysisRunId,
      correlationId: payload.correlationId,
      outcome: result.outcome,
      recommendationCount: result.recommendationCount,
      failureCode: result.failureCode,
      shareMode: result.shareMode,
      shareEntryCount: result.shareEntryCount,
    });

    // A narration that could not be produced is not a successful run. Returning
    // normally here made the fence record MODEL_PROVIDER_UNAVAILABLE while the
    // dashboard showed COMPLETED, so this task's own `maxAttempts` never fired
    // and a provider outage looked green (staging run
    // run_06g4ea6s6md5t1i1eu3eeqle01). The fence has already released the lease
    // and banked the reason, so a retry re-claims cleanly under the same
    // correlation id. `skipped` still returns: nothing was attempted, and the
    // analysis run keeps its findings either way.
    if (result.outcome === "failed") {
      throw new DomainError(
        "INTEGRATION_ERROR",
        `Channel narration failed: ${result.failureCode ?? "unknown"}`,
      );
    }
    return result;
  },
});

/**
 * The quality judge's slot (ADR 0038), every forty-eight hours at 03:00 UTC.
 *
 * It picks up every recommendation not yet judged — oldest first, two hundred
 * at most — reads each against its own cited findings, and files verdicts
 * through the fenced admission RPC, one call per organization. Verdicts are
 * internal quality evidence for human prompt iteration; nothing here edits a
 * recommendation, a prompt, or a rule.
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
    const supabase = createAnalysisWorkerServiceClient();
    const judgeProvider = createRecommendationJudgeProvider({
      modelId: env.RECOMMENDATION_JUDGE_MODEL ?? "",
    });

    const result = await runChannelRecommendationEvaluations(
      { providerName: judgeProvider.providerName, modelId: judgeProvider.modelId },
      {
        async loadUnjudged(limit) {
          // Oldest first so a backlog drains in order. Postgres performs the
          // anti-join before the 200-row limit: the worker never downloads an
          // ever-growing history of judged ids or puts them in a request URL.
          // The citations ride with their findings' stored words and figures;
          // that is the judge's whole folder, and deliberately nothing more.
          const select = `id, organization_id, label, headline, detail, limitations, prompt_version,
             channel_recommendation_citations (
                finding_id,
                channel_findings (
                  detector_key, kind, code, needs_data_reason, value_kind, value_numerator,
                  value_denominator, monetary_impact_minor_units, currency, limitations
                )
             ),
             channel_recommendation_contexts (manifest_id, share_mode, provided_refs, cited_refs),
             channel_recommendation_evaluations!left()`;
          const response = (await supabase
            .from("channel_recommendations")
            .select(select)
            .is("channel_recommendation_evaluations.recommendation_id", null)
            .order("created_at", { ascending: true })
            .limit(limit)) as {
            data: z.infer<typeof unjudgedRecommendationShape>[] | null;
            error: { code: string } | null;
          };
          const { data, error } = response;
          if (error) throw new Error(`Unjudged recommendations load failed: ${error.code}`);

          const parsed = (data ?? []).map((row) => unjudgedRecommendationShape.parse(row));
          const lookups = await loadContextLookups(
            supabase as unknown as WorkerSupabase,
            parsed.flatMap((row) =>
              row.channel_recommendation_contexts.map((provenance) => ({
                organizationId: row.organization_id,
                manifestId: provenance.manifest_id,
              })),
            ),
          );
          return parsed.map((row) =>
            toUnjudged(
              row,
              (manifestId) => lookups.get(`${row.organization_id}:${manifestId}`) ?? null,
            ),
          );
        },
        judge(system, user) {
          return judgeProvider.generate(system, user);
        },
        reportRefusal(input) {
          logger.warn("channel_recommendations.evaluation_refused", input);
        },
        async admit(input) {
          const { error } = await supabase.rpc("admit_channel_recommendation_evaluations", {
            p_organization_id: input.organizationId,
            p_batch_id: input.batchId,
            p_judge_provider: input.providerName,
            p_judge_model: input.modelId,
            p_judge_prompt_version: input.promptVersion,
            p_judge_prompt_digest: input.promptDigest,
            p_judge_output_digest: input.outputDigest,
            p_evaluations: input.verdicts,
          });
          if (error) throw new Error(`Evaluation admission failed: ${error.code}`);
        },
      },
    );

    logger.info("channel_recommendations.evaluations_completed", {
      batchId: result.batchId,
      evaluatedCount: result.evaluatedCount,
      refusedCount: result.refusedCount,
    });
    return result;
  },
});
