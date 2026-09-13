import { describe, expect, it } from "vitest";

import {
  campaignDeliverableVersionSchema,
  deliverableCompletion,
  deliverableRenderDigest,
  deliverableSourceSchema,
  publicationEligibility,
  type CampaignDeliverableReview,
  type DeliverableRenderInputs,
} from "@/domain/campaigns/deliverable";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const DELIVERABLE = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function renderInputs(overrides: Partial<DeliverableRenderInputs> = {}): DeliverableRenderInputs {
  return {
    plateContentHash: HASH_A,
    templateVersion: 3,
    script: "Latn",
    slotValues: { headline: "Weekday lunch", price: "AED 35" },
    freeLine: null,
    brandMarkVersionId: null,
    fontManifestVersion: "2026.09.1",
    renderEngineVersion: "resvg-0.44",
    ...overrides,
  };
}

function review(overrides: Partial<CampaignDeliverableReview> = {}): CampaignDeliverableReview {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: ORGANIZATION,
    deliverableId: DELIVERABLE,
    deliverableVersionId: VERSION,
    contentHash: HASH_A,
    actorId: "66666666-6666-4666-8666-666666666666",
    decision: "approved",
    reasonCodes: [],
    note: null,
    reviewedAt: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

describe("where finished bytes come from", () => {
  it("accepts a composed poster render", () => {
    const parsed = deliverableSourceSchema.safeParse({
      kind: "finished_poster",
      posterRenderId: VERSION,
      templateKey: "core.feed.square",
      templateVersion: 3,
      script: "Latn",
    });

    expect(parsed.success).toBe(true);
  });

  it("requires choosing a final image to be explicit, never implied", () => {
    // Without the explicit choice there is no valid `final_image` at all, so a
    // plate cannot become publishable just by being an image.
    expect(
      deliverableSourceSchema.safeParse({ kind: "final_image", assetId: VERSION }).success,
    ).toBe(false);
    expect(
      deliverableSourceSchema.safeParse({
        kind: "final_image",
        assetId: VERSION,
        chosenAsFinal: true,
      }).success,
    ).toBe(true);
  });

  it("refuses a source carrying a signed URL", () => {
    const parsed = deliverableSourceSchema.safeParse({
      kind: "final_image",
      assetId: VERSION,
      chosenAsFinal: true,
      signedUrl: "https://storage.example/signed?token=abc",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("the render digest", () => {
  it("is identical for identical inputs, so a retry reuses rather than repays", () => {
    expect(deliverableRenderDigest(renderInputs())).toBe(deliverableRenderDigest(renderInputs()));
  });

  it("changes when the free line changes", () => {
    expect(deliverableRenderDigest(renderInputs({ freeLine: "Served until 4pm" }))).not.toBe(
      deliverableRenderDigest(renderInputs()),
    );
  });

  it("changes when the font manifest moves, because the pixels do", () => {
    expect(deliverableRenderDigest(renderInputs({ fontManifestVersion: "2026.10.1" }))).not.toBe(
      deliverableRenderDigest(renderInputs()),
    );
  });

  it("changes when the script changes", () => {
    expect(deliverableRenderDigest(renderInputs({ script: "Arab" }))).not.toBe(
      deliverableRenderDigest(renderInputs()),
    );
  });

  it("changes when a slot value changes", () => {
    expect(
      deliverableRenderDigest(
        renderInputs({ slotValues: { headline: "Weekday lunch", price: "AED 39" } }),
      ),
    ).not.toBe(deliverableRenderDigest(renderInputs()));
  });

  it("changes when the brand mark version changes", () => {
    expect(deliverableRenderDigest(renderInputs({ brandMarkVersionId: CAMPAIGN }))).not.toBe(
      deliverableRenderDigest(renderInputs()),
    );
  });
});

describe("whether an exact output may be published", () => {
  const version = { id: VERSION, contentHash: HASH_A, version: 2 };

  it("refuses an output nobody has reviewed", () => {
    expect(publicationEligibility({ version, reviews: [], currentVersion: 2 })).toEqual({
      publishable: false,
      reasonCode: "never_reviewed",
    });
  });

  it("allows an output whose exact content was approved", () => {
    const outcome = publicationEligibility({
      version,
      reviews: [review()],
      currentVersion: 2,
    });

    expect(outcome).toMatchObject({ publishable: true });
  });

  it("refuses when the bytes moved under the approval", () => {
    // The review names this version, but it approved different content. A
    // version id alone would miss this; the hash is what catches it.
    const outcome = publicationEligibility({
      version,
      reviews: [review({ contentHash: HASH_B })],
      currentVersion: 2,
    });

    expect(outcome).toEqual({ publishable: false, reasonCode: "reviewed_different_content" });
  });

  it("treats a rejection after an approval as a rejection", () => {
    const outcome = publicationEligibility({
      version,
      reviews: [
        review({ reviewedAt: "2026-09-13T10:00:00.000Z", decision: "approved" }),
        review({
          id: "77777777-7777-4777-8777-777777777777",
          reviewedAt: "2026-09-13T11:00:00.000Z",
          decision: "rejected",
          reasonCodes: ["text_incorrect"],
        }),
      ],
      currentVersion: 2,
    });

    expect(outcome).toEqual({ publishable: false, reasonCode: "rejected" });
  });

  it("ignores a review that belongs to another version", () => {
    const outcome = publicationEligibility({
      version,
      reviews: [review({ deliverableVersionId: "88888888-8888-4888-8888-888888888888" })],
      currentVersion: 2,
    });

    expect(outcome).toEqual({ publishable: false, reasonCode: "never_reviewed" });
  });

  it("refuses a version a newer one has superseded", () => {
    const outcome = publicationEligibility({
      version: { id: VERSION, contentHash: HASH_A, version: 1 },
      reviews: [review()],
      currentVersion: 2,
    });

    expect(outcome).toEqual({ publishable: false, reasonCode: "superseded_by_newer_version" });
  });

  it("does not let a new version inherit the previous approval", () => {
    // The new version has different bytes and no review of its own. This is
    // D05: every finished variation is reviewed before it can publish.
    const outcome = publicationEligibility({
      version: { id: "99999999-9999-4999-8999-999999999999", contentHash: HASH_B, version: 3 },
      reviews: [review()],
      currentVersion: 3,
    });

    expect(outcome).toEqual({ publishable: false, reasonCode: "never_reviewed" });
  });
});

describe("reporting a partly finished set", () => {
  it("reports five of eight with the shortfall named, never a tidy five", () => {
    const completion = deliverableCompletion({
      plan: [
        { format: "feed", language: "en", count: 5 },
        { format: "story", language: "ar", count: 3 },
      ],
      produced: [
        ...Array.from({ length: 5 }, () => ({ format: "feed", language: "en" })),
        { format: "story", language: "ar" },
      ],
    });

    expect(completion).toMatchObject({ planned: 8, produced: 6, complete: false });
    expect(completion.missing).toEqual([{ format: "story", language: "ar", shortfall: 2 }]);
  });

  it("calls a fully produced set complete", () => {
    const completion = deliverableCompletion({
      plan: [{ format: "feed", language: "en", count: 2 }],
      produced: [
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
      ],
    });

    expect(completion).toMatchObject({ planned: 2, produced: 2, complete: true, missing: [] });
  });

  it("does not let a surplus in one format paper over a gap in another", () => {
    const completion = deliverableCompletion({
      plan: [
        { format: "feed", language: "en", count: 1 },
        { format: "story", language: "en", count: 1 },
      ],
      produced: [
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
      ],
    });

    expect(completion.complete).toBe(false);
    expect(completion.produced).toBe(1);
    expect(completion.missing).toEqual([{ format: "story", language: "en", shortfall: 1 }]);
  });
});

describe("a deliverable version as a whole", () => {
  it("refuses an unknown field rather than dropping it", () => {
    const parsed = campaignDeliverableVersionSchema.safeParse({
      schemaVersion: 1,
      id: VERSION,
      organizationId: ORGANIZATION,
      campaignId: CAMPAIGN,
      deliverableId: DELIVERABLE,
      version: 1,
      bundleVersionId: CAMPAIGN,
      directionKey: CAMPAIGN,
      creativeVariantId: null,
      source: {
        kind: "finished_poster",
        posterRenderId: VERSION,
        templateKey: "core.feed.square",
        templateVersion: 3,
        script: "Latn",
      },
      channel: "instagram",
      placement: "feed",
      language: "en",
      copy: { caption: "Lunch is on.", hashtags: [], callToAction: "", destinationUrl: null },
      renderInputs: renderInputs(),
      contentHash: HASH_A,
      createdAt: "2026-09-13T10:00:00.000Z",
      approved: true,
    });

    expect(parsed.success).toBe(false);
  });
});
