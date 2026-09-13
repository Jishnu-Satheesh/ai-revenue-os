import { describe, expect, it } from "vitest";

import type { CampaignDeliverableReview } from "@/domain/campaigns/deliverable";
import {
  admitLaunch,
  campaignLaunchManifestSchema,
  launchDigest,
  launchTermsChanged,
  type CampaignLaunchManifest,
} from "@/domain/campaigns/launch";

const CAMPAIGN = "11111111-1111-4111-8111-111111111111";
const BUNDLE = "22222222-2222-4222-8222-222222222222";
const DELIVERABLE = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const ACCOUNT = "55555555-5555-4555-8555-555555555555";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const DIGEST = "c".repeat(64);

function manifest(overrides: Partial<CampaignLaunchManifest> = {}): CampaignLaunchManifest {
  return {
    schemaVersion: 1,
    campaignId: CAMPAIGN,
    bundleVersionId: BUNDLE,
    bundleDigest: DIGEST,
    proposalVersionId: null,
    proposalDigest: null,
    selections: [
      { deliverableId: DELIVERABLE, deliverableVersionId: VERSION, contentHash: HASH_A },
    ],
    actions: [
      {
        deliverableVersionId: VERSION,
        channel: "instagram",
        placement: "feed",
        script: "Latn",
        channelAccountId: ACCOUNT,
        caption: "Lunch is on.",
        hashtags: ["#lunch"],
        callToAction: "Book a table",
        destinationUrl: null,
        scheduledAt: "2026-09-20T09:00:00.000Z",
        timezone: "Asia/Dubai",
        budget: null,
        expiresAt: null,
        pausePolicyRef: "default_pause_policy",
      },
    ],
    assertions: [],
    offerRef: null,
    measurementPrerequisites: [],
    ...overrides,
  };
}

