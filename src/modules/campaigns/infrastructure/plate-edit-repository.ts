import { z } from "zod";

import type { PlateEditStore } from "@/workflows/campaigns/edit-plate";

/**
 * Storage for what a plate edit produced.
 *
 * One security-definer RPC and nothing else, on the same terms as the render
 * store: the function checks the caller is the worker, checks the mask path
 * carries the tenant's own prefix, and owns the idempotency decision.
 *
 * The idempotency here is the caller's key rather than a content digest,
 * because an edit is not deterministic -- the same instruction asked twice
 * produces two different images. A replay that names a different parent, child
 * or mask is a conflict the function raises rather than a row it overwrites.
 */

type RpcResult = { data: unknown; error: { message?: string } | null };

export type PlateEditPersistence = {
  rpc(name: "record_campaign_plate_edit", args: Record<string, unknown>): Promise<RpcResult>;
};

const recordedSchema = z.object({
  edit_id: z.string().uuid(),
  child_plate_asset_id: z.string().uuid(),
  replayed: z.boolean(),
});

export function createPlateEditStore(persistence: PlateEditPersistence): PlateEditStore {
  return {
    async record(input) {
      const { data, error } = await persistence.rpc("record_campaign_plate_edit", {
        target_organization_id: input.organizationId,
        input_edit: {
          // Repeated inside the payload because the RPC compares the two before
          // anything else; a mismatch is how a cross-tenant write is caught.
          organization_id: input.organizationId,
          campaign_id: input.campaignId,
          parent_plate_asset_id: input.parentPlateAssetId,
          child_plate_asset_id: input.childPlateAssetId,
          mask_storage_path: input.maskStoragePath,
          mask_content_hash: input.maskContentHash,
          union_coverage_ratio: input.unionCoverageRatio,
          annotations: input.annotations,
          negative_rules: input.negativeRules,
          model_id: input.modelId,
          // Read with `->>` and passed through `nullif(..., '')`, so an explicit
          // null becomes an SQL NULL correctly here. The render store's
          // `refusal_detail` is read with `->` and does not have that property,
          // which is why the two are written differently.
          cost_minor: input.costMinor,
          idempotency_key: input.idempotencyKey,
          edited_by: input.editedBy,
        },
      });

      // The provider message is not surfaced: it can echo identifiers.
      if (error) throw new Error("The plate edit could not be recorded.");

      const parsed = recordedSchema.safeParse(data);
      if (!parsed.success) throw new Error("The plate edit store returned an unreadable result.");

      return {
        editId: parsed.data.edit_id,
        childPlateAssetId: parsed.data.child_plate_asset_id,
        replayed: parsed.data.replayed,
      };
    },
  };
}
