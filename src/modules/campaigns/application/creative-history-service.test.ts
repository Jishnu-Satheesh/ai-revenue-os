import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCreativeHistoryService,
  type CreativeHistoryItemRecord,
  type CreativeHistoryStore,
  type CreativeHistoryVersionRecord,
} from "@/modules/campaigns/application/creative-history-service";
import { DEFAULT_ASSET_INTAKE_LIMITS, ingestCampaignImage } from "@/modules/campaigns/infrastructure/asset-intake";
import {
  creativeHistoryStorageConfiguration,
  creativeHistoryStoragePath,
} from "@/modules/campaigns/infrastructure/creative-history-storage";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "10000000-0000-4000-8000-0000000000ff";
const ITEM_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";
const SECOND_VERSION_ID = "30000000-0000-4000-8000-000000000002";
const FOLDER_ID = "40000000-0000-4000-8000-000000000001";
const NESTED_FOLDER_ID = "40000000-0000-4000-8000-000000000002";
const INTENT_ID = "50000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `${ORGANIZATION_ID}/creative-history/${INTENT_ID}/source`;

const RIGHTS = { status: "owned" as const, confirmedAt: "2026-09-01T10:00:00.000Z" };

const METADATA = {
  subjectTags: ["biryani"],
  occasionTags: ["eid"],
  channels: ["instagram"],
  formats: ["square"],
  markets: ["ae"],
  languages: ["en"],
  objectives: ["awareness"],
  styleTags: ["warm"],
};

const listFolders = vi.fn();
const createFolder = vi.fn();
const listItems = vi.fn();
const readItem = vi.fn();
const createItem = vi.fn();
const reserveVersion = vi.fn();
const finalizeVersion = vi.fn();
const recordReview = vi.fn();
const archiveItem = vi.fn();
const writeMetadata = vi.fn();
const listReviewReasons = vi.fn();

const download = vi.fn();
const upload = vi.fn();
const signPreviews = vi.fn();

const store: CreativeHistoryStore = {
  listFolders,
  createFolder,
  listItems,
  readItem,
  createItem,
  reserveVersion,
  finalizeVersion,
  recordReview,
  archiveItem,
  writeMetadata,
  listReviewReasons,
};

function service(ingest = ingestCampaignImage) {
  return createCreativeHistoryService({
    store,
    objects: { download, upload, signPreviews },
    ingest,
    storage: creativeHistoryStorageConfiguration,
    intakeLimits: DEFAULT_ASSET_INTAKE_LIMITS,
    storagePath: creativeHistoryStoragePath,
    newUploadIntentId: () => INTENT_ID,
  });
}

function version(
  overrides: Partial<CreativeHistoryVersionRecord> = {},
): CreativeHistoryVersionRecord {
  return {
    organizationId: ORGANIZATION_ID,
    versionId: VERSION_ID,
    itemId: ITEM_ID,
    version: 1,
    storagePath: STORAGE_PATH,
    sourcePosterRenderId: null,
    contentHash: null,
    mimeType: null,
    byteSize: null,
    widthPx: null,
    heightPx: null,
    isUsable: false,
    finalizedAt: null,
    createdAt: "2026-09-10T09:00:00.000Z",
    ...overrides,
  };
}

function usableVersion(overrides: Partial<CreativeHistoryVersionRecord> = {}) {
  return version({
    isUsable: true,
    contentHash: "a".repeat(64),
    mimeType: "image/png",
    byteSize: 1_000,
    widthPx: 800,
    heightPx: 800,
    finalizedAt: "2026-09-10T09:05:00.000Z",
    ...overrides,
  });
}

function item(overrides: Partial<CreativeHistoryItemRecord> = {}): CreativeHistoryItemRecord {
  return {
    organizationId: ORGANIZATION_ID,
    itemId: ITEM_ID,
    folderId: null,
    label: "Eid family poster",
    creativeType: "poster",
    sourceKind: "historical_upload",
    rights: RIGHTS,
    confirmedMetadata: null,
    proposedMetadata: null,
    archivedAt: null,
    createdAt: "2026-09-10T09:00:00.000Z",
    versions: [version()],
    reviews: [],
    ...overrides,
  };
}

