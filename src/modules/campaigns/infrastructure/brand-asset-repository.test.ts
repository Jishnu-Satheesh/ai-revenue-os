import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBrandAssetStore,
  type BrandAssetPersistence,
} from "@/modules/campaigns/infrastructure/brand-asset-repository";
import { DomainError } from "@/lib/errors";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const ASSET_ID = "20000000-0000-4000-8000-000000000002";
const VERSION_ID = "30000000-0000-4000-8000-000000000003";
const rpc = vi.fn();

beforeEach(() => rpc.mockReset());

describe("brand asset governed persistence", () => {
  it("reserves new classification in the same database call as the asset identity", async () => {
    rpc.mockResolvedValue({
      data: {
        brand_asset_id: ASSET_ID,
        version_id: VERSION_ID,
        storage_path: `${ORGANIZATION_ID}/${ASSET_ID}/${VERSION_ID}/source`,
      },
      error: null,
    });

    await createBrandAssetStore({ rpc } as BrandAssetPersistence).reserve({
      organizationId: ORGANIZATION_ID,
      brandAssetId: null,
      label: "Malayalam wordmark",
      assetRole: "logo",
      classification: {
        conditioningRoles: ["brand_mark", "typography"],
        tags: ["മലയാളം"],
        scripts: ["Mlym"],
        ownership: "owned",
      },
    });

    expect(rpc).toHaveBeenCalledWith("create_brand_asset_version", {
      target_organization_id: ORGANIZATION_ID,
      input_asset: {
        organization_id: ORGANIZATION_ID,
        brand_asset_id: null,
        label: "Malayalam wordmark",
        asset_role: "logo",
        conditioning_roles: ["brand_mark", "typography"],
        tags: ["മലയാളം"],
        scripts: ["Mlym"],
        ownership: "owned",
      },
    });
  });

  it("omits classification keys for the deployed legacy reservation shape", async () => {
    rpc.mockResolvedValue({
      data: {
        brand_asset_id: ASSET_ID,
        version_id: VERSION_ID,
        storage_path: `${ORGANIZATION_ID}/${ASSET_ID}/${VERSION_ID}/source`,
      },
      error: null,
    });

    await createBrandAssetStore({ rpc } as BrandAssetPersistence).reserve({
      organizationId: ORGANIZATION_ID,
      brandAssetId: null,
      label: "Legacy upload",
      assetRole: "product",
      classification: null,
    });

    expect(rpc.mock.calls[0]?.[1]).toEqual({
      target_organization_id: ORGANIZATION_ID,
      input_asset: {
        organization_id: ORGANIZATION_ID,
        brand_asset_id: null,
        label: "Legacy upload",
        asset_role: "product",
      },
    });
  });

  it("fails closed when the reservation receipt is malformed", async () => {
    rpc.mockResolvedValue({ data: { brand_asset_id: ASSET_ID }, error: null });

    await expect(
      createBrandAssetStore({ rpc } as BrandAssetPersistence).reserve({
        organizationId: ORGANIZATION_ID,
        brandAssetId: null,
        label: "Broken receipt",
        assetRole: "other",
        classification: null,
      }),
    ).rejects.toThrow();
  });

  it.each([
    {
      code: "23514",
      databaseMessage: "brand_asset_tags_duplicate",
      expectedCode: "VALIDATION_ERROR",
      expectedMessage: "Asset tags must be unique.",
    },
    {
      code: "42501",
      databaseMessage: "brand_asset_forbidden",
      expectedCode: "AUTHORIZATION_ERROR",
      expectedMessage: "You do not have permission to change this asset.",
    },
  ])(
    "preserves the governed $databaseMessage reservation refusal",
    async ({ code, databaseMessage, expectedCode, expectedMessage }) => {
      rpc.mockResolvedValue({ data: null, error: { code, message: databaseMessage } });

      const operation = createBrandAssetStore({ rpc } as BrandAssetPersistence).reserve({
        organizationId: ORGANIZATION_ID,
        brandAssetId: null,
        label: "Refused upload",
        assetRole: "product",
        classification: null,
      });

      await expect(operation).rejects.toMatchObject<Partial<DomainError>>({
        name: "DomainError",
        code: expectedCode,
        message: expectedMessage,
      });
    },
  );
});
