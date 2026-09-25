import { z } from "zod";

import { studioPromptDigest } from "@/domain/creative-studio/digest";

/**
 * The pure Studio contracts: what a draft, a reference, a marker and a
 * suggestion ARE, before any provider, database or worker exists.
 *
 * Two preservation rules shape every schema here. The model's Text Copy is
 * stored verbatim — no trim, no paraphrase, no translation — because the
 * poster renders these exact bytes and the digest must too. Logo ranges are
 * measured in Unicode code points, not UTF-16 units, because an emoji is one
 * character a person sees and two units JavaScript counts.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "A content hash must be SHA-256 hex.");

/** Versioned registry of the evidence-based export presets. */
export const STUDIO_ASPECT_PRESET_REGISTRY_VERSION = 1 as const;

export const STUDIO_ASPECT_PRESETS = {
  instagram_feed: {
    label: "Instagram Feed",
    ratio: "4:5",
    width: 1080,
    height: 1350,
    placementFamily: "instagram_feed",
  },
  instagram_stories: {
    label: "Instagram Stories",
    ratio: "9:16",
    width: 1080,
    height: 1920,
    placementFamily: "instagram_stories",
  },
  google_square: {
    label: "Google square",
    ratio: "1:1",
    width: 1200,
    height: 1200,
    placementFamily: "google_ads",
  },
  google_horizontal: {
    label: "Google horizontal",
    ratio: "1.91:1",
    width: 1200,
    height: 628,
    placementFamily: "google_ads",
  },
  google_vertical: {
    label: "Google vertical",
    ratio: "4:5",
    width: 960,
    height: 1200,
    placementFamily: "google_ads",
  },
  ecommerce_creative: {
    label: "Ecommerce creative",
    ratio: "1:1",
    width: 1200,
    height: 1200,
    placementFamily: "ecommerce",
  },
} as const;

export const aspectPresetSchema = z.enum([
  "instagram_feed",
  "instagram_stories",
  "google_square",
  "google_horizontal",
  "google_vertical",
  "ecommerce_creative",
]);
export type AspectPreset = z.infer<typeof aspectPresetSchema>;

/** Proposed default: Instagram Feed 4:5 at 1080x1350. */
export const DEFAULT_ASPECT_PRESET: AspectPreset = "instagram_feed";

export const studioModeSchema = z.enum(["exact_design", "take_inspiration"]);
export type StudioMode = z.infer<typeof studioModeSchema>;

const referenceIdSchema = z.string().min(1).max(120);

/**
 * One selected input image, pinned by immutable identity. There is no
 * rejected-history arm on purpose: rejected designs never reach generation,
 * so the type must not be able to name them.
 */
export const studioReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("approved_history"),
    referenceId: referenceIdSchema,
    versionId: uuidSchema,
    reviewId: uuidSchema,
    contentHash: sha256HexSchema,
  }),
  z.strictObject({
    kind: z.literal("uploaded_reference"),
    referenceId: referenceIdSchema,
    uploadId: uuidSchema,
    rightsAttestationId: uuidSchema,
    contentHash: sha256HexSchema,
  }),
  z.strictObject({
    kind: z.literal("product"),
    referenceId: referenceIdSchema,
    versionId: uuidSchema,
    contentHash: sha256HexSchema,
  }),
  z.strictObject({
    kind: z.literal("brand_mark"),
    referenceId: referenceIdSchema,
    versionId: uuidSchema,
    contentHash: sha256HexSchema,
  }),
]);
export type StudioReference = z.infer<typeof studioReferenceSchema>;

/**
 * One explicit chip: these exact code points of the stored copy are
 * represented by the approved channel logo at render time. The stored copy
 * keeps the original words; only the derived rendering instructions omit
 * the represented phrase.
 */
export const channelLogoSubstitutionSchema = z.strictObject({
  /** Inclusive start in Unicode code points. */
  start: z.number().int().nonnegative(),
  /** Exclusive end in Unicode code points. */
  end: z.number().int().positive(),
  /** The exact copy slice [start, end). Checked, never assumed. */
  phrase: z.string().min(1).max(200),
  channelId: z.string().trim().min(1).max(80),
  logoAssetVersionId: uuidSchema,
  logoContentHash: sha256HexSchema,
  /** Selected-chip consent is explicit: absent or false refuses at parse. */
  consent: z.literal(true),
});
export type ChannelLogoSubstitution = z.infer<typeof channelLogoSubstitutionSchema>;

