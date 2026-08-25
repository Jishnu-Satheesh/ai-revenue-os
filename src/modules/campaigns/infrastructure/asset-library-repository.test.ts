import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAssetLibraryRepository,
  type AssetLibraryPersistence,
} from "@/modules/campaigns/infrastructure/asset-library-repository";
import { DomainError } from "@/lib/errors";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const ASSET_ID = "20000000-0000-4000-8000-000000000002";
const VERSION_ID = "30000000-0000-4000-8000-000000000003";

const assetRow = {
  id: ASSET_ID,
  organization_id: ORGANIZATION_ID,
  label: "Kerala fish curry",
  asset_role: "product",
  conditioning_roles: ["subject"],
  tags: ["മീൻ കറി"],
  scripts: [],
  ownership: "owned",
  archived_at: null,
};

const versionRow = {
  id: VERSION_ID,
  organization_id: ORGANIZATION_ID,
  brand_asset_id: ASSET_ID,
  version: 2,
  storage_path: `${ORGANIZATION_ID}/${ASSET_ID}/${VERSION_ID}/source`,
  content_hash: "a".repeat(64),
  mime_type: "image/png",
  byte_size: 1200,
  width_px: 800,
  height_px: 800,
  is_usable: true,
};

const reviewRow = {
  id: "40000000-0000-4000-8000-000000000004",
  organization_id: ORGANIZATION_ID,
  subject_kind: "brand_asset_version",
  subject_id: VERSION_ID,
  verdict: "rejected",
  reason_codes: ["wrong_style"],
  reviewed_at: "2026-08-25T10:00:00+00:00",
};

type TableName =
  | "organization_brand_assets"
  | "organization_brand_asset_versions"
  | "creative_asset_reviews"
  | "creative_review_reasons";

const rpc = vi.fn();
const queryCalls: Array<{ table: TableName; column: string; value: unknown }> = [];
let tableRows: Record<TableName, unknown[]>;

function persistence(): AssetLibraryPersistence {
  return {
    rpc,
    from(table: TableName) {
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          queryCalls.push({ table, column, value });
          return query;
        },
        order() {
          return Promise.resolve({ data: tableRows[table], error: null });
        },
      };
      return query;
    },
  } as AssetLibraryPersistence;
}

beforeEach(() => {
  rpc.mockReset();
  queryCalls.length = 0;
  tableRows = {
    organization_brand_assets: [assetRow],
    organization_brand_asset_versions: [versionRow],
    creative_asset_reviews: [reviewRow],
    creative_review_reasons: [
      {
        key: "wrong_style",
        description: "Avoid the rejected visual style.",
        owner_scope: "core",
        pack_slug: null,
      },
    ],
  };
});

describe("asset library session reads", () => {
  it("joins usable versions to tenant assets and their latest append-only review", async () => {
    const references =
      await createAssetLibraryRepository(persistence()).listReferences(ORGANIZATION_ID);

    expect(references).toEqual([
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        brandAssetId: ASSET_ID,
        brandAssetVersionId: VERSION_ID,
        currentVerdict: "rejected",
        currentReasonCodes: ["wrong_style"],
        currentReviewedAt: "2026-08-25T10:00:00.000Z",
      }),
    ]);
    expect(queryCalls).toEqual(
      expect.arrayContaining([
        { table: "organization_brand_assets", column: "organization_id", value: ORGANIZATION_ID },
        {
          table: "organization_brand_asset_versions",
          column: "organization_id",
          value: ORGANIZATION_ID,
        },
        {
          table: "organization_brand_asset_versions",
          column: "is_usable",
          value: true,
        },
        { table: "creative_asset_reviews", column: "organization_id", value: ORGANIZATION_ID },
        {
          table: "creative_asset_reviews",
          column: "subject_kind",
          value: "brand_asset_version",
        },
      ]),
    );
  });

  it("uses reviewed time then review id to select the current verdict deterministically", async () => {
    tableRows.creative_asset_reviews = [
      {
        ...reviewRow,
        id: "50000000-0000-4000-8000-000000000005",
        verdict: "approved",
        reason_codes: [],
      },
      { ...reviewRow, id: "40000000-0000-4000-8000-000000000004" },
    ];

    const [reference] =
      await createAssetLibraryRepository(persistence()).listReferences(ORGANIZATION_ID);

    expect(reference?.currentVerdict).toBe("approved");
    expect(reference?.currentReasonCodes).toEqual([]);
  });

  it("fails closed when a database row cannot satisfy the domain boundary", async () => {
    tableRows.organization_brand_assets = [{ ...assetRow, ownership: "borrowed" }];

    await expect(
      createAssetLibraryRepository(persistence()).listReferences(ORGANIZATION_ID),
    ).rejects.toThrow();
  });

  it("maps governed reason descriptions for the review UI", async () => {
    await expect(createAssetLibraryRepository(persistence()).listReviewReasons()).resolves.toEqual([
      {
        code: "wrong_style",
        description: "Avoid the rejected visual style.",
        ownerScope: "core",
        packSlug: null,
      },
    ]);
  });
});

