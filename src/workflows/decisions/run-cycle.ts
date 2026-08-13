import { createHash, randomUUID } from "node:crypto";

import {
  resolveConfidenceImplementation,
  resolveRankingImplementation,
} from "@/domain/decisions/artifacts";
import { parameterDigest } from "@/domain/decisions/digest";
import { applyPolicyGate } from "@/domain/decisions/policy";
import { computeSlotBudget, screenCandidates } from "@/domain/decisions/screening";
import { expectedContributionMinor } from "@/domain/decisions/value";
import type { DecisionDomainEvent, EventPublisher } from "@/domain/events/types";
import type {
  DecisionAggregate,
  DecisionCycleContext,
  DecisionCyclePort,
  DecisionLiveClaim,
} from "@/modules/decisions/application/ports";
import { createDecisionService } from "@/modules/decisions/application/service";
import type {
  CampaignEvidence,
  CampaignOpportunitySource,
} from "@/modules/decisions/sources/campaign-opportunity-source";
import {
  DecisionConfigurationError,
  decisionCycleRequestDigest,
  parseCampaignDecisionCyclePayload,
} from "@/workflows/decisions/contracts";

export type CampaignDecisionCycleDependencies = {
  cycles: DecisionCyclePort;
  source: Pick<CampaignOpportunitySource, "generate">;
  loadEvidence(context: DecisionCycleContext): CampaignEvidence;
  events: EventPublisher;
  now?: () => Date;
  newId?: () => string;
  signal?: AbortSignal;
};

export type CampaignDecisionCycleResult =
  | {
      status: "completed";
      decisionCycleId: string;
      decisionRecordId: string;
      opportunityId: string | null;
    }
  | { status: "in_progress" | "cancelled"; decisionCycleId: string }
  | { status: "failed"; decisionCycleId: string; failureCode: string };

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function versionTuple(context: DecisionCycleContext) {
  return {
    policyVersionId: context.accessPolicy.id,
    ...(context.playbook === null ? {} : { playbookVersionId: context.playbook.versionId }),
    rankingWeightsId: context.rankingArtifact.id,
    confidenceCalibrationId: context.confidenceArtifact.id,
  };
}

function baseRecord(input: {
  claim: DecisionLiveClaim;
  context: DecisionCycleContext;
  inputsDigest: string;
}) {
  return {
    decisionCycleId: input.claim.decisionCycleId,
    organizationId: input.claim.organizationId,
    correlationId: input.claim.correlationId,
    rejectionHistogram: {} as Record<string, number>,
    screenedCount: 0,
    scoredCount: 0,
    inputsDigest: input.inputsDigest,
    versionTuple: versionTuple(input.context),
    propensity: 1 as const,
    isExploration: false as const,
  };
}

function noActionAggregate(input: {
  claim: DecisionLiveClaim;
  context: DecisionCycleContext;
  inputsDigest: string;
  reason: string;
  rejectionHistogram?: Record<string, number>;
  screenedCount?: number;
  candidates?: DecisionAggregate["candidates"];
}): DecisionAggregate {
  const candidates = input.candidates ?? [];
  return {
    record: {
      ...baseRecord(input),
      outcome: "no_action",
      reason: input.reason,
      needsDataKeys: [],
      selectedCandidateFingerprint: null,
      opportunityId: null,
      rejectionHistogram: input.rejectionHistogram ?? {},
      screenedCount: input.screenedCount ?? 0,
      scoredCount: candidates.length,
    },
    candidates,
    opportunity: null,
  };
}

function needsDataAggregate(input: {
  claim: DecisionLiveClaim;
  context: DecisionCycleContext;
  inputsDigest: string;
  keys: readonly string[];
}): DecisionAggregate {
  return {
    record: {
      ...baseRecord(input),
      outcome: "needs_data",
      reason: "campaign_evidence_missing",
      needsDataKeys: [...new Set(input.keys)].slice(0, 50),
      selectedCandidateFingerprint: null,
      opportunityId: null,
    },
    candidates: [],
    opportunity: null,
  };
}

