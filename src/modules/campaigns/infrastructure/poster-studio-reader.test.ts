import { describe, expect, it, vi } from "vitest";

import { validManifest } from "@/domain/campaigns/test-manifest";
import type { CampaignReadPort } from "@/modules/campaigns/application/ports";
import {
  readPosterStudioView,
  readPosterTemplates,
  type PosterStudioPersistence,
} from "@/modules/campaigns/infrastructure/poster-studio-reader";

const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const CAMPAIGN_ID = validManifest().campaignId;
const VERSION_ID = "e0000000-0000-4000-8000-000000000001";

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    key: "core_feed_headline",
    version: 1,
    placement: "feed_image",
    canvas_width_px: 1080,
    canvas_height_px: 1080,
    owner_scope: "core",
    pack_slug: null,
    organization_id: null,
    state: "active",
    layout: {
      safeArea: { topPx: 64, rightPx: 64, bottomPx: 64, leftPx: 64 },
      logoSlot: null,
      plateCropFocus: "center",
      textBoxes: [
        {
          slot: "caption",
          xPx: 64,
          yPx: 64,
          widthPx: 952,
          heightPx: 320,
          maxLines: 3,
          minFontSizePx: 32,
          maxFontSizePx: 96,
          fontSizeStepPx: 4,
          lineHeightRatio: 1.2,
          alignment: "start",
          required: true,
        },
      ],
    },
    ...overrides,
  };
}

function renderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aa000000-0000-4000-8000-000000000001",
    template_key: "core_feed_headline",
    template_version: 1,
    script: "Latn",
    state: "rendered",
    render_digest: "a".repeat(64),
    text_values: { caption: "Lunch that pays for itself." },
    refusal_code: null,
    output_storage_path: "org/campaign/version/posters/a.png",
    output_width_px: 1080,
    output_height_px: 1080,
    rendered_at: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * A stand-in for the session client, recording the filters applied. The filters
 * are asserted rather than assumed: RLS is the boundary, but a query missing
 * `organization_id` would read another tenant's rows in any environment where
 * RLS was ever relaxed, and that is exactly the mistake worth catching here.
 */
function persistence(tables: {
  campaign_poster_templates?: unknown[];
  campaign_poster_renders?: unknown[];
  error?: string;
}) {
  const filters: { table: string; column: string; value: unknown }[] = [];

  const client: PosterStudioPersistence = {
    from(table) {
      const rows = (tables[table] ?? []) as Record<string, unknown>[];
      const result = tables.error
        ? { data: null, error: { message: tables.error } }
        : { data: rows, error: null };

      const chain = {
        eq(column: string, value: string | number) {
          filters.push({ table, column, value });
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        then(resolve: (value: typeof result) => unknown) {
          return Promise.resolve(result).then(resolve);
        },
      };
      return { select: () => chain } as unknown as ReturnType<PosterStudioPersistence["from"]>;
    },
  };

  return { client, filters };
}

function readPort(overrides: Partial<CampaignReadPort> = {}): CampaignReadPort {
  return {
    getVersion: async () => ({
      id: VERSION_ID,
      campaignId: CAMPAIGN_ID,
      digest: "f".repeat(64),
      manifest: validManifest(),
    }),
    ...overrides,
  } as unknown as CampaignReadPort;
}

describe("readPosterTemplates", () => {
  it("reads the catalogue into templates", async () => {
    const { client } = persistence({ campaign_poster_templates: [templateRow()] });

    const { templates, unreadable } = await readPosterTemplates(client);

    expect(templates).toHaveLength(1);
    expect(templates[0].key).toBe("core_feed_headline");
    expect(unreadable).toEqual([]);
  });

  /**
   * A row this code cannot parse means the database and the application
   * disagree about what a template is. Dropping it quietly turns a defect into
   * "the template vanished", which nobody can act on.
   */
  it("reports a catalogue row it cannot read instead of losing it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = persistence({
      campaign_poster_templates: [templateRow({ canvas_width_px: -5, key: "broken_feed" })],
    });

    const { templates, unreadable } = await readPosterTemplates(client);

    expect(templates).toEqual([]);
    expect(unreadable).toEqual([{ key: "broken_feed", version: 1 }]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("fails loudly when the catalogue cannot be read at all", async () => {
    const { client } = persistence({ error: "connection lost" });

    await expect(readPosterTemplates(client)).rejects.toThrow(/could not be read/);
  });
});

describe("readPosterStudioView", () => {
  it("composes the catalogue, the version and its renders", async () => {
    const { client } = persistence({
      campaign_poster_templates: [templateRow()],
      campaign_poster_renders: [renderRow()],
    });

    const view = await readPosterStudioView(
      readPort(),
      client,
      ORGANIZATION_ID,
      CAMPAIGN_ID,
      VERSION_ID,
    );

    expect(view).not.toBeNull();
    expect(view?.offers.length).toBeGreaterThan(0);
    expect(view?.renders).toHaveLength(1);
    expect(view?.renders[0].outputStoragePath).toBe("org/campaign/version/posters/a.png");
  });

  it("scopes the render history to the organization and the version", async () => {
    const { client, filters } = persistence({ campaign_poster_renders: [renderRow()] });

    await readPosterStudioView(readPort(), client, ORGANIZATION_ID, CAMPAIGN_ID, VERSION_ID);

    const renderFilters = filters.filter((filter) => filter.table === "campaign_poster_renders");
    expect(renderFilters).toEqual([
      { table: "campaign_poster_renders", column: "organization_id", value: ORGANIZATION_ID },
      { table: "campaign_poster_renders", column: "bundle_version_id", value: VERSION_ID },
    ]);
  });

  /** Telling the two apart would confirm another tenant's version exists. */
  it("returns null for a missing version and for another campaign's version alike", async () => {
    const { client } = persistence({});

    const missing = await readPosterStudioView(
      readPort({ getVersion: async () => null }),
      client,
      ORGANIZATION_ID,
      CAMPAIGN_ID,
      VERSION_ID,
    );
    expect(missing).toBeNull();

    const foreign = await readPosterStudioView(
      readPort({
        getVersion: async () =>
          ({
            id: VERSION_ID,
            campaignId: "c0000000-0000-4000-8000-0000000000ff",
            digest: "f".repeat(64),
            manifest: validManifest(),
          }) as never,
      }),
      client,
      ORGANIZATION_ID,
      CAMPAIGN_ID,
      VERSION_ID,
    );
    expect(foreign).toBeNull();
  });
});
