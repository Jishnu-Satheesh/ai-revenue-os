import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAssetLibraryService,
  type AssetLibraryReference,
  type AssetLibraryStore,
} from "@/modules/campaigns/application/asset-library-service";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const ASSET_ID = "20000000-0000-4000-8000-000000000002";
const VERSION_ID = "30000000-0000-4000-8000-000000000003";

const activeReference: AssetLibraryReference = {
  organizationId: ORGANIZATION_ID,
  brandAssetId: ASSET_ID,
  brandAssetVersionId: VERSION_ID,
  label: "Kerala fish curry",
  assetRole: "product",
  conditioningRoles: ["subject"],
  tags: ["Café", "മീൻ കറി"],
  scripts: [],
  ownership: "owned",
  archivedAt: null,
  version: 2,
  storagePath: `${ORGANIZATION_ID}/${ASSET_ID}/${VERSION_ID}/source`,
  contentHash: "a".repeat(64),
  mimeType: "image/png",
  byteSize: 1200,
  widthPx: 800,
  heightPx: 800,
  currentVerdict: "approved",
  currentReasonCodes: [],
  currentReviewedAt: "2026-08-25T10:00:00.000Z",
};

const archivedReference: AssetLibraryReference = {
  ...activeReference,
  brandAssetId: "20000000-0000-4000-8000-000000000004",
  brandAssetVersionId: "30000000-0000-4000-8000-000000000005",
  label: "Old dining room",
  conditioningRoles: ["setting"],
  tags: ["Indoor"],
  ownership: "third_party",
  archivedAt: "2026-08-25T11:00:00.000Z",
  currentVerdict: "rejected",
  currentReasonCodes: ["wrong_style"],
  currentReviewedAt: "2026-08-25T10:30:00.000Z",
};

const listReferences = vi.fn();
const updateMetadata = vi.fn();
const recordReview = vi.fn();
const listReviewReasons = vi.fn();

function service() {
  return createAssetLibraryService({
    store: {
      listReferences,
      updateMetadata,
      recordReview,
      listReviewReasons,
    } as AssetLibraryStore,
  });
}

beforeEach(() => {
  for (const mock of [listReferences, updateMetadata, recordReview, listReviewReasons]) {
    mock.mockReset();
  }
  listReferences.mockResolvedValue([activeReference, archivedReference]);
  updateMetadata.mockResolvedValue({ brandAssetId: ASSET_ID, archivedAt: null });
  recordReview.mockResolvedValue({
    reviewId: "40000000-0000-4000-8000-000000000004",
    verdict: "approved",
    reviewedAt: "2026-08-25T12:00:00.000Z",
  });
  listReviewReasons.mockResolvedValue([
    {
      code: "wrong_style",
      description: "Avoid the rejected visual style.",
      ownerScope: "core",
      packSlug: null,
    },
  ]);
});

describe("asset library listing and filters", () => {
  it("hides archived references by default while keeping them available explicitly", async () => {
    await expect(service().list({ organizationId: ORGANIZATION_ID })).resolves.toEqual([
      activeReference,
    ]);
    await expect(
      service().list({ organizationId: ORGANIZATION_ID, includeArchived: true }),
    ).resolves.toEqual([activeReference, archivedReference]);
    expect(listReferences).toHaveBeenCalledWith(ORGANIZATION_ID);
  });

  it("filters by conditioning role, current verdict, and the shared Unicode tag comparison", async () => {
    await expect(
      service().list({
        organizationId: ORGANIZATION_ID,
        role: "subject",
        verdict: "approved",
        tag: " CAFE\u0301 ",
      }),
    ).resolves.toEqual([activeReference]);

    await expect(
      service().list({
        organizationId: ORGANIZATION_ID,
        includeArchived: true,
        verdict: "unreviewed",
      }),
    ).resolves.toEqual([]);
  });
});

describe("governed brand-asset metadata writes", () => {
  it("normalizes multilingual tags before asking the governed store to update metadata", async () => {
    await service().updateMetadata({
      organizationId: ORGANIZATION_ID,
      brandAssetId: ASSET_ID,
      conditioningRoles: ["typography"],
      tags: [" CAFE\u0301 ", "മീൻ കറി"],
      scripts: ["Latn", "Mlym"],
      archived: false,
    });

    expect(updateMetadata).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      brandAssetId: ASSET_ID,
      conditioningRoles: ["typography"],
      tags: ["CAFÉ", "മീൻ കറി"],
      scripts: ["Latn", "Mlym"],
      archived: false,
    });
  });

  it("refuses an unclassified asset and typography without a declared script", async () => {
    await expect(
      service().updateMetadata({
        organizationId: ORGANIZATION_ID,
        brandAssetId: ASSET_ID,
        conditioningRoles: [],
        tags: [],
        scripts: [],
        archived: false,
      }),
    ).rejects.toThrow();
    await expect(
      service().updateMetadata({
        organizationId: ORGANIZATION_ID,
        brandAssetId: ASSET_ID,
        conditioningRoles: ["typography"],
        tags: [],
        scripts: [],
        archived: false,
      }),
    ).rejects.toThrow();
    expect(updateMetadata).not.toHaveBeenCalled();
  });

  it("archives through the governed writer without deleting or rewriting versions", async () => {
    updateMetadata.mockResolvedValue({
      brandAssetId: ASSET_ID,
      archivedAt: "2026-08-25T12:00:00.000Z",
    });

    await service().archive({ organizationId: ORGANIZATION_ID, brandAssetId: ASSET_ID });

    expect(updateMetadata).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      brandAssetId: ASSET_ID,
      archived: true,
    });
  });
});

describe("human creative reviews", () => {
  it("refuses a rejection without a governed reason before persistence", async () => {
    await expect(
      service().recordReview({
        organizationId: ORGANIZATION_ID,
        subjectKind: "brand_asset_version",
        subjectId: VERSION_ID,
        verdict: "rejected",
        reasonCodes: [],
        note: null,
      }),
    ).rejects.toThrow(/reason/i);
    expect(recordReview).not.toHaveBeenCalled();
  });

  it("refuses rejection reasons on an approval before persistence", async () => {
    await expect(
      service().recordReview({
        organizationId: ORGANIZATION_ID,
        subjectKind: "campaign_asset",
        subjectId: VERSION_ID,
        verdict: "approved",
        reasonCodes: ["wrong_style"],
        note: null,
      }),
    ).rejects.toThrow();
    expect(recordReview).not.toHaveBeenCalled();
  });

  it("records either subject kind with the organization repeated at the store boundary", async () => {
    await service().recordReview({
      organizationId: ORGANIZATION_ID,
      subjectKind: "campaign_asset",
      subjectId: VERSION_ID,
      verdict: "approved",
      reasonCodes: [],
      note: "Ready for use.",
    });

    expect(recordReview).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      subjectKind: "campaign_asset",
      subjectId: VERSION_ID,
      verdict: "approved",
      reasonCodes: [],
      note: "Ready for use.",
    });
  });

  it("returns the governed reason descriptions the UI can show instead of codes", async () => {
    await expect(service().reviewReasons()).resolves.toEqual([
      expect.objectContaining({
        code: "wrong_style",
        description: expect.stringContaining("style"),
      }),
    ]);
  });
});
