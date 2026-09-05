import { z } from "zod";

import type { PosterRenderRecord, PosterRenderStore } from "@/workflows/campaigns/render-poster";

/**
 * Storage for what a poster render produced.
 *
 * One security-definer RPC and nothing else. It checks the caller is the
 * worker, checks the plate belongs to the same tenant *and* the same bundle
 * version, and owns the idempotency decision -- the table is content-addressed
 * on the render digest, so an identical re-render replays rather than
 * duplicating, and inputs that produced different bytes than last time are a
 * refusal rather than a row quietly overwritten.
 *
 * Nothing here retries. The digest is deterministic, so a lost render is
 * re-askable; a render the table describes wrongly is not repairable, because
 * the table is append-only by trigger.
 */

type RpcResult = { data: unknown; error: { message?: string } | null };

export type PosterRenderPersistence = {
  rpc(name: "record_campaign_poster_render", args: Record<string, unknown>): Promise<RpcResult>;
};

const recordedSchema = z.object({
  render_id: z.string().uuid(),
  state: z.enum(["rendered", "refused"]),
  replayed: z.boolean(),
});

export function createPosterRenderStore(persistence: PosterRenderPersistence): PosterRenderStore {
  return {
    async record(input: PosterRenderRecord) {
      const { data, error } = await persistence.rpc("record_campaign_poster_render", {
        target_organization_id: input.organizationId,
        input_render: {
          // Repeated inside the payload because the RPC compares the two before
          // it does anything else; a mismatch is how a cross-tenant write is
          // caught rather than assumed impossible.
          organization_id: input.organizationId,
          campaign_id: input.campaignId,
          bundle_version_id: input.bundleVersionId,
          plate_asset_id: input.plateAssetId,
          plate_generation_run_id: input.plateGenerationRunId,
          template_key: input.templateKey,
          template_version: input.templateVersion,
          script: input.script,
          text_values: input.textValues,
          font_manifest: input.fontManifest,
          render_digest: input.renderDigest,
          state: input.state,
          refusal_code: input.refusalCode,
          // Absent, not null, and the distinction is load-bearing. The RPC reads
          // this one with `->` rather than `->>`, so an explicit null arrives as
          // JSONB `null` -- a real value whose `jsonb_typeof` is 'null'. The
          // column takes an SQL NULL or an object and refuses that, which
          // rejected every successful render at the last step.
          ...(input.refusalDetail === null ? {} : { refusal_detail: input.refusalDetail }),
          output_storage_path: input.outputStoragePath,
          output_content_hash: input.outputContentHash,
          output_mime_type: input.outputMimeType,
          output_width_px: input.outputWidthPx,
          output_height_px: input.outputHeightPx,
        },
      });

      // The provider message is not surfaced: it can echo identifiers.
      if (error) throw new Error("The poster render could not be recorded.");

      const parsed = recordedSchema.safeParse(data);
      if (!parsed.success)
        throw new Error("The poster render store returned an unreadable result.");

      return {
        renderId: parsed.data.render_id,
        state: parsed.data.state,
        replayed: parsed.data.replayed,
      };
    },
  };
}