let png: Buffer;
let exifJpeg: Buffer;

beforeAll(async () => {
  png = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 5, g: 10, b: 15 } },
  })
    .png()
    .toBuffer();
  exifJpeg = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .withExifMerge({ IFD0: { Copyright: "VENUE-GPS-MARKER" } })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  for (const mock of [
    listFolders,
    createFolder,
    listItems,
    readItem,
    createItem,
    reserveVersion,
    finalizeVersion,
    recordReview,
    archiveItem,
    writeMetadata,
    listReviewReasons,
    download,
    upload,
    signPreviews,
  ]) {
    mock.mockReset();
  }
  listFolders.mockResolvedValue([]);
  listItems.mockResolvedValue([]);
  readItem.mockResolvedValue(item());
  createItem.mockResolvedValue({ itemId: ITEM_ID, versionId: VERSION_ID });
  reserveVersion.mockResolvedValue({
    itemId: ITEM_ID,
    versionId: SECOND_VERSION_ID,
    version: 2,
    storagePath: STORAGE_PATH,
  });
  createFolder.mockResolvedValue({ folderId: FOLDER_ID });
  recordReview.mockResolvedValue({
    reviewId: "60000000-0000-4000-8000-000000000001",
    verdict: "approved",
    reviewedAt: "2026-09-11T09:00:00.000Z",
  });
  archiveItem.mockResolvedValue({ itemId: ITEM_ID, archivedAt: "2026-09-12T09:00:00.000Z" });
  writeMetadata.mockResolvedValue({ itemId: ITEM_ID, metadataConfirmed: true });
  listReviewReasons.mockResolvedValue([]);
  download.mockResolvedValue(png);
  upload.mockResolvedValue(true);
  signPreviews.mockResolvedValue({});
});

