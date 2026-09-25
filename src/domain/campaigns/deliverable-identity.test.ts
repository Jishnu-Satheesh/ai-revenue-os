import { describe, expect, it } from "vitest";

import {
  deliverableRenderDigest,
  type StudioFullPosterRenderInputs,
} from "@/domain/campaigns/deliverable";
import {
  POSTER_DELIVERABLE_ORDINAL,
  resolvePosterDeliverableIdentity,
  PosterDeliverableIdentityError,
  type PosterDeliverableIdentityReason,
} from "@/domain/campaigns/deliverable-identity";
import type { CampaignPosterPlan } from "@/domain/campaigns/schemas";

const STUDIO_VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDIO_EXPORT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STUDIO_PROFILE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HASH_A = "a".repeat(64);

function plan(): CampaignPosterPlan {
  return {
    placements: [
      { placement: "feed_image", templateKey: "core_feed_headline", templateVersion: 1 },
      { placement: "image_story", templateKey: "core_story_stack", templateVersion: 2 },
    ],
    scripts: ["Latn", "Mlym"],
  };
}

function reasonFor(fn: () => unknown): PosterDeliverableIdentityReason | null {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PosterDeliverableIdentityError);
    return (error as PosterDeliverableIdentityError).reason;
  }
  return null;
}

describe("resolvePosterDeliverableIdentity", () => {
  it("resolves the plan's own placement, the script's language and the short format", () => {
    expect(
      resolvePosterDeliverableIdentity({
        posterPlan: plan(),
        templateKey: "core_feed_headline",
        templateVersion: 1,
        script: "Latn",
      }),
    ).toEqual({
      placement: "feed_image",
      language: "en",
      format: "feed",
      ordinal: POSTER_DELIVERABLE_ORDINAL,
    });
  });

  it("maps each renderable script and placement through the closed vocabularies", () => {
    expect(
      resolvePosterDeliverableIdentity({
        posterPlan: { ...plan(), scripts: ["Mlym", "Arab"] },
        templateKey: "core_story_stack",
        templateVersion: 2,
        script: "Arab",
      }),
    ).toEqual({
      placement: "image_story",
      language: "ar",
      format: "story",
      ordinal: POSTER_DELIVERABLE_ORDINAL,
    });
  });

  it("pins the template version, not just the key", () => {
    expect(
      reasonFor(() =>
        resolvePosterDeliverableIdentity({
          posterPlan: plan(),
          templateKey: "core_feed_headline",
          templateVersion: 2,
          script: "Latn",
        }),
      ),
    ).toBe("template_not_in_poster_plan");
  });

  it("refuses a template the plan never named, rather than filing under a neighbour", () => {
    expect(
      reasonFor(() =>
        resolvePosterDeliverableIdentity({
          posterPlan: plan(),
          templateKey: "retired_banner",
          templateVersion: 1,
          script: "Latn",
        }),
      ),
    ).toBe("template_not_in_poster_plan");
  });

  it("refuses a script the plan does not list", () => {
    expect(
      reasonFor(() =>
        resolvePosterDeliverableIdentity({
          posterPlan: plan(),
          templateKey: "core_feed_headline",
          templateVersion: 1,
          script: "Arab",
        }),
      ),
    ).toBe("script_not_in_poster_plan");
  });

  it("refuses a version with no poster plan at all", () => {
    expect(
      reasonFor(() =>
        resolvePosterDeliverableIdentity({
          posterPlan: undefined,
          templateKey: "core_feed_headline",
          templateVersion: 1,
          script: "Latn",
        }),
      ),
    ).toBe("poster_plan_missing");
  });
});

describe("studio export identity", () => {
  function studioInputs(exportId: string | null): StudioFullPosterRenderInputs {
    return {
      schemaVersion: 2,
      kind: "studio_full_poster",
      studioVersionId: STUDIO_VERSION,
      studioExportId: exportId,
      contentHash: HASH_A,
      inputDigest: "e".repeat(64),
      providerProfileId: STUDIO_PROFILE,
      textCopyDigest: "f".repeat(64),
      channelLogoSubstitutionDigest: "0".repeat(64),
      referenceManifestDigest: "1".repeat(64),
      exportTransformDigest: null,
    };
  }

  it("treats the native bytes and a transformed export as different identities", () => {
    expect(deliverableRenderDigest(studioInputs(null))).not.toBe(
      deliverableRenderDigest(studioInputs(STUDIO_EXPORT)),
    );
  });

  it("keeps each export identity stable across identical reads", () => {
    expect(deliverableRenderDigest(studioInputs(STUDIO_EXPORT))).toBe(
      deliverableRenderDigest(studioInputs(STUDIO_EXPORT)),
    );
  });

  it("leaves legacy poster identity resolution untouched by studio inputs", () => {
    // Studio selections resolve through resolveDeliverableSource, never through
    // the compositor plan — the plan path still refuses what it always refused.
    expect(
      reasonFor(() =>
        resolvePosterDeliverableIdentity({
          posterPlan: plan(),
          templateKey: "core_feed_headline",
          templateVersion: 1,
          script: "Arab",
        }),
      ),
    ).toBe("script_not_in_poster_plan");
  });
});
