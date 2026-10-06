import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The gate is exercised with explicit allowlists below, so the ambient value is
// deliberately absent: a test must not pass because the environment enabled it.
vi.mock("@/lib/env", () => ({ env: { CAMPAIGNS_V1_ORGANIZATION_IDS: undefined } }));

import { bundleDigest } from "@/domain/campaigns/digest";
import { validManifest } from "@/domain/campaigns/test-manifest";
import {
  assertCampaignsEnabled,
  isCampaignsEnabled,
  parseCampaignOrganizationIds,
} from "@/modules/campaigns/application/feature-access";
import { createCampaignService } from "@/modules/campaigns/application/service";
import type { CreateCampaignRequest } from "@/modules/campaigns/application/api-schemas";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const VERSION_ID = "f0000000-0000-4000-8000-000000000001";
const OPPORTUNITY_ID = "e0000000-0000-4000-8000-000000000001";

const publish = vi.fn();
const enqueueGeneration = vi.fn();
const createBrief = vi.fn();
const createCampaign = vi.fn();
const createSourceSnapshot = vi.fn();
const readVerifiedFacts = vi.fn();
const findOpportunity = vi.fn();
const getCampaign = vi.fn();
const listVersions = vi.fn();
const getVersion = vi.fn();
const getLiveApproval = vi.fn();
const getLatestApproval = vi.fn();
const recordAttestation = vi.fn();
const approve = vi.fn();

function service(now = new Date("2026-08-15T10:00:00.000Z")) {
  return createCampaignService({
    read: {
      listCampaigns: vi.fn(),
      getCampaign,
      listVersions,
      getVersion,
      getLiveApproval,
      getLatestApproval,
      latestGenerationRun: vi.fn(async () => null),
    },
    review: { recordAttestation, approve },
    store: { createBrief, createCampaign, createSourceSnapshot },
    facts: { readVerifiedFacts, findOpportunity },
    generation: { enqueueGeneration },
    events: { publish },
    now: () => now,
  });
}

function manualRequest(overrides: Partial<CreateCampaignRequest> = {}): CreateCampaignRequest {
  return {
    source: { kind: "manual_brief" },
    title: "Weekday lunch",
    brief: {
      objective: "Increase weekday lunch covers",
      audience: "Nearby office workers",
      offer: null,
      requestedChannels: ["instagram"],
    },
    generationProfile: "brand_guided",
    idempotencyKey: "idem-key-12345678",
    ...overrides,
  } as CreateCampaignRequest;
}

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: OPPORTUNITY_ID,
    organizationId: ORGANIZATION_ID,
    status: "proposed",
    actionKey: "campaign.meta_bundle_v1",
    playbookVersionId: "a0000000-0000-4000-8000-000000000001",
    decisionRecordId: "b0000000-0000-4000-8000-000000000001",
    assertions: [{ key: "policy.access.active", expectedOutcome: "true" }],
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  for (const spy of [
    publish,
    enqueueGeneration,
    createBrief,
    createCampaign,
    createSourceSnapshot,
    readVerifiedFacts,
    findOpportunity,
    getCampaign,
    listVersions,
    getVersion,
    getLiveApproval,
    getLatestApproval,
    recordAttestation,
    approve,
  ]) {
    spy.mockReset();
  }
  createBrief.mockResolvedValue("brief-1");
  createCampaign.mockResolvedValue({ campaignId: CAMPAIGN_ID, replayed: false });
  createSourceSnapshot.mockResolvedValue("snapshot-1");
  enqueueGeneration.mockResolvedValue({ runId: "run-1" });
  readVerifiedFacts.mockResolvedValue({ facts: { currency: "AED" }, brandAssetVersionIds: [] });
  publish.mockResolvedValue(undefined);
});

describe("campaign rollout gate", () => {
  it("enables nobody when the flag is unset, because publishing spends money", () => {
    expect(parseCampaignOrganizationIds(undefined).size).toBe(0);
    expect(isCampaignsEnabled(ORGANIZATION_ID, new Set())).toBe(false);
  });

  it("enables exactly the organizations listed", () => {
    const enabled = parseCampaignOrganizationIds(`${ORGANIZATION_ID},${ACTOR_ID}`);

    expect(isCampaignsEnabled(ORGANIZATION_ID, enabled)).toBe(true);
    expect(isCampaignsEnabled("33333333-3333-4333-8333-333333333333", enabled)).toBe(false);
  });

  it("matches regardless of the casing an operator typed", () => {
    const enabled = parseCampaignOrganizationIds(ORGANIZATION_ID.toUpperCase());

    expect(isCampaignsEnabled(ORGANIZATION_ID, enabled)).toBe(true);
  });

  it("refuses a malformed allowlist rather than silently enabling a subset", () => {
    expect(() => parseCampaignOrganizationIds("not-a-uuid")).toThrow();
    expect(() => parseCampaignOrganizationIds(`${ORGANIZATION_ID},`)).toThrow();
    expect(() => parseCampaignOrganizationIds(`${ORGANIZATION_ID},${ORGANIZATION_ID}`)).toThrow();
  });

  it("throws a feature error a route maps away from a membership error", () => {
    expect(() => assertCampaignsEnabled(ORGANIZATION_ID, new Set())).toThrow(
      /not available for this organization/,
    );
  });
});