export const studioMarkerSchema = z.strictObject({
  /** Replay order. Admission requires exactly 1..n in order. */
  ordinal: z.number().int().positive().max(8),
  /** Normalized against the EXIF-normalized original, never container pixels. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  instruction: z.string().trim().min(1).max(500),
});
export type StudioMarker = z.infer<typeof studioMarkerSchema>;

/** At most eight ordered markers; NaN and infinities fail the bounds above. */
export const MAX_STUDIO_MARKERS = 8 as const;

/**
 * A saved Studio setup. Prompt and Text Copy allow blank: a blank canvas is
 * a starting point, not an error. Both are stored verbatim — trimming here
 * would silently change what the poster renders and what its digest covers.
 */
export const studioDraftSchema = z.strictObject({
  documentId: uuidSchema,
  baseRevision: z.number().int().nonnegative(),
  campaignId: uuidSchema.nullable(),
  mode: studioModeSchema,
  prompt: z.string().max(6000),
  textCopy: z.string().max(6000),
  aspectPreset: aspectPresetSchema,
  primaryReferenceId: referenceIdSchema.nullable(),
  channelLogoSubstitutions: z.array(channelLogoSubstitutionSchema),
  references: z.array(studioReferenceSchema),
  productVersionIds: z.array(uuidSchema).max(3),
  brandSnapshotId: uuidSchema.nullable(),
});
export type StudioDraft = z.infer<typeof studioDraftSchema>;

export const studioPromptOperationSchema = z.enum(["save_draft", "new_idea", "enhance", "generate"]);
export type StudioPromptOperation = z.infer<typeof studioPromptOperationSchema>;

export type PromptValidation = { readonly ok: true } | { readonly ok: false; readonly code: string };

/**
 * Blank is a draft, not a direction. Saving and New Idea start from nothing;
 * Enhance and generation have nothing to work with until the operator writes.
 */
export function validatePromptForOperation(input: {
  readonly prompt: string;
  readonly operation: StudioPromptOperation;
}): PromptValidation {
  if (input.operation === "save_draft" || input.operation === "new_idea") return { ok: true };
  if (input.prompt.trim().length > 0) return { ok: true };
  return {
    ok: false,
    code: input.operation === "enhance" ? "prompt_required_for_enhance" : "prompt_required_for_generate",
  };
}

export type LogoSubstitutionRefusalCode =
  | "range_out_of_bounds"
  | "phrase_mismatch"
  | "range_overlap"
  | "unknown_channel"
  | "logo_unavailable";

export type LogoSubstitutionAdmission =
  | { readonly admitted: true; readonly count: number }
  | {
      readonly admitted: false;
      readonly refusals: readonly { readonly index: number; readonly code: LogoSubstitutionRefusalCode; readonly detail: string }[];
    };

/**
 * Admits the chip manifest against the exact stored copy. Ranges are read in
 * code points — `Array.from` splits astral characters once, where indexing
 * the string would split an emoji in half and compare the wrong phrase.
 */
export function admitLogoSubstitutions(input: {
  readonly textCopy: string;
  readonly substitutions: readonly ChannelLogoSubstitution[];
  readonly channels: Readonly<Record<string, { readonly logoAvailable: boolean }>>;
}): LogoSubstitutionAdmission {
  const codePoints = Array.from(input.textCopy);
  const refusals: {
    index: number;
    code: LogoSubstitutionRefusalCode;
    detail: string;
  }[] = [];
  const accepted: { index: number; start: number; end: number }[] = [];

  input.substitutions.forEach((substitution, index) => {
    if (substitution.start >= substitution.end || substitution.end > codePoints.length) {
      refusals.push({
        index,
        code: "range_out_of_bounds",
        detail: `Substitution ${index + 1} claims code points ${substitution.start}–${substitution.end}, but the copy is ${codePoints.length} code points long.`,
      });
      return;
    }

    const actual = codePoints.slice(substitution.start, substitution.end).join("");
    if (actual !== substitution.phrase) {
      refusals.push({
        index,
        code: "phrase_mismatch",
        detail: `Substitution ${index + 1} claims "${substitution.phrase}", but the copy reads "${actual}" at that range.`,
      });
      return;
    }

    const channel = input.channels[substitution.channelId];
    if (!channel) {
      refusals.push({
        index,
        code: "unknown_channel",
        detail: `Substitution ${index + 1} names an unknown channel: ${substitution.channelId}.`,
      });
      return;
    }
    if (!channel.logoAvailable) {
      refusals.push({
        index,
        code: "logo_unavailable",
        detail: `Substitution ${index + 1} names ${substitution.channelId}, whose approved logo bytes are unavailable.`,
      });
      return;
    }

    const overlap = accepted.find(
      (entry) => substitution.start < entry.end && entry.start < substitution.end,
    );
    if (overlap) {
      refusals.push({
        index,
        code: "range_overlap",
        detail: `Substitution ${index + 1} overlaps substitution ${overlap.index + 1}: two chips may not claim the same words.`,
      });
      return;
    }

    accepted.push({ index, start: substitution.start, end: substitution.end });
  });

  if (refusals.length > 0) return { admitted: false, refusals };
  return { admitted: true, count: input.substitutions.length };
}

export type MarkerAdmissionCode = "too_many_markers" | "duplicate_ordinal" | "ordinals_not_sequential";

/**
 * Admits a marker set for one edit request. Shape (bounds, non-empty
 * instruction) is enforced by the schema; this enforces the set rules: at
 * most eight, ordinals exactly 1..n in order.
 */
export function admitStudioMarkers(input: {
  readonly markers: readonly StudioMarker[];
}): { readonly admitted: true; readonly count: number } | { readonly admitted: false; readonly code: MarkerAdmissionCode; readonly detail: string } {
  if (input.markers.length > MAX_STUDIO_MARKERS) {
    return {
      admitted: false,
      code: "too_many_markers",
      detail: `An edit carries at most ${MAX_STUDIO_MARKERS} markers; got ${input.markers.length}.`,
    };
  }
  const ordinals = input.markers.map((marker) => marker.ordinal);
  if (new Set(ordinals).size !== ordinals.length) {
    return {
      admitted: false,
      code: "duplicate_ordinal",
      detail: `Markers share an ordinal: ${ordinals.join(", ")}.`,
    };
  }
  const sequential = ordinals.every((ordinal, index) => ordinal === index + 1);
  if (!sequential) {
    return {
      admitted: false,
      code: "ordinals_not_sequential",
      detail: `Markers must be numbered 1 to ${input.markers.length} in order; got ${ordinals.join(", ")}.`,
    };
  }
  return { admitted: true, count: input.markers.length };
}

export type PrimaryReferenceCode =
  | "exact_design_requires_primary"
  | "primary_reference_unknown"
  | "primary_reference_not_layout_source";

/**
 * Exact design follows a layout, so it names one. The primary may be an
 * approved design or a fresh upload — upload-only Exact works without
 * inventing an Asset Library version — but never a product photo or a mark.
 */
export function admitExactDesignPrimary(input: {
  readonly mode: StudioMode;
  readonly primaryReferenceId: string | null;
  readonly references: readonly StudioReference[];
}):
  | { readonly admitted: true }
  | { readonly admitted: false; readonly code: PrimaryReferenceCode; readonly detail: string } {
  if (input.primaryReferenceId === null) {
    if (input.mode === "exact_design") {
      return {
        admitted: false,
        code: "exact_design_requires_primary",
        detail: "Exact design follows a reference layout: choose which selected reference is primary.",
      };
    }
    return { admitted: true };
  }

  const primary = input.references.find(
    (reference) => reference.referenceId === input.primaryReferenceId,
  );
  if (!primary) {
    return {
      admitted: false,
      code: "primary_reference_unknown",
      detail: `Primary reference "${input.primaryReferenceId}" is not among the selected references.`,
    };
  }
  if (primary.kind !== "approved_history" && primary.kind !== "uploaded_reference") {
    return {
      admitted: false,
      code: "primary_reference_not_layout_source",
      detail: `Primary reference "${input.primaryReferenceId}" is a ${primary.kind}, not a design layout to follow.`,
    };
  }
  return { admitted: true };
}

export type GenerationReferenceCode =
  | "too_many_design_references"
  | "too_many_product_references"
  | "too_many_brand_marks"
  | "provider_image_cap_exceeded"
  | "provider_payload_exceeded";

/** Design, product and mark ceilings before the provider's own caps apply. */
export const MAX_DESIGN_REFERENCES = 3 as const;
export const MAX_PRODUCT_REFERENCES = 3 as const;
export const MAX_BRAND_MARKS = 2 as const;

/**
 * Admits the reference set for a generation request. The parent image and
 * the marker overlay travel to the provider too, so they count against its
 * image cap alongside the references.
 */
export function admitGenerationReferences(input: {
  readonly references: readonly StudioReference[];
  readonly parentImageCount: number;
  readonly markerOverlayCount: number;
  readonly estimatedInputBytes: number;
  readonly profile: { readonly maxImages: number; readonly maxInputBytes: number };
}):
  | { readonly admitted: true }
  | { readonly admitted: false; readonly code: GenerationReferenceCode; readonly detail: string } {
  const designs = input.references.filter(
    (reference) => reference.kind === "approved_history" || reference.kind === "uploaded_reference",
  ).length;
  if (designs > MAX_DESIGN_REFERENCES) {
    return {
      admitted: false,
      code: "too_many_design_references",
      detail: `At most ${MAX_DESIGN_REFERENCES} design references; got ${designs}.`,
    };
  }
  const products = input.references.filter((reference) => reference.kind === "product").length;
  if (products > MAX_PRODUCT_REFERENCES) {
    return {
      admitted: false,
      code: "too_many_product_references",
      detail: `At most ${MAX_PRODUCT_REFERENCES} product images; got ${products}.`,
    };
  }
  const marks = input.references.filter((reference) => reference.kind === "brand_mark").length;
  if (marks > MAX_BRAND_MARKS) {
    return {
      admitted: false,
      code: "too_many_brand_marks",
      detail: `At most ${MAX_BRAND_MARKS} brand marks; got ${marks}.`,
    };
  }

  const totalImages = input.references.length + input.parentImageCount + input.markerOverlayCount;
  if (totalImages > input.profile.maxImages) {
    return {
      admitted: false,
      code: "provider_image_cap_exceeded",
      detail: `The qualified profile carries ${input.profile.maxImages} images; this request needs ${totalImages} including parent and marker overlay.`,
    };
  }
  if (input.estimatedInputBytes > input.profile.maxInputBytes) {
    return {
      admitted: false,
      code: "provider_payload_exceeded",
      detail: `The qualified profile carries ${input.profile.maxInputBytes} bytes; this request needs about ${input.estimatedInputBytes}.`,
    };
  }
  return { admitted: true };
}

export const studioUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type StudioUsage = z.infer<typeof studioUsageSchema>;

export const studioSuggestionOperationSchema = z.enum(["enhance", "new_idea"]);
export type StudioSuggestionOperation = z.infer<typeof studioSuggestionOperationSchema>;

/**
 * A bounded text-only suggestion, persisted as the typed
 * `studio_runs.result_json`. The original prompt digest pins what the model
 * saw; applying after further edits is stale, not automatic.
 */
export const studioSuggestionSchema = z.strictObject({
  originalPromptDigest: sha256HexSchema,
  suggestedPrompt: z.string().min(1).max(6000),
  operation: studioSuggestionOperationSchema,
  usage: studioUsageSchema,
});
export type StudioSuggestion = z.infer<typeof studioSuggestionSchema>;

export type SuggestionApplication =
  | { readonly applied: true; readonly prompt: string; readonly textCopy: string }
  | {
      readonly applied: false;
      readonly prompt: string;
      readonly textCopy: string;
      readonly code: "declined" | "suggestion_stale";
    };

/**
 * Applies an explicitly accepted suggestion to the prompt and nothing else.
 * Text Copy, product and brand fields are never rewritten by a suggestion,
 * and applying enqueues no image generation — it returns words, not a run.
 */
export function applySuggestion(input: {
  readonly currentPrompt: string;
  readonly textCopy: string;
  readonly suggestion: StudioSuggestion;
  readonly accept: boolean;
}): SuggestionApplication {
  if (!input.accept) {
    return {
      applied: false,
      prompt: input.currentPrompt,
      textCopy: input.textCopy,
      code: "declined",
    };
  }
  if (input.suggestion.originalPromptDigest !== studioPromptDigest(input.currentPrompt)) {
    return {
      applied: false,
      prompt: input.currentPrompt,
      textCopy: input.textCopy,
      code: "suggestion_stale",
    };
  }
  return { applied: true, prompt: input.suggestion.suggestedPrompt, textCopy: input.textCopy };
}
