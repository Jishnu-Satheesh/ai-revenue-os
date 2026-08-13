import { describe, expect, it, vi } from "vitest";

import { createDecisionCycleRepository } from "@/modules/decisions/infrastructure/cycle-repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const decisionCycleId = "22222222-2222-4222-8222-222222222222";
const claimToken = "33333333-3333-4333-8333-333333333333";
const requestDigest = "a".repeat(64);

const operation = {
  organizationId,
  correlationId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "campaign-cycle-2026-08-13",
  requestDigest,
  triggerType: "scheduled" as const,
};

const claim = {
  ...operation,
  decisionCycleId,
  claimToken,
  leaseExpiresAt: "2026-08-13T12:05:00.000Z",
};

describe("DecisionCycleRepository", () => {
  it("maps claim input and every result from exact snake case", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "acquired",
        decision_cycle_id: decisionCycleId,
        claim_token: claimToken,
        lease_expires_at: "2026-08-13T12:05:00.000Z",
      },
      error: null,
    });
    const repository = createDecisionCycleRepository({ rpc });

    await expect(repository.claim(operation)).resolves.toEqual({
      status: "acquired",
      decisionCycleId,
      claimToken,
      leaseExpiresAt: "2026-08-13T12:05:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("claim_campaign_decision_cycle", {
      target_organization_id: organizationId,
      input_operation: {
        organization_id: organizationId,
        correlation_id: operation.correlationId,
        idempotency_key: operation.idempotencyKey,
        request_digest: requestDigest,
        trigger_type: "scheduled",
      },
    });
  });

  it("renews, reads, completes, fails, and cancels only through fenced RPCs", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { lease_expires_at: "2026-08-13T12:05:00.000Z" },
        error: null,
      })
      .mockResolvedValueOnce({ data: contextRow(), error: null })
      .mockResolvedValueOnce({
        data: { decision_record_id: "55555555-5555-4555-8555-555555555555", opportunity_id: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: { status: "failed" }, error: null })
      .mockResolvedValueOnce({ data: { status: "cancelled" }, error: null });
    const repository = createDecisionCycleRepository({ rpc });

    await repository.renew(claim);
    await repository.loadContext(claim);
    await repository.complete({ ...claim, aggregate: needsDataAggregate() });
    await repository.fail({ ...claim, failureCode: "decision_configuration_invalid" });
    await repository.cancel(operation);

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "renew_campaign_decision_cycle_claim",
      "load_campaign_decision_context",
      "complete_campaign_decision_cycle",
      "fail_campaign_decision_cycle",
      "cancel_campaign_decision_cycle",
    ]);
    expect(rpc.mock.calls[2]?.[1]).toEqual({
      target_organization_id: organizationId,
      input_completion: {
        organization_id: organizationId,
        idempotency_key: operation.idempotencyKey,
        request_digest: requestDigest,
        claim_token: claimToken,
        decision_cycle_id: decisionCycleId,
        aggregate: needsDataAggregate(),
      },
    });
  });

  it("returns a safe database error without leaking provider details", async () => {
    const repository = createDecisionCycleRepository({
      rpc: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "password=secret payload=x" } }),
    });

    await expect(repository.claim(operation)).rejects.toThrow(
      /^Campaign decision cycle could not be loaded or saved\.$/,
    );
  });
});

function contextRow() {
  return {
    organization_id: organizationId,
    organization_currency: "AED",
    access_policy: {
      id: "66666666-6666-4666-8666-666666666666",
      max_active_recommendations: 3,
    },
    active_opportunity_count: 0,
    spend_policy: null,
    playbook: {
      definition_id: "77777777-7777-4777-8777-777777777777",
      version_id: "88888888-8888-4888-8888-888888888888",
      semantic_version: "1.0.0",
      action_key: "campaign.meta_bundle_v1",
      required_capability_keys: ["advertise_meta_ads"],
      required_evidence_keys: ["impact.range"],
      risk_class: 3,
      primary_metric_key: "contribution.incremental_gross_profit",
      guardrail_metric_keys: ["spend.total"],
      freshness_bound_minutes: 1440,
      measurement_window_days: 7,
    },
    ranking_artifact: {
      id: "99999999-9999-4999-8999-999999999999",
      implementation_key: "decision.ranking.evidence_value_time_v1",
    },
    confidence_artifact: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      implementation_key: "decision.confidence.computed_baseline_v1",
    },
    suppressions: [],
    evidence: {
      organization_profile_current: true,
      brand_constraints_verified: false,
      brand_assets_usable: false,
      synthetic_assets_allowed: false,
      economics: null,
      active_goal_metric_keys: [],
      meta_account_mapped: false,
      granted_capability_keys: [],
      tracking_ready: false,
      measurement_plan_registered: true,
      margin_firewall_result: "unknown",
      inputs_observed_at: "2026-08-13T12:00:00.000Z",
      observed_volume: 0,
    },
  };
}

function needsDataAggregate() {
  return {
    record: {
      decisionCycleId,
      organizationId,
      correlationId: operation.correlationId,
      outcome: "needs_data" as const,
      reason: "campaign_evidence_missing",
      needsDataKeys: ["impact.range"],
      selectedCandidateFingerprint: null,
      opportunityId: null,
      rejectionHistogram: {},
      screenedCount: 0,
      scoredCount: 0,
      inputsDigest: "b".repeat(64),
      versionTuple: {
        policyVersionId: "66666666-6666-4666-8666-666666666666",
        playbookVersionId: "88888888-8888-4888-8888-888888888888",
        rankingWeightsId: "99999999-9999-4999-8999-999999999999",
        confidenceCalibrationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      propensity: 1 as const,
      isExploration: false as const,
    },
    candidates: [],
    opportunity: null,
  };
}
