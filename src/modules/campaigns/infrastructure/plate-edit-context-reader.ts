import { z } from "zod";

import { approvalStatus } from "@/domain/campaigns/state-machine";
import { negativeRuleSchema } from "@/domain/campaigns/reference-resolution";
import type { VariantContextReader } from "@/workflows/campaigns/generate-variants";
import type { PlateEditContext, PlateEditContextReader } from "@/workflows/campaigns/edit-plate";

/**
 * Everything an edit needs that is not in the payload.
 *
 * Composed over the variant context loader for the same reason the render
 * reader is: the manifest an edit belongs to and the approval it may invalidate
 * are the same rows a variant is derived from, and two readers of those rows
 * would eventually disagree about one of them.
 *
 * Returning `null` rather than throwing is deliberate. A plate that has moved,
 * or a version that no longer exists, is a run with nothing left to do -- not
 * an error worth spending a retry budget on.
 */

type Row = Record<string, unknown>;

type Awaitable = PromiseLike<{ data: Row[] | null; error: unknown }>;

export type PlateEditContextPersistence = {
  from(table: "campaign_assets" | "campaign_source_snapshots"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { eq(column: string, value: string): Awaitable } & Awaitable;
    };
  };
};

const plateSchema = z.object({
  id: z.string().uuid(),
  storage_path: z.string().min(1),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  mime_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  width_px: z.number().int().positive(),
  height_px: z.number().int().positive(),
  bundle_version_id: z.string().uuid(),
});

export function createPlateEditContextLoader(
  persistence: PlateEditContextPersistence,
  variants: VariantContextReader,
  now: () => Date = () => new Date(),
): PlateEditContextReader {
  return {
    async read(input): Promise<PlateEditContext | null> {
      const { data: assets, error: assetError } = await persistence
        .from("campaign_assets")
        .select("id, storage_path, content_hash, mime_type, width_px, height_px, bundle_version_id")
        .eq("organization_id", input.organizationId)
        .eq("id", input.parentPlateAssetId);
      if (assetError) return null;

      const plate = plateSchema.safeParse((assets ?? [])[0]);
      if (!plate.success) return null;

      // Editing one version's plate under another version's identity would
      // produce a successor whose parent is not the version it claims. The RPC
      // refuses the write too; this refuses before a model is paid.
      if (plate.data.bundle_version_id !== input.bundleVersionId) return null;

      const context = await variants.read({
        organizationId: input.organizationId,
        bundleVersionId: input.bundleVersionId,
      });

      const { data: snapshots } = await persistence
        .from("campaign_source_snapshots")
        .select("negative_rules")
        .eq("organization_id", input.organizationId)
        .eq("campaign_id", input.campaignId);

      // Descriptions, not codes. The prompt is read by a model, and `no_minors`
      // tells it nothing that "do not show children" tells it.
      const negativeRules = z
        .array(negativeRuleSchema)
        .safeParse((snapshots ?? [])[0]?.negative_rules ?? []);

      return {
        manifest: context.manifest,
        parentStoragePath: plate.data.storage_path,
        parentContentHash: plate.data.content_hash,
        parentWidthPx: plate.data.width_px,
        parentHeightPx: plate.data.height_px,
        parentMimeType: plate.data.mime_type,
        /**
         * Whether an approval is live against this version *right now*. The
         * worker reports it so the operator is told the edit invalidated an
         * approval, rather than discovering it when a dispatch refuses later.
         */
        parentVersionApproved: approvalStatus(
          context.approval,
          { bundleVersionId: input.bundleVersionId, bundleDigest: context.digest },
          now(),
        ).isApproved,
        negativeRules: negativeRules.success
          ? negativeRules.data.map((rule) => rule.description)
          : [],
      };
    },
  };
}
