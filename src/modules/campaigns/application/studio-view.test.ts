import { describe, expect, it } from "vitest";

import {
  toCampaignListItem,
  toStudioView,
  type StudioViewInput,
} from "@/modules/campaigns/application/studio-view";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";
import type {
  BundleVersionDetail,
  BundleVersionSummary,
  CampaignApproval,
  CampaignSummary,
} from "@/modules/campaigns/application/ports";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = manifestIds.campaign;
const VERSION_ID = "d1000000-0000-4000-8000-000000000001";
const NOW = "2026-08-15T12:00:00";

const campaign: CampaignSummary = {
  id: CAMPAIGN_ID,
  organizationId: ORGANIZATION_ID,
  title: "Weekday evening demand lift",
  sourceKind: "decision_opportunity",
  briefId: null,
  opportunityId: "e1000000-0000-4000-8000-000000000001",
  state: "ready_for_review",
  createdAt: "2026-08-14T09:00:00",
  updatedAt: "2026-08-15T09:30:00",
};

function versionDetail(overrides: Partial<BundleVersionDetail> = {}): BundleVersionDetail {
  const manifest = validManifest();
  return {
    id: VERSION_ID,
    campaignId: CAMPAIGN_ID,
    version: 1,
    parentVersionId: null,
    sourceSnapshotId: "a1000000-0000-4000-8000-000000000001",
    digest: "a".repeat(64),
    generationProfile: manifest.generationProfile,
    executionMode: manifest.executionMode,
    createdAt: "2026-08-15T09:30:00",
    manifest,
    ...overrides,
  };
}

function summaryOf(detail: BundleVersionDetail): BundleVersionSummary {
  const { manifest: _manifest, ...summary } = detail;
  return summary;
}

