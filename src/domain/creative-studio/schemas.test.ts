import { describe, expect, it } from "vitest";

import { studioPromptDigest } from "@/domain/creative-studio/digest";
import {
  DEFAULT_ASPECT_PRESET,
  STUDIO_ASPECT_PRESETS,
  STUDIO_ASPECT_PRESET_REGISTRY_VERSION,
  admitExactDesignPrimary,
  admitGenerationReferences,
  admitLogoSubstitutions,
  admitStudioMarkers,
  applySuggestion,
  aspectPresetSchema,
  channelLogoSubstitutionSchema,
  studioDraftSchema,
  studioMarkerSchema,
  studioReferenceSchema,
  studioSuggestionSchema,
  validatePromptForOperation,
} from "@/domain/creative-studio/schemas";

const DOCUMENT = "11111111-1111-4111-8111-111111111111";
const VERSION = "33333333-3333-4333-8333-333333333333";
const REVIEW = "44444444-4444-4334-8334-444444444444";
const UPLOAD = "55555555-5555-4555-8555-555555555555";
const RIGHTS = "66666666-6666-4666-8666-666666666666";
const LOGO_VERSION = "77777777-7777-4777-8777-777777777777";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function approvedReference() {
  return {
    kind: "approved_history",
    referenceId: "ref-approved-1",
    versionId: VERSION,
    reviewId: REVIEW,
    contentHash: HASH_A,
  } as const;
}

function uploadedReference() {
  return {
    kind: "uploaded_reference",
    referenceId: "ref-upload-1",
    uploadId: UPLOAD,
    rightsAttestationId: RIGHTS,
    contentHash: HASH_B,
  } as const;
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    documentId: DOCUMENT,
    baseRevision: 3,
    campaignId: null,
    mode: "take_inspiration",
    prompt: "A busy lunch poster",
    textCopy: "Weekday lunch\nAED 35",
    aspectPreset: "instagram_feed",
    primaryReferenceId: null,
    channelLogoSubstitutions: [],
    references: [],
    productVersionIds: [],
    brandSnapshotId: null,
    ...overrides,
  };
}

describe("aspect preset registry", () => {
  it("is versioned and defaults to Instagram Feed 4:5 at 1080x1350", () => {
    expect(STUDIO_ASPECT_PRESET_REGISTRY_VERSION).toBe(1);
    expect(DEFAULT_ASPECT_PRESET).toBe("instagram_feed");
    expect(STUDIO_ASPECT_PRESETS.instagram_feed).toMatchObject({
      ratio: "4:5",
      width: 1080,
      height: 1350,
    });
  });

  it("carries the evidence-based presets with destination, ratio and export size", () => {
    expect(STUDIO_ASPECT_PRESETS.instagram_stories).toMatchObject({
      ratio: "9:16",
      width: 1080,
      height: 1920,
    });
    expect(STUDIO_ASPECT_PRESETS.google_square).toMatchObject({
      ratio: "1:1",
      width: 1200,
      height: 1200,
    });
    expect(STUDIO_ASPECT_PRESETS.google_horizontal).toMatchObject({
      width: 1200,
      height: 628,
    });
    expect(STUDIO_ASPECT_PRESETS.google_vertical).toMatchObject({
      width: 960,
      height: 1200,
    });
    expect(STUDIO_ASPECT_PRESETS.ecommerce_creative).toMatchObject({
      ratio: "1:1",
      width: 1200,
      height: 1200,
    });
  });

  it("refuses an unlisted placement rather than inventing dimensions", () => {
    expect(aspectPresetSchema.safeParse("amazon_a_plus").success).toBe(false);
  });
});

