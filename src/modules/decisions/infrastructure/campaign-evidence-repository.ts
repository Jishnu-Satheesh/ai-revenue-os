import type { DecisionCycleContext } from "@/modules/decisions/application/ports";
import type { CampaignEvidence } from "@/modules/decisions/sources/campaign-opportunity-source";

export function mapCampaignEvidence(
  evidence: DecisionCycleContext["evidence"],
  spendPolicy: DecisionCycleContext["spendPolicy"],
): CampaignEvidence {
  return {
    ...evidence,
    inputsObservedAt: new Date(evidence.inputsObservedAt),
    spendPolicy,
    accessPolicyActive: true,
    // Governed impact arithmetic/comparable-intervention evidence does not yet
    // exist. Controlled selection fixtures are injected by workflow tests only.
    impactEvidence: null,
  };
}
