import { describe, expect, it } from "vitest";

import {
  readCampaignOutput,
  type CampaignOutputPersistence,
} from "@/modules/campaigns/infrastructure/campaign-output-reader";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "10000000-0000-4000-8000-0000000000ff";
const CAMPAIGN_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ONE = "30000000-0000-4000-8000-000000000001";
const VERSION_TWO = "30000000-0000-4000-8000-000000000002";

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    organization_id: ORGANIZATION_ID,
    bundle_version_id: VERSION_ONE,
    storage_path: "org/campaign/run/a.jpg",
    mime_type: "image/jpeg",
    width_px: 1080,
    height_px: 1080,
    truth_class: "synthetic_generated",
    alt_text: "Kingfish curry in a clay pot.",
    created_at: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

type FakeTables = {
  campaign_assets?: unknown[];
  campaign_bundle_versions?: unknown[];
  campaigns?: unknown[];
};

function persistence(tables: FakeTables): CampaignOutputPersistence {
  return {
    from(table: keyof FakeTables) {
      const data = tables[table] ?? [];
      const result = Promise.resolve({ data, error: null });
      return {
        select: () => ({
          eq: () => Object.assign(result, { order: () => result }),
        }),
      };
    },
  } as unknown as CampaignOutputPersistence;
}

const CAMPAIGNS = [{ id: CAMPAIGN_ID, organization_id: ORGANIZATION_ID, title: "Onam lunch" }];

describe("grouping", () => {
  it("nests images inside their bundle version, inside their campaign", async () => {
    const groups = await readCampaignOutput(
      persistence({
        campaigns: CAMPAIGNS,
        campaign_bundle_versions: [
          {
            id: VERSION_ONE,
            organization_id: ORGANIZATION_ID,
            campaign_id: CAMPAIGN_ID,
            version: 1,
            created_at: "2026-08-25T10:00:00.000Z",
          },
        ],
        campaign_assets: [asset()],
      }),
      ORGANIZATION_ID,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe("Onam lunch");
    expect(groups[0]!.versions[0]!.images[0]!.truthClass).toBe("synthetic_generated");
  });

  it("puts the newest round first, because that is what is being judged", async () => {
    const groups = await readCampaignOutput(
      persistence({
        campaigns: CAMPAIGNS,
        campaign_bundle_versions: [
          {
            id: VERSION_ONE,
            organization_id: ORGANIZATION_ID,
            campaign_id: CAMPAIGN_ID,
            version: 1,
            created_at: "2026-08-25T10:00:00.000Z",
          },
          {
            id: VERSION_TWO,
            organization_id: ORGANIZATION_ID,
            campaign_id: CAMPAIGN_ID,
            version: 2,
            created_at: "2026-08-25T11:00:00.000Z",
          },
        ],
        campaign_assets: [
          asset(),
          asset({ id: "40000000-0000-4000-8000-000000000002", bundle_version_id: VERSION_TWO }),
        ],
      }),
      ORGANIZATION_ID,
    );

    expect(groups[0]!.versions.map((entry) => entry.version)).toEqual([2, 1]);
  });

  it("omits a bundle version that produced no image, rather than showing an empty row", async () => {
    const groups = await readCampaignOutput(
      persistence({
        campaigns: CAMPAIGNS,
        campaign_bundle_versions: [
          {
            id: VERSION_ONE,
            organization_id: ORGANIZATION_ID,
            campaign_id: CAMPAIGN_ID,
            version: 1,
            created_at: "2026-08-25T10:00:00.000Z",
          },
        ],
        campaign_assets: [],
      }),
      ORGANIZATION_ID,
    );

    expect(groups).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("treats a row from another organization as corruption, not as something to filter", async () => {
    await expect(
      readCampaignOutput(
        persistence({
          campaigns: CAMPAIGNS,
          campaign_bundle_versions: [
            {
              id: VERSION_ONE,
              organization_id: OTHER_ORGANIZATION_ID,
              campaign_id: CAMPAIGN_ID,
              version: 1,
              created_at: "2026-08-25T10:00:00.000Z",
            },
          ],
          campaign_assets: [],
        }),
        ORGANIZATION_ID,
      ),
    ).rejects.toThrow(/could not be read/i);
  });

  it("refuses an asset belonging to another organization", async () => {
    await expect(
      readCampaignOutput(
        persistence({
          campaigns: CAMPAIGNS,
          campaign_bundle_versions: [],
          campaign_assets: [asset({ organization_id: OTHER_ORGANIZATION_ID })],
        }),
        ORGANIZATION_ID,
      ),
    ).rejects.toThrow(/could not be read/i);
  });
});

describe("malformed data", () => {
  it("refuses an unknown truth class rather than rendering it", async () => {
    await expect(
      readCampaignOutput(
        persistence({
          campaigns: CAMPAIGNS,
          campaign_bundle_versions: [],
          campaign_assets: [asset({ truth_class: "photograph_probably" })],
        }),
        ORGANIZATION_ID,
      ),
    ).rejects.toThrow(/could not be read/i);
  });
});