describe("the intake contract the browser is handed", () => {
  it("names the permitted types and size from Storage and the intake contract, not from a component", () => {
    const intake = service().intakeContract();

    expect(intake.bucket).toBe("creative-assets");
    expect([...intake.allowedMimeTypes].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    // 15 MB: the bucket's own file_size_limit and the intake contract agree.
    expect(intake.maxBytes).toBe(15_728_640);
    expect(intake.minWidthPx).toBeGreaterThan(0);
  });

  it("carries no credential, key or secret of any kind", () => {
    const serialized = JSON.stringify(service().intakeContract());

    for (const forbidden of ["key", "secret", "token", "service_role", "password"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("says plainly that the browser's own checks do not decide", () => {
    expect(service().intakeContract().clientValidationIsAdvisory).toBe(true);
  });
});

describe("creating a folder", () => {
  it("passes a top-level folder straight through", async () => {
    await service().createFolder({ organizationId: ORGANIZATION_ID, name: "Ramadan" });

    expect(createFolder).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID, name: "Ramadan" }),
    );
  });

  it("refuses a grandchild folder before the database has to", async () => {
    listFolders.mockResolvedValue([
      {
        organizationId: ORGANIZATION_ID,
        folderId: NESTED_FOLDER_ID,
        parentFolderId: FOLDER_ID,
        name: "Eid",
        defaultMetadata: null,
        archivedAt: null,
      },
    ]);

    await expect(
      service().createFolder({
        organizationId: ORGANIZATION_ID,
        name: "Eid 2026",
        parentFolderId: NESTED_FOLDER_ID,
      }),
    ).rejects.toThrow(/one level deep/i);
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("refuses a parent that belongs to nobody it can see, which is how a cycle would start", async () => {
    listFolders.mockResolvedValue([]);

    await expect(
      service().createFolder({
        organizationId: ORGANIZATION_ID,
        name: "Stolen",
        parentFolderId: FOLDER_ID,
      }),
    ).rejects.toThrow(/not available/i);
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("refuses an archived parent", async () => {
    listFolders.mockResolvedValue([
      {
        organizationId: ORGANIZATION_ID,
        folderId: FOLDER_ID,
        parentFolderId: null,
        name: "Old",
        defaultMetadata: null,
        archivedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);

    await expect(
      service().createFolder({
        organizationId: ORGANIZATION_ID,
        name: "Child",
        parentFolderId: FOLDER_ID,
      }),
    ).rejects.toThrow(/archived/i);
  });
});

describe("reserving an upload", () => {
  it("builds the object key itself, inside the caller's own tenant folder", async () => {
    const reservation = await service().reserveItem({
      organizationId: ORGANIZATION_ID,
      label: "Eid family poster",
      creativeType: "poster",
      rights: RIGHTS,
      clientUploadId: "file-1",
    });

    expect(reservation.storagePath).toBe(STORAGE_PATH);
    expect(reservation.storagePath.startsWith(`${ORGANIZATION_ID}/`)).toBe(true);
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID, storagePath: STORAGE_PATH }),
    );
  });

  it("gives each file in a batch its own key, so two poster.png uploads never collide", async () => {
    let counter = 0;
    const batchService = createCreativeHistoryService({
      store,
      objects: { download, upload, signPreviews },
      ingest: ingestCampaignImage,
      storage: creativeHistoryStorageConfiguration,
      intakeLimits: DEFAULT_ASSET_INTAKE_LIMITS,
      storagePath: creativeHistoryStoragePath,
      newUploadIntentId: () => `5000000${(counter += 1)}-0000-4000-8000-000000000001`,
    });

    const first = await batchService.reserveItem({
      organizationId: ORGANIZATION_ID,
      label: "poster",
      creativeType: "poster",
      rights: RIGHTS,
      clientUploadId: "local-1",
    });
    const second = await batchService.reserveItem({
      organizationId: ORGANIZATION_ID,
      label: "poster",
      creativeType: "poster",
      rights: RIGHTS,
      clientUploadId: "local-2",
    });

    expect(first.storagePath).not.toBe(second.storagePath);
    expect(first.clientUploadId).toBe("local-1");
    expect(second.clientUploadId).toBe("local-2");
  });

  it("refuses a folder the caller cannot see", async () => {
    listFolders.mockResolvedValue([]);

    await expect(
      service().reserveItem({
        organizationId: ORGANIZATION_ID,
        label: "Eid family poster",
        creativeType: "poster",
        folderId: FOLDER_ID,
        rights: RIGHTS,
        clientUploadId: "file-1",
      }),
    ).rejects.toThrow(/not available/i);
    expect(createItem).not.toHaveBeenCalled();
  });

  it("will not let a person create a Studio-linked design by hand", async () => {
    await expect(
      service().reserveItem({
        organizationId: ORGANIZATION_ID,
        label: "Fake render",
        creativeType: "poster",
        sourceKind: "studio_render",
        rights: RIGHTS,
        clientUploadId: "file-1",
      } as never),
    ).rejects.toThrow();
    expect(createItem).not.toHaveBeenCalled();
  });

  it("requires a rights answer, because copying somebody else's design is not a default", async () => {
    await expect(
      service().reserveItem({
        organizationId: ORGANIZATION_ID,
        label: "Eid family poster",
        creativeType: "poster",
        clientUploadId: "file-1",
      } as never),
    ).rejects.toThrow();
  });

  it("takes the next version number from the database, not from the request", async () => {
    const reservation = await service().reserveVersion({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      clientUploadId: "file-2",
    });

    expect(reservation.version).toBe(2);
    expect(reservation.versionId).toBe(SECOND_VERSION_ID);
  });
});

describe("finishing an upload", () => {
  it("stores the re-encoded bytes and marks the version usable", async () => {
    const outcome = await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    expect(outcome.status).toBe("usable");
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ path: STORAGE_PATH }));
    expect(finalizeVersion).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID, versionId: VERSION_ID }),
    );
  });

  it("strips the location a phone photograph carries before anything is stored", async () => {
    download.mockResolvedValue(exifJpeg);

    await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    const stored = upload.mock.calls[0][0].bytes as Buffer;
    expect(stored.includes(Buffer.from("VENUE-GPS-MARKER"))).toBe(false);
  });

  it("says new bytes still need a human, even on the second version of an approved design", async () => {
    const outcome = await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    expect(outcome).toMatchObject({ status: "usable", uploadState: "needs_review" });
  });

  it("refuses bytes that are not a readable image, and says so as a refusal", async () => {
    download.mockResolvedValue(Buffer.from("this is not a picture"));

    const outcome = await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    expect(outcome).toMatchObject({ status: "refused", uploadState: "refused" });
    expect(finalizeVersion).not.toHaveBeenCalled();
  });

  it("refuses when nothing was ever uploaded to the reserved key", async () => {
    download.mockResolvedValue(null);

    const outcome = await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "upload_missing" });
  });

  it("leaves the version unusable when the checked bytes cannot be stored", async () => {
    upload.mockResolvedValue(false);

    const outcome = await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "storage_failed" });
    expect(finalizeVersion).not.toHaveBeenCalled();
  });

  it("takes the object key from the stored row, never from the request", async () => {
    readItem.mockResolvedValue(
      item({ versions: [version({ storagePath: `${OTHER_ORGANIZATION_ID}/elsewhere/source` })] }),
    );

    await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    // The row is what was asked for. A request cannot name its own object,
    // because it is never consulted about where the bytes live.
    expect(download).toHaveBeenCalledWith(`${OTHER_ORGANIZATION_ID}/elsewhere/source`);
  });

  it("is unavailable for a design this tenant cannot see", async () => {
    readItem.mockResolvedValue(null);

    await expect(
      service().complete({
        organizationId: ORGANIZATION_ID,
        itemId: ITEM_ID,
        versionId: VERSION_ID,
      }),
    ).rejects.toThrow(/not available/i);
  });
});

