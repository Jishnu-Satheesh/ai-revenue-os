import { describe, expect, it, vi } from "vitest";

import type { DecisionCycleContext } from "@/modules/decisions/application/ports";
import { createDecisionCycleRepository } from "@/modules/decisions/infrastructure/cycle-repository";
import { createCampaignOpportunitySource } from "@/modules/decisions/sources/campaign-opportunity-source";
import { DecisionConfigurationError } from "@/workflows/decisions/contracts";
import { runCampaignDecisionCycle } from "@/workflows/decisions/run-cycle";

const organizationId = "11111111-1111-4111-8111-111111111111";
const correlationId = "22222222-2222-4222-8222-222222222222";
const decisionCycleId = "33333333-3333-4333-8333-333333333333";
const claimToken = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-08-13T12:00:00.000Z");
const payload = {
  organizationId,
  correlationId,
  idempotencyKey: "campaign-cycle-test",
  triggerType: "manual" as const,
};

describe("runCampaignDecisionCycle", () => {
  it("emits cycle_started only for the first claim and persists production needs_data", async () => {
    const fixture = setup({ claimStatus: "acquired", impact: false });
    const result = await runCampaignDecisionCycle(payload, fixture.dependencies);

    expect(result.status).toBe("completed");
    expect(fixture.publish.mock.calls.map(([event]) => event.eventName)).toEqual([
      "decision.cycle_started",
      "decision.needs_data_identified",
    ]);
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        claimToken,
        aggregate: expect.objectContaining({
          record: expect.objectContaining({
            outcome: "needs_data",
            needsDataKeys: expect.arrayContaining(["impact.range", "impact.source_revisions"]),
          }),
          candidates: [],
          opportunity: null,
        }),
      }),
    );
  });

  it.each(["completed", "in_progress", "cancelled"] as const)(
    "returns a %s replay without reads, writes, or events",
    async (claimStatus) => {
      const fixture = setup({ claimStatus, impact: false });
      const result = await runCampaignDecisionCycle(payload, fixture.dependencies);

      expect(result.status).toBe(claimStatus);
      expect(fixture.loadContext).not.toHaveBeenCalled();
      expect(fixture.complete).not.toHaveBeenCalled();
      expect(fixture.publish).not.toHaveBeenCalled();
    },
  );

  it("reclaims an expired lease with a new token and emits no second cycle-start event", async () => {
    const fixture = setup({ claimStatus: "reclaimed", impact: false });
    await runCampaignDecisionCycle(payload, fixture.dependencies);

    expect(fixture.publish.mock.calls.map(([event]) => event.eventName)).toEqual([
      "decision.needs_data_identified",
    ]);
    expect(fixture.renew).toHaveBeenCalledWith(expect.objectContaining({ claimToken }));
  });

  it("lets a stale token fence reads and leaves retryable infrastructure failures claimed", async () => {
    const fixture = setup({ claimStatus: "acquired", impact: false });
    fixture.renew.mockRejectedValueOnce(new Error("decision_claim_fenced"));

    await expect(runCampaignDecisionCycle(payload, fixture.dependencies)).rejects.toThrow(
      /decision_claim_fenced/,
    );
    expect(fixture.loadContext).not.toHaveBeenCalled();
    expect(fixture.fail).not.toHaveBeenCalled();
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("persists a normalized deterministic configuration failure", async () => {
    const fixture = setup({ claimStatus: "acquired", impact: false });
    fixture.loadContext.mockRejectedValueOnce(
      new DecisionConfigurationError("decision_access_policy_missing"),
    );

    await expect(runCampaignDecisionCycle(payload, fixture.dependencies)).resolves.toEqual({
      status: "failed",
      decisionCycleId,
      failureCode: "decision_access_policy_missing",
    });
    expect(fixture.fail).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "decision_access_policy_missing", claimToken }),
    );
  });

  it("terminally fails a production access-policy error mapped by the repository", async () => {
    const fixture = setup({ claimStatus: "acquired", impact: false });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "acquired",
          decision_cycle_id: decisionCycleId,
          claim_token: claimToken,
          lease_expires_at: "2026-08-13T12:05:00.000Z",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { lease_expires_at: "2026-08-13T12:05:00.000Z" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "22023", message: "campaign_decision_access_policy_invalid" },
      })
      .mockResolvedValueOnce({ data: { status: "failed" }, error: null });

    const result = await runCampaignDecisionCycle(payload, {
      ...fixture.dependencies,
      cycles: createDecisionCycleRepository({ rpc }),
    });

    expect(result).toEqual({
      status: "failed",
      decisionCycleId,
      failureCode: "decision_access_policy_invalid",
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_campaign_decision_cycle",
      "renew_campaign_decision_cycle_claim",
      "load_campaign_decision_context",
      "fail_campaign_decision_cycle",
    ]);
  });

  it("records slot-budget exhaustion before source generation", async () => {
    const fixture = setup({ claimStatus: "acquired", impact: true });
    fixture.loadContext.mockResolvedValueOnce(
      context({
        accessPolicy: { id: context().accessPolicy.id, maxActiveRecommendations: 1 },
        activeOpportunityCount: 1,
      }),
    );
    const generate = vi.spyOn(fixture.source, "generate");

    await runCampaignDecisionCycle(payload, fixture.dependencies);

    expect(generate).not.toHaveBeenCalled();
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregate: expect.objectContaining({
          record: expect.objectContaining({
            outcome: "no_action",
            reason: "slot_budget_exhausted",
          }),
        }),
      }),
    );
  });

  it.each([
    ["risk", { playbook: { ...context().playbook!, riskClass: 4 } }, "risk_tier_prohibited"],
    [
      "budget",
      { spendPolicy: { ...context().spendPolicy!, monthlyBudgetMinor: 10 } },
      "budget_exhausted",
    ],
    [
      "suppression",
      { suppressions: [{ candidateFingerprint: "PLACEHOLDER", suppressedUntil: null }] },
      "suppressed",
    ],
  ] as const)(
    "records no_action when %s deterministically removes the only candidate",
    async (_name, override, reason) => {
      const fixture = setup({ claimStatus: "acquired", impact: true });
      if (_name === "suppression") {
        const generated = fixture.source.generate({
          organizationId,
          playbookVersionId: context().playbook!.versionId,
          evidence: fixture.controlledEvidence,
          now,
        });
        if (generated.outcome !== "candidates") throw new Error("fixture");
        fixture.loadContext.mockResolvedValueOnce(
          context({
            suppressions: [
              {
                candidateFingerprint: generated.candidates[0]!.candidateFingerprint,
                suppressedUntil: null,
              },
            ],
          }),
        );
      } else {
        fixture.loadContext.mockResolvedValueOnce(
          context(override as Partial<DecisionCycleContext>),
        );
      }

      await runCampaignDecisionCycle(payload, fixture.dependencies);

      expect(fixture.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregate: expect.objectContaining({
            record: expect.objectContaining({ outcome: "no_action", reason }),
            opportunity: null,
          }),
        }),
      );
    },
  );

  it("screens impact evidence beyond the full freshness bound before scoring", async () => {
    const fixture = setup({ claimStatus: "acquired", impact: true });
    fixture.controlledEvidence.impactEvidence!.observedAt = new Date("2026-08-12T00:00:00.000Z");

    await runCampaignDecisionCycle(payload, fixture.dependencies);

    expect(fixture.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregate: expect.objectContaining({
          record: expect.objectContaining({ outcome: "no_action", reason: "stale_inputs" }),
          candidates: [],
          opportunity: null,
        }),
      }),
    );
  });

  it("persists one controlled selected action with exact versions, digest, and identifier-only event", async () => {
    const fixture = setup({ claimStatus: "acquired", impact: true });
    await runCampaignDecisionCycle(payload, fixture.dependencies);

    const completion = fixture.complete.mock.calls[0]?.[0];
    expect(completion.aggregate.record).toEqual(
      expect.objectContaining({
        outcome: "action_selected",
        needsDataKeys: [],
        inputsDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        versionTuple: {
          policyVersionId: context().accessPolicy.id,
          playbookVersionId: context().playbook!.versionId,
          rankingWeightsId: context().rankingArtifact.id,
          confidenceCalibrationId: context().confidenceArtifact.id,
        },
      }),
    );
    expect(completion.aggregate.candidates).toHaveLength(1);
    expect(completion.aggregate.opportunity).toEqual(
      expect.objectContaining({
        evidenceBundle: { sourceRevisionIds: ["impact-revision-1"] },
        confidence: 0.75,
        riskTier: 3,
        approvalPath: "human_approval",
        guardrails: [
          {
            key: "spend.total",
            comparator: "less_than_or_equal",
            threshold: { amountMinor: 450_000, currency: "AED" },
          },
          { key: "contribution.margin_rate", comparator: "equals", threshold: "pass" },
        ],
        assertions: [
          { key: "inputs.fresh_until", expectedOutcome: "2026-08-14T06:00:00.000Z" },
          { key: "impact.fresh_until", expectedOutcome: "2026-08-14T06:00:00.000Z" },
          { key: "policy.access.active", expectedOutcome: context().accessPolicy.id },
          { key: "policy.spend.active", expectedOutcome: context().spendPolicy!.id },
          { key: "policy.spend.ceiling", expectedOutcome: "450000:AED" },
          { key: "capability.publish_instagram.granted", expectedOutcome: "true" },
          { key: "capability.publish_facebook.granted", expectedOutcome: "true" },
          { key: "capability.advertise_meta_ads.granted", expectedOutcome: "true" },
          { key: "capacity.max_active_recommendations", expectedOutcome: "3" },
          { key: "margin.firewall.pass", expectedOutcome: "pass" },
          { key: "measurement.tracking_ready", expectedOutcome: "true" },
          { key: "measurement.plan_registered", expectedOutcome: "true" },
        ],
        evaluationPlan: {
          primaryMetricKey: "contribution.incremental_gross_profit",
          measurementWindowDays: 7,
          measurementMethod: "reconciliation",
        },
        expiresAt: "2026-08-14T06:00:00.000Z",
      }),
    );
    const proposed = fixture.publish.mock.calls.at(-1)?.[0];
    expect(proposed).toEqual(
      expect.objectContaining({
        eventName: "opportunity.proposed",
        payload: {
          opportunityId: completion.aggregate.opportunity.id,
          decisionCycleId,
        },
      }),
    );
    expect(JSON.stringify(proposed)).not.toContain("impact-revision-1");
  });

  it("samples one cycle timestamp for freshness, confidence, expiry, and events", async () => {
    const fixture = setup({ claimStatus: "acquired", impact: true });
    const clock = vi.fn().mockReturnValue(now);

    await runCampaignDecisionCycle(payload, { ...fixture.dependencies, now: clock });

    expect(clock).toHaveBeenCalledTimes(1);
    expect(fixture.complete.mock.calls[0]?.[0].aggregate.opportunity?.expiresAt).toBe(
      "2026-08-14T06:00:00.000Z",
    );
    expect(fixture.publish.mock.calls.map(([event]) => event.occurredAt)).toEqual([
      now.toISOString(),
      now.toISOString(),
    ]);
  });

  it("cancels before authoritative reads and again before persistence", async () => {
    const beforeRead = new AbortController();
    beforeRead.abort();
    const first = setup({ claimStatus: "acquired", impact: true, signal: beforeRead.signal });
    await expect(runCampaignDecisionCycle(payload, first.dependencies)).resolves.toEqual({
      status: "cancelled",
      decisionCycleId,
    });
    expect(first.cancel).toHaveBeenCalled();
    expect(first.loadContext).not.toHaveBeenCalled();

    const beforeWrite = new AbortController();
    const second = setup({ claimStatus: "acquired", impact: true, signal: beforeWrite.signal });
    const originalGenerate = second.source.generate.bind(second.source);
    vi.spyOn(second.source, "generate").mockImplementation((input) => {
      const output = originalGenerate(input);
      beforeWrite.abort();
      return output;
    });
    await expect(runCampaignDecisionCycle(payload, second.dependencies)).resolves.toEqual({
      status: "cancelled",
      decisionCycleId,
    });
    expect(second.cancel).toHaveBeenCalled();
    expect(second.complete).not.toHaveBeenCalled();
  });
});

