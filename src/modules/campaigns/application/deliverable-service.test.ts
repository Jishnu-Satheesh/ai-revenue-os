import { beforeEach, describe, expect, it, vi } from "vitest";

import { deliverableRenderDigest } from "@/domain/campaigns/deliverable";
import type { DeliverableRenderInputs } from "@/domain/campaigns/deliverable";
import {
  createDeliverableService,
  type DeliverableStore,
} from "@/modules/campaigns/application/deliverable-service";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const BUNDLE = "33333333-3333-4333-8333-333333333333";
const DIRECTION = "44444444-4444-4444-8444-444444444444";
const RENDER = "55555555-5555-4555-8555-555555555555";
const VERSION = "66666666-6666-4666-8666-666666666666";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function renderInputs(overrides: Partial<DeliverableRenderInputs> = {}): DeliverableRenderInputs {
  return {
    plateContentHash: HASH_A,
    templateVersion: 3,
    script: "Latn",
    slotValues: { headline: "Weekday lunch" },
    freeLine: null,
    brandMarkVersionId: null,
    fontManifestVersion: "2026.09.1",
    renderEngineVersion: "resvg-0.44",
    ...overrides,
  };
}

function recordRequest() {
  return {
    campaignId: CAMPAIGN,
    bundleVersionId: BUNDLE,
    directionKey: DIRECTION,
    channel: "instagram",
    placement: "feed",
    language: "en",
    format: "feed",
    source: {
      kind: "finished_poster" as const,
      posterRenderId: RENDER,
      templateKey: "core.feed.square",
      templateVersion: 3,
      script: "Latn",
    },
    copy: { caption: "Lunch is on.", hashtags: [], callToAction: "", destinationUrl: null },
    renderInputs: renderInputs(),
    contentHash: HASH_A,
  };
}

const store = {
  recordVersion: vi.fn(),
  reviewVersion: vi.fn(),
  readVersionForPublication: vi.fn(),
};

function service() {
  return createDeliverableService({ store: store as unknown as DeliverableStore });
}

beforeEach(() => {
  Object.values(store).forEach((fn) => fn.mockReset());
  store.recordVersion.mockResolvedValue({
    deliverableId: "deliverable",
    deliverableVersionId: VERSION,
    version: 1,
    outcome: "saved",
  });
  store.reviewVersion.mockResolvedValue({ reviewId: "review", outcome: "saved" });
});

describe("recording a finished output", () => {
  it("computes the render digest itself rather than trusting the caller", async () => {
    await service().recordVersion({ organizationId: ORGANIZATION, request: recordRequest() });

    expect(store.recordVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          render_digest: deliverableRenderDigest(renderInputs()),
        }),
      }),
    );
  });

  it("sends a poster render id for a composed poster and no final asset", async () => {
    await service().recordVersion({ organizationId: ORGANIZATION, request: recordRequest() });

    const payload = store.recordVersion.mock.calls[0]?.[0].payload;
    expect(payload.poster_render_id).toBe(RENDER);
    expect(payload.final_asset_id).toBeNull();
  });

  it("refuses a source that is a plate with no explicit final choice", async () => {
    await expect(
      service().recordVersion({
        organizationId: ORGANIZATION,
        request: {
          ...recordRequest(),
          source: { kind: "final_image", assetId: RENDER } as never,
        },
      }),
    ).rejects.toThrow();
  });

  it("reports a replay as a replay, so a retry does not look like a second output", async () => {
    store.recordVersion.mockResolvedValue({
      deliverableId: "deliverable",
      deliverableVersionId: VERSION,
      version: 1,
      outcome: "replayed",
    });

    const outcome = await service().recordVersion({
      organizationId: ORGANIZATION,
      request: recordRequest(),
    });

    expect(outcome.status).toBe("replayed");
  });

  it("never lets the caller name its own tenant", async () => {
    await service().recordVersion({ organizationId: ORGANIZATION, request: recordRequest() });

    expect(store.recordVersion).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
  });
});