describe("studio draft", () => {
  it("accepts a campaign-free draft with blank prompt and blank copy", () => {
    const parsed = studioDraftSchema.safeParse(draft({ prompt: "", textCopy: "" }));

    expect(parsed.success).toBe(true);
  });

  it("preserves Text Copy verbatim: Unicode, newlines and surrounding spaces kept", () => {
    const copy = "  Weekday lunch  \nകേരള മീൻ കറി  \n AED 35 \n";
    const parsed = studioDraftSchema.safeParse(draft({ textCopy: copy }));

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.textCopy).toBe(copy);
  });

  it("preserves prompt verbatim without trimming", () => {
    const parsed = studioDraftSchema.safeParse(draft({ prompt: "  lunch poster  " }));

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.prompt).toBe("  lunch poster  ");
  });

  it("refuses prompt and copy past the 6000-character bound", () => {
    expect(studioDraftSchema.safeParse(draft({ prompt: "x".repeat(6001) })).success).toBe(false);
    expect(studioDraftSchema.safeParse(draft({ textCopy: "x".repeat(6001) })).success).toBe(false);
  });

  it("refuses an unknown field rather than dropping it", () => {
    expect(
      studioDraftSchema.safeParse({ ...draft(), providerHandle: "opaque-handle" }).success,
    ).toBe(false);
  });
});

describe("prompt validation per operation", () => {
  it("allows a blank saved draft and a blank New Idea", () => {
    expect(validatePromptForOperation({ prompt: "", operation: "save_draft" })).toEqual({
      ok: true,
    });
    expect(validatePromptForOperation({ prompt: "   ", operation: "new_idea" })).toEqual({
      ok: true,
    });
  });

  it("requires text for Enhance", () => {
    expect(validatePromptForOperation({ prompt: "", operation: "enhance" })).toMatchObject({
      ok: false,
      code: "prompt_required_for_enhance",
    });
    expect(validatePromptForOperation({ prompt: "   ", operation: "enhance" })).toMatchObject({
      ok: false,
    });
  });

  it("requires text for image generation", () => {
    expect(validatePromptForOperation({ prompt: "", operation: "generate" })).toMatchObject({
      ok: false,
      code: "prompt_required_for_generate",
    });
    expect(
      validatePromptForOperation({ prompt: "Add the lunch spread", operation: "generate" }),
    ).toEqual({ ok: true });
  });
});