describe("createCampaignService.create", () => {
  it("creates a brief, a campaign, and a pinned snapshot for a manual entry", async () => {
    const result = await service().create(ORGANIZATION_ID, ACTOR_ID, manualRequest());

    expect(createBrief).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID }),
    );
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: "manual_brief", opportunityId: null }),
    );
    expect(createSourceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: CAMPAIGN_ID, facts: { currency: "AED" } }),
    );
    expect(result).toMatchObject({ campaignId: CAMPAIGN_ID, runId: "run-1" });
  });

  it("judges an opportunity's expiry by the injected clock, not the wall clock", async () => {
    // This was a real defect. The service is built around an injected clock and
    // the qualification step reached past it to `new Date()`, so an
    // opportunity's expiry was judged against a different "now" than every
    // timestamp the same request went on to record. Nothing caught it until a
    // fixture's expiry date arrived in real life and two unrelated tests began
    // failing. Pinned here explicitly so a calendar is never the thing that
    // notices again.
    findOpportunity.mockResolvedValue(
      opportunity({ expiresAt: new Date("2020-01-02T00:00:00.000Z") }),
    );

    await service(new Date("2020-01-01T00:00:00.000Z")).create(ORGANIZATION_ID, ACTOR_ID, {
      ...manualRequest(),
      source: { kind: "decision_opportunity", opportunityId: OPPORTUNITY_ID },
      brief: undefined,
    } as CreateCampaignRequest);

    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: "decision_opportunity" }),
    );
  });

  it("takes an opportunity campaign's intent from the opportunity, not a brief", async () => {
    findOpportunity.mockResolvedValue(opportunity());

    await service().create(ORGANIZATION_ID, ACTOR_ID, {
      ...manualRequest(),
      source: { kind: "decision_opportunity", opportunityId: OPPORTUNITY_ID },
      brief: undefined,
    } as CreateCampaignRequest);

    expect(createBrief).not.toHaveBeenCalled();
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: "decision_opportunity", briefId: null }),
    );
  });

  it("snapshots the opportunity's assertions rather than reading them later", async () => {
    findOpportunity.mockResolvedValue(opportunity());

    await service().create(ORGANIZATION_ID, ACTOR_ID, {
      ...manualRequest(),
      source: { kind: "decision_opportunity", opportunityId: OPPORTUNITY_ID },
      brief: undefined,
    } as CreateCampaignRequest);

    expect(createSourceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        assertions: [{ key: "policy.access.active", expectedOutcome: "true" }],
      }),
    );
  });

  it("refuses an opportunity from another organization", async () => {
    findOpportunity.mockResolvedValue(
      opportunity({ organizationId: "99999999-9999-4999-8999-999999999999" }),
    );

    await expect(
      service().create(ORGANIZATION_ID, ACTOR_ID, {
        ...manualRequest(),
        source: { kind: "decision_opportunity", opportunityId: OPPORTUNITY_ID },
        brief: undefined,
      } as CreateCampaignRequest),
    ).rejects.toThrow();
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("explains an expired opportunity in terms an operator can act on", async () => {
    findOpportunity.mockResolvedValue(
      opportunity({ expiresAt: new Date("2026-08-01T00:00:00.000Z") }),
    );

    await expect(
      service().create(ORGANIZATION_ID, ACTOR_ID, {
        ...manualRequest(),
        source: { kind: "decision_opportunity", opportunityId: OPPORTUNITY_ID },
        brief: undefined,
      } as CreateCampaignRequest),
    ).rejects.toThrow(/expired/i);
  });

  it("refuses an opportunity that is not a campaign recommendation", async () => {
    findOpportunity.mockResolvedValue(opportunity({ actionKey: "pricing.change_v1" }));

    await expect(
      service().create(ORGANIZATION_ID, ACTOR_ID, {
        ...manualRequest(),
        source: { kind: "decision_opportunity", opportunityId: OPPORTUNITY_ID },
        brief: undefined,
      } as CreateCampaignRequest),
    ).rejects.toThrow(/not a campaign recommendation/i);
  });

  it("does not generate inline; it queues the work and returns", async () => {
    await service().create(ORGANIZATION_ID, ACTOR_ID, manualRequest());

    expect(enqueueGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: CAMPAIGN_ID, sourceSnapshotId: "snapshot-1" }),
    );
  });

  it("carries the caller's idempotency key into the queued run", async () => {
    await service().create(ORGANIZATION_ID, ACTOR_ID, manualRequest());

    expect(enqueueGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "idem-key-12345678" }),
    );
  });

  it("reports a replayed creation rather than creating a second campaign", async () => {
    createCampaign.mockResolvedValue({ campaignId: CAMPAIGN_ID, replayed: true });

    const result = await service().create(ORGANIZATION_ID, ACTOR_ID, manualRequest());

    expect(result.replayed).toBe(true);
  });

  it("publishes an identifier-only creation event", async () => {
    await service().create(ORGANIZATION_ID, ACTOR_ID, manualRequest());

    const [event] = publish.mock.calls[0];
    expect(event).toMatchObject({
      eventName: "campaign.created",
      organizationId: ORGANIZATION_ID,
      payload: { campaignId: CAMPAIGN_ID, sourceKind: "manual_brief" },
    });
    expect(JSON.stringify(event.payload)).not.toContain("lunch");
  });
});

