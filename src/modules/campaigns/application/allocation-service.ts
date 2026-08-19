import {
  evaluateVariant,
  type AllocationDecision,
  type AllocationRuleThresholds,
  type ResolvedMargin,
  type VariantDiagnostics,
} from "@/domain/campaigns/allocation";

/**
 * The decision half of the fast loop, kept apart from the workflow that acts on
 * it.
 *
 * This service decides nothing that the domain rules do not already decide. It
 * assembles the inputs — a campaign's live variants, their own diagnostics, and
 * the channel's contribution margin — hands each variant to the deterministic
 * evaluator, and appends every resulting decision to the ledger, including the
 * ones that choose not to act. A decision not to act is still a decision, and
 * an operator who cannot see it cannot trust the loop.
 *
 * It is deliberately single-campaign. There is no second campaign in any
 * parameter, and no return value that ranks or compares variants across
 * campaigns, because comparing campaigns is learning and ADR 0021 keeps
 * learning out of this loop entirely.
 */

export type AllocationVariantCandidate = {
  variantId: string;
  /** The channel whose margin this variant spends against. */
  channel: string;
  diagnostics: VariantDiagnostics;
};

export type AllocationLedgerRow = {
  organizationId: string;
  campaignId: string;
  cycleId: string;
  decision: AllocationDecision;
  actor: "agent";
  at: string;
};

export type AllocationServiceDependencies = {
  readVariants(input: {
    organizationId: string;
    campaignId: string;
  }): Promise<readonly AllocationVariantCandidate[]>;
  /** Null means the ledger grade is insufficient or the margin is unavailable. */
  resolveMargin(input: { organizationId: string; channel: string }): Promise<ResolvedMargin | null>;
  appendLedger(row: AllocationLedgerRow): Promise<void>;
  thresholds: AllocationRuleThresholds;
  now?: () => Date;
};

export type AllocationCampaignResult = {
  campaignId: string;
  /** Every decision appended, in evaluation order. */
  decisions: readonly AllocationDecision[];
  /** The subset whose action is `pause`, for the workflow to dispatch. */
  pauses: readonly AllocationDecision[];
};

export async function evaluateCampaign(
  input: { organizationId: string; campaignId: string; cycleId: string },
  deps: AllocationServiceDependencies,
): Promise<AllocationCampaignResult> {
  const now = deps.now ?? (() => new Date());
  const at = now().toISOString();

  const variants = await deps.readVariants({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
  });

  // Resolved once per channel, not once per variant. The margin is a fact about
  // the channel, and fetching it per variant would both waste reads and let two
  // variants of the same channel disagree with each other mid-cycle.
  const marginByChannel = new Map<string, ResolvedMargin | null>();
  const decisions: AllocationDecision[] = [];

  for (const variant of variants) {
    let margin = marginByChannel.get(variant.channel);
    if (margin === undefined) {
      margin = await deps.resolveMargin({
        organizationId: input.organizationId,
        channel: variant.channel,
      });
      marginByChannel.set(variant.channel, margin);
    }

    const variantDecisions = evaluateVariant(
      {
        variantId: variant.variantId,
        diagnostics: variant.diagnostics,
        margin,
      },
      deps.thresholds,
    );

    for (const decision of variantDecisions) {
      await deps.appendLedger({
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        cycleId: input.cycleId,
        decision,
        actor: "agent",
        at,
      });
      decisions.push(decision);
    }
  }

  return {
    campaignId: input.campaignId,
    decisions,
    pauses: decisions.filter((decision) => decision.action === "pause"),
  };
}
