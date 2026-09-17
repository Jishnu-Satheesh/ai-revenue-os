import { describe, expect, it } from "vitest";

import {
  POSTER_DELIVERABLE_ORDINAL,
  resolvePosterDeliverableIdentity,
  PosterDeliverableIdentityError,
  type PosterDeliverableIdentityReason,
} from "@/domain/campaigns/deliverable-identity";
import type { CampaignPosterPlan } from "@/domain/campaigns/schemas";

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