function approvalFor(
  detail: BundleVersionDetail,
  overrides: Partial<CampaignApproval> = {},
): CampaignApproval {
  return {
    id: "b1000000-0000-4000-8000-000000000001",
    campaignId: CAMPAIGN_ID,
    bundleVersionId: detail.id,
    bundleDigest: detail.digest,
    approvedBy: "f1000000-0000-4000-8000-000000000001",
    approvedAt: "2026-08-15T10:00:00",
    expiresAt: "2026-08-16T10:00:00",
    actionKeys: detail.manifest.actions.map((action) => action.id),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

function studioInput(overrides: Partial<StudioViewInput> = {}): StudioViewInput {
  const detail = versionDetail();
  return {
    campaign,
    versions: [summaryOf(detail)],
    version: detail,
    approval: null,
    now: NOW,
    ...overrides,
  };
}

describe("the portfolio list never invents what a campaign has not produced", () => {
  it("reports a campaign with no version as awaiting its first, not as empty facts", () => {
    const item = toCampaignListItem(campaign, null);

    expect(item).toMatchObject({
      awaitingFirstVersion: true,
      version: null,
      objective: null,
      spendCeiling: null,
    });
    expect(item.channels).toEqual([]);
  });

  it("reads objective, channels and spend from the version rather than the campaign row", () => {
    const detail = versionDetail();
    const item = toCampaignListItem(campaign, detail);

    expect(item.awaitingFirstVersion).toBe(false);
    expect(item.objective).toBe(detail.manifest.objective);
    expect(item.version).toBe(1);
    expect(item.spendCeiling).toEqual(detail.manifest.totalSpendCeiling);
  });

  it("lists each channel once even when several actions target it", () => {
    const detail = versionDetail();
    const channels = new Set(detail.manifest.actions.map((action) => action.channel));

    expect(toCampaignListItem(campaign, detail).channels).toEqual([...channels].sort());
  });

  it("keeps a null spend ceiling null, because no paid action is not zero spend", () => {
    const detail = versionDetail();
    detail.manifest.totalSpendCeiling = null;

    expect(toCampaignListItem(campaign, detail).spendCeiling).toBeNull();
  });

  it("carries the real campaign state through rather than collapsing it to a demo lifecycle", () => {
    const measuring = toCampaignListItem({ ...campaign, state: "measuring" }, null);

    expect(measuring.state).toBe("measuring");
  });
});

describe("the studio binds approval to the exact version on screen", () => {
  it("reports no approval when none exists", () => {
    expect(toStudioView(studioInput()).approval).toMatchObject({ status: "none" });
  });

  it("accepts an approval that covers this version and digest", () => {
    const detail = versionDetail();

    const view = toStudioView(
      studioInput({
        version: detail,
        versions: [summaryOf(detail)],
        approval: approvalFor(detail),
      }),
    );

    expect(view.approval).toMatchObject({ status: "live" });
  });

  it("refuses an approval whose digest no longer matches the version it names", () => {
    const detail = versionDetail();
    const stale = approvalFor(detail, { bundleDigest: "b".repeat(64) });

    expect(toStudioView(studioInput({ version: detail, approval: stale })).approval).toMatchObject({
      status: "digest_mismatch",
    });
  });

  it("reports an approval left behind by a newer version as superseded", () => {
    const first = versionDetail();
    const second = versionDetail({
      id: "d1000000-0000-4000-8000-000000000002",
      version: 2,
      parentVersionId: first.id,
      digest: "c".repeat(64),
    });

    const view = toStudioView(
      studioInput({
        version: second,
        versions: [summaryOf(second), summaryOf(first)],
        approval: approvalFor(first),
      }),
    );

    expect(view.approval).toMatchObject({ status: "superseded" });
  });

  it("reports an expired approval as expired rather than live", () => {
    const detail = versionDetail();
    const expired = approvalFor(detail, { expiresAt: "2026-08-15T11:00:00" });

    expect(
      toStudioView(studioInput({ version: detail, approval: expired })).approval,
    ).toMatchObject({
      status: "expired",
    });
  });

  it("reports a revoked approval as revoked and keeps its reason", () => {
    const detail = versionDetail();
    const revoked = approvalFor(detail, {
      revokedAt: "2026-08-15T11:00:00",
      revokedReason: "capability_lost",
    });

    expect(
      toStudioView(studioInput({ version: detail, approval: revoked })).approval,
    ).toMatchObject({
      status: "revoked",
      revokedReason: "capability_lost",
    });
  });
});

describe("the studio presents the three directions as the contract requires", () => {
  it("exposes exactly one control, evidence-led and experimental direction", () => {
    const view = toStudioView(studioInput());

    expect(view.directions.map((direction) => direction.kind).sort()).toEqual([
      "control",
      "evidence_led",
      "experimental",
    ]);
  });

  it("keeps every direction's copy, hashtags and call to action addressable", () => {
    const view = toStudioView(studioInput());

    for (const direction of view.directions) {
      expect(direction.copy.length).toBeGreaterThan(0);
      expect(direction.hashtagSets.length).toBeGreaterThan(0);
    }
  });

  it("marks the experimental direction's declared experiment and leaves the others without one", () => {
    const view = toStudioView(studioInput());
    const experimental = view.directions.find((direction) => direction.kind === "experimental");
    const control = view.directions.find((direction) => direction.kind === "control");

    expect(experimental?.experiment).not.toBeNull();
    expect(control?.experiment).toBeNull();
  });

  it("attaches each direction's assets by id rather than by position", () => {
    const view = toStudioView(studioInput());

    for (const direction of view.directions) {
      expect(direction.assets.length).toBeGreaterThan(0);
      for (const asset of direction.assets) {
        expect(direction.assetIds).toContain(asset.id);
      }
    }
  });
});

describe("the studio shows measurement as a plan, never as a result", () => {
  it("carries the preregistered plan without a verdict", () => {
    const view = toStudioView(studioInput());

    expect(view.measurement).toMatchObject({
      attributionMethod: expect.any(String),
      outcomeWindowDays: expect.any(Number),
    });
    expect(view.measurement).not.toHaveProperty("result");
    expect(view.measurement).not.toHaveProperty("verdict");
  });
});

describe("the studio exposes the digest the operator would be approving", () => {
  it("shows the stored digest so attestation can be bound to it", () => {
    const detail = versionDetail();

    expect(toStudioView(studioInput({ version: detail })).digest).toBe(detail.digest);
  });

  it("reports the version chain newest first", () => {
    const first = versionDetail();
    const second = versionDetail({
      id: "d1000000-0000-4000-8000-000000000002",
      version: 2,
      parentVersionId: first.id,
    });

    const view = toStudioView(
      studioInput({ version: second, versions: [summaryOf(second), summaryOf(first)] }),
    );

    expect(view.versions.map((entry) => entry.version)).toEqual([2, 1]);
  });
});

describe("channel readiness on the view", () => {
  it("keeps 'not known' distinct from 'nothing blocking'", () => {
    // The panel renders these two completely differently, and collapsing them
    // would put a green tick on a channel nobody actually checked.
    expect(toStudioView(studioInput()).readiness).toBeNull();
    expect(toStudioView(studioInput({ readiness: null })).readiness).toBeNull();
    expect(toStudioView(studioInput({ readiness: [] })).readiness).toEqual([]);
  });

  it("attaches a reason and a recovery to every refusal code", () => {
    const view = toStudioView(
      studioInput({
        readiness: [
          {
            channel: "instagram",
            capabilityKey: "publish_instagram",
            actionCount: 3,
            anyRequired: true,
            firstScheduledFor: "2026-09-01T14:00:00+00:00",
            accountLabel: null,
            restrictionCodes: [],
            verdict: "blocked",
            codes: ["capability_not_granted", "account_not_mapped"],
          },
        ],
      }),
    );

    expect(view.readiness?.[0]?.blockers).toEqual([
      {
        code: "capability_not_granted",
        reason: expect.stringContaining("allowed to publish"),
        recovery: "Connect the channel",
      },
      {
        code: "account_not_mapped",
        reason: expect.stringContaining("no page or profile"),
        recovery: "Choose an account",
      },
    ]);
  });

  it("renders an unrecognized code as itself rather than as a blank card", () => {
    const view = toStudioView(
      studioInput({
        readiness: [
          {
            channel: "facebook",
            capabilityKey: "publish_facebook",
            actionCount: 1,
            anyRequired: false,
            firstScheduledFor: null,
            accountLabel: null,
            restrictionCodes: [],
            verdict: "blocked",
            codes: ["something_new_we_have_not_seen"],
          },
        ],
      }),
    );

    expect(view.readiness?.[0]?.blockers[0]?.reason).toContain("something_new_we_have_not_seen");
  });
});