function review(overrides: Partial<CampaignDeliverableReview> = {}): CampaignDeliverableReview {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    organizationId: CAMPAIGN,
    deliverableId: DELIVERABLE,
    deliverableVersionId: VERSION,
    contentHash: HASH_A,
    actorId: "77777777-7777-4777-8777-777777777777",
    decision: "approved",
    reasonCodes: [],
    note: null,
    reviewedAt: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

function reviewState(
  overrides: {
    contentHash?: string;
    version?: number;
    currentVersion?: number;
    reviews?: readonly CampaignDeliverableReview[];
  } = {},
) {
  return new Map([
    [
      VERSION,
      {
        version: {
          id: VERSION,
          contentHash: overrides.contentHash ?? HASH_A,
          version: overrides.version ?? 1,
        },
        currentVersion: overrides.currentVersion ?? 1,
        reviews: overrides.reviews ?? [review()],
      },
    ],
  ]);
}

describe("the launch digest", () => {
  it("covers the words, so changing a caption produces different authority", () => {
    const changed = manifest({
      actions: [{ ...manifest().actions[0]!, caption: "Lunch is on, until 4pm." }],
    });

    expect(launchTermsChanged(manifest(), changed)).toBe(true);
  });

  it("covers the destination account, so a post cannot be redirected quietly", () => {
    const changed = manifest({
      actions: [
        { ...manifest().actions[0]!, channelAccountId: "88888888-8888-4888-8888-888888888888" },
      ],
    });

    expect(launchTermsChanged(manifest(), changed)).toBe(true);
  });

  it("covers the schedule and the budget", () => {
    expect(
      launchTermsChanged(
        manifest(),
        manifest({
          actions: [{ ...manifest().actions[0]!, scheduledAt: "2026-09-21T09:00:00.000Z" }],
        }),
      ),
    ).toBe(true);

    expect(
      launchTermsChanged(
        manifest(),
        manifest({
          actions: [
            {
              ...manifest().actions[0]!,
              budget: { amountMinor: 50000, currency: "AED" },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("is stable for the same terms, so a replay matches its own record", () => {
    expect(launchDigest(manifest())).toBe(launchDigest(manifest()));
  });

  it("refuses a manifest carrying an unexpected field", () => {
    const parsed = campaignLaunchManifestSchema.safeParse({ ...manifest(), approved: true });

    expect(parsed.success).toBe(false);
  });

  it("will not accept a free-text account handle in place of a connected account", () => {
    const parsed = campaignLaunchManifestSchema.safeParse({
      ...manifest(),
      actions: [{ ...manifest().actions[0]!, channelAccountId: "@alnoorkitchen" }],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("what may be launched", () => {
  it("admits a set whose every output was approved at its current bytes", () => {
    expect(admitLaunch({ manifest: manifest(), reviewState: reviewState() })).toEqual({
      outcome: "admissible",
    });
  });

  it("refuses an output nobody reviewed", () => {
    expect(admitLaunch({ manifest: manifest(), reviewState: reviewState({ reviews: [] }) })).toEqual(
      {
        outcome: "refused",
        reasonCode: "selection_not_reviewed",
        deliverableVersionId: VERSION,
      },
    );
  });

  it("refuses when the selection names bytes the output no longer has", () => {
    // The launch was assembled before a re-render and submitted after it.
    const outcome = admitLaunch({
      manifest: manifest(),
      reviewState: reviewState({ contentHash: HASH_B }),
    });

    expect(outcome).toEqual({
      outcome: "refused",
      reasonCode: "selection_content_changed",
      deliverableVersionId: VERSION,
    });
  });

  it("refuses an output a newer version has superseded", () => {
    const outcome = admitLaunch({
      manifest: manifest(),
      reviewState: reviewState({ version: 1, currentVersion: 2 }),
    });

    expect(outcome).toEqual({
      outcome: "refused",
      reasonCode: "selection_superseded",
      deliverableVersionId: VERSION,
    });
  });

  it("refuses an output that was rejected", () => {
    const outcome = admitLaunch({
      manifest: manifest(),
      reviewState: reviewState({
        reviews: [review({ decision: "rejected", reasonCodes: ["text_incorrect"] })],
      }),
    });

    expect(outcome).toEqual({
      outcome: "refused",
      reasonCode: "selection_rejected",
      deliverableVersionId: VERSION,
    });
  });

  it("refuses an unreviewed later variant even though its family was approved", () => {
    // The generation cap authorized MAKING this variant. It authorizes nothing
    // about publishing it: D05 wants each finished output reviewed on its own.
    const variant = "99999999-9999-4999-8999-999999999999";
    const outcome = admitLaunch({
      manifest: manifest({
        selections: [
          { deliverableId: DELIVERABLE, deliverableVersionId: variant, contentHash: HASH_B },
        ],
        actions: [{ ...manifest().actions[0]!, deliverableVersionId: variant }],
      }),
      reviewState: new Map([
        [
          variant,
          {
            version: { id: variant, contentHash: HASH_B, version: 2 },
            currentVersion: 2,
            reviews: [],
          },
        ],
      ]),
    });

    expect(outcome).toMatchObject({
      outcome: "refused",
      reasonCode: "selection_not_reviewed",
    });
  });
});

describe("the reviewed set and the scheduled set must be the same set", () => {
  it("refuses an action for an output nobody selected", () => {
    const stray = "99999999-9999-4999-8999-999999999999";
    const outcome = admitLaunch({
      manifest: manifest({
        actions: [
          manifest().actions[0]!,
          { ...manifest().actions[0]!, deliverableVersionId: stray },
        ],
      }),
      reviewState: reviewState(),
    });

    expect(outcome).toEqual({
      outcome: "refused",
      reasonCode: "action_without_selection",
      deliverableVersionId: stray,
    });
  });

  it("refuses a selected output that nothing would actually publish", () => {
    const extra = "99999999-9999-4999-8999-999999999999";
    const outcome = admitLaunch({
      manifest: manifest({
        selections: [
          manifest().selections[0]!,
          { deliverableId: DELIVERABLE, deliverableVersionId: extra, contentHash: HASH_B },
        ],
      }),
      reviewState: reviewState(),
    });

    expect(outcome).toEqual({
      outcome: "refused",
      reasonCode: "selection_without_action",
      deliverableVersionId: extra,
    });
  });

  it("refuses the same output selected twice", () => {
    const outcome = admitLaunch({
      manifest: manifest({
        selections: [manifest().selections[0]!, manifest().selections[0]!],
      }),
      reviewState: reviewState(),
    });

    expect(outcome).toEqual({
      outcome: "refused",
      reasonCode: "duplicate_selection",
      deliverableVersionId: null,
    });
  });
});
