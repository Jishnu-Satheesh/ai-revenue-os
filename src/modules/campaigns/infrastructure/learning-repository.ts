import { z } from "zod";

import type {
  LearningContext,
  ProposeLearningWrite,
  ProposeWriteResult,
} from "@/modules/campaigns/application/learning-service";

/**
 * The learning path's persistence surface.
 *
 * Every read and the single write go through a worker-only security-definer
 * RPC, so the loop has no direct table access and no path to anything the wall
 * protects. The write RPC is the authoritative guard: it refuses a proposal
 * with no settled outcome, refuses cited evidence that does not belong to the
 * campaign and organization, and enforces one live proposal per campaign. The
 * repository is only a translation layer between those RPCs and the service.
 */

type RpcResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

export type LearningRpcName = "read_campaign_learning_context" | "propose_campaign_learning";

export type LearningPersistence = {
  rpc(name: LearningRpcName, args: Record<string, unknown>): Promise<RpcResult<unknown>>;
};

/** Postgres may hand a numeric or bigint back as a number or a string. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const uuidArray = z.array(z.string().uuid());

const contextSchema = z.strictObject({
  outcome_id: z.string().uuid(),
  bundle_version_id: z.string().uuid(),
  bundle_digest: z.string().regex(/^[0-9a-f]{64}$/),
  policy_version_ids: uuidArray,
  variant_ids: uuidArray,
  planned_exposure_count: z.unknown(),
  realized_exposure_count: z.unknown(),
  verdict: z.enum(["validated_outcome", "inconclusive", "guardrail_breach", "execution_only"]),
  evidence_tier: z.enum(["computed", "observed"]).nullable(),
  primary_metric_key: z.string().min(1),
  attribution_method: z.enum(["observational_prepost", "provider_randomized_experiment"]),
  outcome_window_days: z.number().int(),
  settlement_delay_days: z.number().int(),
  baseline_source: z.string(),
  baseline_lookback_days: z.number().int(),
  estimate_minor: z.unknown().nullable(),
  estimate_currency: z.string().nullable(),
  limitations: z.array(z.string()),
  settled_at: z.string(),
});

const writeResultSchema = z.strictObject({
  outcome: z.enum(["proposed", "unchanged"]),
  proposal_id: z.string().uuid(),
});

export function createLearningRepository(persistence: LearningPersistence) {
  return {
    /**
     * The computed result a worker drafts from, or null when the campaign has no
     * current settled outcome — a normal state, not an error.
     */
    async readContext(organizationId: string, campaignId: string): Promise<LearningContext | null> {
      const { data, error } = await persistence.rpc("read_campaign_learning_context", {
        target_organization_id: organizationId,
        target_campaign_id: campaignId,
      });

      if (error?.code === "campaign_has_no_settled_outcome") return null;
      if (error || data === null || data === undefined) {
        throw new Error("The campaign learning context could not be read.");
      }

      const parsed = contextSchema.safeParse(data);
      if (!parsed.success)
        throw new Error("The campaign learning context returned an unexpected shape.");

      const row = parsed.data;
      return {
        organizationId,
        campaignId,
        outcomeId: row.outcome_id,
        bundleVersionId: row.bundle_version_id,
        bundleDigest: row.bundle_digest,
        policyVersionIds: row.policy_version_ids,
        variantIds: row.variant_ids,
        plannedExposureCount: toNumber(row.planned_exposure_count) ?? 0,
        realizedExposureCount: toNumber(row.realized_exposure_count) ?? 0,
        verdict: row.verdict,
        evidenceTier: row.evidence_tier,
        primaryMetricKey: row.primary_metric_key,
        attributionMethod: row.attribution_method,
        outcomeWindowDays: row.outcome_window_days,
        settlementDelayDays: row.settlement_delay_days,
        baselineSource: row.baseline_source,
        baselineLookbackDays: row.baseline_lookback_days,
        estimateMinor: toNumber(row.estimate_minor),
        estimateCurrency: row.estimate_currency,
        limitations: row.limitations,
        settledAt: row.settled_at,
      };
    },

    async writeProposal(input: ProposeLearningWrite): Promise<ProposeWriteResult> {
      const { data, error } = await persistence.rpc("propose_campaign_learning", {
        target_organization_id: input.organizationId,
        input_proposal: {
          organization_id: input.organizationId,
          campaign_id: input.campaignId,
          variant_ids: input.variantIds,
          hypothesis: input.hypothesis,
          observation: input.observation,
          proposed_lesson: input.proposedLesson,
          suggested_next_test: input.suggestedNextTest,
          evidence_links: input.evidenceLinks,
        },
      });

      if (error) {
        return { result: "refused", reasonCode: error.code ?? "unknown_refusal" };
      }

      const parsed = writeResultSchema.safeParse(data);
      if (!parsed.success) {
        return { result: "refused", reasonCode: "unexpected_write_result" };
      }

      return {
        result: parsed.data.outcome,
        proposalId: parsed.data.proposal_id,
      };
    },
  };
}

export type LearningRepository = ReturnType<typeof createLearningRepository>;
