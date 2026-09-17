import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CampaignDeliverableReview } from "@/domain/campaigns/deliverable";
import { launchDigest, type CampaignLaunchManifest } from "@/domain/campaigns/launch";
import {
  createLaunchService,
  launchOutcomeStatus,
  type LaunchStore,
} from "@/modules/campaigns/application/launch-service";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const BUNDLE = "33333333-3333-4333-8333-333333333333";
const DELIVERABLE = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const ACCOUNT = "66666666-6666-4666-8666-666666666666";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function manifest(overrides: Partial<CampaignLaunchManifest> = {}): CampaignLaunchManifest {
  return {
    schemaVersion: 1,
    campaignId: CAMPAIGN,
    bundleVersionId: BUNDLE,
    bundleDigest: "c".repeat(64),
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
        hashtags: [],
        callToAction: "",
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

function approvedState(contentHash = HASH_A) {
  const review: CampaignDeliverableReview = {
    id: "77777777-7777-4777-8777-777777777777",
    organizationId: ORGANIZATION,
    deliverableId: DELIVERABLE,
    deliverableVersionId: VERSION,
    contentHash,
    actorId: "88888888-8888-4888-8888-888888888888",
    decision: "approved",
    reasonCodes: [],
    note: null,
    reviewedAt: "2026-09-13T10:00:00.000Z",
  };
  return new Map([
    [
      VERSION,
      {
        version: { id: VERSION, contentHash, version: 1 },
        currentVersion: 1,
        reviews: [review],
      },
    ],
  ]);
}

const store = { readReviewState: vi.fn(), approveLaunch: vi.fn() };

function service() {
  return createLaunchService({ store: store as unknown as LaunchStore });
}

beforeEach(() => {
  store.readReviewState.mockReset();
  store.approveLaunch.mockReset();
  store.readReviewState.mockResolvedValue(approvedState());
  store.approveLaunch.mockResolvedValue({ launchApprovalId: "launch", outcome: "saved" });
});

describe("authorizing a publication", () => {
  it("computes the digest from the manifest rather than trusting one supplied", async () => {
    await service().approve({
      organizationId: ORGANIZATION,
      request: { manifest: manifest(), idempotencyKey: "owner-launches-11" },
    });

    expect(store.approveLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ launch_digest: launchDigest(manifest()) }),
      }),
    );
  });

  it("refuses before reaching the database when an output was never reviewed", async () => {
    store.readReviewState.mockResolvedValue(new Map());

    const outcome = await service().approve({
      organizationId: ORGANIZATION,
      request: { manifest: manifest(), idempotencyKey: "unreviewed-11" },
    });

    expect(outcome).toMatchObject({
      status: "not_admissible",
      reasonCode: "selection_not_reviewed",
      deliverableVersionId: VERSION,
    });
    expect(launchOutcomeStatus(outcome)).toBe(422);
    expect(store.approveLaunch).not.toHaveBeenCalled();
  });

  it("names the exact output blocking the launch, so the interface can point at it", async () => {
    store.readReviewState.mockResolvedValue(approvedState(HASH_B));

    const outcome = await service().approve({
      organizationId: ORGANIZATION,
      request: { manifest: manifest(), idempotencyKey: "moved-bytes-11" },
    });

    expect(outcome).toMatchObject({
      status: "not_admissible",
      reasonCode: "selection_content_changed",
      deliverableVersionId: VERSION,
    });
  });

  it("refuses a selection whose output has a newer version, so a stale approval cannot launch", async () => {
    // A later variant invalidates: the reviewed bytes are no longer the live
    // output, and launching them would publish something already replaced.
    const state = approvedState();
    const entry = state.get(VERSION)!;
    state.set(VERSION, { ...entry, currentVersion: entry.currentVersion + 1 });
    store.readReviewState.mockResolvedValue(state);

    const outcome = await service().approve({
      organizationId: ORGANIZATION,
      request: { manifest: manifest(), idempotencyKey: "stale-digest-11" },
    });

    expect(outcome).toMatchObject({
      status: "not_admissible",
      reasonCode: "selection_superseded",
      deliverableVersionId: VERSION,
    });
    expect(store.approveLaunch).not.toHaveBeenCalled();
  });

  it("refuses a selection from another tenant, which reads as unreviewed here", async () => {
    // The review read is scoped to this tenant, so another tenant's output is
    // simply absent from it. A guessed id from elsewhere can never authorize.
    const foreign = "99999999-9999-4999-8999-999999999999";
    store.readReviewState.mockResolvedValue(new Map());

    const outcome = await service().approve({
      organizationId: ORGANIZATION,
      request: {
        manifest: manifest({
          selections: [{ deliverableId: DELIVERABLE, deliverableVersionId: foreign, contentHash: HASH_A }],
          actions: [{ ...manifest().actions[0]!, deliverableVersionId: foreign }],
        }),
        idempotencyKey: "foreign-output-11",
      },
    });

    expect(outcome).toMatchObject({
      status: "not_admissible",
      reasonCode: "selection_not_reviewed",
      deliverableVersionId: foreign,
    });
    expect(store.approveLaunch).not.toHaveBeenCalled();
  });

  it("reports a replay as a replay, so a double click does not read as two launches", async () => {
    store.approveLaunch.mockResolvedValue({ launchApprovalId: "launch", outcome: "replayed" });

    const outcome = await service().approve({
      organizationId: ORGANIZATION,
      request: { manifest: manifest(), idempotencyKey: "owner-launches-11" },
    });

    expect(outcome.status).toBe("replayed");
    expect(launchOutcomeStatus(outcome)).toBe(200);
  });

  it("maps a database conflict to 409 rather than a server fault", async () => {
    store.approveLaunch.mockRejectedValue({ kind: "conflict" });

    const outcome = await service().approve({
      organizationId: ORGANIZATION,
      request: { manifest: manifest(), idempotencyKey: "conflicting-11" },
    });

    expect(launchOutcomeStatus(outcome)).toBe(409);
  });

  it("never lets a request body name its own tenant", async () => {
    await service().approve({
      organizationId: ORGANIZATION,
      request: { manifest: manifest(), idempotencyKey: "owner-launches-11" },
    });

    expect(store.approveLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
    const sent = JSON.stringify(store.approveLaunch.mock.calls[0]?.[0].payload);
    expect(sent).not.toContain("actor");
  });

  it("refuses a manifest whose scheduled set differs from its reviewed set", async () => {
    const stray = "99999999-9999-4999-8999-999999999999";
    const outcome = await service().approve({
      organizationId: ORGANIZATION,
      request: {
        manifest: manifest({
          actions: [
            manifest().actions[0]!,
            { ...manifest().actions[0]!, deliverableVersionId: stray },
          ],
        }),
        idempotencyKey: "mixed-sets-11",
      },
    });

    expect(outcome).toMatchObject({
      status: "not_admissible",
      reasonCode: "action_without_selection",
    });
    expect(store.approveLaunch).not.toHaveBeenCalled();
  });
});
