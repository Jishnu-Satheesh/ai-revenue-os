import { z } from "zod";

import {
  assessGuardrail,
  type MetricObservation,
  type TruncationCause,
} from "@/domain/campaigns/measurement";
import type {
  MeasurementContext,
  SettleOutcomeWrite,
  SettleWriteResult,
} from "@/modules/campaigns/application/measurement-service";

/**
 * The evidence loop's persistence surface.
 *
 * Every read and the single write go through a worker-only security-definer
 * RPC, so the loop has no direct table access and no path to anything the wall
 * protects. The write RPC is the authoritative guard: it refuses a premature
 * settle and refuses a verdict whose plan digest was not the plan on file at
 * first exposure. The repository is only a translation layer between those
 * RPCs and the application service.
 */

type RpcResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

export type MeasurementRpcName = "read_campaign_measurement_context" | "settle_campaign_outcome";

export type MeasurementPersistence = {
  rpc(name: MeasurementRpcName, args: Record<string, unknown>): Promise<RpcResult<unknown>>;
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

const planSchema = z.strictObject({
  primary_metric_key: z.string().min(1),
  guardrail_metric_keys: z.array(z.string()),
  baseline_source: z.string(),
  baseline_lookback_days: z.number().int(),
  attribution_method: z.enum(["observational_prepost", "provider_randomized_experiment"]),
  outcome_window_days: z.number().int(),
  settlement_delay_days: z.number().int(),
  minimum_evidence_tier: z.enum(["computed", "observed"]),
});

const truncationSchema = z.strictObject({
  variant_id: z.string().uuid(),
  cause: z.enum(["agent_pause", "operator_pause", "guardrail"]),
  rule_key: z.string().nullable(),
  at: z.string(),
});

const observationSchema = z.strictObject({
  value_minor: z.unknown(),
  period_start: z.string(),
  evidence_tier: z.enum(["computed", "observed"]),
});

const baselineSchema = z
  .strictObject({
    value_minor: z.unknown(),
    evidence_tier: z.enum(["computed", "observed"]),
  })
  .nullable();

const providerEffectSchema = z
  .strictObject({
    estimate_minor: z.unknown(),
    low_minor: z.unknown(),
    high_minor: z.unknown(),
    currency: z.string(),
  })
  .nullable();

const contextSchema = z.strictObject({
  bundle_version_id: z.string().uuid(),
  plan_digest: z.string(),
  first_exposure_at: z.string().nullable(),
  plan: planSchema,
  planned_exposure_count: z.unknown(),
  realized_exposure_count: z.unknown(),
  truncations: z.array(truncationSchema),
  spend_ceiling_minor: z.unknown().nullable(),
  spend_currency: z.string().nullable(),
  realized_spend_minor: z.unknown().nullable(),
  primary_observations: z.array(observationSchema),
  baseline_observation: baselineSchema,
  provider_effect: providerEffectSchema,
});

const writeResultSchema = z.strictObject({
  outcome: z.enum(["recorded", "restated", "unchanged"]),
  outcome_id: z.string().uuid(),
});

function toObservation(row: z.infer<typeof observationSchema>): MetricObservation {
  return {
    valueMinor: toNumber(row.value_minor) ?? 0,
    periodStart: row.period_start,
    evidenceTier: row.evidence_tier,
  };
}

export function createMeasurementRepository(persistence: MeasurementPersistence) {
  return {
    async readContext(organizationId: string, campaignId: string): Promise<MeasurementContext> {
      const { data, error } = await persistence.rpc("read_campaign_measurement_context", {
        target_organization_id: organizationId,
        target_campaign_id: campaignId,
      });
      if (error || data === null || data === undefined) {
        throw new Error("The campaign measurement context could not be read.");
      }

      const parsed = contextSchema.safeParse(data);
      if (!parsed.success)
        throw new Error("The campaign measurement context returned an unexpected shape.");

      const row = parsed.data;
      const plannedCount = toNumber(row.planned_exposure_count);
      const realizedCount = toNumber(row.realized_exposure_count);
      const realizedSpend = toNumber(row.realized_spend_minor);
      const ceiling = toNumber(row.spend_ceiling_minor);

      const guardrail = assessGuardrail({
        spendCeilingMinor: ceiling,
        realizedSpendMinor: realizedSpend,
        currency: row.spend_currency,
      });

      const primaryObservations: MetricObservation[] = row.primary_observations.map(toObservation);
      const baseline: MetricObservation | null =
        row.baseline_observation === null
          ? null
          : {
              valueMinor: toNumber(row.baseline_observation.value_minor) ?? 0,
              periodStart: "",
              evidenceTier: row.baseline_observation.evidence_tier,
            };

      return {
        organizationId,
        campaignId,
        plan: {
          primaryMetricKey: row.plan.primary_metric_key,
          guardrailMetricKeys: row.plan.guardrail_metric_keys,
          baselineSource: row.plan.baseline_source,
          baselineLookbackDays: row.plan.baseline_lookback_days,
          attributionMethod: row.plan.attribution_method,
          outcomeWindowDays: row.plan.outcome_window_days,
          settlementDelayDays: row.plan.settlement_delay_days,
          minimumEvidenceTier: row.plan.minimum_evidence_tier,
        },
        bundleVersionId: row.bundle_version_id,
        planDigest: row.plan_digest,
        firstExposureAt: row.first_exposure_at,
        exposure: {
          plannedCount: plannedCount ?? 0,
          realizedCount: realizedCount ?? 0,
          truncations: row.truncations.map(
            (truncation): TruncationCause => ({
              variantId: truncation.variant_id,
              cause: truncation.cause,
              ruleKey: truncation.rule_key,
              at: truncation.at,
            }),
          ),
        },
        guardrail,
        primaryObservations,
        baseline,
        providerEffect:
          row.provider_effect === null
            ? null
            : {
                estimateMinor: toNumber(row.provider_effect.estimate_minor) ?? 0,
                lowMinor: toNumber(row.provider_effect.low_minor) ?? 0,
                highMinor: toNumber(row.provider_effect.high_minor) ?? 0,
                currency: row.provider_effect.currency,
              },
      };
    },

    async writeOutcome(input: SettleOutcomeWrite): Promise<SettleWriteResult> {
      const { data, error } = await persistence.rpc("settle_campaign_outcome", {
        target_organization_id: input.organizationId,
        input_outcome: {
          organization_id: input.organizationId,
          campaign_id: input.campaignId,
          bundle_version_id: input.bundleVersionId,
          plan_digest: input.planDigest,
          verdict: input.verdict,
          attribution_method: input.attributionMethod,
          primary_metric_key: input.primaryMetricKey,
          outcome_window_days: input.outcomeWindowDays,
          settlement_delay_days: input.settlementDelayDays,
          planned_exposure_count: input.plannedExposureCount,
          realized_exposure_count: input.realizedExposureCount,
          estimate_minor: input.estimateMinor,
          estimate_low_minor: input.estimateLowMinor,
          estimate_high_minor: input.estimateHighMinor,
          estimate_currency: input.estimateCurrency,
          evidence_tier: input.evidenceTier,
          guardrail_state: input.guardrailState,
          realized_spend_minor: input.realizedSpendMinor,
          spend_ceiling_minor: input.spendCeilingMinor,
          spend_currency: input.spendCurrency,
          truncation_causes: input.truncationCauses,
          limitations: input.limitations,
          baseline_source: input.baselineSource,
          baseline_lookback_days: input.baselineLookbackDays,
        },
      });

      if (error) {
        // The RPC refuses a premature settle, a plan digest that was not on
        // file, or a tenant mismatch. Each refusal is surfaced as a reason code
        // rather than thrown, so the workflow can say why without crashing.
        return { result: "refused", reasonCode: error.code ?? "unknown_refusal" };
      }

      const parsed = writeResultSchema.safeParse(data);
      if (!parsed.success) {
        return { result: "refused", reasonCode: "unexpected_write_result" };
      }

      return { result: parsed.data.outcome, outcomeId: parsed.data.outcome_id };
    },
  };
}

export type MeasurementRepository = ReturnType<typeof createMeasurementRepository>;