function startEvent(claim: DecisionLiveClaim, occurredAt: Date, eventId: string) {
  return {
    eventId,
    eventName: "decision.cycle_started",
    occurredAt: occurredAt.toISOString(),
    organizationId: claim.organizationId,
    actorType: "system" as const,
    correlationId: claim.correlationId,
    schemaVersion: 1,
    payload: { decisionCycleId: claim.decisionCycleId },
  } satisfies DecisionDomainEvent<"decision.cycle_started">;
}

async function cancelIfAborted(
  operation: Parameters<DecisionCyclePort["cancel"]>[0],
  claim: DecisionLiveClaim,
  dependencies: CampaignDecisionCycleDependencies,
): Promise<CampaignDecisionCycleResult | null> {
  if (!dependencies.signal?.aborted) return null;
  await dependencies.cycles.cancel(operation);
  return { status: "cancelled", decisionCycleId: claim.decisionCycleId };
}

export async function runCampaignDecisionCycle(
  rawPayload: unknown,
  dependencies: CampaignDecisionCycleDependencies,
): Promise<CampaignDecisionCycleResult> {
  const payload = parseCampaignDecisionCyclePayload(rawPayload);
  const now = dependencies.now ?? (() => new Date());
  const newId = dependencies.newId ?? randomUUID;
  const operation = { ...payload, requestDigest: decisionCycleRequestDigest(payload) };
  const claimed = await dependencies.cycles.claim(operation);

  if (claimed.status === "completed") return claimed;
  if (claimed.status === "in_progress" || claimed.status === "cancelled") return claimed;

  const claim: DecisionLiveClaim = {
    ...operation,
    decisionCycleId: claimed.decisionCycleId,
    claimToken: claimed.claimToken,
    leaseExpiresAt: claimed.leaseExpiresAt,
  };
  if (claimed.status === "acquired") {
    await dependencies.events.publish(startEvent(claim, now(), newId()));
  }

  const cancelledBeforeRead = await cancelIfAborted(operation, claim, dependencies);
  if (cancelledBeforeRead) return cancelledBeforeRead;

  try {
    await dependencies.cycles.renew(claim);
    const context = await dependencies.cycles.loadContext(claim);
    if (context.organizationId !== payload.organizationId) {
      throw new DecisionConfigurationError("decision_context_organization_mismatch");
    }

    const inputsDigest = sha256({
      organizationId: context.organizationId,
      accessPolicyId: context.accessPolicy.id,
      spendPolicyId: context.spendPolicy?.id ?? null,
      playbookVersionId: context.playbook?.versionId ?? null,
      rankingArtifactId: context.rankingArtifact.id,
      confidenceArtifactId: context.confidenceArtifact.id,
      evidence: context.evidence,
      suppressions: context.suppressions,
    });
    const slotBudget = computeSlotBudget({
      maxActiveRecommendations: context.accessPolicy.maxActiveRecommendations,
      activeOpportunityCount: context.activeOpportunityCount,
    });

    let aggregate: DecisionAggregate;
    if (slotBudget === 0) {
      aggregate = noActionAggregate({
        claim,
        context,
        inputsDigest,
        reason: "slot_budget_exhausted",
      });
    } else if (context.playbook === null) {
      aggregate = noActionAggregate({ claim, context, inputsDigest, reason: "no_active_playbook" });
    } else {
      const evidence = dependencies.loadEvidence(context);
      const generated = dependencies.source.generate({
        organizationId: payload.organizationId,
        playbookVersionId: context.playbook.versionId,
        evidence,
        now: now(),
      });

      if (generated.outcome === "needs_data") {
        aggregate = needsDataAggregate({
          claim,
          context,
          inputsDigest,
          keys: [
            ...generated.missingEvidenceKeys,
            ...generated.missingCapabilityKeys.map((key) => `capability.${key}`),
          ],
        });
      } else if (generated.outcome === "rejected") {
        aggregate = noActionAggregate({
          claim,
          context,
          inputsDigest,
          reason: generated.rejectionReason,
        });
      } else {
        const candidate = generated.candidates[0];
        if (!candidate || generated.candidates.length !== 1) {
          throw new DecisionConfigurationError("decision_campaign_candidate_count_invalid");
        }
        const screened = screenCandidates(
          [
            {
              ...candidate,
              requiredCapabilityKeys: context.playbook.requiredCapabilityKeys,
              primaryMetricKey: context.playbook.primaryMetricKey,
              // Candidate freshness is the governed impact observation that
              // will be scored, not a newer unrelated context read.
              inputsObservedAt: candidate.impactEvidence.observedAt,
              freshnessBoundMinutes: context.playbook.freshnessBoundMinutes,
            },
          ],
          {
            now: now(),
            grantedCapabilityKeys: new Set(evidence.grantedCapabilityKeys),
            activeGoalMetricKeys: new Set(evidence.activeGoalMetricKeys),
            goalAlignmentActive: evidence.activeGoalMetricKeys.length > 0,
            suppressedFingerprints: new Map(
              context.suppressions.map((item) => [
                item.candidateFingerprint,
                {
                  suppressedUntil:
                    item.suppressedUntil === null ? null : new Date(item.suppressedUntil),
                },
              ]),
            ),
          },
        );

        if (screened.survivors.length === 0) {
          aggregate = noActionAggregate({
            claim,
            context,
            inputsDigest,
            reason: screened.rejections[0]?.reason ?? "no_candidate_admitted",
            rejectionHistogram: screened.rejectionHistogram,
            screenedCount: screened.screenedCount,
          });
        } else {
          let confidenceImplementation;
          let rankingImplementation;
          try {
            confidenceImplementation = resolveConfidenceImplementation(
              context.confidenceArtifact.implementationKey,
            );
            rankingImplementation = resolveRankingImplementation(
              context.rankingArtifact.implementationKey,
            );
          } catch {
            throw new DecisionConfigurationError("decision_artifact_implementation_unknown");
          }
          const impact = candidate.impactEvidence;
          const ageMinutes = (now().getTime() - impact.observedAt.getTime()) / 60_000;
          const confidence = confidenceImplementation.compute({
            evidenceTier: impact.evidenceTier,
            completenessGrade: impact.completenessGrade,
            inputAgeMinutes: ageMinutes,
            freshnessBoundMinutes: context.playbook.freshnessBoundMinutes,
          });
          const executionCostMinor = candidate.parameters.spendCeiling.amountMinor;
          const valueInput = {
            candidateFingerprint: candidate.candidateFingerprint,
            evidenceTier: impact.evidenceTier,
            impactLowMinor: impact.impactLowMinor,
            impactHighMinor: impact.impactHighMinor,
            executionCostMinor,
            currency: impact.currency,
            confidence: confidence.confidence,
            timeToImpactDays: impact.timeToImpactDays,
          };
          const expectedContribution = expectedContributionMinor(valueInput);
          const ranked = rankingImplementation.rank([
            { ...valueInput, expectedContributionMinor: expectedContribution },
          ]);
          const policy = applyPolicyGate(
            [
              {
                ...valueInput,
                riskTier: context.playbook.riskClass,
                marginFirewall: evidence.marginFirewallResult,
              },
            ],
            {
              policyVersionId: context.accessPolicy.id,
              remainingBudgetMinor: context.spendPolicy?.monthlyBudgetMinor ?? 0,
              currency: context.spendPolicy?.currency ?? context.organizationCurrency,
            },
          );
          if (policy.needsData.length > 0) {
            aggregate = needsDataAggregate({
              claim,
              context,
              inputsDigest,
              keys: policy.needsData.map((item) => item.missingInput),
            });
          } else {
            const removalReason = policy.removed[0]?.reason;
            const candidateRow: DecisionAggregate["candidates"][number] = {
              playbookVersionId: context.playbook.versionId,
              candidateFingerprint: candidate.candidateFingerprint,
              subjectKind: candidate.subject.subjectKind,
              subjectRef: candidate.subject.subjectId,
              parameterDigest: parameterDigest(candidate.parameters),
              impactLowMinor: impact.impactLowMinor,
              impactHighMinor: impact.impactHighMinor,
              confidence: confidence.confidence,
              executionCostMinor,
              expectedContributionMinor: expectedContribution,
              currency: impact.currency,
              evidenceTier: impact.evidenceTier,
              eligibilityResult: { eligible: true },
              policyResult:
                removalReason === undefined
                  ? { admitted: true, policyVersionId: context.accessPolicy.id }
                  : { admitted: false, reason: removalReason },
              rejectionReason: removalReason ?? null,
              rank:
                ranked.findIndex(
                  (item) => item.candidateFingerprint === candidate.candidateFingerprint,
                ) + 1,
            };
            if (policy.admitted.length === 0) {
              aggregate = noActionAggregate({
                claim,
                context,
                inputsDigest,
                reason: removalReason ?? "no_candidate_admitted",
                screenedCount: screened.screenedCount,
                candidates: [candidateRow],
              });
            } else {
              const opportunityId = newId();
              aggregate = {
                record: {
                  ...baseRecord({ claim, context, inputsDigest }),
                  outcome: "action_selected",
                  reason: null,
                  needsDataKeys: [],
                  selectedCandidateFingerprint: candidate.candidateFingerprint,
                  opportunityId,
                  screenedCount: screened.screenedCount,
                  scoredCount: 1,
                },
                candidates: [candidateRow],
                opportunity: {
                  id: opportunityId,
                  playbookVersionId: context.playbook.versionId,
                  candidateFingerprint: candidate.candidateFingerprint,
                  title: "Review a governed Meta campaign recommendation",
                  summary:
                    "A bounded Meta campaign could increase incremental gross profit within the configured spend ceiling.",
                  hypothesis:
                    "If the approved campaign reaches the intended audience, incremental gross profit will improve within the measurement window.",
                  subjectKind: candidate.subject.subjectKind,
                  subjectRef: candidate.subject.subjectId,
                  evidenceBundle: { sourceRevisionIds: [...impact.sourceRevisionIds] },
                  assumptions: ["The governed impact evidence remains current through review."],
                  impactLowMinor: impact.impactLowMinor,
                  impactHighMinor: impact.impactHighMinor,
                  confidence: confidence.confidence,
                  confidenceRationale: confidence.rationaleCode,
                  evidenceTier: impact.evidenceTier,
                  executionCostMinor,
                  expectedContributionMinor: expectedContribution,
                  currency: impact.currency,
                  timeToImpactDays: impact.timeToImpactDays,
                  riskTier: context.playbook.riskClass as 0 | 1 | 2 | 3,
                  approvalPath: "human_approval",
                  guardrails: context.playbook.guardrailMetricKeys.map((key) => ({ key })),
                  assertions: [
                    { key: "policy.access.active", expectedOutcome: context.accessPolicy.id },
                    {
                      key: "policy.spend.active",
                      expectedOutcome: context.spendPolicy?.id ?? "missing",
                    },
                    { key: "margin.firewall.pass", expectedOutcome: "pass" },
                    { key: "measurement.tracking_ready", expectedOutcome: "true" },
                  ],
                  evaluationPlan: {
                    primaryMetricKey: context.playbook.primaryMetricKey,
                    measurementWindowDays: context.playbook.measurementWindowDays,
                  },
                  expiresAt: new Date(
                    now().getTime() + context.playbook.freshnessBoundMinutes * 60_000,
                  ).toISOString(),
                  status: "proposed",
                },
              };
            }
          }
        }
      }
    }

    const cancelledBeforeWrite = await cancelIfAborted(operation, claim, dependencies);
    if (cancelledBeforeWrite) return cancelledBeforeWrite;
    await dependencies.cycles.renew(claim);
    const service = createDecisionService({
      aggregateStore: dependencies.cycles,
      events: dependencies.events,
      now,
    });
    const completion = await service.record(claim, aggregate);
    return { status: "completed", decisionCycleId: claim.decisionCycleId, ...completion };
  } catch (error) {
    if (!(error instanceof DecisionConfigurationError)) throw error;
    await dependencies.cycles.fail({ ...claim, failureCode: error.failureCode });
    return {
      status: "failed",
      decisionCycleId: claim.decisionCycleId,
      failureCode: error.failureCode,
    };
  }
}
