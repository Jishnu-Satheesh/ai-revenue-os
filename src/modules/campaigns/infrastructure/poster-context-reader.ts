import { z } from "zod";

import { posterTemplateSchema } from "@/domain/campaigns/poster-template";
import type { VariantContextReader } from "@/workflows/campaigns/generate-variants";
import type {
  PosterRenderContext,
  PosterRenderContextReader,
} from "@/workflows/campaigns/render-poster";

/**
 * Everything a render needs that is not in the payload.
 *
 * Composed over the variant context loader rather than re-reading the version:
 * the manifest a poster quotes and the evidence its free box answers to are the
 * same manifest and the same evidence a variant is derived from, and two
 * readers of the same rows would eventually disagree about one of them.
 *
 * Returning `null` rather than throwing is deliberate. A campaign whose plate,
 * template or version has moved is not an error to retry -- it is a run with
 * nothing left to do, and the worker records nothing for it.
 */

type Row = Record<string, unknown>;

export type PosterContextPersistence = {
  from(table: "campaign_poster_templates" | "campaign_assets"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string | number,
        ): {
          eq(
            column: string,
            value: string | number,
          ): PromiseLike<{ data: Row[] | null; error: unknown }>;
        } & PromiseLike<{ data: Row[] | null; error: unknown }>;
      };
    };
  };
};

const plateSchema = z.object({
  id: z.string().uuid(),
  storage_path: z.string().min(1),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  bundle_version_id: z.string().uuid(),
});

export function createPosterRenderContextLoader(
  persistence: PosterContextPersistence,
  variants: VariantContextReader,
): PosterRenderContextReader {
  return {
    async read(input): Promise<PosterRenderContext | null> {
      const { data: templates, error: templateError } = await persistence
        .from("campaign_poster_templates")
        .select(
          "key, version, placement, canvas_width_px, canvas_height_px, layout, owner_scope, pack_slug, organization_id, state",
        )
        .eq("key", input.templateKey)
        .eq("version", input.templateVersion)
        .eq("state", "active");
      if (templateError) return null;

      const [templateRow] = templates ?? [];
      if (!templateRow) return null;

      const template = posterTemplateSchema.safeParse({
        key: templateRow.key,
        version: templateRow.version,
        placement: templateRow.placement,
        canvasWidthPx: templateRow.canvas_width_px,
        canvasHeightPx: templateRow.canvas_height_px,
        layout: templateRow.layout,
        ownerScope: templateRow.owner_scope,
        packSlug: templateRow.pack_slug ?? null,
        organizationId: templateRow.organization_id ?? null,
        state: templateRow.state,
      });
      if (!template.success) return null;

      const { data: assets, error: assetError } = await persistence
        .from("campaign_assets")
        .select("id, storage_path, content_hash, bundle_version_id")
        .eq("organization_id", input.organizationId)
        .eq("id", input.plateAssetId);
      if (assetError) return null;

      const plate = plateSchema.safeParse((assets ?? [])[0]);
      if (!plate.success) return null;

      // Defence in depth. The RPC refuses this too, but composing an approved
      // version's poster over another version's plate would produce a poster
      // nobody approved from parts that were each approved once, and it should
      // not reach a render before it is caught.
      if (plate.data.bundle_version_id !== input.bundleVersionId) return null;

      const context = await variants.read({
        organizationId: input.organizationId,
        bundleVersionId: input.bundleVersionId,
      });

      return {
        manifest: context.manifest,
        template: template.data,
        plateStoragePath: plate.data.storage_path,
        plateContentHash: plate.data.content_hash,
        // Null, and honestly so. `campaign_assets` records no generation run
        // and its `provenance` carries a model and a prompt version but not a
        // run id, so there is nothing here to read. The render table documents
        // this column as null for a plate with no run behind it; recording a
        // guessed run would be worse than recording none.
        plateGenerationRunId: null,
        // Nothing supplies one today, so a template requiring it is simply
        // unavailable rather than rendered with an invented line. Spec 020
        // section 18.2 carries this as an open item.
        legalLine: null,
        evidence: context.evidence,
      };
    },
  };
}

/**
 * The plate bytes, from the campaign bucket.
 *
 * Separate from spec 019's reference reader, which reads `brand-assets`. A
 * plate is a generated campaign asset and lives in `campaign-assets`; reusing
 * the other reader would look right and quietly find nothing.
 */
export function createSupabaseCampaignObjectReader(client: {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: unknown }>;
    };
  };
}) {
  return {
    async read(storagePath: string): Promise<Uint8Array | null> {
      const { data, error } = await client.storage.from("campaign-assets").download(storagePath);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
