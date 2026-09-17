import { z } from "zod";

/**
 * Whether starting generation may spend what it is about to spend.
 *
 * Approving a proposal authorizes preparation inside a stated cost ceiling —
 * the purse. The click on Generate spends it. The route checks this before
 * anything is enqueued, so a misconfigured worker ceiling cannot spend money
 * nobody agreed to.
 *
 * Only proposal-born campaigns carry an approved purse. A manual or
 * opportunity campaign has no proposal behind it, so there is nothing to check
 * against and the dispatch ceiling stands on its own.
 */

const ceilingSchema = z.strictObject({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

const proposalDocumentSchema = z.strictObject({
  generationCostCeiling: ceilingSchema,
});

export function approvedCeilingMinor(document: unknown): number | null {
  const parsed = proposalDocumentSchema.safeParse(document);
  if (!parsed.success) return null;
  return parsed.data.generationCostCeiling.amountMinor;
}

export type GenerationCapDecision =
  | { allowed: true }
  | { allowed: false; reasonCode: "generation_budget_exceeded" | "generation_budget_unreadable" };

/**
 * Pure check, so the route stays a thin reader and the rule is testable alone.
 *
 * Refuses when the dispatch ceiling is above what the approval permits. Equal
 * is allowed: spending exactly the purse is spending inside it, not beyond it.
 */
export function generationDispatchAllowed(input: {
  approvedCeilingMinor: number | null;
  dispatchCeilingMinor: number;
}): GenerationCapDecision {
  if (input.approvedCeilingMinor === null) {
    return { allowed: false, reasonCode: "generation_budget_unreadable" };
  }
  if (input.dispatchCeilingMinor > input.approvedCeilingMinor) {
    return { allowed: false, reasonCode: "generation_budget_exceeded" };
  }
  return { allowed: true };
}

/** Minimal persistence surface for reading the approved purse. */
export type ProposalCapPersistence = {
  from(
    table: "campaign_proposals" | "campaign_proposal_versions",
  ): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          limit(count: number): Promise<{
            data: Record<string, unknown>[] | null;
            error: unknown;
          }>;
        };
        limit(count: number): Promise<{
          data: Record<string, unknown>[] | null;
          error: unknown;
        }>;
      };
    };
  };
};

export function createApprovedGenerationCapReader(persistence: ProposalCapPersistence) {
  return {
    /**
     * The approved preparation purse for a proposal-born campaign.
     *
     * Reads through the caller's own session, so row level security decides
     * what is visible exactly as it does everywhere else. Returns `null` when
     * there is no readable approval behind this campaign — which the route
     * treats as "do not spend", never as "spend freely".
     */
    async readApprovedCeiling(input: {
      organizationId: string;
      campaignId: string;
    }): Promise<{ ceilingMinor: number | null; state: string | null }> {
      const { data: proposals, error: proposalError } = await persistence
        .from("campaign_proposals")
        .select("state,current_version_id")
        .eq("organization_id", input.organizationId)
        .eq("linked_campaign_id", input.campaignId)
        .limit(1);
      if (proposalError) throw new Error("The proposal approval could not be read.");
      const [proposal] = proposals ?? [];
      if (!proposal) return { ceilingMinor: null, state: null };

      const state = typeof proposal.state === "string" ? proposal.state : null;
      const versionId =
        typeof proposal.current_version_id === "string" ? proposal.current_version_id : null;
      if (!versionId) return { ceilingMinor: null, state };

      const { data: versions, error: versionError } = await persistence
        .from("campaign_proposal_versions")
        .select("document")
        .eq("organization_id", input.organizationId)
        .eq("id", versionId)
        .limit(1);
      if (versionError) throw new Error("The proposal approval could not be read.");
      const [version] = versions ?? [];
      if (!version) return { ceilingMinor: null, state };

      return { ceilingMinor: approvedCeilingMinor(version.document), state };
    },
  };
}

export type ApprovedGenerationCapReader = ReturnType<typeof createApprovedGenerationCapReader>;
