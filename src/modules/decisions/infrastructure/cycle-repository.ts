import { z } from "zod";

import { DecisionConfigurationError } from "@/domain/decisions/errors";
import {
  decisionClaimResultSchema,
  decisionCycleContextSchema,
  decisionLiveClaimSchema,
  decisionOperationInputSchema,
  type DecisionCycleContext,
  type DecisionCyclePort,
} from "@/modules/decisions/application/ports";

type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };

export type DecisionCyclePersistence = {
  rpc(
    name:
      | "claim_campaign_decision_cycle"
      | "renew_campaign_decision_cycle_claim"
      | "load_campaign_decision_context"
      | "complete_campaign_decision_cycle"
      | "fail_campaign_decision_cycle"
      | "cancel_campaign_decision_cycle",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
};

const claimRowSchema = z.strictObject({
  status: z.enum(["acquired", "reclaimed", "in_progress", "completed", "cancelled"]),
  decision_cycle_id: z.string().uuid(),
  claim_token: z.string().uuid().optional(),
  lease_expires_at: z.string().datetime({ offset: true }).optional(),
  decision_record_id: z.string().uuid().optional(),
  opportunity_id: z.string().uuid().nullable().optional(),
});
const renewRowSchema = z.strictObject({
  lease_expires_at: z.string().datetime({ offset: true }),
});
const completionRowSchema = z.strictObject({
  decision_record_id: z.string().uuid(),
  opportunity_id: z.string().uuid().nullable(),
});
const contextRowSchema = z.strictObject({
  organization_id: z.string().uuid(),
  organization_currency: z.string(),
  access_policy: z.strictObject({
    id: z.string().uuid(),
    max_active_recommendations: z.number(),
  }),
  active_opportunity_count: z.number(),
  spend_policy: z
    .strictObject({ id: z.string().uuid(), monthly_budget_minor: z.number(), currency: z.string() })
    .nullable(),
  playbook: z
    .strictObject({
      definition_id: z.string().uuid(),
      version_id: z.string().uuid(),
      semantic_version: z.string(),
      action_key: z.string(),
      required_capability_keys: z.array(z.string()),
      required_evidence_keys: z.array(z.string()),
      risk_class: z.number(),
      primary_metric_key: z.string(),
      guardrail_metric_keys: z.array(z.string()),
      freshness_bound_minutes: z.number(),
      measurement_window_days: z.number(),
    })
    .nullable(),
  ranking_artifact: z.strictObject({ id: z.string().uuid(), implementation_key: z.string() }),
  confidence_artifact: z.strictObject({ id: z.string().uuid(), implementation_key: z.string() }),
  suppressions: z.array(
    z.strictObject({ candidate_fingerprint: z.string(), suppressed_until: z.string().nullable() }),
  ),
  evidence: z.strictObject({
    organization_profile_current: z.boolean(),
    brand_constraints_verified: z.boolean(),
    brand_assets_usable: z.boolean(),
    synthetic_assets_allowed: z.boolean(),
    economics: z.strictObject({ currency: z.string(), completeness_grade: z.string() }).nullable(),
    active_goal_metric_keys: z.array(z.string()),
    meta_account_mapped: z.boolean(),
    granted_capability_keys: z.array(z.string()),
    tracking_ready: z.boolean(),
    measurement_plan_registered: z.boolean(),
    margin_firewall_result: z.string(),
    inputs_observed_at: z.string().nullable(),
    observed_volume: z.number(),
  }),
});

const deterministicFailureCodes = new Map<string, string>([
  ["22023:campaign_decision_access_policy_invalid", "decision_access_policy_invalid"],
  [
    "22023:campaign_decision_ranking_implementation_invalid",
    "decision_ranking_implementation_invalid",
  ],
  [
    "22023:campaign_decision_confidence_implementation_invalid",
    "decision_confidence_implementation_invalid",
  ],
  ["40001:campaign_decision_capacity_exhausted", "decision_capacity_exhausted"],
  ["23505:campaign_decision_active_duplicate", "decision_active_opportunity_duplicate"],
]);

function databaseError(error?: { message?: string; code?: string }): never {
  const failureCode = deterministicFailureCodes.get(`${error?.code ?? ""}:${error?.message ?? ""}`);
  if (failureCode !== undefined) throw new DecisionConfigurationError(failureCode);
  throw new Error("Campaign decision cycle could not be loaded or saved.");
}

function operationPayload(input: z.infer<typeof decisionOperationInputSchema>) {
  return {
    organization_id: input.organizationId,
    correlation_id: input.correlationId,
    idempotency_key: input.idempotencyKey,
    request_digest: input.requestDigest,
    trigger_type: input.triggerType,
  };
}

function claimPayload(input: z.infer<typeof decisionLiveClaimSchema>) {
  return {
    organization_id: input.organizationId,
    idempotency_key: input.idempotencyKey,
    request_digest: input.requestDigest,
    claim_token: input.claimToken,
    decision_cycle_id: input.decisionCycleId,
  };
}

function mapContext(value: unknown): DecisionCycleContext {
  const row = contextRowSchema.parse(value);
  return decisionCycleContextSchema.parse({
    organizationId: row.organization_id,
    organizationCurrency: row.organization_currency,
    accessPolicy: {
      id: row.access_policy.id,
      maxActiveRecommendations: row.access_policy.max_active_recommendations,
    },
    activeOpportunityCount: row.active_opportunity_count,
    spendPolicy:
      row.spend_policy === null
        ? null
        : {
            id: row.spend_policy.id,
            monthlyBudgetMinor: row.spend_policy.monthly_budget_minor,
            currency: row.spend_policy.currency,
          },
    playbook:
      row.playbook === null
        ? null
        : {
            definitionId: row.playbook.definition_id,
            versionId: row.playbook.version_id,
            semanticVersion: row.playbook.semantic_version,
            actionKey: row.playbook.action_key,
            requiredCapabilityKeys: row.playbook.required_capability_keys,
            requiredEvidenceKeys: row.playbook.required_evidence_keys,
            riskClass: row.playbook.risk_class,
            primaryMetricKey: row.playbook.primary_metric_key,
            guardrailMetricKeys: row.playbook.guardrail_metric_keys,
            freshnessBoundMinutes: row.playbook.freshness_bound_minutes,
            measurementWindowDays: row.playbook.measurement_window_days,
          },
    rankingArtifact: {
      id: row.ranking_artifact.id,
      implementationKey: row.ranking_artifact.implementation_key,
    },
    confidenceArtifact: {
      id: row.confidence_artifact.id,
      implementationKey: row.confidence_artifact.implementation_key,
    },
    suppressions: row.suppressions.map((item) => ({
      candidateFingerprint: item.candidate_fingerprint,
      suppressedUntil: item.suppressed_until,
    })),
    evidence: {
      organizationProfileCurrent: row.evidence.organization_profile_current,
      brandConstraintsVerified: row.evidence.brand_constraints_verified,
      brandAssetsUsable: row.evidence.brand_assets_usable,
      syntheticAssetsAllowed: row.evidence.synthetic_assets_allowed,
      economics:
        row.evidence.economics === null
          ? null
          : {
              currency: row.evidence.economics.currency,
              completenessGrade: row.evidence.economics.completeness_grade,
            },
      activeGoalMetricKeys: row.evidence.active_goal_metric_keys,
      metaAccountMapped: row.evidence.meta_account_mapped,
      grantedCapabilityKeys: row.evidence.granted_capability_keys,
      trackingReady: row.evidence.tracking_ready,
      measurementPlanRegistered: row.evidence.measurement_plan_registered,
      marginFirewallResult: row.evidence.margin_firewall_result,
      inputsObservedAt: row.evidence.inputs_observed_at,
      observedVolume: row.evidence.observed_volume,
    },
  });
}

export function createDecisionCycleRepository(
  persistence: DecisionCyclePersistence,
): DecisionCyclePort {
  async function rpc(
    name: Parameters<DecisionCyclePersistence["rpc"]>[0],
    args: Record<string, unknown>,
  ) {
    const result = await persistence.rpc(name, args);
    if (result.error) databaseError(result.error);
    if (result.data === null) databaseError();
    return result.data;
  }

  return {
    async claim(rawInput) {
      const input = decisionOperationInputSchema.parse(rawInput);
      const row = claimRowSchema.parse(
        await rpc("claim_campaign_decision_cycle", {
          target_organization_id: input.organizationId,
          input_operation: operationPayload(input),
        }),
      );
      return decisionClaimResultSchema.parse({
        status: row.status,
        decisionCycleId: row.decision_cycle_id,
        ...(row.claim_token === undefined ? {} : { claimToken: row.claim_token }),
        ...(row.lease_expires_at === undefined ? {} : { leaseExpiresAt: row.lease_expires_at }),
        ...(row.decision_record_id === undefined
          ? {}
          : { decisionRecordId: row.decision_record_id }),
        ...(row.status === "completed" ? { opportunityId: row.opportunity_id ?? null } : {}),
      });
    },
    async renew(rawInput) {
      const input = decisionLiveClaimSchema.parse(rawInput);
      const row = renewRowSchema.parse(
        await rpc("renew_campaign_decision_cycle_claim", {
          target_organization_id: input.organizationId,
          input_claim: claimPayload(input),
        }),
      );
      return { leaseExpiresAt: row.lease_expires_at };
    },
    async loadContext(rawInput) {
      const input = decisionLiveClaimSchema.parse(rawInput);
      return mapContext(
        await rpc("load_campaign_decision_context", {
          target_organization_id: input.organizationId,
          input_claim: claimPayload(input),
        }),
      );
    },
    async complete(rawInput) {
      const { aggregate: _aggregate, ...claimInput } = rawInput;
      void _aggregate;
      const input = decisionLiveClaimSchema.parse(claimInput);
      const row = completionRowSchema.parse(
        await rpc("complete_campaign_decision_cycle", {
          target_organization_id: input.organizationId,
          input_completion: { ...claimPayload(input), aggregate: rawInput.aggregate },
        }),
      );
      return { decisionRecordId: row.decision_record_id, opportunityId: row.opportunity_id };
    },
    async fail(rawInput) {
      const { failureCode: _failureCode, ...claimInput } = rawInput;
      void _failureCode;
      const input = decisionLiveClaimSchema.parse(claimInput);
      if (!/^[a-z][a-z0-9_.-]{0,119}$/.test(rawInput.failureCode)) databaseError();
      await rpc("fail_campaign_decision_cycle", {
        target_organization_id: input.organizationId,
        input_failure: { ...claimPayload(input), failure_code: rawInput.failureCode },
      });
    },
    async cancel(rawInput) {
      const input = decisionOperationInputSchema.parse(rawInput);
      await rpc("cancel_campaign_decision_cycle", {
        target_organization_id: input.organizationId,
        input_operation: operationPayload(input),
      });
    },
  };
}