function setup(options: {
  claimStatus: "acquired" | "reclaimed" | "in_progress" | "completed" | "cancelled";
  impact: boolean;
  signal?: AbortSignal;
}) {
  const publish = vi.fn().mockResolvedValue(undefined);
  const renew = vi.fn().mockResolvedValue({ leaseExpiresAt: "2026-08-13T12:05:00.000Z" });
  const loadContext = vi.fn().mockResolvedValue(context());
  const complete = vi.fn().mockResolvedValue({
    decisionRecordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    opportunityId: null,
  });
  const fail = vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const source = createCampaignOpportunitySource();
  const controlledEvidence = evidence(options.impact);

  const claimResult =
    options.claimStatus === "acquired" || options.claimStatus === "reclaimed"
      ? {
          status: options.claimStatus,
          decisionCycleId,
          claimToken,
          leaseExpiresAt: "2026-08-13T12:05:00.000Z",
        }
      : options.claimStatus === "completed"
        ? {
            status: "completed" as const,
            decisionCycleId,
            decisionRecordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            opportunityId: null,
          }
        : options.claimStatus === "in_progress"
          ? {
              status: "in_progress" as const,
              decisionCycleId,
              leaseExpiresAt: "2026-08-13T12:05:00.000Z",
            }
          : { status: "cancelled" as const, decisionCycleId };

  return {
    publish,
    renew,
    loadContext,
    complete,
    fail,
    cancel,
    source,
    controlledEvidence,
    dependencies: {
      cycles: {
        claim: vi.fn().mockResolvedValue(claimResult),
        renew,
        loadContext,
        complete,
        fail,
        cancel,
      },
      source,
      loadEvidence: vi.fn(() => controlledEvidence),
      events: { publish },
      now: () => now,
      newId: vi
        .fn()
        .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        .mockReturnValue("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      signal: options.signal,
    },
  };
}

function evidence(withImpact: boolean) {
  return {
    organizationProfileCurrent: true,
    brandConstraintsVerified: true,
    brandAssetsUsable: true,
    syntheticAssetsAllowed: false,
    economics: { currency: "AED", completenessGrade: "complete" as const },
    activeGoalMetricKeys: ["contribution.incremental_gross_profit"],
    metaAccountMapped: true,
    grantedCapabilityKeys: ["publish_instagram", "publish_facebook", "advertise_meta_ads"],
    spendPolicy: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      monthlyBudgetMinor: 450_000,
      currency: "AED",
    },
    trackingReady: true,
    measurementPlanRegistered: true,
    accessPolicyActive: true,
    marginFirewallResult: "pass" as const,
    impactEvidence: withImpact
      ? {
          evidenceTier: "computed" as const,
          impactLowMinor: 600_000,
          impactHighMinor: 900_000,
          currency: "AED",
          sourceRevisionIds: ["impact-revision-1"],
          observedAt: new Date("2026-08-13T06:00:00.000Z"),
          timeToImpactDays: 7,
          completenessGrade: "complete" as const,
        }
      : null,
    inputsObservedAt: new Date("2026-08-13T06:00:00.000Z"),
    observedVolume: 100,
  };
}

