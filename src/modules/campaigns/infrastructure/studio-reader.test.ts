import { describe, expect, it, vi } from "vitest";

import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";
import type {
  BundleVersionDetail,
  BundleVersionSummary,
  CampaignReadPort,
  CampaignSummary,
} from "@/modules/campaigns/application/ports";
import { readCampaignList, readStudioView } from "@/modules/campaigns/infrastructure/studio-reader";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CAMPAIGN_ID = "c9000000-0000-4000-8000-000000000009";
const NOW = () => "2026-08-15T12:00:00.000Z";

function campaign(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    id: manifestIds.campaign,
    organizationId: ORGANIZATION_ID,
    title: "Weekday evening demand lift",
    sourceKind: "manual_brief",
    briefId: manifestIds.brief,
    opportunityId: null,
    state: "ready_for_review",
    createdAt: "2026-08-14T09:00:00",
    updatedAt: "2026-08-15T09:30:00",
    ...overrides,
  };
}

function version(overrides: Partial<BundleVersionDetail> = {}): BundleVersionDetail {
  const manifest = validManifest();
  return {
    id: "d1000000-0000-4000-8000-000000000001",
    campaignId: manifestIds.campaign,
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
  const { manifest: _manifest, ...rest } = detail;
  return rest;
}

function readPort(overrides: Partial<CampaignReadPort> = {}): CampaignReadPort {
  const detail = version();
  return {
    listCampaigns: vi.fn(async () => [campaign()]),
    getCampaign: vi.fn(async () => campaign()),
    listVersions: vi.fn(async () => [summaryOf(detail)]),
    getVersion: vi.fn(async () => detail),
    getLiveApproval: vi.fn(async () => null),
    latestGenerationRun: vi.fn(async () => null),
    ...overrides,
  };
}

describe("reading the portfolio", () => {
  it("fills each row from that campaign's newest version", async () => {
    const [row] = await readCampaignList(readPort(), ORGANIZATION_ID);

    expect(row).toMatchObject({ awaitingFirstVersion: false, version: 1 });
    expect(row?.objective).toBe(validManifest().objective);
  });

  it("shows a campaign whose generation has not produced a version yet", async () => {
    const read = readPort({ listVersions: vi.fn(async () => []) });

    const [row] = await readCampaignList(read, ORGANIZATION_ID);

    expect(row).toMatchObject({ awaitingFirstVersion: true, objective: null });
    // No version means nothing to fetch; asking anyway would be a wasted read.
    expect(read.getVersion).not.toHaveBeenCalled();
  });

  it("reads a claimed run with a live lease as still generating", async () => {
    const read = readPort({
      listVersions: vi.fn(async () => []),
      latestGenerationRun: vi.fn(async () => ({
        status: "claimed",
        failureCode: null,
        leaseExpiresAt: "2026-08-17T12:00:00.000Z",
      })),
    });

    const [row] = await readCampaignList(read, ORGANIZATION_ID, () => "2026-08-17T11:00:00.000Z");

    expect(row?.generation.status).toBe("generating");
    expect(row?.openable).toBe(false);
  });

  it("reads a claimed run whose lease has lapsed as stalled, not generating", async () => {
    // The failure this covers actually happened: a worker killed by a timeout
    // never wrote that it failed, so the row stayed `claimed` forever. Reading
    // that as "generating" is a spinner that never stops.
    const read = readPort({
      listVersions: vi.fn(async () => []),
      latestGenerationRun: vi.fn(async () => ({
        status: "claimed",
        failureCode: null,
        leaseExpiresAt: "2026-08-17T10:00:00.000Z",
      })),
    });

    const [row] = await readCampaignList(read, ORGANIZATION_ID, () => "2026-08-17T11:00:00.000Z");

    expect(row?.generation.status).toBe("stalled");
  });

  it("names the missing evidence when generation failed for want of data", async () => {
    const read = readPort({
      listVersions: vi.fn(async () => []),
      latestGenerationRun: vi.fn(async () => ({
        status: "failed",
        failureCode: "needs_data:brand_voice,objective",
        leaseExpiresAt: null,
      })),
    });

    const [row] = await readCampaignList(read, ORGANIZATION_ID, () => "2026-08-17T11:00:00.000Z");

    expect(row?.generation.status).toBe("failed");
    expect(row?.generation.detail).toContain("brand_voice");
  });

  it("does not read a generation run for a campaign that already has a version", async () => {
    const read = readPort();

    const [row] = await readCampaignList(read, ORGANIZATION_ID);

    expect(row?.generation.status).toBe("settled");
    expect(row?.openable).toBe(true);
    expect(read.latestGenerationRun).not.toHaveBeenCalled();
  });

  it("returns an empty portfolio rather than failing when there are no campaigns", async () => {
    const read = readPort({ listCampaigns: vi.fn(async () => []) });

    await expect(readCampaignList(read, ORGANIZATION_ID)).resolves.toEqual([]);
  });
});

describe("reading one campaign", () => {
  it("defaults to the newest version", async () => {
    const view = await readStudioView(readPort(), ORGANIZATION_ID, manifestIds.campaign, {
      clock: NOW,
    });

    expect(view).toMatchObject({ versionNumber: 1, digest: "a".repeat(64) });
  });

  it("returns nothing for a campaign the session cannot see", async () => {
    const read = readPort({ getCampaign: vi.fn(async () => null) });

    await expect(
      readStudioView(read, ORGANIZATION_ID, manifestIds.campaign, { clock: NOW }),
    ).resolves.toBeNull();
    // Nothing further is read once the campaign is not visible, so a hidden
    // campaign cannot be probed through its versions.
    expect(read.listVersions).not.toHaveBeenCalled();
  });

  it("refuses a version id that belongs to a different campaign", async () => {
    const foreign = version({ campaignId: OTHER_CAMPAIGN_ID });
    const read = readPort({ getVersion: vi.fn(async () => foreign) });

    await expect(
      readStudioView(read, ORGANIZATION_ID, manifestIds.campaign, {
        versionId: foreign.id,
        clock: NOW,
      }),
    ).resolves.toBeNull();
  });

  it("returns nothing when the campaign exists but has produced no version", async () => {
    const read = readPort({ listVersions: vi.fn(async () => []) });

    await expect(
      readStudioView(read, ORGANIZATION_ID, manifestIds.campaign, { clock: NOW }),
    ).resolves.toBeNull();
  });

  it("reads the requested version rather than the newest when one is named", async () => {
    const older = version({ id: "d1000000-0000-4000-8000-000000000000", version: 1 });
    const newer = version({
      id: "d1000000-0000-4000-8000-000000000002",
      version: 2,
      parentVersionId: older.id,
    });
    const read = readPort({
      listVersions: vi.fn(async () => [summaryOf(newer), summaryOf(older)]),
      getVersion: vi.fn(async (_organizationId: string, versionId: string) =>
        versionId === older.id ? older : newer,
      ),
    });

    const view = await readStudioView(read, ORGANIZATION_ID, manifestIds.campaign, {
      versionId: older.id,
      clock: NOW,
    });

    expect(view?.versionNumber).toBe(1);
    expect(view?.versions.map((entry) => entry.isCurrent)).toEqual([false, true]);
  });
});
