import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { posterTemplateSchema } from "@/domain/campaigns/poster-template";
import { resolvePosterSlots, templateAvailability } from "@/domain/campaigns/poster-slots";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";

/**
 * The seeded templates, read from the migration itself.
 *
 * Deliberately not from a TypeScript copy of the same layouts. The migration is
 * what reaches the database, and a second declaration would let the checked-in
 * copy pass while the rows in staging were wrong -- which is the failure this
 * file exists to prevent. There is no local database to rehearse a migration
 * against, so a layout the domain would reject must be caught here or it is
 * caught in production.
 */

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260905170000_seed_core_poster_templates.sql",
);

const ROW =
  /\(\s*'([a-z0-9_]+)',\s*(\d+),\s*'(\w+)',\s*(\d+),\s*(\d+),\s*'core',\s*null,\s*null,\s*'active',\s*'(\{.*?\})'::jsonb\s*\)/g;

function seededTemplates() {
  const sql = readFileSync(MIGRATION, "utf8");
  const templates = [];

  for (const match of sql.matchAll(ROW)) {
    templates.push({
      key: match[1],
      version: Number(match[2]),
      placement: match[3],
      canvasWidthPx: Number(match[4]),
      canvasHeightPx: Number(match[5]),
      ownerScope: "core",
      packSlug: null,
      organizationId: null,
      state: "active",
      layout: JSON.parse(match[6]),
    });
  }

  return templates;
}

describe("the seeded core poster templates", () => {
  it("seeds two templates for each placement the platform supports", () => {
    const templates = seededTemplates();

    expect(templates).toHaveLength(4);
    expect(templates.filter((t) => t.placement === "feed_image")).toHaveLength(2);
    expect(templates.filter((t) => t.placement === "image_story")).toHaveLength(2);
  });

  it("every seeded layout is one the domain accepts", () => {
    for (const template of seededTemplates()) {
      const parsed = posterTemplateSchema.safeParse(template);
      // Named, so a failure says which template and which rule rather than
      // printing an anonymous Zod tree.
      expect(parsed.success, `${template.key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  /**
   * The rule that would otherwise be discovered by an operator: `body` has no
   * governed source, so a template requiring it can never be offered. Seeding
   * one would put a permanently unavailable choice in the picker.
   */
  it("requires only slots an approved manifest can actually fill", () => {
    const { slots } = resolvePosterSlots({
      manifest: validManifest(),
      directionId: manifestIds.control,
      channel: "instagram",
      placement: "feed_image",
      extra: null,
      legalLine: null,
    });

    for (const template of seededTemplates()) {
      const parsed = posterTemplateSchema.parse(template);
      expect(
        templateAvailability(parsed, slots),
        `${template.key} is seeded but can never be offered`,
      ).toEqual({ available: true });
    }
  });

  it("uses the real canvas sizes for the placements they claim", () => {
    for (const template of seededTemplates()) {
      if (template.placement === "feed_image") {
        expect([template.canvasWidthPx, template.canvasHeightPx]).toEqual([1080, 1080]);
      } else {
        expect([template.canvasWidthPx, template.canvasHeightPx]).toEqual([1080, 1920]);
      }
    }
  });

  /**
   * Story chrome is not a matter of taste. Instagram draws its profile row and
   * reply bar over the top and bottom of the canvas, and text under either is
   * unreadable on a real phone.
   */
  it("keeps story text clear of the platform's own chrome", () => {
    for (const template of seededTemplates().filter((t) => t.placement === "image_story")) {
      expect(template.layout.safeArea.topPx).toBeGreaterThanOrEqual(250);
      expect(template.layout.safeArea.bottomPx).toBeGreaterThanOrEqual(250);
    }
  });

  /** Left and right would mis-align every Arabic poster while looking correct. */
  it("never declares a physical alignment", () => {
    for (const template of seededTemplates()) {
      for (const box of template.layout.textBoxes) {
        expect(["start", "center", "end"]).toContain(box.alignment);
      }
    }
  });

  it("re-runs without duplicating a template version", () => {
    const sql = readFileSync(MIGRATION, "utf8");

    expect(sql.match(/on conflict \(key, version\) do nothing/g)).toHaveLength(4);
  });
});
