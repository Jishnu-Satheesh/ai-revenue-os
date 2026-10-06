import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { launchDigest, type CampaignLaunchManifest } from "@/domain/campaigns/launch";
import { createLaunchRouteHandlers } from "@/modules/campaigns/application/launch-route-handlers";
import type { LaunchRouteContext } from "@/modules/campaigns/application/launch-route-handlers";
import type { CampaignLaunchService } from "@/modules/campaigns/application/launch-service";

const loggerWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: vi.fn(),
  },
}));

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const BUNDLE = "33333333-3333-4333-8333-333333333333";
const DELIVERABLE = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const ACCOUNT = "66666666-6666-4666-8666-666666666666";
const HASH = "a".repeat(64);
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
      { deliverableId: DELIVERABLE, deliverableVersionId: VERSION, contentHash: HASH },
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

const service = {
  digestFor: vi.fn(),
  approve: vi.fn(),
};

const context = vi.fn();
const publish = vi.fn();

function handlers() {
  return createLaunchRouteHandlers({
    context,
    serviceFor: () => service as unknown as CampaignLaunchService,
    publish,
  });
}

function params(extra: Record<string, string> = {}) {
  return Promise.resolve({ organizationId: ORGANIZATION, campaignId: CAMPAIGN, ...extra });
}

function post(body: unknown) {
  return new Request("https://example.test/api/launch-approvals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function approvalBody(overrides: Record<string, unknown> = {}) {
  return { manifest: manifest(), idempotencyKey: "owner-launches-11", ...overrides };
}

beforeEach(() => {
  service.digestFor.mockReset();
  service.approve.mockReset();
  context.mockReset();
  publish.mockReset();
  publish.mockResolvedValue(undefined);
  loggerWarn.mockReset();
  context.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user" },
    supabase: {},
    membership: { role: "owner" },
  } satisfies LaunchRouteContext);
  service.approve.mockResolvedValue({
    status: "saved",
    launchApprovalId: "approval",
    launchDigest: launchDigest(manifest()),
  });
});

describe("who may authorize a publication", () => {
  it("demands the publish capability, which sits above the operator line", async () => {
    await handlers().approve(post(approvalBody()), params());

    expect(context).toHaveBeenCalledWith(expect.anything(), "campaign.publish");
  });

  it("returns 403 when the capability check refuses, without reaching the service", async () => {
    context.mockRejectedValue(new DomainError("AUTHORIZATION_ERROR", "Not permitted."));

    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(403);
    expect(service.approve).not.toHaveBeenCalled();
  });
});

describe("what the terms may say", () => {
  it("refuses a manifest naming a campaign other than the one in the address", async () => {
    // Otherwise the campaign somebody reviewed on screen is not the campaign
    // they would be authorizing.
    const other = "99999999-9999-4999-8999-999999999999";
    const response = await handlers().approve(
      post(approvalBody({ manifest: manifest({ campaignId: other }) })),
      params(),
    );

    expect(response.status).toBe(400);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it("refuses a client-supplied digest, because the digest is the binding", async () => {
    const response = await handlers().approve(
      post(approvalBody({ launchDigest: DIGEST })),
      params(),
    );

    expect(response.status).toBe(400);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it("refuses a body naming its own approver", async () => {
    const response = await handlers().approve(
      post(approvalBody({ actorId: "77777777-7777-4777-8777-777777777777" })),
      params(),
    );

    expect(response.status).toBe(400);
  });

  it("refuses a free-text account handle in place of a connected account", async () => {
    const response = await handlers().approve(
      post(
        approvalBody({
          manifest: manifest({
            actions: [{ ...manifest().actions[0]!, channelAccountId: "@alnoorkitchen" }],
          }),
        }),
      ),
      params(),
    );

    expect(response.status).toBe(400);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it("refuses a launch carrying no selections at all", async () => {
    const response = await handlers().approve(
      post(approvalBody({ manifest: manifest({ selections: [] }) })),
      params(),
    );

    expect(response.status).toBe(400);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it("never lets the caller name the tenant it writes to", async () => {
    await handlers().approve(post(approvalBody()), params());

    expect(service.approve).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
  });

  it("refuses a malformed campaign id in the path", async () => {
    const response = await handlers().approve(
      post(approvalBody()),
      params({ campaignId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(service.approve).not.toHaveBeenCalled();
  });
});

describe("how an outcome reaches the client", () => {
  it("reports granted authority as 201, with the digest it is bound to", async () => {
    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      outcome: "saved",
      launchApprovalId: "approval",
      launchDigest: launchDigest(manifest()),
    });
  });

  it("reports a replay as 200, so a double-click does not look like a second authority", async () => {
    service.approve.mockResolvedValue({
      status: "replayed",
      launchApprovalId: "approval",
      launchDigest: launchDigest(manifest()),
    });

    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(200);
  });

  it("names the blocking output and its reason rather than refusing blankly", async () => {
    service.approve.mockResolvedValue({
      status: "not_admissible",
      reasonCode: "selection_not_reviewed",
      deliverableVersionId: VERSION,
    });

    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      outcome: "not_admissible",
      reasonCode: "selection_not_reviewed",
      deliverableVersionId: VERSION,
    });
  });

  it("reports conflicting terms under one key as 409", async () => {
    service.approve.mockResolvedValue({ status: "conflict" });

    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(409);
  });

  it("reports an unreachable database as 503, never as a refusal to publish", async () => {
    service.approve.mockResolvedValue({ status: "unavailable" });

    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(503);
  });
});

describe("announcing an approval", () => {
  it("announces a newly saved authority once, with identifiers only", async () => {
    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(201);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      userId: "user",
      eventName: "campaign.launch_approved",
      payload: { campaignId: CAMPAIGN, bundleVersionId: BUNDLE, launchApprovalId: "approval" },
    });
    // Identifiers travel; the manifest, its words and its money stay in the campaign.
    expect(JSON.stringify(publish.mock.calls)).not.toContain("Lunch is on.");
  });

  it("does not announce a replay, so a double-click is not a second approval", async () => {
    service.approve.mockResolvedValue({
      status: "replayed",
      launchApprovalId: "approval",
      launchDigest: launchDigest(manifest()),
    });

    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(200);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not announce a refusal", async () => {
    service.approve.mockResolvedValue({
      status: "not_admissible",
      reasonCode: "selection_not_reviewed",
      deliverableVersionId: VERSION,
    });

    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(422);
    expect(publish).not.toHaveBeenCalled();
  });

  it("still returns the saved authority when the announcement fails, and logs the loss", async () => {
    // The authority row is the record; the event is a notification about it.
    // Failing the request would report an error over work that happened, and
    // the retry would replay silently — losing the event anyway while also
    // lying about the outcome.
    publish.mockRejectedValue(new Error("event bus unavailable"));

    const response = await handlers().approve(post(approvalBody()), params());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      outcome: "saved",
      launchApprovalId: "approval",
      launchDigest: launchDigest(manifest()),
    });
    // The loss must carry the approval id: without it the warn names a
    // campaign with many authorities and reconciles nothing.
    expect(loggerWarn).toHaveBeenCalledWith("campaign.launch_approved_announcement_failed", {
      organizationId: ORGANIZATION,
      campaignId: CAMPAIGN,
      launchApprovalId: "approval",
    });
  });
});
