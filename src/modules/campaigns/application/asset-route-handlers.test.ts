import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAssetRouteHandlers,
  type AssetRouteHandlerDependencies,
} from "@/modules/campaigns/application/asset-route-handlers";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const ASSET_ID = "20000000-0000-4000-8000-000000000002";
const VERSION_ID = "30000000-0000-4000-8000-000000000003";

const context = vi.fn();
const list = vi.fn();
const updateMetadata = vi.fn();
const archive = vi.fn();
const recordReview = vi.fn();
const reviewReasons = vi.fn();
const reserve = vi.fn();
const complete = vi.fn();

const reference = {
  organizationId: ORGANIZATION_ID,
  brandAssetId: ASSET_ID,
  brandAssetVersionId: VERSION_ID,
  label: "Kerala fish curry",
  assetRole: "product" as const,
  conditioningRoles: ["subject" as const],
  tags: ["മീൻ കറി"],
  scripts: [],
  ownership: "owned" as const,
  archivedAt: null,
  version: 1,
  storagePath: `${ORGANIZATION_ID}/${ASSET_ID}/${VERSION_ID}/source`,
  contentHash: "a".repeat(64),
  mimeType: "image/png" as const,
  byteSize: 1_200,
  widthPx: 800,
  heightPx: 800,
  currentVerdict: "approved" as const,
  currentReasonCodes: [],
  currentReviewedAt: "2026-08-25T10:00:00.000Z",
};

function dependencies(): AssetRouteHandlerDependencies {
  return {
    context,
    servicesFor: () => ({
      library: { list, updateMetadata, archive, recordReview, reviewReasons },
      brandAssets: { reserve, complete },
    }),
  } as AssetRouteHandlerDependencies;
}

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({ organizationId: ORGANIZATION_ID, ...overrides });
}

function jsonRequest(method: string, body: unknown, path = "/assets") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of [
    context,
    list,
    updateMetadata,
    archive,
    recordReview,
    reviewReasons,
    reserve,
    complete,
  ]) {
    mock.mockReset();
  }
  context.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    user: { id: "user-1" },
    supabase: {},
    membership: { role: "operator" },
  });
  list.mockResolvedValue([reference]);
  reviewReasons.mockResolvedValue([]);
  reserve.mockResolvedValue({
    brandAssetId: ASSET_ID,
    versionId: VERSION_ID,
    storagePath: reference.storagePath,
  });
  complete.mockResolvedValue({
    status: "usable",
    versionId: VERSION_ID,
    contentHash: "b".repeat(64),
  });
  updateMetadata.mockResolvedValue({ brandAssetId: ASSET_ID, archivedAt: null });
  recordReview.mockResolvedValue({
    reviewId: "40000000-0000-4000-8000-000000000004",
    verdict: "approved",
    reviewedAt: "2026-08-25T12:00:00.000Z",
  });
});

