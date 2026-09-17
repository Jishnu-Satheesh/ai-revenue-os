import { z } from "zod";

import type {
  PosterExistingRender,
  PosterRenderRecord,
  PosterRenderStore,
} from "@/workflows/campaigns/render-poster";

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

type MaybeSingleResult = { data: unknown; error: { message?: string } | null };

export type PosterRenderPersistence = {
  rpc(name: "record_campaign_poster_render", args: Record<string, unknown>): Promise<RpcResult>;
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          eq(
            column: string,
            value: string,
          ): {
            eq(
              column: string,
              value: string,
            ): {
              maybeSingle(): Promise<MaybeSingleResult>;
            };
          };
        };
      };
    };
  };
};

const recordedSchema = z.object({
  render_id: z.string().uuid(),
  state: z.enum(["rendered", "refused"]),
  replayed: z.boolean(),
});

const existingRenderSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(["rendered", "refused"]),
  refusal_code: z.string().nullable(),
  text_values: z.record(z.string(), z.string()),
  output_storage_path: z.string().nullable(),
  output_content_hash: z.string().nullable(),
  output_mime_type: z.string().nullable(),
  output_width_px: z.number().nullable(),
  output_height_px: z.number().nullable(),
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

    /**
     * The row a previous attempt already wrote for this exact digest, if any.
     *
     * The digest is over plate, template, words, script and fonts -- everything
     * that changes the pixels -- so a hit means the output already exists and
     * the worker can skip drawing it again. A miss is null, never an invented
     * row. A row the application can no longer read is an error rather than a
     * miss: reusing a render nobody understands is how the wrong picture ends
     * up under the right words.
     */
    async findByDigest(input: {
      organizationId: string;
      campaignId: string;
      bundleVersionId: string;
      renderDigest: string;
    }): Promise<PosterExistingRender | null> {
      const { data, error } = await persistence
        .from("campaign_poster_renders")
        .select(
          "id,state,refusal_code,text_values,output_storage_path,output_content_hash,output_mime_type,output_width_px,output_height_px",
        )
        .eq("organization_id", input.organizationId)
        .eq("campaign_id", input.campaignId)
        .eq("bundle_version_id", input.bundleVersionId)
        .eq("render_digest", input.renderDigest)
        .maybeSingle();

      // A read that failed is not an absent render. Treating it as one would
      // draw, store and record a second output for work already done.
      if (error) throw new Error("The poster render could not be read.");
      if (data === null) return null;

      const parsed = existingRenderSchema.safeParse(data);
      if (!parsed.success) throw new Error("The poster render store returned an unreadable row.");

      return {
        renderId: parsed.data.id,
        state: parsed.data.state,
        refusalCode: parsed.data.refusal_code,
        textValues: parsed.data.text_values,
        outputStoragePath: parsed.data.output_storage_path,
        outputContentHash: parsed.data.output_content_hash,
        outputMimeType: parsed.data.output_mime_type,
        outputWidthPx: parsed.data.output_width_px,
        outputHeightPx: parsed.data.output_height_px,
      };
    },
  };
}
