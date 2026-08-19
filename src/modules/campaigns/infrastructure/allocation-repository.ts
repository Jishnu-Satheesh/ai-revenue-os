import { z } from "zod";

import type { ResolvedMargin, VariantDiagnostics } from "@/domain/campaigns/allocation";
import type { AllocationLedgerRow } from "@/modules/campaigns/application/allocation-service";

/**
 * The fast loop's persistence surface.
 *
 * Every write and every grain-correct read goes through a worker-only
 * security-definer RPC, so the loop has no direct table access and no path to
 * anything the wall protects. The RPC names below are the entire surface: the
 * evidence loop's exposure, observation, and outcome records are absent from
 * this contract by omission, because the fast loop is not allowed to touch
 * them.
 */

type RpcResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

export type AllocationRpcName =
  | "append_campaign_allocation_event"
  | "read_campaign_allocation_candidates"
  | "read_campaign_channel_margin"
  | "pause_campaign_variant"
  | "resume_campaign_variant";

export type AllocationPersistence = {
  rpc(name: AllocationRpcName, args: Record<string, unknown>): Promise<RpcResult<unknown>>;
};

export type AllocationCandidate = {
  variantId: string;
  channel: string;
  diagnostics: VariantDiagnostics;
};

/** Postgres may hand a numeric or bigint back as a number or a string. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const candidateSchema = z.strictObject({
  variant_id: z.string().uuid(),
  channel: z.string(),
  impressions: z.unknown(),
  clicks: z.unknown(),
  spend_minor: z.unknown(),
});

const marginSchema = z
  .strictObject({
    contribution_margin_minor: z.unknown(),
    resolved_margin_grade: z.enum(["measured", "derived", "estimated", "assumed"]),
    currency: z.string(),
  })
  .nullable();

export function createAllocationRepository(persistence: AllocationPersistence) {
  return {
    /** The live variants a campaign still has in flight, with their own numbers. */
    async listCandidates(
      organizationId: string,
      campaignId: string,
    ): Promise<readonly AllocationCandidate[]> {
      const { data, error } = await persistence.rpc("read_campaign_allocation_candidates", {
        target_organization_id: organizationId,
        campaign_id: campaignId,
      });
      if (error || !Array.isArray(data))
        throw new Error("Allocation candidates could not be read.");

      return data.flatMap((row) => {
        const parsed = candidateSchema.safeParse(row);
        if (!parsed.success) return [];
        return [
          {
            variantId: parsed.data.variant_id,
            channel: parsed.data.channel,
            diagnostics: {
              impressions: toNumber(parsed.data.impressions),
              clicks: toNumber(parsed.data.clicks),
              spendMinor: toNumber(parsed.data.spend_minor),
            },
          },
        ];
      });
    },

    /** The channel's contribution margin, or null when the grade is insufficient. */
    async resolveMargin(organizationId: string, channel: string): Promise<ResolvedMargin | null> {
      const { data, error } = await persistence.rpc("read_campaign_channel_margin", {
        target_organization_id: organizationId,
        channel,
      });
      if (error) throw new Error("The channel margin could not be read.");

      const parsed = marginSchema.safeParse(data);
      if (!parsed.success) return null;
      if (parsed.data === null) return null;

      const contributionMarginMinor = toNumber(parsed.data.contribution_margin_minor);
      if (contributionMarginMinor === null) return null;

      return {
        contributionMarginMinor,
        qualityTier: parsed.data.resolved_margin_grade,
        currency: parsed.data.currency,
      };
    },

    /** Append one decision to the allocation ledger. */
    async appendLedgerRow(row: AllocationLedgerRow): Promise<void> {
      const { error } = await persistence.rpc("append_campaign_allocation_event", {
        target_organization_id: row.organizationId,
        input_event: {
          organization_id: row.organizationId,
          campaign_id: row.campaignId,
          cycle_id: row.cycleId,
          variant_id: row.decision.variantId,
          rule_key: row.decision.ruleKey,
          rule_version: row.decision.ruleVersion,
          observed_value: row.decision.observedValue,
          threshold: row.decision.threshold,
          resolved_margin_minor:
            row.decision.resolvedMarginGrade === null ? null : row.decision.observedValue,
          resolved_margin_grade: row.decision.resolvedMarginGrade,
          action: row.decision.action,
          reason_code: row.decision.reasonCode,
          actor: row.actor,
          at: row.at,
        },
      });
      if (error) throw new Error("The allocation decision could not be recorded.");
    },

    /** The agent-side pause: mark the variant, no provider call. */
    async pauseVariant(
      organizationId: string,
      variantId: string,
      reasonCode: string,
    ): Promise<{ outcome: "paused" | "already_paused" | "not_pausable" }> {
      const { data, error } = await persistence.rpc("pause_campaign_variant", {
        target_organization_id: organizationId,
        input_pause: {
          organization_id: organizationId,
          variant_id: variantId,
          reason_code: reasonCode,
        },
      });
      if (error) throw new Error("The variant could not be paused.");
      const outcome = (data as { outcome?: string } | null)?.outcome;
      if (outcome === "paused" || outcome === "already_paused" || outcome === "not_pausable") {
        return { outcome };
      }
      throw new Error("The variant could not be paused.");
    },

    /** The operator-side resume: recorded with actor and time by the database. */
    async resumeVariant(
      organizationId: string,
      variantId: string,
    ): Promise<{ outcome: "resumed" | "not_paused" | "forbidden" }> {
      const { data, error } = await persistence.rpc("resume_campaign_variant", {
        target_organization_id: organizationId,
        input_resume: {
          organization_id: organizationId,
          variant_id: variantId,
        },
      });
      if (error) throw new Error("The variant could not be resumed.");
      const outcome = (data as { outcome?: string } | null)?.outcome;
      if (outcome === "resumed" || outcome === "not_paused" || outcome === "forbidden") {
        return { outcome };
      }
      throw new Error("The variant could not be resumed.");
    },
  };
}

export type AllocationRepository = ReturnType<typeof createAllocationRepository>;
