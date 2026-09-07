import { describe, expect, it } from "vitest";

import { validManifest } from "@/domain/campaigns/test-manifest";
import { createPosterRenderContextLoader } from "@/modules/campaigns/infrastructure/poster-context-reader";
import type { VariantContextReader } from "@/workflows/campaigns/generate-variants";

const ORGANIZATION_ID = "3f1d5e2a-0000-4000-8000-000000000001";
const BUNDLE_VERSION_ID = "3f1d5e2a-0000-4000-8000-000000000003";
const PLATE_ASSET_ID = "3f1d5e2a-0000-4000-8000-000000000004";

const TEMPLATE_ROW = {
  key: "worker_probe",
  version: 1,
  placement: "feed_image",
  canvas_width_px: 600,
  canvas_height_px: 400,
  owner_scope: "core",
  pack_slug: null,
  organization_id: null,
  state: "active",
  layout: {
    safeArea: { topPx: 32, rightPx: 32, bottomPx: 32, leftPx: 32 },
    logoSlot: null,
    plateCropFocus: "center",
    textBoxes: [
      {
        slot: "caption",
        xPx: 40,
        yPx: 40,
        widthPx: 520,
        heightPx: 140,
        maxLines: 2,
        minFontSizePx: 20,
        maxFontSizePx: 48,
        fontSizeStepPx: 4,
        lineHeightRatio: 1.25,
        alignment: "start",
        required: true,
      },
    ],
  },
};

const PLATE_ROW = {
  id: PLATE_ASSET_ID,
  storage_path: "org/campaign/version/plate.png",
  content_hash: "b".repeat(64),
  bundle_version_id: BUNDLE_VERSION_ID,
};

function persistence(rows: { templates?: unknown[]; assets?: unknown[] }) {
  const terminal = (data: unknown[] | null) => {
    const result = Promise.resolve({ data, error: null });
    return Object.assign(result, {
      eq: () => Object.assign(Promise.resolve({ data, error: null }), { eq: () => result }),
    });
  };

  return {
    from(table: "campaign_poster_templates" | "campaign_assets") {
      const data = table === "campaign_poster_templates" ? rows.templates : rows.assets;
      return { select: () => ({ eq: () => terminal(data ?? []) }) };
    },
  } as never;
}

const variants: VariantContextReader = {
  read: async () => ({
    manifest: validManifest(),
    digest: "d".repeat(64),
    approval: null,
    evidence: {
      offer: null,
      factKeys: [],
      factText: "al noor kitchen serves kerala food in deira",
      restrictedTerms: ["authentic"],
    },
    limits: { maxHashtags: null, maxCopyCharacters: null },
  }),
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    campaignId: "3f1d5e2a-0000-4000-8000-000000000002",
    bundleVersionId: BUNDLE_VERSION_ID,
    plateAssetId: PLATE_ASSET_ID,
    templateKey: "worker_probe",
    templateVersion: 1,
    ...overrides,
  };
}

describe("createPosterRenderContextLoader", () => {
  it("composes the template and plate over the version's own manifest and evidence", async () => {
    const loader = createPosterRenderContextLoader(
      persistence({ templates: [TEMPLATE_ROW], assets: [PLATE_ROW] }),
      variants,
    );

    const context = await loader.read(input());

    expect(context).not.toBeNull();
    expect(context?.template.key).toBe("worker_probe");
    expect(context?.plateStoragePath).toBe("org/campaign/version/plate.png");
    // The evidence a poster's free box answers to is the evidence a variant is
    // derived from, read once rather than assembled twice.
    expect(context?.evidence.restrictedTerms).toEqual(["authentic"]);
  });

  /**
   * The poster nobody approved: an approved version's words composed over a
   * different version's plate, from parts that were each approved once.
   */
  it("refuses a plate belonging to a different bundle version", async () => {
    const loader = createPosterRenderContextLoader(
      persistence({
        templates: [TEMPLATE_ROW],
        assets: [{ ...PLATE_ROW, bundle_version_id: "3f1d5e2a-0000-4000-8000-0000000000ff" }],
      }),
      variants,
    );

    expect(await loader.read(input())).toBeNull();
  });

  it("returns nothing when the template is unknown or retired", async () => {
    const loader = createPosterRenderContextLoader(
      persistence({ templates: [], assets: [PLATE_ROW] }),
      variants,
    );

    expect(await loader.read(input())).toBeNull();
  });

  it("returns nothing when the plate is missing", async () => {
    const loader = createPosterRenderContextLoader(
      persistence({ templates: [TEMPLATE_ROW], assets: [] }),
      variants,
    );

    expect(await loader.read(input())).toBeNull();
  });

  /** A layout the domain will not accept must not reach the compositor. */
  it("returns nothing when the stored layout is not a valid template", async () => {
    const loader = createPosterRenderContextLoader(
      persistence({
        templates: [{ ...TEMPLATE_ROW, layout: { safeArea: {}, textBoxes: [] } }],
        assets: [PLATE_ROW],
      }),
      variants,
    );

    expect(await loader.read(input())).toBeNull();
  });

  it("records no generation run, because nothing stores which run made the plate", async () => {
    const loader = createPosterRenderContextLoader(
      persistence({ templates: [TEMPLATE_ROW], assets: [PLATE_ROW] }),
      variants,
    );

    expect((await loader.read(input()))?.plateGenerationRunId).toBeNull();
  });
});