describe("reviewing a finished output", () => {
  it("refuses a rejection carrying no reason", async () => {
    const outcome = await service().reviewVersion({
      organizationId: ORGANIZATION,
      request: {
        deliverableVersionId: VERSION,
        contentHash: HASH_A,
        decision: "rejected",
        idempotencyKey: "reject-silently-11",
      },
    });

    expect(outcome).toEqual({ status: "needs_input", reasonCode: "rejection_requires_reason" });
    expect(store.reviewVersion).not.toHaveBeenCalled();
  });

  it("accepts a rejection that says why", async () => {
    const outcome = await service().reviewVersion({
      organizationId: ORGANIZATION,
      request: {
        deliverableVersionId: VERSION,
        contentHash: HASH_A,
        decision: "rejected",
        reasonCodes: ["text_incorrect"],
        idempotencyKey: "reject-with-reason-11",
      },
    });

    expect(outcome.status).toBe("saved");
  });

  it("reports a changed hash as content_changed, not as a generic failure", async () => {
    store.reviewVersion.mockRejectedValue({ kind: "content_changed" });

    const outcome = await service().reviewVersion({
      organizationId: ORGANIZATION,
      request: {
        deliverableVersionId: VERSION,
        contentHash: HASH_B,
        decision: "approved",
        idempotencyKey: "moved-bytes-11",
      },
    });

    expect(outcome).toEqual({ status: "content_changed" });
  });

  it("reports a superseded version distinctly, so the interface can say why", async () => {
    store.reviewVersion.mockRejectedValue({ kind: "superseded" });

    const outcome = await service().reviewVersion({
      organizationId: ORGANIZATION,
      request: {
        deliverableVersionId: VERSION,
        contentHash: HASH_A,
        decision: "approved",
        idempotencyKey: "stale-version-11",
      },
    });

    expect(outcome).toEqual({ status: "superseded" });
  });

  it("answers 'not visible' the same way as 'not permitted'", async () => {
    store.reviewVersion.mockRejectedValue({ kind: "not_found" });

    const outcome = await service().reviewVersion({
      organizationId: ORGANIZATION,
      request: {
        deliverableVersionId: VERSION,
        contentHash: HASH_A,
        decision: "approved",
        idempotencyKey: "foreign-version-11",
      },
    });

    expect(outcome).toEqual({ status: "forbidden" });
  });
});

describe("whether an output may be published", () => {
  it("refuses when the version cannot be found at all", async () => {
    store.readVersionForPublication.mockResolvedValue(null);

    await expect(
      service().publicationEligibility({
        organizationId: ORGANIZATION,
        deliverableVersionId: VERSION,
      }),
    ).resolves.toEqual({ publishable: false, reasonCode: "never_reviewed" });
  });

  it("refuses an output whose bytes moved after approval", async () => {
    store.readVersionForPublication.mockResolvedValue({
      version: { id: VERSION, contentHash: HASH_A, version: 2 },
      currentVersion: 2,
      reviews: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          organizationId: ORGANIZATION,
          deliverableId: "88888888-8888-4888-8888-888888888888",
          deliverableVersionId: VERSION,
          contentHash: HASH_B,
          actorId: "99999999-9999-4999-8999-999999999999",
          decision: "approved",
          reasonCodes: [],
          note: null,
          reviewedAt: "2026-09-13T10:00:00.000Z",
        },
      ],
    });

    await expect(
      service().publicationEligibility({
        organizationId: ORGANIZATION,
        deliverableVersionId: VERSION,
      }),
    ).resolves.toEqual({ publishable: false, reasonCode: "reviewed_different_content" });
  });

  it("allows an output whose exact bytes were approved", async () => {
    store.readVersionForPublication.mockResolvedValue({
      version: { id: VERSION, contentHash: HASH_A, version: 2 },
      currentVersion: 2,
      reviews: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          organizationId: ORGANIZATION,
          deliverableId: "88888888-8888-4888-8888-888888888888",
          deliverableVersionId: VERSION,
          contentHash: HASH_A,
          actorId: "99999999-9999-4999-8999-999999999999",
          decision: "approved",
          reasonCodes: [],
          note: null,
          reviewedAt: "2026-09-13T10:00:00.000Z",
        },
      ],
    });

    await expect(
      service().publicationEligibility({
        organizationId: ORGANIZATION,
        deliverableVersionId: VERSION,
      }),
    ).resolves.toMatchObject({ publishable: true });
  });
});

describe("reporting completion", () => {
  it("never shrinks the plan to match what was produced", () => {
    const completion = service().completion({
      plan: [{ format: "feed", language: "en", count: 4 }],
      produced: [
        { format: "feed", language: "en" },
        { format: "feed", language: "en" },
      ],
    });

    expect(completion).toMatchObject({ planned: 4, produced: 2, complete: false });
    expect(completion.missing).toEqual([{ format: "feed", language: "en", shortfall: 2 }]);
  });
});