describe("a finalize whose response was lost", () => {
  it("replays the same version rather than creating a second one", async () => {
    const canonical = await sharp(png).png({ compressionLevel: 9 }).toBuffer();
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(canonical).digest("hex");

    readItem.mockResolvedValue(item({ versions: [usableVersion({ contentHash: hash })] }));
    download.mockResolvedValue(canonical);

    const outcome = await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    expect(outcome).toMatchObject({ status: "usable", replayed: true, versionId: VERSION_ID });
    expect(finalizeVersion).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("calls changed bytes under the same key a conflict, not an overwrite", async () => {
    readItem.mockResolvedValue(item({ versions: [usableVersion({ contentHash: "b".repeat(64) })] }));
    download.mockResolvedValue(png);

    const outcome = await service().complete({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
    });

    expect(outcome).toMatchObject({ status: "conflict", reason: "changed_bytes" });
    expect(finalizeVersion).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("a batch where one file fails", () => {
  it("keeps the good ones and names only the failures for retry", async () => {
    const goodItem = "20000000-0000-4000-8000-00000000000a";
    const badItem = "20000000-0000-4000-8000-00000000000b";
    const badVersion = "30000000-0000-4000-8000-00000000000b";

    readItem.mockImplementation(async ({ itemId }: { itemId: string }) =>
      itemId === goodItem
        ? item({ itemId: goodItem, versions: [version({ itemId: goodItem })] })
        : item({
            itemId: badItem,
            versions: [version({ itemId: badItem, versionId: badVersion })],
          }),
    );
    download.mockImplementation(async () =>
      finalizeVersion.mock.calls.length === 0 ? png : Buffer.from("broken"),
    );

    const result = await service().completeBatch({
      organizationId: ORGANIZATION_ID,
      uploads: [
        { itemId: goodItem, versionId: VERSION_ID },
        { itemId: badItem, versionId: badVersion },
      ],
    });

    expect(result.usableCount).toBe(1);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["usable", "refused"]);
    expect(result.retryable).toEqual([{ itemId: badItem, versionId: badVersion }]);
    // The good file's version was finalized and stays finalized.
    expect(finalizeVersion).toHaveBeenCalledTimes(1);
  });

  it("turns an unavailable member into that member's own refusal, not the batch's", async () => {
    readItem.mockImplementation(async ({ itemId }: { itemId: string }) =>
      itemId === ITEM_ID ? item() : null,
    );

    const result = await service().completeBatch({
      organizationId: ORGANIZATION_ID,
      uploads: [
        { itemId: ITEM_ID, versionId: VERSION_ID },
        { itemId: "20000000-0000-4000-8000-0000000000ff", versionId: VERSION_ID },
      ],
    });

    expect(result.usableCount).toBe(1);
    expect(result.outcomes[1]).toMatchObject({ status: "refused" });
  });
});

describe("reviewing a design", () => {
  it("records an approval against the exact version", async () => {
    readItem.mockResolvedValue(item({ versions: [usableVersion()] }));

    await service().review({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      versionId: VERSION_ID,
      verdict: "approved",
    });

    expect(recordReview).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: VERSION_ID, verdict: "approved", reasonCodes: [] }),
    );
  });

  it("refuses a rejection with no reason", async () => {
    readItem.mockResolvedValue(item({ versions: [usableVersion()] }));

    await expect(
      service().review({
        organizationId: ORGANIZATION_ID,
        itemId: ITEM_ID,
        versionId: VERSION_ID,
        verdict: "rejected",
        reasonCodes: [],
      }),
    ).rejects.toThrow();
    expect(recordReview).not.toHaveBeenCalled();
  });

  it("refuses a verdict on a version that belongs to another design", async () => {
    readItem.mockResolvedValue(item({ versions: [usableVersion()] }));

    await expect(
      service().review({
        organizationId: ORGANIZATION_ID,
        itemId: ITEM_ID,
        versionId: SECOND_VERSION_ID,
        verdict: "approved",
      }),
    ).rejects.toThrow(/not available/i);
  });

  it("refuses a verdict on bytes that are not finished uploading", async () => {
    readItem.mockResolvedValue(item({ versions: [version()] }));

    await expect(
      service().review({
        organizationId: ORGANIZATION_ID,
        itemId: ITEM_ID,
        versionId: VERSION_ID,
        verdict: "approved",
      }),
    ).rejects.toThrow(/finished uploading/i);
  });
});

describe("metadata", () => {
  it("keeps a model's suggestion out of the column a person confirms", async () => {
    await service().proposeMetadata({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      proposedMetadata: METADATA,
    });

    expect(writeMetadata).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      proposedMetadata: METADATA,
    });
    expect(writeMetadata.mock.calls[0][0]).not.toHaveProperty("confirmedMetadata");
  });

  it("writes a person's answer to the confirmed column alone", async () => {
    await service().confirmMetadata({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      confirmedMetadata: METADATA,
    });

    expect(writeMetadata.mock.calls[0][0]).not.toHaveProperty("proposedMetadata");
  });
});

