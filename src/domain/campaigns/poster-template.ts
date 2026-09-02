import { z } from "zod";

/**
 * Declarative, versioned poster layouts.
 *
 * Templates are the contract that lets text be exact by construction. An
 * operator cannot place type freely, and some posters they can imagine will not
 * be expressible -- that is the price of a poster whose every word is a value
 * somebody approved, and ADR 0042 takes the trade deliberately.
 *
 * This schema is the domain half of the contract enforced by
 * `private.poster_template_layout_valid` in migration 20260826090000. The
 * database checks structure; this checks the geometry and the pairings that
 * SQL is a poor place to express. The two must agree on the slot vocabulary, and
 * a test asserts it.
 */

/**
 * The scripts a poster can actually be rendered in.
 *
 * Deliberately closed, and deliberately narrower than the asset library's
 * `scriptCodeSchema`, which accepts any ISO 15924 code. A typography reference
 * can teach the platform about any script; a *render* needs a vendored font
 * with the glyphs in it. A plan naming a script we have no font for is a plan
 * that cannot render, and the manifest boundary is a much better place to learn
 * that than the worker.
 *
 * A test holds this list to the fonts actually vendored, so adding a fourth
 * font without widening this is caught rather than silently unusable.
 */
export const RENDERABLE_SCRIPTS = ["Latn", "Mlym", "Arab"] as const;
export const renderableScriptSchema = z.enum(RENDERABLE_SCRIPTS);
export type RenderableScript = z.infer<typeof renderableScriptSchema>;

export const POSTER_TEXT_SLOTS = ["caption", "body", "footer", "extra"] as const;
export const posterTextSlotSchema = z.enum(POSTER_TEXT_SLOTS);
export type PosterTextSlot = z.infer<typeof posterTextSlotSchema>;

/**
 * Start and end, never left and right.
 *
 * In Arabic, start is the right-hand edge. A template that declared `left`
 * would mis-align every Arabic poster while looking entirely intentional, which
 * is precisely the class of error a non-reader cannot see.
 */
export const POSTER_TEXT_ALIGNMENTS = ["start", "center", "end"] as const;
export const posterTextAlignmentSchema = z.enum(POSTER_TEXT_ALIGNMENTS);
export type PosterTextAlignment = z.infer<typeof posterTextAlignmentSchema>;

export const POSTER_PLATE_CROP_FOCUSES = ["center", "top", "bottom", "left", "right"] as const;
export const posterPlateCropFocusSchema = z.enum(POSTER_PLATE_CROP_FOCUSES);

const pixelSchema = z.number().int().nonnegative().max(4_096);
const positivePixelSchema = z.number().int().positive().max(4_096);

export const posterTextBoxSchema = z
  .strictObject({
    slot: posterTextSlotSchema,
    xPx: pixelSchema,
    yPx: pixelSchema,
    widthPx: positivePixelSchema,
    heightPx: positivePixelSchema,
    /** Hard cap. Text needing more lines is shrunk, then refused -- never clipped. */
    maxLines: z.number().int().positive().max(12),
    minFontSizePx: z.number().int().min(8).max(400),
    maxFontSizePx: z.number().int().min(8).max(400),
    /**
     * How far shrink-to-fit steps down each attempt. A zero step would never
     * terminate; a step wider than the range would skip every size the template
     * declared acceptable and refuse text that fits.
     */
    fontSizeStepPx: z.number().int().positive().max(64),
    lineHeightRatio: z.number().min(0.8).max(3),
    alignment: posterTextAlignmentSchema,
    required: z.boolean(),
  })
  .superRefine((box, context) => {
    if (box.minFontSizePx > box.maxFontSizePx) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minFontSizePx"],
        message: "A minimum font size above its maximum leaves no size to try.",
      });
    }
  });

export type PosterTextBox = z.infer<typeof posterTextBoxSchema>;