describe("createCampaignService.attest", () => {
  const manifest = validManifest();
  const digest = bundleDigest(manifest);

  it("records an attestation against the exact version on file", async () => {
    getVersion.mockResolvedValue({ id: VERSION_ID, campaignId: CAMPAIGN_ID, digest, manifest });
    recordAttestation.mockResolvedValue("attestation-1");

    const id = await service().attest(ORGANIZATION_ID, ACTOR_ID, {
      bundleVersionId: VERSION_ID,
      bundleDigest: digest,
      statement: "I reviewed every image.",
    });

    expect(id).toBe("attestation-1");
  });

  it("refuses when the operator's screen showed a different digest", async () => {
    getVersion.mockResolvedValue({ id: VERSION_ID, campaignId: CAMPAIGN_ID, digest, manifest });

    await expect(
      service().attest(ORGANIZATION_ID, ACTOR_ID, {
        bundleVersionId: VERSION_ID,
        bundleDigest: "b".repeat(64),
        statement: "I reviewed every image.",
      }),
    ).rejects.toThrow(/changed since you reviewed it/i);
    expect(recordAttestation).not.toHaveBeenCalled();
  });

  it("refuses when the stored digest disagrees with the stored manifest", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: CAMPAIGN_ID,
      digest: "c".repeat(64),
      manifest,
    });

    await expect(
      service().attest(ORGANIZATION_ID, ACTOR_ID, {
        bundleVersionId: VERSION_ID,
        bundleDigest: "c".repeat(64),
        statement: "I reviewed every image.",
      }),
    ).rejects.toThrow();
    expect(recordAttestation).not.toHaveBeenCalled();
  });

  it("refuses to attest a version the reader cannot see", async () => {
    getVersion.mockResolvedValue(null);

    await expect(
      service().attest(ORGANIZATION_ID, ACTOR_ID, {
        bundleVersionId: VERSION_ID,
        bundleDigest: digest,
        statement: "I reviewed every image.",
      }),
    ).rejects.toThrow();
  });
});

describe("createCampaignService.timeline", () => {
  it("reports an approval left on an earlier version as superseded", async () => {
    getCampaign.mockResolvedValue({ id: CAMPAIGN_ID, organizationId: ORGANIZATION_ID });
    listVersions.mockResolvedValue([
      { id: "f0000000-0000-4000-8000-000000000002", version: 2, digest: "b".repeat(64) },
      { id: VERSION_ID, version: 1, digest: "a".repeat(64) },
    ]);
    getLatestApproval.mockResolvedValue({
      bundleVersionId: VERSION_ID,
      bundleDigest: "a".repeat(64),
      expiresAt: "2027-01-01T00:00:00.000Z",
      revokedAt: null,
    });

    const timeline = await service().timeline(ORGANIZATION_ID, CAMPAIGN_ID);

    expect(timeline.approval?.status).toEqual({
      isApproved: false,
      reason: "version_superseded",
    });
  });

  it("reports an approval covering the latest version as valid", async () => {
    getCampaign.mockResolvedValue({ id: CAMPAIGN_ID, organizationId: ORGANIZATION_ID });
    listVersions.mockResolvedValue([{ id: VERSION_ID, version: 1, digest: "a".repeat(64) }]);
    getLatestApproval.mockResolvedValue({
      bundleVersionId: VERSION_ID,
      bundleDigest: "a".repeat(64),
      expiresAt: "2027-01-01T00:00:00.000Z",
      revokedAt: null,
    });

    const timeline = await service().timeline(ORGANIZATION_ID, CAMPAIGN_ID);

    expect(timeline.approval?.status).toEqual({ isApproved: true });
  });

  it("refuses a campaign the reader cannot see", async () => {
    getCampaign.mockResolvedValue(null);

    await expect(service().timeline(ORGANIZATION_ID, CAMPAIGN_ID)).rejects.toThrow();
  });
});