describe("the read model", () => {
  it("reports an unreviewed design as needing review, not as ready", async () => {
    listItems.mockResolvedValue([
      item({ confirmedMetadata: METADATA, versions: [usableVersion()] }),
    ]);

    const [view] = await service().list({ organizationId: ORGANIZATION_ID });

    expect(view.uploadState).toBe("needs_review");
    expect(view.eligibility).toBe("unreviewed");
  });

  it("reports a design whose file is still uploading as reserved, with no current version", async () => {
    listItems.mockResolvedValue([item()]);

    const [view] = await service().list({ organizationId: ORGANIZATION_ID });

    expect(view.uploadState).toBe("reserved");
    expect(view.currentVersion).toBeNull();
    expect(view.pendingVersion?.versionId).toBe(VERSION_ID);
  });

  it("keeps a design without confirmed metadata out of selection and says why", async () => {
    listItems.mockResolvedValue([
      item({
        versions: [usableVersion()],
        reviews: [
          {
            reviewId: "60000000-0000-4000-8000-000000000001",
            versionId: VERSION_ID,
            verdict: "approved",
            reasonCodes: [],
            note: null,
            reviewedAt: "2026-09-11T09:00:00.000Z",
            reviewedBy: "70000000-0000-4000-8000-000000000001",
          },
        ],
      }),
    ]);

    const [view] = await service().list({ organizationId: ORGANIZATION_ID });

    expect(view.eligibility).toBe("metadata_unconfirmed");
  });

  it("marks a confirmed, approved design eligible", async () => {
    listItems.mockResolvedValue([
      item({
        confirmedMetadata: METADATA,
        versions: [usableVersion()],
        reviews: [
          {
            reviewId: "60000000-0000-4000-8000-000000000001",
            versionId: VERSION_ID,
            verdict: "approved",
            reasonCodes: [],
            note: null,
            reviewedAt: "2026-09-11T09:00:00.000Z",
            reviewedBy: "70000000-0000-4000-8000-000000000001",
          },
        ],
      }),
    ]);

    const [view] = await service().list({ organizationId: ORGANIZATION_ID });

    expect(view.eligibility).toBe("eligible_approved");
  });

  it("uses the most recent verdict and keeps the earlier one as history", async () => {
    listItems.mockResolvedValue([
      item({
        confirmedMetadata: METADATA,
        versions: [usableVersion()],
        reviews: [
          {
            reviewId: "60000000-0000-4000-8000-000000000001",
            versionId: VERSION_ID,
            verdict: "approved",
            reasonCodes: [],
            note: null,
            reviewedAt: "2026-09-11T09:00:00.000Z",
            reviewedBy: "70000000-0000-4000-8000-000000000001",
          },
          {
            reviewId: "60000000-0000-4000-8000-000000000002",
            versionId: VERSION_ID,
            verdict: "rejected",
            reasonCodes: ["off_brand_colour"],
            note: null,
            reviewedAt: "2026-09-12T09:00:00.000Z",
            reviewedBy: "70000000-0000-4000-8000-000000000001",
          },
        ],
      }),
    ]);

    const [view] = await service().list({ organizationId: ORGANIZATION_ID });

    expect(view.currentVersion?.review?.verdict).toBe("rejected");
    expect(view.eligibility).toBe("eligible_rejected");
  });

  it("keeps every receipt after a design is archived", async () => {
    listItems.mockResolvedValue([
      item({
        archivedAt: "2026-09-12T00:00:00.000Z",
        confirmedMetadata: METADATA,
        versions: [usableVersion()],
        reviews: [
          {
            reviewId: "60000000-0000-4000-8000-000000000001",
            versionId: VERSION_ID,
            verdict: "approved",
            reasonCodes: [],
            note: null,
            reviewedAt: "2026-09-11T09:00:00.000Z",
            reviewedBy: "70000000-0000-4000-8000-000000000001",
          },
        ],
      }),
    ]);

    const [view] = await service().list({ organizationId: ORGANIZATION_ID, includeArchived: true });

    expect(view.eligibility).toBe("archived");
    expect(view.currentVersion?.review?.verdict).toBe("approved");
  });

  it("never hands the browser a storage path", async () => {
    listItems.mockResolvedValue([item({ versions: [usableVersion()] })]);
    signPreviews.mockResolvedValue({ [STORAGE_PATH]: "https://signed.example/preview" });

    const views = await service().list({ organizationId: ORGANIZATION_ID });

    expect(JSON.stringify(views)).not.toContain("creative-history/");
    expect(views[0].currentVersion?.previewUrl).toBe("https://signed.example/preview");
  });

  it("shows the design without its picture when signing fails, rather than nothing at all", async () => {
    listItems.mockResolvedValue([item({ versions: [usableVersion()] })]);
    signPreviews.mockResolvedValue({});

    const [view] = await service().list({ organizationId: ORGANIZATION_ID });

    expect(view.currentVersion?.previewUrl).toBeNull();
    expect(view.label).toBe("Eid family poster");
  });

  it("keeps a folder's suggestion separate from what a person confirmed", async () => {
    listFolders.mockResolvedValue([
      {
        organizationId: ORGANIZATION_ID,
        folderId: FOLDER_ID,
        parentFolderId: null,
        name: "Ramadan",
        defaultMetadata: METADATA,
        archivedAt: null,
      },
    ]);
    listItems.mockResolvedValue([item({ folderId: FOLDER_ID, versions: [usableVersion()] })]);

    const [view] = await service().list({ organizationId: ORGANIZATION_ID });

    expect(view.folderDefaultMetadata).toEqual(METADATA);
    expect(view.confirmedMetadata).toBeNull();
    expect(view.metadataConfirmed).toBe(false);
    // A folder default is a starting point, never a human answer: an item that
    // inherited one is still not selectable.
    expect(view.eligibility).toBe("metadata_unconfirmed");
  });

  it("hides archived designs unless they are asked for", async () => {
    await service().list({ organizationId: ORGANIZATION_ID });
    expect(listItems).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: false }),
    );
  });
});
