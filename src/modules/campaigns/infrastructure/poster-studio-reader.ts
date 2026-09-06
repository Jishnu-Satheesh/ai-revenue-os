import { z } from "zod";

import { logger } from "@/lib/logger";
import { posterTemplateSchema, type PosterTemplate } from "@/domain/campaigns/poster-template";
import type { CampaignReadPort } from "@/modules/campaigns/application/ports";
import {
  toPosterStudioView,
  type PosterStudioRender,
  type PosterStudioView,
} from "@/modules/campaigns/application/poster-studio-view";

/**
 * The Studio's reads, under the caller's own session.
 *
 * Every query here runs on the session client, so RLS decides what comes back:
 * a template owned by another organization is not filtered out by this code, it
 * is never returned. There is no service-role client in this path, and adding
 * one would move the tenant boundary from the database into a `.eq()` call that
 * somebody eventually forgets.
 */

type Row = Record<string, unknown>;

type Filterable = {
  eq(column: string, value: string | number): Filterable & PromiseLike<Result>;
  order(column: string, options: { ascending: boolean }): Filterable & PromiseLike<Result>;
  limit(count: number): Filterable & PromiseLike<Result>;
};

type Result = { data: Row[] | null; error: { message?: string } | null };

export type PosterStudioPersistence = {
  from(table: "campaign_poster_templates" | "campaign_poster_renders"): {
    select(columns: string): Filterable & PromiseLike<Result>;
  };
};

const TEMPLATE_COLUMNS =
  "key, version, placement, canvas_width_px, canvas_height_px, layout, owner_scope, pack_slug, organization_id, state";

const RENDER_COLUMNS =
  "id, template_key, template_version, script, state, render_digest, text_values, refusal_code, output_storage_path, output_width_px, output_height_px, rendered_at";

/**
 * Bounded because this is a screen, not an export. A version with hundreds of
 * renders is a real possibility once an operator tries every script against
 * every template, and returning all of them would make the page slower the more
 * somebody used it.
 */
const RENDER_LIMIT = 200;

const renderRowSchema = z.object({
  id: z.string().uuid(),
  template_key: z.string(),
  template_version: z.number().int().positive(),
  script: z.enum(["Latn", "Mlym", "Arab"]),
  state: z.enum(["rendered", "refused"]),
  render_digest: z.string(),
  text_values: z.record(z.string(), z.string()),
  refusal_code: z.string().nullable(),
  output_storage_path: z.string().nullable(),
  output_width_px: z.number().int().nullable(),
  output_height_px: z.number().int().nullable(),
  rendered_at: z.string(),
});

function toTemplate(row: Row): PosterTemplate | null {
  const parsed = posterTemplateSchema.safeParse({
    key: row.key,
    version: row.version,
    placement: row.placement,
    canvasWidthPx: row.canvas_width_px,
    canvasHeightPx: row.canvas_height_px,
    layout: row.layout,
    ownerScope: row.owner_scope,
    packSlug: row.pack_slug ?? null,
    organizationId: row.organization_id ?? null,
    state: row.state,
  });
  return parsed.success ? parsed.data : null;
}

function toRender(row: Row): PosterStudioRender | null {
  const parsed = renderRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const value = parsed.data;
  return {
    id: value.id,
    templateKey: value.template_key,
    templateVersion: value.template_version,
    script: value.script,
    state: value.state,
    renderDigest: value.render_digest,
    textValues: value.text_values,
    refusalCode: value.refusal_code,
    outputStoragePath: value.output_storage_path,
    outputWidthPx: value.output_width_px,
    outputHeightPx: value.output_height_px,
    renderedAt: value.rendered_at,
  };
}

/**
 * The template catalogue this member may choose from.
 *
 * Retired templates are read as well as active ones. The view drops them from
 * the offers, but a render already recorded against a retired template still
 * has to be describable, and a catalogue that hid it would leave that render
 * pointing at a template the screen says does not exist.
 */
export async function readPosterTemplates(
  persistence: PosterStudioPersistence,
): Promise<{
  templates: readonly PosterTemplate[];
  unreadable: { key: string; version: number }[];
}> {
  const { data, error } = await persistence
    .from("campaign_poster_templates")
    .select(TEMPLATE_COLUMNS)
    .order("key", { ascending: true });

  if (error) throw new Error("The poster template catalogue could not be read.");

  const templates: PosterTemplate[] = [];
  const unreadable: { key: string; version: number }[] = [];

  for (const row of data ?? []) {
    const template = toTemplate(row);
    if (template === null) {
      // Not dropped in silence. A catalogue row this code cannot parse means
      // the database and the application disagree about what a template is,
      // and that is a defect to see rather than a template to lose.
      const key = typeof row.key === "string" ? row.key : "unknown";
      const version = typeof row.version === "number" ? row.version : 0;
      unreadable.push({ key, version });
      logger.error("campaign.poster_template_unreadable", { templateKey: key });
      continue;
    }
    templates.push(template);
  }

  return { templates, unreadable };
}

export async function readPosterStudioView(
  read: CampaignReadPort,
  persistence: PosterStudioPersistence,
  organizationId: string,
  campaignId: string,
  bundleVersionId: string,
): Promise<PosterStudioView | null> {
  const version = await read.getVersion(organizationId, bundleVersionId);
  // Both "no such version" and "another tenant's version" return null. Telling
  // them apart would confirm that another tenant's version exists.
  if (!version || version.campaignId !== campaignId) return null;

  const [{ templates, unreadable }, renders] = await Promise.all([
    readPosterTemplates(persistence),
    readRenders(persistence, organizationId, bundleVersionId),
  ]);

  return toPosterStudioView({
    manifest: version.manifest,
    bundleVersionId,
    digest: version.digest,
    templates,
    renders,
    unreadableTemplates: unreadable,
  });
}

async function readRenders(
  persistence: PosterStudioPersistence,
  organizationId: string,
  bundleVersionId: string,
): Promise<readonly PosterStudioRender[]> {
  const { data, error } = await persistence
    .from("campaign_poster_renders")
    .select(RENDER_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("bundle_version_id", bundleVersionId)
    .order("rendered_at", { ascending: false })
    .limit(RENDER_LIMIT);

  if (error) throw new Error("The poster render history could not be read.");

  const renders: PosterStudioRender[] = [];
  for (const row of data ?? []) {
    const render = toRender(row);
    if (render === null) {
      logger.error("campaign.poster_render_row_unreadable", { organizationId });
      continue;
    }
    renders.push(render);
  }
  return renders;
}