function context(overrides: Partial<DecisionCycleContext> = {}): DecisionCycleContext {
  return {
    organizationId,
    organizationCurrency: "AED",
    accessPolicy: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      maxActiveRecommendations: 3,
    },
    activeOpportunityCount: 0,
    spendPolicy: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      monthlyBudgetMinor: 450_000,
      currency: "AED",
    },
    playbook: {
      definitionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      versionId: "12121212-1212-4212-8212-121212121212",
      semanticVersion: "1.0.0",
      actionKey: "campaign.meta_bundle_v1",
      requiredCapabilityKeys: ["publish_instagram", "publish_facebook", "advertise_meta_ads"],
      requiredEvidenceKeys: ["impact.range"],
      riskClass: 3,
      primaryMetricKey: "contribution.incremental_gross_profit",
      guardrailMetricKeys: ["spend.total", "contribution.margin_rate"],
      freshnessBoundMinutes: 1_440,
      measurementWindowDays: 7,
    },
    rankingArtifact: {
      id: "13131313-1313-4313-8313-131313131313",
      implementationKey: "decision.ranking.evidence_value_time_v1",
    },
    confidenceArtifact: {
      id: "14141414-1414-4414-8414-141414141414",
      implementationKey: "decision.confidence.computed_baseline_v1",
    },
    suppressions: [],
    evidence: {
      organizationProfileCurrent: true,
      brandConstraintsVerified: false,
      brandAssetsUsable: false,
      syntheticAssetsAllowed: false,
      economics: { currency: "AED", completenessGrade: "complete" },
      activeGoalMetricKeys: ["contribution.incremental_gross_profit"],
      metaAccountMapped: false,
      grantedCapabilityKeys: [],
      trackingReady: false,
      measurementPlanRegistered: true,
      marginFirewallResult: "unknown",
      inputsObservedAt: "2026-08-13T06:00:00.000Z",
      observedVolume: 100,
    },
    ...overrides,
  };
}