describe("references", () => {
  it("accepts each of the four manifest arms", () => {
    for (const reference of [
      approvedReference(),
      uploadedReference(),
      { kind: "product", referenceId: "ref-product-1", versionId: VERSION, contentHash: HASH_A },
      { kind: "brand_mark", referenceId: "ref-mark-1", versionId: VERSION, contentHash: HASH_A },
    ]) {
      expect(studioReferenceSchema.safeParse(reference).success).toBe(true);
    }
  });

  it("excludes rejected history at final generation: no such arm exists", () => {
    const parsed = studioReferenceSchema.safeParse({
      kind: "rejected_history",
      referenceId: "ref-rejected-1",
      versionId: VERSION,
      reviewId: REVIEW,
      contentHash: HASH_A,
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a reference carrying no content hash", () => {
    const withoutHash = {
      kind: "approved_history",
      referenceId: "ref-approved-1",
      versionId: VERSION,
      reviewId: REVIEW,
    };

    expect(studioReferenceSchema.safeParse(withoutHash).success).toBe(false);
  });
});

describe("primary reference membership", () => {
  it("admits an Exact design whose primary is a selected approved history entry", () => {
    expect(
      admitExactDesignPrimary({
        mode: "exact_design",
        primaryReferenceId: "ref-approved-1",
        references: [approvedReference()],
      }),
    ).toEqual({ admitted: true });
  });

  it("admits an upload-only Exact design: the primary may be an uploaded reference", () => {
    expect(
      admitExactDesignPrimary({
        mode: "exact_design",
        primaryReferenceId: "ref-upload-1",
        references: [uploadedReference()],
      }),
    ).toEqual({ admitted: true });
  });

  it("refuses an Exact design with no primary reference", () => {
    expect(
      admitExactDesignPrimary({
        mode: "exact_design",
        primaryReferenceId: null,
        references: [approvedReference()],
      }),
    ).toMatchObject({ admitted: false, code: "exact_design_requires_primary" });
  });

  it("refuses a primary that was never selected", () => {
    expect(
      admitExactDesignPrimary({
        mode: "exact_design",
        primaryReferenceId: "ref-approved-9",
        references: [approvedReference()],
      }),
    ).toMatchObject({ admitted: false, code: "primary_reference_unknown" });
  });

  it("refuses a product photo as the Exact layout primary", () => {
    expect(
      admitExactDesignPrimary({
        mode: "exact_design",
        primaryReferenceId: "ref-product-1",
        references: [
          { kind: "product", referenceId: "ref-product-1", versionId: VERSION, contentHash: HASH_A },
        ],
      }),
    ).toMatchObject({ admitted: false, code: "primary_reference_not_layout_source" });
  });

  it("lets Take Inspiration run with no primary at all", () => {
    expect(
      admitExactDesignPrimary({ mode: "take_inspiration", primaryReferenceId: null, references: [] }),
    ).toEqual({ admitted: true });
  });
});

describe("channel logo substitutions", () => {
  const channels = {
    talabat: { logoAvailable: true },
    deliveroo: { logoAvailable: false },
  };

  it("admits a chip-consented range whose phrase matches the copy at code-point offsets", () => {
    const outcome = admitLogoSubstitutions({
      textCopy: "Order on Talabat today",
      substitutions: [
        {
          start: 9,
          end: 16,
          phrase: "Talabat",
          channelId: "talabat",
          logoAssetVersionId: LOGO_VERSION,
          logoContentHash: HASH_A,
          consent: true,
        },
      ],
      channels,
    });

    expect(outcome).toEqual({ admitted: true, count: 1 });
  });

  it("measures ranges in Unicode code points, not UTF-16 units", () => {
    // "കേ" is two UTF-16 units but the emoji below is the sharp case: "🍔" is
    // one code point and two UTF-16 units. A UTF-16 implementation would read
    // the wrong phrase and either admit a lie or refuse honest input.
    const copy = "🍔 Talabat";
    const outcome = admitLogoSubstitutions({
      textCopy: copy,
      substitutions: [
        {
          start: 2,
          end: 9,
          phrase: "Talabat",
          channelId: "talabat",
          logoAssetVersionId: LOGO_VERSION,
          logoContentHash: HASH_A,
          consent: true,
        },
      ],
      channels,
    });

    expect(outcome).toEqual({ admitted: true, count: 1 });
  });

  it("rejects a phrase that does not match the copy at the claimed range", () => {
    const outcome = admitLogoSubstitutions({
      textCopy: "Order on Talabat today",
      substitutions: [
        {
          start: 9,
          end: 16,
          phrase: "Deliveroo",
          channelId: "talabat",
          logoAssetVersionId: LOGO_VERSION,
          logoContentHash: HASH_A,
          consent: true,
        },
      ],
      channels,
    });

    expect(outcome).toMatchObject({ admitted: false });
    if (!outcome.admitted) expect(outcome.refusals[0]!.code).toBe("phrase_mismatch");
  });

  it("rejects overlapping ranges: two chips may not claim the same words", () => {
    const outcome = admitLogoSubstitutions({
      textCopy: "Order on Talabat today",
      substitutions: [
        {
          start: 9,
          end: 16,
          phrase: "Talabat",
          channelId: "talabat",
          logoAssetVersionId: LOGO_VERSION,
          logoContentHash: HASH_A,
          consent: true,
        },
        {
          start: 12,
          end: 19,
          phrase: "abat to",
          channelId: "talabat",
          logoAssetVersionId: LOGO_VERSION,
          logoContentHash: HASH_A,
          consent: true,
        },
      ],
      channels,
    });

    expect(outcome).toMatchObject({ admitted: false });
    if (!outcome.admitted)
      expect(outcome.refusals.some((refusal) => refusal.code === "range_overlap")).toBe(true);
  });

  it("rejects an unknown channel and an unavailable logo with distinct codes", () => {
    const substitution = {
      start: 9,
      end: 16,
      phrase: "Talabat",
      channelId: "talabat",
      logoAssetVersionId: LOGO_VERSION,
      logoContentHash: HASH_A,
      consent: true,
    } as const;

    const unknown = admitLogoSubstitutions({
      textCopy: "Order on Talabat today",
      substitutions: [{ ...substitution, channelId: "mystery" }],
      channels,
    });
    if (!unknown.admitted) expect(unknown.refusals[0]!.code).toBe("unknown_channel");
    else expect.unreachable();

    const unavailable = admitLogoSubstitutions({
      textCopy: "Order on Deliveroo today",
      substitutions: [
        { ...substitution, start: 9, end: 18, phrase: "Deliveroo", channelId: "deliveroo" },
      ],
      channels,
    });
    if (!unavailable.admitted) expect(unavailable.refusals[0]!.code).toBe("logo_unavailable");
    else expect.unreachable();
  });

  it("requires explicit chip consent at the schema level", () => {
    expect(
      channelLogoSubstitutionSchema.safeParse({
        start: 9,
        end: 16,
        phrase: "Talabat",
        channelId: "talabat",
        logoAssetVersionId: LOGO_VERSION,
        logoContentHash: HASH_A,
        consent: false,
      }).success,
    ).toBe(false);
  });

  it("rejects a range past the end of the copy", () => {
    const outcome = admitLogoSubstitutions({
      textCopy: "Hi",
      substitutions: [
        {
          start: 0,
          end: 40,
          phrase: "Hi plus much more",
          channelId: "talabat",
          logoAssetVersionId: LOGO_VERSION,
          logoContentHash: HASH_A,
          consent: true,
        },
      ],
      channels,
    });

    expect(outcome).toMatchObject({ admitted: false });
    if (!outcome.admitted) expect(outcome.refusals[0]!.code).toBe("range_out_of_bounds");
  });
});

describe("markers", () => {
  it("refuses empty instructions, off-image points and bad ordinals at the schema", () => {
    expect(
      studioMarkerSchema.safeParse({ ordinal: 1, x: 0.5, y: 0.5, instruction: "" }).success,
    ).toBe(false);
    expect(
      studioMarkerSchema.safeParse({ ordinal: 1, x: 1.2, y: 0.5, instruction: "Move it" }).success,
    ).toBe(false);
    expect(
      studioMarkerSchema.safeParse({ ordinal: 0, x: 0.5, y: 0.5, instruction: "Move it" }).success,
    ).toBe(false);
    expect(
      studioMarkerSchema.safeParse({ ordinal: 9, x: 0.5, y: 0.5, instruction: "Move it" }).success,
    ).toBe(false);
    expect(
      studioMarkerSchema.safeParse({
        ordinal: 1,
        x: Number.NaN,
        y: 0.5,
        instruction: "Move it",
      }).success,
    ).toBe(false);
  });

  it("accepts edge coordinates 0 and 1", () => {
    expect(
      studioMarkerSchema.safeParse({ ordinal: 1, x: 0, y: 1, instruction: "Corner" }).success,
    ).toBe(true);
  });

  it("admits up to eight ordered markers", () => {
    const markers = Array.from({ length: 8 }, (_, index) => ({
      ordinal: index + 1,
      x: 0.1 * (index + 1),
      y: 0.1,
      instruction: `Change ${index + 1}`,
    }));

    expect(admitStudioMarkers({ markers })).toEqual({ admitted: true, count: 8 });
  });

  it("refuses a ninth marker", () => {
    const markers = Array.from({ length: 9 }, (_, index) => ({
      ordinal: index + 1,
      x: 0.05 * (index + 1),
      y: 0.1,
      instruction: `Change ${index + 1}`,
    }));

    expect(admitStudioMarkers({ markers })).toMatchObject({
      admitted: false,
      code: "too_many_markers",
    });
  });

  it("refuses duplicate and non-sequential ordinals", () => {
    const marker = { x: 0.5, y: 0.5, instruction: "Move it" };

    expect(
      admitStudioMarkers({ markers: [{ ...marker, ordinal: 1 }, { ...marker, ordinal: 1 }] }),
    ).toMatchObject({ admitted: false, code: "duplicate_ordinal" });
    expect(
      admitStudioMarkers({ markers: [{ ...marker, ordinal: 1 }, { ...marker, ordinal: 3 }] }),
    ).toMatchObject({ admitted: false, code: "ordinals_not_sequential" });
  });
});

describe("generation reference caps", () => {
  const profile = { maxImages: 6, maxInputBytes: 10_000_000 };

  it("admits a full house: three designs, products and marks within provider caps", () => {
    const outcome = admitGenerationReferences({
      references: [
        approvedReference(),
        { ...approvedReference(), referenceId: "ref-approved-2" },
        uploadedReference(),
        { kind: "product", referenceId: "ref-product-1", versionId: VERSION, contentHash: HASH_A },
        { kind: "product", referenceId: "ref-product-2", versionId: VERSION, contentHash: HASH_A },
        { kind: "brand_mark", referenceId: "ref-mark-1", versionId: VERSION, contentHash: HASH_A },
      ],
      parentImageCount: 0,
      markerOverlayCount: 0,
      estimatedInputBytes: 1_000,
      profile,
    });

    expect(outcome).toEqual({ admitted: true });
  });

  it("refuses a fourth design reference", () => {
    const outcome = admitGenerationReferences({
      references: [
        approvedReference(),
        { ...approvedReference(), referenceId: "ref-approved-2" },
        { ...approvedReference(), referenceId: "ref-approved-3" },
        uploadedReference(),
      ],
      parentImageCount: 0,
      markerOverlayCount: 0,
      estimatedInputBytes: 1_000,
      profile,
    });

    expect(outcome).toMatchObject({ admitted: false, code: "too_many_design_references" });
  });

  it("counts the parent and the marker overlay against the provider image cap", () => {
    const outcome = admitGenerationReferences({
      references: [approvedReference(), uploadedReference()],
      parentImageCount: 1,
      markerOverlayCount: 1,
      estimatedInputBytes: 1_000,
      profile: { ...profile, maxImages: 3 },
    });

    expect(outcome).toMatchObject({ admitted: false, code: "provider_image_cap_exceeded" });
  });

  it("refuses a payload past the qualified provider byte ceiling", () => {
    const outcome = admitGenerationReferences({
      references: [approvedReference()],
      parentImageCount: 0,
      markerOverlayCount: 0,
      estimatedInputBytes: 11_000_000,
      profile,
    });

    expect(outcome).toMatchObject({ admitted: false, code: "provider_payload_exceeded" });
  });
});

describe("suggestions", () => {
  const suggestion = {
    originalPromptDigest: studioPromptDigest("A busy lunch poster"),
    suggestedPrompt: "A busy lunch poster with the spread front and centre",
    operation: "enhance",
    usage: { inputTokens: 120, outputTokens: 40 },
  } as const;

  it("persists as a typed result with the original prompt digest", () => {
    expect(studioSuggestionSchema.safeParse(suggestion).success).toBe(true);
  });

  it("applies an accepted suggestion to the prompt only: Text Copy is untouched", () => {
    const copy = "Weekday lunch\nAED 35 ";
    const outcome = applySuggestion({
      currentPrompt: "A busy lunch poster",
      textCopy: copy,
      suggestion: { ...suggestion },
      accept: true,
    });

    expect(outcome.applied).toBe(true);
    if (outcome.applied) {
      expect(outcome.prompt).toBe(suggestion.suggestedPrompt);
      expect(outcome.textCopy).toBe(copy);
      expect("runId" in outcome).toBe(false);
    }
  });

  it("keeps the original prompt when the suggestion is declined", () => {
    const outcome = applySuggestion({
      currentPrompt: "A busy lunch poster",
      textCopy: "Weekday lunch",
      suggestion: { ...suggestion },
      accept: false,
    });

    expect(outcome).toMatchObject({ applied: false, prompt: "A busy lunch poster" });
  });

  it("refuses to paste a suggestion over edits made after it", () => {
    const outcome = applySuggestion({
      currentPrompt: "A busy lunch poster, now with dessert",
      textCopy: "Weekday lunch",
      suggestion: { ...suggestion },
      accept: true,
    });

    expect(outcome).toMatchObject({ applied: false, code: "suggestion_stale" });
    if (!outcome.applied) expect(outcome.prompt).toBe("A busy lunch poster, now with dessert");
  });

  it("persists a blank-prompt New Idea reload without inventing text", () => {
    const blank = studioSuggestionSchema.safeParse({
      originalPromptDigest: "d".repeat(64),
      suggestedPrompt: "A quiet breakfast scene",
      operation: "new_idea",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    expect(blank.success).toBe(true);
  });
});
