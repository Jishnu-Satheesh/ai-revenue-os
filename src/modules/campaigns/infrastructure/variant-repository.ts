import { z } from "zod";

import {
  CAMPAIGN_VARIANT_STATES,
  type CampaignCreativeVariant,
  type CampaignVariantState,
} from "@/domain/campaigns/variants";

/**
 * Storage for creative variants.
 *
 * Appending goes through one security-definer RPC and nothing else. That RPC
 * locks the bundle version, rechecks the approval, rechecks the policy window,
 * and assigns the slot numbers itself — so the checks cannot be skipped by a
 * caller that forgot them, and two workers racing cannot both take slot four.
 *
 * The application's own `admitVariant` runs first and covers the same ground.
 * That is not redundancy for its own sake: the service can explain a refusal in
 * words an operator reads, and the database can guarantee it. Only one of those
 * two jobs can be done well by either layer.
 */

type RpcResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

export type CampaignVariantPersistence = {
  rpc(
    name: "append_campaign_creative_variant",
    args: Record<string, unknown>,
  ): Promise<RpcResult<unknown>>;
  from(table: "campaign_creative_variants"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(column: string, value: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
      } & PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

/**
 * Refusals the database raises, mapped to the same vocabulary the application
 * service uses. A worker that hits one of these has raced another worker or is
 * working from a stale read; either way the answer is the database's.
 */
const REFUSAL_BY_MESSAGE: Readonly<Record<string, VariantAppendRefusal>> = {
  campaign_variant_requires_live_approval: "no_live_approval",
  campaign_variant_approval_digest_mismatch: "approval_superseded",
  campaign_variant_policy_expired: "policy_expired",
  campaign_variant_direction_cap_reached: "direction_cap_reached",
  campaign_variant_total_cap_reached: "total_cap_reached",
};

export type VariantAppendRefusal =
  | "no_live_approval"
  | "approval_superseded"
  | "policy_expired"
  | "direction_cap_reached"
  | "total_cap_reached";

export type VariantAppendResult =
  | { outcome: "appended"; variantId: string }
  | { outcome: "refused"; reason: VariantAppendRefusal };

export type VariantProvenance = {
  modelId: string;
  promptVersionId: string;
  generationRunId: string;
};

const appendedIdSchema = z.string().uuid();

export type StoredVariant = {
  id: string;
  directionId: string;
  ordinal: number;
  state: CampaignVariantState;
  assetId: string;
  channel: string;
  placement: string;
  hook: string;
  caption: string;
  callToAction: string;
  hashtags: readonly string[];
};

const listedVariantSchema = z.object({
  id: z.string().uuid(),
  direction_key: z.string().uuid(),
  direction_ordinal: z.number().int().positive(),
  state: z.enum(CAMPAIGN_VARIANT_STATES),
  asset_id: z.string().uuid(),
  channel: z.string(),
  placement: z.string(),
  hook: z.string(),
  caption: z.string(),
  call_to_action: z.string(),
  hashtags: z.array(z.string()).default([]),
});

const storedVariantSchema = z.object({
  content_hash: z.string(),
  direction_key: z.string().uuid(),
});

export function createCampaignVariantStore(persistence: CampaignVariantPersistence) {
  return {
    /**
     * What is already stored for this version.
     *
     * Read before generating so the service can refuse with a reason rather
     * than letting the database refuse with a constraint. The counts are a
     * snapshot and may be stale by the time the append lands, which is exactly
     * why the RPC counts again under a lock.
     */
    async readCapacity(
      organizationId: string,
      bundleVersionId: string,
    ): Promise<{
      contentHashes: readonly string[];
      usedByDirection: Readonly<Record<string, number>>;
      usedInTotal: number;
    }> {
      const { data, error } = await persistence
        .from("campaign_creative_variants")
        .select("content_hash, direction_key")
        .eq("organization_id", organizationId)
        .eq("bundle_version_id", bundleVersionId);
      if (error) throw new Error("Stored variants could not be read.");

      const rows = (data ?? []).flatMap((row) => {
        const parsed = storedVariantSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });

      const usedByDirection: Record<string, number> = {};
      for (const row of rows) {
        usedByDirection[row.direction_key] = (usedByDirection[row.direction_key] ?? 0) + 1;
      }

      return {
        contentHashes: rows.map((row) => row.content_hash),
        usedByDirection,
        usedInTotal: rows.length,
      };
    },

    /**
     * The fleet, as the Studio renders it.
     *
     * Ordered by slot so the grid reads the same way twice, and joined to the
     * manifest by the caller rather than here — the direction's name lives in
     * the approved version, not in the variant row.
     */
    async listForVersion(
      organizationId: string,
      bundleVersionId: string,
    ): Promise<readonly StoredVariant[]> {
      const { data, error } = await persistence
        .from("campaign_creative_variants")
        .select(
          "id, direction_key, direction_ordinal, state, asset_id, channel, placement, hook, caption, call_to_action, hashtags",
        )
        .eq("organization_id", organizationId)
        .eq("bundle_version_id", bundleVersionId);
      if (error) throw new Error("Stored variants could not be read.");

      return (data ?? [])
        .flatMap((row) => {
          const parsed = listedVariantSchema.safeParse(row);
          return parsed.success ? [parsed.data] : [];
        })
        .sort((left, right) => left.direction_ordinal - right.direction_ordinal)
        .map((row) => ({
          id: row.id,
          directionId: row.direction_key,
          ordinal: row.direction_ordinal,
          state: row.state,
          assetId: row.asset_id,
          channel: row.channel,
          placement: row.placement,
          hook: row.hook,
          caption: row.caption,
          callToAction: row.call_to_action,
          hashtags: row.hashtags,
        }));
    },

    async append(input: {
      organizationId: string;
      bundleVersionId: string;
      variant: CampaignCreativeVariant;
      contentHash: string;
      provenance: VariantProvenance;
    }): Promise<VariantAppendResult> {
      const { data, error } = await persistence.rpc("append_campaign_creative_variant", {
        target_organization_id: input.organizationId,
        input_variant: {
          organization_id: input.organizationId,
          bundle_version_id: input.bundleVersionId,
          direction_key: input.variant.directionId,
          asset_id: input.variant.assetId,
          channel: input.variant.channel,
          placement: input.variant.placement,
          hook: input.variant.hook,
          caption: input.variant.caption,
          call_to_action: input.variant.callToAction,
          hashtags: input.variant.hashtags,
          content_hash: input.contentHash,
          provenance: input.provenance,
        },
      });

      if (error) {
        const refusal = REFUSAL_BY_MESSAGE[extractCode(error.message)];
        if (refusal) return { outcome: "refused", reason: refusal };
        // Anything unrecognised is a storage failure, not a business answer.
        // Reporting it as a refusal would tell an operator their campaign was
        // rejected when the truth is that nobody knows.
        throw new Error("The variant could not be stored.");
      }

      const parsed = appendedIdSchema.safeParse(data);
      if (!parsed.success) throw new Error("The variant could not be stored.");
      return { outcome: "appended", variantId: parsed.data };
    },
  };
}

export type CampaignVariantStore = ReturnType<typeof createCampaignVariantStore>;

/** Postgres wraps the raised name in prose; the name is the part we match on. */
function extractCode(message: string | undefined): string {
  if (!message) return "";
  const match = /campaign_variant_[a-z_]+/.exec(message);
  return match ? match[0] : "";
}
