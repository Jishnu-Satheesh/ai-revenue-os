import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DomainError } from "@/lib/errors";
import {
  createCreativeHistoryRouteHandlers,
  type CreativeHistoryRouteHandlerDependencies,
} from "@/modules/campaigns/application/creative-history-route-handlers";
import type { CreativeHistoryService } from "@/modules/campaigns/application/creative-history-service";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const ITEM_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";

const context = vi.fn();
const intakeContract = vi.fn();
const reviewReasons = vi.fn();
const listFolders = vi.fn();
const createFolder = vi.fn();
const list = vi.fn();
const read = vi.fn();
const reserveItem = vi.fn();
const reserveVersion = vi.fn();
const complete = vi.fn();
const completeBatch = vi.fn();
const archive = vi.fn();
const confirmMetadata = vi.fn();
const review = vi.fn();

function service(): CreativeHistoryService {
  return {
    intakeContract,
    listFolders,
    createFolder,
    list,
    read,
    reserveItem,
    reserveVersion,
    complete,
    completeBatch,
    archive,
    confirmMetadata,
    proposeMetadata: vi.fn(),
    review,
    reviewReasons,
  } as unknown as CreativeHistoryService;
}

function dependencies(): CreativeHistoryRouteHandlerDependencies {
  return { context, serviceFor: () => service() };
}

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({ organizationId: ORGANIZATION_ID, ...overrides });
}

function jsonRequest(method: string, body: unknown, path = "/creative-history") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of [
    context,
    intakeContract,
    reviewReasons,
    listFolders,
    createFolder,
    list,
    read,
    reserveItem,
    reserveVersion,
    complete,
    completeBatch,
    archive,
    confirmMetadata,
    review,
  ]) {
    mock.mockReset();
  }
  context.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    user: { id: "user-1" },
    supabase: {},
    membership: { role: "operator" },
  });
  intakeContract.mockReturnValue({
    bucket: "creative-assets",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxBytes: 15_728_640,
    minWidthPx: 200,
    minHeightPx: 200,
    maxWidthPx: 8_000,
    maxHeightPx: 8_000,
    clientValidationIsAdvisory: true,
  });
  reviewReasons.mockResolvedValue([]);
  listFolders.mockResolvedValue([]);
  createFolder.mockResolvedValue({ folderId: "40000000-0000-4000-8000-000000000001" });
  list.mockResolvedValue([]);
  read.mockResolvedValue({ itemId: ITEM_ID });
  reserveItem.mockResolvedValue({
    itemId: ITEM_ID,
    versionId: VERSION_ID,
    version: 1,
    clientUploadId: "local-1",
    uploadIntentId: "50000000-0000-4000-8000-000000000001",
    bucket: "creative-assets",
    storagePath: `${ORGANIZATION_ID}/creative-history/intent/source`,
    intake: intakeContract(),
  });
  reserveVersion.mockResolvedValue({
    itemId: ITEM_ID,
    versionId: VERSION_ID,
    version: 2,
    clientUploadId: "local-2",
    uploadIntentId: "50000000-0000-4000-8000-000000000002",
    bucket: "creative-assets",
    storagePath: `${ORGANIZATION_ID}/creative-history/intent-2/source`,
    intake: intakeContract(),
  });
  archive.mockResolvedValue({ itemId: ITEM_ID, archivedAt: "2026-09-12T00:00:00.000Z" });
  confirmMetadata.mockResolvedValue({ itemId: ITEM_ID, metadataConfirmed: true });
  review.mockResolvedValue({
    reviewId: "60000000-0000-4000-8000-000000000001",
    verdict: "approved",
    reviewedAt: "2026-09-12T00:00:00.000Z",
  });
});

describe("the intake contract", () => {
  it("is readable under asset.read and carries the reviewer's own reason list", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.intake(new Request("http://localhost/intake"), params());

    expect(response.status).toBe(200);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.read");
    await expect(response.json()).resolves.toMatchObject({
      intake: { bucket: "creative-assets" },
      reviewReasons: [],
    });
  });
});

describe("folders", () => {
  it("lists folders under asset.read", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    await handlers.listFolders(new Request("http://localhost/folders"), params());

    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.read");
    expect(listFolders).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID });
  });

  it("creates a folder under asset.manage, not asset.read", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.createFolder(
      jsonRequest("POST", { name: "Ramadan" }),
      params(),
    );

    expect(response.status).toBe(201);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.manage");
    expect(createFolder).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID, name: "Ramadan" }),
    );
  });
});

describe("listing and reading items", () => {
  it("refuses an unsupported query field instead of ignoring it", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.listItems(
      new Request("http://localhost/items?organizationId=someone-else"),
      params(),
    );

    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("parses the eligibility and folder filters through to the service", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    await handlers.listItems(
      new Request(
        `http://localhost/items?eligibility=eligible_approved&includeArchived=true&folderId=${ITEM_ID}`,
      ),
      params(),
    );

    expect(list).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      eligibility: "eligible_approved",
      includeArchived: true,
      folderId: ITEM_ID,
    });
  });

  it("reads one item by the path id, never by a body id", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    await handlers.readItem(new Request("http://localhost/items/x"), params({ itemId: ITEM_ID }));

    expect(read).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID, itemId: ITEM_ID });
  });

  it("reports another tenant's design as not found, never as forbidden", async () => {
    read.mockRejectedValue(new DomainError("TENANT_SCOPE_ERROR", "That design is not available."));
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.readItem(
      new Request("http://localhost/items/x"),
      params({ itemId: ITEM_ID }),
    );

    expect(response.status).toBe(404);
  });
});

