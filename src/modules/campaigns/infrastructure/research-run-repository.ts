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
  /**
   * Loads everything the worker needs in one claim-bound call: the run, the
   * still-binding policy version, and the pinned manifest snapshots. Throws
   * a not_found failure when the claim is gone — the service turns that into
   * a lost claim rather than retrying landed work.
   */
  load(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
  }): Promise<LoadedResearchContext>;
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
  /**
   * Proves the run still holds its claim, and returns nothing else.
   *
   * The worker reads business context, pinned memory and Growth evidence on
   * the service client, which bypasses RLS — tenancy holds there because every
   * query repeats the organization id. This is the second fence: a worker that
   * lost its claim must not keep reading on the strength of a connection it
   * still happens to hold. Throws a not_found failure when the claim is gone,
   * which the service turns into a lost claim.
   */
  assertClaimLive(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
  }): Promise<void>;
  /**
   * The organizations holding at least one claim whose lease has lapsed.
   *
   * Read first so the sweep acts tenant by tenant. A run is judged dead by
   * its lease alone: there is no heartbeat to miss, so a worker cannot keep a
   * claim alive by asserting it is still working.
   */
  listLeaseExpiries(): Promise<readonly string[]>;
  /**
   * Returns one organization's lapsed claims to the queue, or gives up on the
   * ones that have used the attempts their admitting policy allows.
   *
   * This is the only way out of a dead claim. Without it such a run holds its
   * pending slot and its reserved budget for good, because `claim` takes only
   * queued rows and both `complete` and `fail` require a live lease.
   */
  reclaimLeases(input: {
    organizationId: string;
  }): Promise<{ reclaimed: number; abandoned: number }>;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export type LoadedResearchMemoryEntry = {
  id: string;
  title: string | null;
  body: string | null;
};

export type LoadedResearchContext = {
  status: string;
  triggerKind: string;
  policyVersion: number;
  budgetMinor: number;
  /** The staged question, admitted with the run. Null when never asked. */
  researchQuestion: string | null;
  /** Null when no policy pointer exists; the recheck then refuses. */
  currentPolicyVersion: number | null;
  manifestId: string | null;
  digest: string | null;
  entries: readonly LoadedResearchMemoryEntry[];
};

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

    async load(input): Promise<LoadedResearchContext> {
      const { data, error } = await client.rpc("load_campaign_research_context", {
        target_organization_id: input.organizationId,
        input_load: { run_id: input.runId, claim_token: input.claimToken },
      });
      if (error) throw researchFailure(error);

      const row = record(data);
      const rawEntries = Array.isArray(row.manifest_entries) ? row.manifest_entries : [];
      return {
        status: String(row.status),
        triggerKind: String(row.trigger_kind),
        policyVersion: Number(row.policy_version),
        budgetMinor: Number(row.budget_minor),
        researchQuestion:
          row.research_question === null ? null : String(row.research_question),
        currentPolicyVersion:
          row.current_policy_version === null ? null : Number(row.current_policy_version),
        manifestId:
          row.context_manifest_id === null ? null : String(row.context_manifest_id),
        digest: row.context_digest === null ? null : String(row.context_digest),
        entries: rawEntries.map((entry) => {
          const item = record(entry);
          return {
            id: String(item.id),
            title: typeof item.title === "string" ? item.title : null,
            body: typeof item.body === "string" ? item.body : null,
          };
        }),
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

    async assertClaimLive(input): Promise<void> {
      const { error } = await client.rpc("assert_campaign_research_claim", {
        target_organization_id: input.organizationId,
        input_claim: { run_id: input.runId, claim_token: input.claimToken },
      });
      if (error) throw researchFailure(error);
    },

    async listLeaseExpiries(): Promise<readonly string[]> {
      const { data, error } = await client.rpc(
        "list_campaign_research_lease_expiries",
        {},
      );
      if (error) throw researchFailure(error);
      // Anything that is not a list of ids is a contract the sweep does not
      // recognise, and sweeping nothing is the safe reading of it.
      return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [];
    },

    async reclaimLeases(input): Promise<{ reclaimed: number; abandoned: number }> {
      const { data, error } = await client.rpc("reclaim_campaign_research_runs", {
        target_organization_id: input.organizationId,
      });
      if (error) throw researchFailure(error);

      const row = record(data);
      return { reclaimed: Number(row.reclaimed ?? 0), abandoned: Number(row.abandoned ?? 0) };
    },
  };
}
