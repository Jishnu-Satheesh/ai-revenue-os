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
  "id, template_key, template_version, script, state, render_digest, text_values, refusal_code, verification, output_storage_path, output_width_px, output_height_px, rendered_at";

/**
 * Bounded because this is a screen, not an export. A version with hundreds of
 * renders is a real possibility once an operator tries every script against
 * every template, and returning all of them would make the page slower the more
 * somebody used it.
 */
const RENDER_LIMIT = 200;

/**
 * Short, because a signed URL is a bearer token for one object. Long enough to
 * look at a poster and decide; not long enough to be worth pasting anywhere.
 */
const PREVIEW_TTL_SECONDS = 600;

const renderRowSchema = z.object({
  id: z.string().uuid(),
  template_key: z.string(),
  template_version: z.number().int().positive(),
  script: z.enum(["Latn", "Mlym", "Arab"]),
  state: z.enum(["rendered", "refused"]),
  render_digest: z.string(),
  text_values: z.record(z.string(), z.string()),
  refusal_code: z.string().nullable(),
  verification: z.record(z.string(), z.unknown()).default({}),
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
    verification: value.verification,
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
export async function readPosterTemplates(persistence: PosterStudioPersistence): Promise<{
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

export type PosterStudioPlate = {
  /** Stable across versions. What the manifest and the directions name. */
  readonly assetKey: string;
  /** This version's row. What a render or an edit request must name. */
  readonly assetId: string;
  readonly previewUrl: string | null;
  readonly widthPx: number;
  readonly heightPx: number;
};

export type PosterStudioAssetPersistence = {
  from(table: "campaign_assets"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { eq(column: string, value: string): Awaitable } & Awaitable;
    };
  };
};

type Awaitable = PromiseLike<{ data: Row[] | null; error: { message?: string } | null }>;

export type PosterStudioStorage = {
  storage: {
    from(bucket: "campaign-assets"): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<{ data: { path: string | null; signedUrl: string }[] | null; error: unknown }>;
    };
  };
};

const plateRowSchema = z.object({
  id: z.string().uuid(),
  asset_key: z.string().uuid(),
  storage_path: z.string().min(1),
  width_px: z.number().int().positive(),
  height_px: z.number().int().positive(),
});

/**
 * Signed URLs for a set of storage paths.
 *
 * A failure returns nothing signed rather than throwing, on the same reasoning
 * the campaign studio already uses: a page that refuses to render because a
 * thumbnail could not be signed is worse than one that says the artwork is
 * unavailable. The words, the refusals and the history are all still there.
 */
async function signed(
  storage: PosterStudioStorage,
  paths: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  if (paths.length === 0) return {};
  const { data, error } = await storage.storage
    .from("campaign-assets")
    .createSignedUrls([...paths], PREVIEW_TTL_SECONDS);
  if (error || !data) return {};

  const urls: Record<string, string> = {};
  for (const entry of data) {
    // A per-path failure comes back as a row with no path rather than an error,
    // so one unsignable object costs its own preview and no more.
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}

/**
 * The plates of one version, with the row id a render or edit must name.
 *
 * The two identifiers are deliberately different and both are returned: the
 * manifest names an asset by a key that survives every version, while a render
 * and an edit point at the per-version row. A surface that had only the key
 * would have to guess, and would guess the wrong version's plate the first time
 * a revision landed.
 */
export async function readPosterStudioPlates(
  persistence: PosterStudioAssetPersistence,
  storage: PosterStudioStorage,
  organizationId: string,
  bundleVersionId: string,
): Promise<readonly PosterStudioPlate[]> {
  const { data, error } = await persistence
    .from("campaign_assets")
    .select("id, asset_key, storage_path, width_px, height_px")
    .eq("organization_id", organizationId)
    .eq("bundle_version_id", bundleVersionId);
  if (error) return [];

  const rows = (data ?? [])
    .map((row) => plateRowSchema.safeParse(row))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));

  const urls = await signed(
    { storage: storage.storage },
    rows.map((row) => row.storage_path),
  );

  return rows.map((row) => ({
    assetKey: row.asset_key,
    assetId: row.id,
    previewUrl: urls[row.storage_path] ?? null,
    widthPx: row.width_px,
    heightPx: row.height_px,
  }));
}

/** Signed previews for the posters a version has already produced. */
export async function readRenderPreviews(
  storage: PosterStudioStorage,
  renders: readonly PosterStudioRender[],
): Promise<Readonly<Record<string, string>>> {
  const paths = renders
    .map((render) => render.outputStoragePath)
    .filter((path): path is string => path !== null);
  const urls = await signed(storage, paths);

  const byRenderId: Record<string, string> = {};
  for (const render of renders) {
    const url = render.outputStoragePath ? urls[render.outputStoragePath] : undefined;
    if (url) byRenderId[render.id] = url;
  }
  return byRenderId;
}
