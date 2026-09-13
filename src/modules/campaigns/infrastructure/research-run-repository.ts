import {
  researchFailure,
  type ResearchPersistence,
} from "@/modules/campaigns/infrastructure/research-policy-repository";

/**
 * The worker's handle on research runs.
 *
 * Claim/complete/fail/cancel travel through the governed writers, so a lost
 * lease completes nothing and a finished run keeps its measured cost. Every
 * fault maps the same way the admission repository maps: named outcomes stay
 * named, and anything unrecognised becomes unavailable rather than a guess.
 */

export type ClaimedResearchRun = {
  runId: string;
  claimToken: string;
  policyVersion: number;
  budgetMinor: number;
};

export type ResearchRunClaim = ClaimedResearchRun | { outcome: "already_claimed" };

export type ResearchRunStore = {
  claim(input: {
    organizationId: string;
    runId: string;
    leaseSeconds: number;
  }): Promise<ResearchRunClaim>;
  complete(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
    proposalId: string | null;
    contextManifestId: string | null;
    contextDigest: string | null;
    qualifiedResearchRequestIds: readonly string[];
    actualCostMinor: number;
    outcome: string;
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
    actualCostMinor: number;
    failureCode: string;
  }): Promise<void>;
  cancel(input: {
    organizationId: string;
    runId: string;
    actualCostMinor?: number;
  }): Promise<void>;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function createResearchRunStore(client: ResearchPersistence): ResearchRunStore {
  return {
    async claim(input): Promise<ResearchRunClaim> {
      const { data, error } = await client.rpc("claim_campaign_research_run", {
        target_organization_id: input.organizationId,
        input_claim: { run_id: input.runId, lease_seconds: input.leaseSeconds },
      });
      if (error) throw researchFailure(error);

      const row = record(data);
      if (row.outcome === "already_claimed") return { outcome: "already_claimed" };
      return {
        runId: String(row.run_id),
        claimToken: String(row.claim_token),
        policyVersion: Number(row.policy_version),
        budgetMinor: Number(row.budget_minor),
      };
    },

    async complete(input): Promise<void> {
      const { error } = await client.rpc("complete_campaign_research_run", {
        target_organization_id: input.organizationId,
        input_complete: {
          run_id: input.runId,
          claim_token: input.claimToken,
          proposal_id: input.proposalId,
          context_manifest_id: input.contextManifestId,
          context_digest: input.contextDigest,
          qualified_research_request_ids: [...input.qualifiedResearchRequestIds],
          actual_cost_minor: input.actualCostMinor,
          outcome: input.outcome,
        },
      });
      if (error) throw researchFailure(error);
    },

    async fail(input): Promise<void> {
      const { error } = await client.rpc("fail_campaign_research_run", {
        target_organization_id: input.organizationId,
        input_failure: {
          run_id: input.runId,
          claim_token: input.claimToken,
          actual_cost_minor: input.actualCostMinor,
          failure_code: input.failureCode,
        },
      });
      if (error) throw researchFailure(error);
    },

    async cancel(input): Promise<void> {
      const { error } = await client.rpc("cancel_campaign_research_run", {
        target_organization_id: input.organizationId,
        input_cancel: {
          run_id: input.runId,
          actual_cost_minor: input.actualCostMinor ?? 0,
        },
      });
      if (error) throw researchFailure(error);
    },
  };
}