describe("asset library governed writes", () => {
  it("updates metadata through the permission-checked RPC with tenant identity repeated", async () => {
    rpc.mockResolvedValue({
      data: { brand_asset_id: ASSET_ID, archived_at: null },
      error: null,
    });

    await createAssetLibraryRepository(persistence()).updateMetadata({
      organizationId: ORGANIZATION_ID,
      brandAssetId: ASSET_ID,
      conditioningRoles: ["typography"],
      tags: ["മലയാളം"],
      scripts: ["Mlym"],
      archived: false,
    });

    expect(rpc).toHaveBeenCalledWith("update_brand_asset_metadata", {
      target_organization_id: ORGANIZATION_ID,
      input_metadata: {
        organization_id: ORGANIZATION_ID,
        brand_asset_id: ASSET_ID,
        conditioning_roles: ["typography"],
        tags: ["മലയാളം"],
        scripts: ["Mlym"],
        archived: false,
      },
    });
  });

  it("records reviews through the existing governed writer", async () => {
    rpc.mockResolvedValue({
      data: {
        review_id: "40000000-0000-4000-8000-000000000004",
        verdict: "rejected",
        reviewed_at: "2026-08-25T10:00:00+00:00",
      },
      error: null,
    });

    const result = await createAssetLibraryRepository(persistence()).recordReview({
      organizationId: ORGANIZATION_ID,
      subjectKind: "campaign_asset",
      subjectId: VERSION_ID,
      verdict: "rejected",
      reasonCodes: ["wrong_style"],
      note: "Avoid this treatment.",
    });

    expect(rpc).toHaveBeenCalledWith("record_creative_asset_review", {
      target_organization_id: ORGANIZATION_ID,
      input_review: {
        organization_id: ORGANIZATION_ID,
        subject_kind: "campaign_asset",
        subject_id: VERSION_ID,
        verdict: "rejected",
        reason_codes: ["wrong_style"],
        note: "Avoid this treatment.",
      },
    });
    expect(result.reviewedAt).toBe("2026-08-25T10:00:00.000Z");
  });

  it("fails closed on a malformed or refused mutation receipt", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(
      createAssetLibraryRepository(persistence()).updateMetadata({
        organizationId: ORGANIZATION_ID,
        brandAssetId: ASSET_ID,
        archived: true,
      }),
    ).rejects.toThrow();

    rpc.mockResolvedValueOnce({ data: { review_id: "not-a-uuid" }, error: null });
    await expect(
      createAssetLibraryRepository(persistence()).recordReview({
        organizationId: ORGANIZATION_ID,
        subjectKind: "brand_asset_version",
        subjectId: VERSION_ID,
        verdict: "approved",
        reasonCodes: [],
        note: null,
      }),
    ).rejects.toThrow();
  });

  it.each([
    {
      databaseCode: "42501",
      databaseMessage: "brand_asset_metadata_forbidden",
      expectedCode: "AUTHORIZATION_ERROR",
      expectedMessage: "You do not have permission to change this asset.",
    },
    {
      databaseCode: "42501",
      databaseMessage: "brand_asset_metadata_not_found",
      expectedCode: "TENANT_SCOPE_ERROR",
      expectedMessage: "That asset is not available.",
    },
    {
      databaseCode: "23514",
      databaseMessage: "brand_asset_tags_duplicate",
      expectedCode: "VALIDATION_ERROR",
      expectedMessage: "Asset tags must be unique.",
    },
  ])(
    "preserves the governed $databaseMessage refusal at the application boundary",
    async ({ databaseCode, databaseMessage, expectedCode, expectedMessage }) => {
      rpc.mockResolvedValue({
        data: null,
        error: { code: databaseCode, message: databaseMessage },
      });

      const operation = createAssetLibraryRepository(persistence()).updateMetadata({
        organizationId: ORGANIZATION_ID,
        brandAssetId: ASSET_ID,
        archived: true,
      });

      await expect(operation).rejects.toMatchObject<Partial<DomainError>>({
        name: "DomainError",
        code: expectedCode,
        message: expectedMessage,
      });
    },
  );

  it("reports malformed database input as validation rather than an unknown persistence failure", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22P02", message: "invalid input syntax for type boolean" },
    });

    const operation = createAssetLibraryRepository(persistence()).updateMetadata({
      organizationId: ORGANIZATION_ID,
      brandAssetId: ASSET_ID,
      archived: true,
    });

    await expect(operation).rejects.toMatchObject<Partial<DomainError>>({
      name: "DomainError",
      code: "VALIDATION_ERROR",
      message: "Please check the asset metadata.",
    });
  });
});
