import {
  computeVerdict,
  type AttributionMethod,
  type CampaignVerdict,
  type Estimate,
  type EvidenceTier,
  type ExposureReconstruction,
  type GuardrailAssessment,
  type GuardrailState,
  type MetricObservation,
  type Outcome,
  type RegisteredMeasurementPlan,
  type TruncationCause,
} from "@/domain/campaigns/measurement";

/**
 * The assembly half of the evidence loop, kept apart from the workflow that
 * schedules it.
 *
 * This service decides nothing the domain rules do not already decide. It reads
 * one campaign's settlement context — the preregistered plan, its reconstructed
 * exposure, its primary-metric observations, and its guardrail — hands them to
 * the deterministic `computeVerdict`, and writes the result. It is deliberately
 * single-campaign: there is no second campaign in any parameter, and nothing
 * here compares one campaign to another.
 *
 * The settlement delay is honored here *and* in the write RPC. This layer
 * returns a `not_ready` result so the workflow can say "this one is not due
 * yet" without touching the database; the RPC refuses regardless, so a
 * mis-scheduled run cannot slip a premature verdict through.
 */

export type MeasurementContext = {
  organizationId: string;
  campaignId: string;
  plan: RegisteredMeasurementPlan;
  bundleVersionId: string;
  /** The bundle digest the plan lives inside — the digest the verdict was computed under. */
  planDigest: string;
  /** Null when the campaign has no confirmed exposure, so no window can anchor to it. */
  firstExposureAt: string | null;
  exposure: ExposureReconstruction;
  guardrail: GuardrailAssessment;
  primaryObservations: readonly MetricObservation[];
  baseline: MetricObservation | null;
  providerEffect: Estimate | null;
};

export type SettleOutcomeWrite = {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  planDigest: string;
  verdict: CampaignVerdict;
  attributionMethod: AttributionMethod;
  primaryMetricKey: string;
  outcomeWindowDays: number;
  settlementDelayDays: number;
  plannedExposureCount: number;
  realizedExposureCount: number;
  estimateMinor: number | null;
  estimateLowMinor: number | null;
  estimateHighMinor: number | null;
  estimateCurrency: string | null;
  evidenceTier: EvidenceTier | null;
  guardrailState: GuardrailState;
  realizedSpendMinor: number | null;
  spendCeilingMinor: number | null;
  spendCurrency: string | null;
  truncationCauses: readonly TruncationCause[];
  limitations: readonly string[];
  baselineSource: string;
  baselineLookbackDays: number;
};

export type SettleWriteResult =
  | { result: "recorded" | "restated" | "unchanged"; outcomeId: string }
  | { result: "refused"; reasonCode: string };

export type MeasurementServiceDependencies = {
  readContext(input: { organizationId: string; campaignId: string }): Promise<MeasurementContext>;
  writeOutcome(input: SettleOutcomeWrite): Promise<SettleWriteResult>;
  now?: () => Date;
};

export type SettleCampaignResult =
  | { result: "not_ready"; eligibleAt: string }
  | { result: "settled"; outcome: Outcome; write: SettleWriteResult }
  | { result: "failed"; failureCode: string };

const MS_PER_DAY = 86_400_000;

/** The instant a campaign may first be settled: first exposure + window + delay. */
export function settlementEligibleAt(
  firstExposureAt: string,
  outcomeWindowDays: number,
  settlementDelayDays: number,
): string {
  const base = new Date(firstExposureAt).getTime();
  return new Date(base + (outcomeWindowDays + settlementDelayDays) * MS_PER_DAY).toISOString();
}

export async function settleCampaign(
  input: { organizationId: string; campaignId: string },
  deps: MeasurementServiceDependencies,
): Promise<SettleCampaignResult> {
  const now = deps.now ?? (() => new Date());

  const context = await deps.readContext(input);
  if (!context.firstExposureAt) {
    return { result: "failed", failureCode: "campaign_has_no_exposure" };
  }

  const eligibleAt = settlementEligibleAt(
    context.firstExposureAt,
    context.plan.outcomeWindowDays,
    context.plan.settlementDelayDays,
  );
  if (now().getTime() < new Date(eligibleAt).getTime()) {
    return { result: "not_ready", eligibleAt };
  }

  const outcome = computeVerdict({
    plan: context.plan,
    exposure: context.exposure,
    primaryObservations: context.primaryObservations,
    baseline: context.baseline,
    guardrail: context.guardrail,
    providerEffect: context.providerEffect,
  });

  const estimate = outcome.estimate;
  const write = await deps.writeOutcome({
    organizationId: context.organizationId,
    campaignId: context.campaignId,
    bundleVersionId: context.bundleVersionId,
    planDigest: context.planDigest,
    verdict: outcome.verdict,
    attributionMethod: context.plan.attributionMethod,
    primaryMetricKey: context.plan.primaryMetricKey,
    outcomeWindowDays: context.plan.outcomeWindowDays,
    settlementDelayDays: context.plan.settlementDelayDays,
    plannedExposureCount: context.exposure.plannedCount,
    realizedExposureCount: context.exposure.realizedCount,
    estimateMinor: estimate?.estimateMinor ?? null,
    estimateLowMinor: estimate?.lowMinor ?? null,
    estimateHighMinor: estimate?.highMinor ?? null,
    estimateCurrency: estimate?.currency ?? null,
    evidenceTier: outcome.evidenceTier,
    guardrailState: context.guardrail.state,
    realizedSpendMinor: context.guardrail.realizedSpendMinor,
    spendCeilingMinor: context.guardrail.spendCeilingMinor,
    spendCurrency: context.guardrail.currency,
    truncationCauses: context.exposure.truncations,
    limitations: outcome.limitations,
    baselineSource: context.plan.baselineSource,
    baselineLookbackDays: context.plan.baselineLookbackDays,
  });

  if (write.result === "refused") {
    return { result: "failed", failureCode: write.reasonCode };
  }

  return { result: "settled", outcome, write };
}