describe("asset library reads", () => {
  it("parses repeated Unicode filters and checks asset.read before listing", async () => {
    const handlers = createAssetRouteHandlers(dependencies());
    const request = new Request(
      "http://localhost/assets?role=subject&verdict=approved&tag=%E0%B4%AE%E0%B5%80%E0%B5%BB+%E0%B4%95%E0%B4%B1%E0%B4%BF&includeArchived=true",
    );

    const response = await handlers.list(request, params());

    expect(response.status).toBe(200);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.read");
    expect(list).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      role: "subject",
      verdict: "approved",
      tag: "മീൻ കറി",
      includeArchived: true,
    });
    await expect(response.json()).resolves.toEqual({ assets: [reference] });
  });

  it("runs the same deterministic resolver over the session-visible library", async () => {
    const handlers = createAssetRouteHandlers(dependencies());
    const request = new Request(
      "http://localhost/assets/resolve?subjectTag=%E0%B4%AE%E0%B5%80%E0%B5%BB+%E0%B4%95%E0%B4%B1%E0%B4%BF&subjectDescription=Confirmed+fish+curry&script=Mlym",
    );

    const response = await handlers.resolve(request, params());
    const body = await response.json();

    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.read");
    expect(list).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      includeArchived: true,
    });
    expect(reviewReasons).toHaveBeenCalled();
    expect(body.resolution).toMatchObject({
      resolverVersion: 1,
      outcome: "resolved",
      refusalCode: null,
      referenceSlots: [
        expect.objectContaining({
          role: "subject",
          brandAssetVersionId: VERSION_ID,
          referenceMode: "inspiration",
        }),
      ],
    });
  });

  it("returns the same no-declared-subject refusal the worker would return", async () => {
    list.mockResolvedValue([]);
    const handlers = createAssetRouteHandlers(dependencies());

    const response = await handlers.resolve(
      new Request("http://localhost/assets/resolve"),
      params(),
    );

    await expect(response.json()).resolves.toMatchObject({
      resolution: { outcome: "insufficient", refusalCode: "no_declared_subject" },
    });
  });

  it("refuses unknown query fields instead of silently ignoring a caller mistake", async () => {
    const handlers = createAssetRouteHandlers(dependencies());

    const response = await handlers.list(
      new Request("http://localhost/assets?organizationId=someone-else"),
      params(),
    );

    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("asset upload routes", () => {
  it("requires full classification on the canonical first-version reservation", async () => {
    const handlers = createAssetRouteHandlers(dependencies());
    const response = await handlers.reserve(
      jsonRequest("POST", {
        label: "Malayalam wordmark",
        assetRole: "logo",
        classification: {
          conditioningRoles: ["brand_mark", "typography"],
          tags: ["മലയാളം"],
          scripts: ["Mlym"],
          ownership: "owned",
        },
      }),
      params(),
    );

    expect(response.status).toBe(201);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.manage");
    expect(reserve).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      label: "Malayalam wordmark",
      assetRole: "logo",
      classification: {
        conditioningRoles: ["brand_mark", "typography"],
        tags: ["മലയാളം"],
        scripts: ["Mlym"],
        ownership: "owned",
      },
    });
  });

  it("keeps the deployed upload URL as an unclassified adapter over the shared reserve flow", async () => {
    const handlers = createAssetRouteHandlers(dependencies());

    const response = await handlers.reserveLegacy(
      jsonRequest("POST", { label: "Legacy upload", assetRole: "product" }),
      params(),
    );

    expect(response.status).toBe(201);
    expect(reserve).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      label: "Legacy upload",
      assetRole: "product",
    });
  });

  it("reserves a later version from the path without accepting classification", async () => {
    const handlers = createAssetRouteHandlers(dependencies());

    await handlers.reserveVersion(
      new Request("http://localhost/assets/x/versions", { method: "POST" }),
      params({ assetId: ASSET_ID }),
    );

    expect(reserve).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      brandAssetId: ASSET_ID,
    });
  });

  it("derives the completion path from canonical route ids and preserves ordinary rejection", async () => {
    complete.mockResolvedValue({
      status: "rejected",
      reason: "unsupported_image_type",
      message: "Choose a PNG, JPEG, or WebP image.",
    });
    const handlers = createAssetRouteHandlers(dependencies());

    const response = await handlers.completeVersion(
      new Request("http://localhost/assets/x/versions/y/complete", { method: "POST" }),
      params({ assetId: ASSET_ID, versionId: VERSION_ID }),
    );

    expect(response.status).toBe(200);
    expect(complete).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: reference.storagePath,
    });
  });

  it("keeps the deployed completion body adapter on the shared completion flow", async () => {
    const handlers = createAssetRouteHandlers(dependencies());

    await handlers.completeLegacy(
      jsonRequest("POST", { brandAssetId: ASSET_ID, versionId: VERSION_ID }),
      params({ uploadId: "legacy-path-id" }),
    );

    expect(complete).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: reference.storagePath,
    });
  });
});

describe("asset metadata and review writes", () => {
  it("patches full classification and archive state through asset.manage", async () => {
    const handlers = createAssetRouteHandlers(dependencies());

    await handlers.update(
      jsonRequest("PATCH", {
        classification: {
          conditioningRoles: ["typography"],
          tags: ["عرض"],
          scripts: ["Arab"],
        },
        archived: true,
      }),
      params({ assetId: ASSET_ID }),
    );

    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.manage");
    expect(updateMetadata).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      brandAssetId: ASSET_ID,
      conditioningRoles: ["typography"],
      tags: ["عرض"],
      scripts: ["Arab"],
      archived: true,
    });
  });

  it("records either governed subject kind through asset.review", async () => {
    const handlers = createAssetRouteHandlers(dependencies());

    const response = await handlers.review(
      jsonRequest("POST", {
        subjectKind: "brand_asset_version",
        subjectId: VERSION_ID,
        verdict: "rejected",
        reasonCodes: ["wrong_style"],
        note: "Avoid this treatment.",
      }),
      params(),
    );

    expect(response.status).toBe(201);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.review");
    expect(recordReview).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      subjectKind: "brand_asset_version",
      subjectId: VERSION_ID,
      verdict: "rejected",
      reasonCodes: ["wrong_style"],
      note: "Avoid this treatment.",
    });
  });

  it("checks membership before parsing a malformed write", async () => {
    const order: string[] = [];
    context.mockImplementation(async () => {
      order.push("context");
      return {
        organizationId: ORGANIZATION_ID,
        user: { id: "user-1" },
        supabase: {},
        membership: { role: "operator" },
      };
    });
    const request = new Request("http://localhost/assets", { method: "POST", body: "{" });
    const handlers = createAssetRouteHandlers(dependencies());

    await handlers.reserve(request, params());

    expect(order).toEqual(["context"]);
    expect(reserve).not.toHaveBeenCalled();
  });
});