export const posterSafeAreaSchema = z.strictObject({
  topPx: pixelSchema,
  rightPx: pixelSchema,
  bottomPx: pixelSchema,
  leftPx: pixelSchema,
});

export const posterLogoSlotSchema = z.strictObject({
  xPx: pixelSchema,
  yPx: pixelSchema,
  widthPx: positivePixelSchema,
  heightPx: positivePixelSchema,
});

export const posterLayoutSchema = z.strictObject({
  safeArea: posterSafeAreaSchema,
  logoSlot: posterLogoSlotSchema.nullable(),
  plateCropFocus: posterPlateCropFocusSchema,
  textBoxes: z.array(posterTextBoxSchema).min(1).max(12),
});

export type PosterLayout = z.infer<typeof posterLayoutSchema>;

export const POSTER_TEMPLATE_OWNER_SCOPES = ["core", "pack", "organization"] as const;
export const POSTER_TEMPLATE_STATES = ["active", "retired"] as const;

const posterTemplateShapeSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "A template key is lower snake case."),
  version: z.number().int().positive(),
  placement: z.enum(["feed_image", "image_story"]),
  canvasWidthPx: positivePixelSchema.min(240),
  canvasHeightPx: positivePixelSchema.min(240),
  ownerScope: z.enum(POSTER_TEMPLATE_OWNER_SCOPES),
  packSlug: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(80)
    .nullable(),
  organizationId: z.string().uuid().nullable(),
  state: z.enum(POSTER_TEMPLATE_STATES),
  layout: posterLayoutSchema,
});

/**
 * A template version is immutable. A changed template is a new version, and
 * posters already rendered keep the version that produced them -- which is what
 * lets a retired template still serve an approved plan.
 */
export const posterTemplateSchema = posterTemplateShapeSchema.superRefine((template, context) => {
  const { canvasWidthPx, canvasHeightPx, layout } = template;
  const { safeArea } = layout;

  if (
    safeArea.leftPx + safeArea.rightPx >= canvasWidthPx ||
    safeArea.topPx + safeArea.bottomPx >= canvasHeightPx
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["layout", "safeArea"],
      message: "The safe area leaves no room inside the canvas it sits in.",
    });
    return;
  }

  const seenSlots = new Set<PosterTextSlot>();
  for (const [index, box] of layout.textBoxes.entries()) {
    if (seenSlots.has(box.slot)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layout", "textBoxes", index, "slot"],
        message: `Two boxes bound to the ${box.slot} slot would draw one approved value twice.`,
      });
    }
    seenSlots.add(box.slot);

    const right = box.xPx + box.widthPx;
    const bottom = box.yPx + box.heightPx;

    if (right > canvasWidthPx || bottom > canvasHeightPx) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layout", "textBoxes", index],
        message: `The ${box.slot} box leaves the canvas, so part of it draws nowhere.`,
      });
      continue;
    }

    if (
      box.xPx < safeArea.leftPx ||
      box.yPx < safeArea.topPx ||
      right > canvasWidthPx - safeArea.rightPx ||
      bottom > canvasHeightPx - safeArea.bottomPx
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layout", "textBoxes", index],
        message: `The ${box.slot} box leaves the safe area, where a platform may crop it.`,
      });
    }
  }

  if (template.ownerScope === "pack" && template.packSlug === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["packSlug"],
      message: "A pack template must name its pack.",
    });
  }

  if (template.ownerScope !== "pack" && template.packSlug !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["packSlug"],
      message: "Only a pack template carries a pack slug.",
    });
  }

  if (template.ownerScope === "organization" && template.organizationId === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["organizationId"],
      message: "An organization template with no owner would be readable by every tenant.",
    });
  }

  if (template.ownerScope !== "organization" && template.organizationId !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["organizationId"],
      message: "Only an organization template is owned by an organization.",
    });
  }
});

export type PosterTemplate = z.infer<typeof posterTemplateSchema>;