describe("reservations", () => {
  it("reserves a new item under asset.manage and returns 201 with no credential", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.reserveItem(
      jsonRequest("POST", {
        label: "Eid poster",
        creativeType: "poster",
        rights: { status: "owned", confirmedAt: "2026-09-01T00:00:00.000Z" },
        clientUploadId: "local-1",
      }),
      params(),
    );

    expect(response.status).toBe(201);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.manage");
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/service_role|secret|token/i);
  });

  it("reserves the next version from the path item id, not from the body", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    await handlers.reserveVersion(
      jsonRequest("POST", { clientUploadId: "local-2" }, "/items/x/versions"),
      params({ itemId: ITEM_ID }),
    );

    expect(reserveVersion).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      clientUploadId: "local-2",
    });
  });
});

describe("completing an upload", () => {
  it("returns 201 only for a genuinely usable version", async () => {
    complete.mockResolvedValue({
      status: "usable",
      itemId: ITEM_ID,
      versionId: VERSION_ID,
      replayed: false,
      contentHash: "a".repeat(64),
      mimeType: "image/png",
      byteSize: 1_000,
      widthPx: 800,
      heightPx: 800,
      uploadState: "needs_review",
    });
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.completeVersion(
      new Request("http://localhost/items/x/versions/y/complete", { method: "POST" }),
      params({ itemId: ITEM_ID, versionId: VERSION_ID }),
    );

    expect(response.status).toBe(201);
  });

  it("never returns 200 for a refused outcome", async () => {
    complete.mockResolvedValue({
      status: "refused",
      itemId: ITEM_ID,
      versionId: VERSION_ID,
      reason: "corrupt_image",
      message: "The image could not be read.",
      uploadState: "refused",
    });
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.completeVersion(
      new Request("http://localhost/items/x/versions/y/complete", { method: "POST" }),
      params({ itemId: ITEM_ID, versionId: VERSION_ID }),
    );

    expect(response.status).toBe(422);
    expect(response.status).not.toBe(200);
  });

  it("reports changed bytes under the same key as a 409 conflict, never a silent overwrite", async () => {
    complete.mockResolvedValue({
      status: "conflict",
      itemId: ITEM_ID,
      versionId: VERSION_ID,
      reason: "changed_bytes",
      message: "A different file is now at this upload slot.",
      uploadState: "refused",
    });
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.completeVersion(
      new Request("http://localhost/items/x/versions/y/complete", { method: "POST" }),
      params({ itemId: ITEM_ID, versionId: VERSION_ID }),
    );

    expect(response.status).toBe(409);
  });

  it("always answers 200 for a batch, letting each member carry its own status", async () => {
    completeBatch.mockResolvedValue({
      outcomes: [
        { status: "usable", itemId: ITEM_ID, versionId: VERSION_ID },
        { status: "refused", itemId: "20000000-0000-4000-8000-0000000000ff", versionId: VERSION_ID },
      ],
      usableCount: 1,
      retryable: [{ itemId: "20000000-0000-4000-8000-0000000000ff", versionId: VERSION_ID }],
    });
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.completeBatch(
      jsonRequest("POST", {
        uploads: [
          { itemId: ITEM_ID, versionId: VERSION_ID },
          { itemId: "20000000-0000-4000-8000-0000000000ff", versionId: VERSION_ID },
        ],
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.retryable).toEqual([
      { itemId: "20000000-0000-4000-8000-0000000000ff", versionId: VERSION_ID },
    ]);
  });
});

describe("updating an item", () => {
  it("archives under asset.manage when the body says archived", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    await handlers.updateItem(
      jsonRequest("PATCH", { archived: true }),
      params({ itemId: ITEM_ID }),
    );

    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.manage");
    expect(archive).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID, itemId: ITEM_ID });
    expect(confirmMetadata).not.toHaveBeenCalled();
  });

  it("confirms metadata under asset.manage when the body carries confirmedMetadata", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    await handlers.updateItem(
      jsonRequest("PATCH", { confirmedMetadata: null }),
      params({ itemId: ITEM_ID }),
    );

    expect(confirmMetadata).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      confirmedMetadata: null,
    });
    expect(archive).not.toHaveBeenCalled();
  });
});

describe("review", () => {
  it("is gated by asset.review, a different permission from asset.manage", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.review(
      jsonRequest("POST", { versionId: VERSION_ID, verdict: "approved" }),
      params({ itemId: ITEM_ID }),
    );

    expect(response.status).toBe(201);
    expect(context).toHaveBeenCalledWith(expect.any(Promise), "asset.review");
  });

  it("takes the design id from the URL, never from the body", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    await handlers.review(
      jsonRequest("POST", {
        itemId: "20000000-0000-4000-8000-0000000000ff",
        versionId: VERSION_ID,
        verdict: "approved",
      }),
      params({ itemId: ITEM_ID }),
    );

    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: ITEM_ID }),
    );
  });

  it("refuses a rejection with no reason as a 400, before it reaches the service", async () => {
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    const response = await handlers.review(
      jsonRequest("POST", { versionId: VERSION_ID, verdict: "rejected", reasonCodes: [] }),
      params({ itemId: ITEM_ID }),
    );

    expect(response.status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });

  it("checks membership before parsing a malformed body", async () => {
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
    const handlers = createCreativeHistoryRouteHandlers(dependencies());

    await handlers.review(
      new Request("http://localhost/items/x/reviews", { method: "POST", body: "{" }),
      params({ itemId: ITEM_ID }),
    );

    expect(order).toEqual(["context"]);
    expect(review).not.toHaveBeenCalled();
  });
});
