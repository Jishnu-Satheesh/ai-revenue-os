import { describe, expect, it, vi } from "vitest";

import type { BrandLogoSelection } from "@/domain/brand/logo";
import { admitGenerationReferences } from "@/domain/creative-studio/schemas";
import { studioReferenceManifestDigest } from "@/domain/creative-studio/digest";
import { DomainError } from "@/lib/errors";
import type { AssetLibraryReference } from "@/modules/campaigns/application/asset-library-service";
import type {
  CreativeHistoryItemRecord,
  CreativeHistoryReviewRecord,
  CreativeHistoryVersionRecord,
} from "@/modules/campaigns/application/creative-history-service";
import type { StudioUploadRecord } from "@/modules/creative-studio/infrastructure/reference-reader";
import {
  createStudioReferenceService,
  type StudioManifestSelection,
  type StudioReferenceServiceDependencies,
} from "@/modules/creative-studio/application/reference-service";

const ORG = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000002";
const VERSION_H = "00000000-0000-4000-8000-000000000003";
const REVIEW = "00000000-0000-4000-8000-000000000004";
const UPLOAD = "00000000-0000-4000-8000-000000000005";
const ACTOR = "00000000-0000-4000-8000-000000000006";
const ATTESTATION = "00000000-0000-4000-8000-000000000007";
const PROD_ASSET = "00000000-0000-4000-8000-000000000008";
const PROD_VERSION = "00000000-0000-4000-8000-000000000009";
const MARK_ASSET = "00000000-0000-4000-8000-00000000000a";
const MARK_VERSION = "00000000-0000-4000-8000-00000000000b";
const QUAL = "00000000-0000-4000-8000-00000000000c";

const HASH_H = "a".repeat(64);
const HASH_U = "b".repeat(64);
const HASH_P = "c".repeat(64);
const HASH_M = "d".repeat(64);

function confirmedMetadata() {
  return {
    subjectTags: [],
    occasionTags: [],
    channels: [],
    formats: [],
    markets: [],
    languages: [],
    objectives: [],
    styleTags: [],
  };
}

function historyVersion(
  overrides: Partial<CreativeHistoryVersionRecord> = {},
): CreativeHistoryVersionRecord {
  return {
    organizationId: ORG,
    versionId: VERSION_H,
    itemId: ITEM,
    version: 1,
    storagePath: `${ORG}/creative-history/${ITEM}/source`,
    sourcePosterRenderId: null,
    contentHash: HASH_H,
    mimeType: "image/png",
    byteSize: 300_000,
    widthPx: 1080,
    heightPx: 1350,
    isUsable: true,
    finalizedAt: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function historyReview(
  overrides: Partial<CreativeHistoryReviewRecord> = {},
): CreativeHistoryReviewRecord {
  return {
    reviewId: REVIEW,
    versionId: VERSION_H,
    verdict: "approved" as const,
    reasonCodes: [] as readonly string[],
    note: null,
    reviewedAt: "2026-02-02T00:00:00.000Z",
    reviewedBy: ACTOR,
    ...overrides,
  };
}

function historyRecord(
  overrides: Partial<CreativeHistoryItemRecord> = {},
): CreativeHistoryItemRecord {
  return {
    organizationId: ORG,
    itemId: ITEM,
    folderId: null,
    label: "Launch hero",
    creativeType: "poster",
    sourceKind: "stored_file",
    rights: {},
    confirmedMetadata: confirmedMetadata(),
    proposedMetadata: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    versions: [historyVersion()],
    reviews: [historyReview()],
    ...overrides,
  };
}

function uploadRecord(overrides: Partial<StudioUploadRecord> = {}): StudioUploadRecord {
  return {
    organizationId: ORG,
    uploadId: UPLOAD,
    actorId: ACTOR,
    reservedPath: `${ORG}/${UPLOAD}/hero.png`,
    state: "ready" as const,
    rightsAttestation: {
      accepted: true,
      attestationId: ATTESTATION,
      authorizedAiProcessing: true,
      intendedUse: "Studio reference",
    },
    finalHash: HASH_U,
    finalMime: "image/png" as const,
    finalWidth: 1080,
    finalHeight: 1350,
    finalBytes: 150_000,
    expiresAt: "2100-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function libraryReference(
  overrides: Partial<AssetLibraryReference> = {},
): AssetLibraryReference {
  return {
    organizationId: ORG,
    brandAssetId: PROD_ASSET,
    brandAssetVersionId: PROD_VERSION,
    label: "Product hero",
    assetRole: "product" as const,
    conditioningRoles: ["subject"] as AssetLibraryReference["conditioningRoles"],
    tags: [],
    scripts: ["Latn"],
    ownership: "owned" as const,
    archivedAt: null,
    version: 1,
    storagePath: `${ORG}/${PROD_ASSET}/${PROD_VERSION}/source`,
    contentHash: HASH_P,
    mimeType: "image/png" as const,
    byteSize: 200_000,
    widthPx: 800,
    heightPx: 800,
    currentVerdict: null,
    currentReasonCodes: [],
    currentReviewedAt: null,
    ...overrides,
  };
}

function markReference(overrides: Partial<AssetLibraryReference> = {}): AssetLibraryReference {
  return libraryReference({
    brandAssetId: MARK_ASSET,
    brandAssetVersionId: MARK_VERSION,
    label: "Primary mark",
    assetRole: "logo",
    conditioningRoles: ["brand_mark"] as AssetLibraryReference["conditioningRoles"],
    storagePath: `${ORG}/${MARK_ASSET}/${MARK_VERSION}/source`,
    contentHash: HASH_M,
    byteSize: 120_000,
    widthPx: 600,
    heightPx: 600,
    ...overrides,
  });
}

function logoSelections(): BrandLogoSelection[] {
  return [{ variant: "primary", brandAssetVersionId: MARK_VERSION }];
}

function selection(overrides: Partial<StudioManifestSelection> = {}): StudioManifestSelection {
  return {
    history: [{ referenceId: "design-1", itemId: ITEM, versionId: VERSION_H }],
    uploads: [{ referenceId: "upload-1", uploadId: UPLOAD }],
    products: [{ referenceId: "product-1", versionId: PROD_VERSION }],
    marks: [{ referenceId: "mark-1", versionId: MARK_VERSION }],
    ...overrides,
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    provider: "test-provider",
    exactModelId: "test-model-1",
    apiFamily: "test-api",
    adapterVersion: "v1",
    supportedRatios: ["4:5"],
    maxInputBytes: 50_000_000,
    maxImages: 8,
    partialFrameContract: {
      mechanism: "streams decodable frames",
      provenByQualificationId: QUAL,
    },
    continuationContract: {
      mechanism: "opaque continuation token",
      provenByQualificationId: QUAL,
    },
    retentionDisclosure: "test fixtures only",
    measuredQualificationId: QUAL,
    enabled: true,
    ...overrides,
  };
}

function serviceWith(input: {
  uploads?: Record<string, StudioUploadRecord | null>;
  history?: Record<string, CreativeHistoryItemRecord | null>;
  library?: readonly AssetLibraryReference[];
  logos?: readonly BrandLogoSelection[];
  sign?: StudioReferenceServiceDependencies["signPaths"];
}) {
  const seenOrganizations: string[] = [];
  const readUpload = vi.fn(async (organizationId: string, uploadId: string) => {
    seenOrganizations.push(organizationId);
    return input.uploads?.[uploadId] ?? null;
  });
  const readHistoryItem = vi.fn(async (organizationId: string, itemId: string) => {
    seenOrganizations.push(organizationId);
    return input.history?.[itemId] ?? null;
  });
  const listLibraryReferences = vi.fn(async (organizationId: string) => {
    seenOrganizations.push(organizationId);
    return input.library ?? [];
  });
  const readLogoSelections = vi.fn(async (organizationId: string) => {
    seenOrganizations.push(organizationId);
    return input.logos ?? [];
  });
  const signPaths =
    input.sign ??
    (async (entries: readonly { bucket: string; path: string }[]) => {
      const urls: Record<string, string> = {};
      for (const entry of entries) {
        urls[`${entry.bucket}:${entry.path}`] = `https://cdn.test/${entry.bucket}/${entry.path}?sig=1`;
      }
      return urls;
    });
  const service = createStudioReferenceService({
    readUpload,
    readHistoryItem,
    listLibraryReferences,
    readLogoSelections,
    signPaths: vi.fn(signPaths),
  });
  return {
    service,
    readUpload,
    readHistoryItem,
    listLibraryReferences,
    readLogoSelections,
    seenOrganizations,
  };
}

function fullDependencies() {
  return {
    uploads: { [UPLOAD]: uploadRecord() },
    history: { [ITEM]: historyRecord() },
    library: [libraryReference(), markReference()],
    logos: logoSelections(),
  };
}

describe("studio reference manifest", () => {
  it("pins every eligible kind by immutable identity", async () => {
    const { service } = serviceWith(fullDependencies());

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: selection(),
      profile: profile(),
    });

    expect(manifest.references).toEqual([
      {
        kind: "approved_history",
        referenceId: "design-1",
        versionId: VERSION_H,
        reviewId: REVIEW,
        contentHash: HASH_H,
      },
      {
        kind: "uploaded_reference",
        referenceId: "upload-1",
        uploadId: UPLOAD,
        rightsAttestationId: ATTESTATION,
        contentHash: HASH_U,
      },
      {
        kind: "product",
        referenceId: "product-1",
        versionId: PROD_VERSION,
        contentHash: HASH_P,
      },
      {
        kind: "brand_mark",
        referenceId: "mark-1",
        versionId: MARK_VERSION,
        contentHash: HASH_M,
      },
    ]);
    expect(manifest.excluded).toEqual([]);
    expect(manifest.digest).toBe(
      studioReferenceManifestDigest(
        manifest.references.map((reference) => ({
          referenceId: reference.referenceId,
          kind: reference.kind,
          contentHash: reference.contentHash,
        })),
      ),
    );
    expect(manifest.totalImages).toBe(4);
    // Stored bytes travel base64, so every byte costs ~4/3 on the wire:
    // (300_000 + 150_000 + 200_000 + 120_000) * 4/3, rounded up.
    expect(manifest.estimatedInputBytes).toBe(1_026_667);
  });

  it("excludes rejected and unreviewed history before the provider input builder sees them", async () => {
    const rejectedVersion = "00000000-0000-4000-8000-0000000000e1";
    const unreviewedVersion = "00000000-0000-4000-8000-0000000000e2";
    const { service } = serviceWith({
      ...fullDependencies(),
      history: {
        [ITEM]: historyRecord({
          versions: [
            historyVersion(),
            historyVersion({
              versionId: rejectedVersion,
              version: 2,
              contentHash: "e".repeat(64),
              storagePath: `${ORG}/creative-history/${ITEM}/v2`,
            }),
            historyVersion({
              versionId: unreviewedVersion,
              version: 3,
              contentHash: "f".repeat(64),
              storagePath: `${ORG}/creative-history/${ITEM}/v3`,
            }),
          ],
          reviews: [
            historyReview(),
            historyReview({
              reviewId: "00000000-0000-4000-8000-0000000000e3",
              versionId: rejectedVersion,
              verdict: "rejected",
              reviewedAt: "2026-03-01T00:00:00.000Z",
            }),
          ],
        }),
      },
    });

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: selection({
        history: [
          { referenceId: "design-1", itemId: ITEM, versionId: VERSION_H },
          { referenceId: "design-2", itemId: ITEM, versionId: rejectedVersion },
          { referenceId: "design-3", itemId: ITEM, versionId: unreviewedVersion },
        ],
        uploads: [],
        products: [],
        marks: [],
      }),
      profile: profile(),
    });

    expect(manifest.references.map((reference) => reference.referenceId)).toEqual(["design-1"]);
    expect(manifest.excluded).toEqual([
      expect.objectContaining({ referenceId: "design-2", kind: "approved_history", reason: "rejected" }),
      expect.objectContaining({
        referenceId: "design-3",
        kind: "approved_history",
        reason: "unreviewed",
      }),
    ]);
    // What reaches the real provider-input builder carries no rejected design.
    const admission = admitGenerationReferences({
      references: manifest.references,
      parentImageCount: 0,
      markerOverlayCount: 0,
      estimatedInputBytes: manifest.estimatedInputBytes,
      profile: { maxImages: 8, maxInputBytes: 50_000_000 },
    });
    expect(admission).toEqual({ admitted: true });
  });

  it("excludes a design whose review was revoked between pick and dispatch", async () => {
    const history = { [ITEM]: historyRecord() };
    const { service } = serviceWith({ ...fullDependencies(), history });
    const picked = selection({ uploads: [], products: [], marks: [] });

    const first = await service.buildManifest({
      organizationId: ORG,
      selection: picked,
      profile: profile(),
    });
    expect(first.references).toHaveLength(1);

    // The reviewer rejects after the pick. Every build reads fresh state, so
    // the dispatch-time rebuild excludes without touching the earlier manifest.
    history[ITEM] = historyRecord({
      reviews: [historyReview({ verdict: "rejected", reviewedAt: "2026-04-01T00:00:00.000Z" })],
    });
    const second = await service.buildManifest({
      organizationId: ORG,
      selection: picked,
      profile: profile(),
    });

    expect(second.references).toEqual([]);
    expect(second.excluded).toEqual([
      expect.objectContaining({ referenceId: "design-1", reason: "rejected" }),
    ]);
    expect(first.references).toHaveLength(1);
  });

  it("reads foreign upload and object ids as absent", async () => {
    const { service } = serviceWith({ library: [], logos: [] });

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: selection(),
      profile: profile(),
    });

    expect(manifest.references).toEqual([]);
    expect(manifest.excluded.map((entry) => [entry.referenceId, entry.reason])).toEqual([
      ["design-1", "not_found"],
      ["upload-1", "not_found"],
      ["product-1", "not_found"],
      ["mark-1", "not_selected"],
    ]);
    expect(manifest.totalImages).toBe(0);
    expect(manifest.digest).toBe(studioReferenceManifestDigest([]));
  });

  it("lets the most recent verdict win when a version was reviewed twice", async () => {
    const { service } = serviceWith({
      ...fullDependencies(),
      history: {
        [ITEM]: historyRecord({
          // Stored oldest-first here; the rule reads timestamps, not position.
          reviews: [
            historyReview({ reviewedAt: "2026-02-02T00:00:00.000Z" }),
            historyReview({
              reviewId: "00000000-0000-4000-8000-0000000000e4",
              verdict: "rejected",
              reviewedAt: "2026-05-01T00:00:00.000Z",
            }),
          ],
        }),
      },
    });

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: selection({ uploads: [], products: [], marks: [] }),
      profile: profile(),
    });

    expect(manifest.references).toEqual([]);
    expect(manifest.excluded).toEqual([
      expect.objectContaining({ referenceId: "design-1", reason: "rejected" }),
    ]);
  });

  it("excludes archived designs, unconfirmed metadata, and versions without approved bytes", async () => {
    const archivedItem = "00000000-0000-4000-8000-0000000000b1";
    const unconfirmedItem = "00000000-0000-4000-8000-0000000000b2";
    const reservedItem = "00000000-0000-4000-8000-0000000000b3";
    const { service } = serviceWith({
      uploads: {},
      history: {
        [archivedItem]: historyRecord({ itemId: archivedItem, archivedAt: "2026-03-01T00:00:00.000Z" }),
        [unconfirmedItem]: historyRecord({ itemId: unconfirmedItem, confirmedMetadata: null }),
        [reservedItem]: historyRecord({
          itemId: reservedItem,
          versions: [historyVersion({ isUsable: false, storagePath: null })],
        }),
      },
      library: [],
      logos: [],
    });

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: {
        history: [
          { referenceId: "archived", itemId: archivedItem, versionId: VERSION_H },
          { referenceId: "unconfirmed", itemId: unconfirmedItem, versionId: VERSION_H },
          { referenceId: "reserved", itemId: reservedItem, versionId: VERSION_H },
          { referenceId: "missing-version", itemId: ITEM, versionId: VERSION_H },
        ],
        uploads: [],
        products: [],
        marks: [],
      },
      profile: profile(),
    });

    expect(manifest.references).toEqual([]);
    expect(manifest.excluded.map((entry) => [entry.referenceId, entry.reason])).toEqual([
      ["archived", "archived"],
      ["unconfirmed", "metadata_unconfirmed"],
      ["reserved", "version_not_usable"],
      ["missing-version", "not_found"],
    ]);
  });

  it("excludes uploads that are unfinished, expired, refused, or unattested", async () => {
    const states = {
      reserved: "00000000-0000-4000-8000-0000000000c1",
      expired: "00000000-0000-4000-8000-0000000000c2",
      rejected: "00000000-0000-4000-8000-0000000000c3",
      unattested: "00000000-0000-4000-8000-0000000000c4",
      incomplete: "00000000-0000-4000-8000-0000000000c5",
    } as const;
    const { service } = serviceWith({
      uploads: {
        [states.reserved]: uploadRecord({ uploadId: states.reserved, state: "reserved" }),
        [states.expired]: uploadRecord({
          uploadId: states.expired,
          state: "expired",
          expiresAt: "2000-01-01T00:00:00.000Z",
        }),
        [states.rejected]: uploadRecord({ uploadId: states.rejected, state: "rejected" }),
        [states.unattested]: uploadRecord({
          uploadId: states.unattested,
          rightsAttestation: { accepted: false },
        }),
        [states.incomplete]: uploadRecord({
          uploadId: states.incomplete,
          finalHash: null,
          finalBytes: null,
        }),
      },
      history: {},
      library: [],
      logos: [],
    });

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: {
        history: [],
        uploads: [
          { referenceId: "still-reserved", uploadId: states.reserved },
          { referenceId: "went-expired", uploadId: states.expired },
          { referenceId: "was-refused", uploadId: states.rejected },
          { referenceId: "no-rights", uploadId: states.unattested },
          { referenceId: "no-hash", uploadId: states.incomplete },
        ],
        products: [],
        marks: [],
      },
      profile: profile(),
    });

    expect(manifest.references).toEqual([]);
    expect(manifest.excluded.map((entry) => [entry.referenceId, entry.reason])).toEqual([
      ["still-reserved", "not_ready"],
      ["went-expired", "expired"],
      ["was-refused", "rejected"],
      ["no-rights", "rights_missing"],
      ["no-hash", "hash_missing"],
    ]);
  });

  it("excludes products that are missing, archived, or not product photography", async () => {
    const archivedVersion = "00000000-0000-4000-8000-0000000000d1";
    const venueVersion = "00000000-0000-4000-8000-0000000000d2";
    const { service } = serviceWith({
      uploads: {},
      history: {},
      library: [
        libraryReference(),
        libraryReference({
          brandAssetVersionId: archivedVersion,
          archivedAt: "2026-03-01T00:00:00.000Z",
        }),
        libraryReference({ brandAssetVersionId: venueVersion, assetRole: "venue" }),
      ],
      logos: [],
    });

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: selection({ history: [], uploads: [], marks: [] , products: [
        { referenceId: "product-1", versionId: PROD_VERSION },
        { referenceId: "product-2", versionId: archivedVersion },
        { referenceId: "product-3", versionId: venueVersion },
        { referenceId: "product-4", versionId: "00000000-0000-4000-8000-0000000000d3" },
      ]}),
      profile: profile(),
    });

    expect(manifest.references.map((reference) => reference.referenceId)).toEqual(["product-1"]);
    expect(manifest.excluded.map((entry) => [entry.referenceId, entry.reason])).toEqual([
      ["product-2", "archived"],
      ["product-3", "not_a_product"],
      ["product-4", "not_found"],
    ]);
  });

  it("resolves only selected brand marks with displayable bytes", async () => {
    const archivedVersion = "00000000-0000-4000-8000-0000000000d4";
    const rejectedVersion = "00000000-0000-4000-8000-0000000000d5";
    const unselectedVersion = "00000000-0000-4000-8000-0000000000d6";
    const { service } = serviceWith({
      uploads: {},
      history: {},
      library: [
        markReference(),
        markReference({
          brandAssetVersionId: archivedVersion,
          archivedAt: "2026-03-01T00:00:00.000Z",
        }),
        markReference({ brandAssetVersionId: rejectedVersion, currentVerdict: "rejected" }),
        markReference({ brandAssetVersionId: unselectedVersion }),
      ],
      logos: [
        { variant: "primary", brandAssetVersionId: MARK_VERSION },
        { variant: "dark", brandAssetVersionId: archivedVersion },
      ],
    });

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: selection({
        history: [],
        uploads: [],
        products: [],
        marks: [
          { referenceId: "mark-1", versionId: MARK_VERSION },
          { referenceId: "mark-2", versionId: archivedVersion },
          { referenceId: "mark-3", versionId: rejectedVersion },
          { referenceId: "mark-4", versionId: unselectedVersion },
        ],
      }),
      profile: profile(),
    });

    expect(manifest.references.map((reference) => reference.referenceId)).toEqual(["mark-1"]);
    expect(manifest.excluded.map((entry) => [entry.referenceId, entry.reason])).toEqual([
      ["mark-2", "archived"],
      ["mark-3", "not_selected"],
      ["mark-4", "not_selected"],
    ]);
  });

  it("refuses a selected mark the platform no longer displays", async () => {
    const rejectedVersion = "00000000-0000-4000-8000-0000000000d7";
    const { service } = serviceWith({
      uploads: {},
      history: {},
      library: [markReference({ brandAssetVersionId: rejectedVersion, currentVerdict: "rejected" })],
      logos: [{ variant: "primary", brandAssetVersionId: rejectedVersion }],
    });

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: selection({
        history: [],
        uploads: [],
        products: [],
        marks: [{ referenceId: "mark-1", versionId: rejectedVersion }],
      }),
      profile: profile(),
    });

    expect(manifest.references).toEqual([]);
    expect(manifest.excluded).toEqual([
      expect.objectContaining({ referenceId: "mark-1", kind: "brand_mark", reason: "rejected" }),
    ]);
  });

  it("refuses the whole build when the encoded request overflows the profile", async () => {
    const { service } = serviceWith(fullDependencies());

    // The four eligible references encode to 1_026_667 bytes on the wire.
    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection(),
        profile: profile({ maxInputBytes: 1_026_666 }),
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection(),
        profile: profile({ maxInputBytes: 1_026_666 }),
      }),
    ).rejects.toThrow(/carries 1026666 bytes/);

    // Additional provider input counts against the same cap.
    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection(),
        profile: profile({ maxInputBytes: 1_026_667 }),
        additionalInputBytes: 1,
      }),
    ).rejects.toThrow(/carries 1026667 bytes/);
  });

  it("counts parent and marker carriers against the profile image cap", async () => {
    const { service } = serviceWith(fullDependencies());

    const ok = await service.buildManifest({
      organizationId: ORG,
      selection: selection(),
      profile: profile({ maxImages: 6 }),
      parentImageCount: 1,
      markerOverlayCount: 1,
    });
    expect(ok.totalImages).toBe(6);

    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection(),
        profile: profile({ maxImages: 5 }),
        parentImageCount: 1,
        markerOverlayCount: 1,
      }),
    ).rejects.toThrow(/carries 5 images/);
  });

  it("refuses a build that breaches a per-kind ceiling instead of dropping a selection", async () => {
    const designs = Array.from({ length: 4 }, (_, index) => ({
      referenceId: `design-${index + 1}`,
      itemId: ITEM,
      versionId: VERSION_H,
    }));
    const { service } = serviceWith(fullDependencies());

    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection({ history: designs, uploads: [], products: [], marks: [] }),
        profile: profile(),
      }),
    ).rejects.toThrow(/At most 3 design references/);
  });

  it("leaves profile enablement to dispatch time", async () => {
    const { service } = serviceWith(fullDependencies());

    const manifest = await service.buildManifest({
      organizationId: ORG,
      selection: selection({ uploads: [], products: [], marks: [] }),
      profile: profile({ enabled: false }),
    });

    expect(manifest.references).toHaveLength(1);
  });

  it("refuses duplicate reference ids across kinds", async () => {
    const { service } = serviceWith(fullDependencies());

    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection({
          uploads: [{ referenceId: "design-1", uploadId: UPLOAD }],
          products: [],
          marks: [],
        }),
        profile: profile(),
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection({
          uploads: [{ referenceId: "design-1", uploadId: UPLOAD }],
          products: [],
          marks: [],
        }),
        profile: profile(),
      }),
    ).rejects.toThrow(/unique/);
  });

  it("rejects a malformed selection, tenant, or profile at the boundary", async () => {
    const { service } = serviceWith(fullDependencies());

    await expect(
      service.buildManifest({
        organizationId: "not-a-uuid",
        selection: selection(),
        profile: profile(),
      }),
    ).rejects.toThrow();
    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection({ history: [{ referenceId: "", itemId: ITEM, versionId: VERSION_H }] }),
        profile: profile(),
      }),
    ).rejects.toThrow();
    await expect(
      service.buildManifest({
        organizationId: ORG,
        selection: selection(),
        profile: profile({ maxImages: 0 }),
      }),
    ).rejects.toThrow();
  });

  it("reads each named source once and never writes a source record", async () => {
    const secondVersion = "00000000-0000-4000-8000-0000000000e5";
    const record = historyRecord({
      versions: [historyVersion(), historyVersion({ versionId: secondVersion, version: 2 })],
      reviews: [historyReview(), historyReview({ versionId: secondVersion })],
    });
    const snapshot = structuredClone({
      record,
      library: [libraryReference(), markReference()],
      logos: logoSelections(),
      upload: uploadRecord(),
    });
    const { service, readHistoryItem, listLibraryReferences, seenOrganizations } = serviceWith({
      uploads: { [UPLOAD]: snapshot.upload },
      history: { [ITEM]: snapshot.record },
      library: snapshot.library,
      logos: snapshot.logos,
    });

    await service.buildManifest({
      organizationId: ORG,
      selection: {
        history: [
          { referenceId: "design-1", itemId: ITEM, versionId: VERSION_H },
          { referenceId: "design-2", itemId: ITEM, versionId: secondVersion },
        ],
        uploads: [{ referenceId: "upload-1", uploadId: UPLOAD }],
        products: [{ referenceId: "product-1", versionId: PROD_VERSION }],
        marks: [{ referenceId: "mark-1", versionId: MARK_VERSION }],
      },
      profile: profile(),
    });

    expect(readHistoryItem).toHaveBeenCalledTimes(1);
    expect(listLibraryReferences).toHaveBeenCalledTimes(1);
    // Every source read carries the caller's tenant.
    expect(seenOrganizations.length).toBeGreaterThan(0);
    expect(new Set(seenOrganizations)).toEqual(new Set([ORG]));
    // Exclusion is a decision about this manifest, not a change to the library.
    expect(snapshot).toEqual({
      record,
      library: [libraryReference(), markReference()],
      logos: logoSelections(),
      upload: uploadRecord(),
    });
  });
});

describe("studio reference previews", () => {
  it("signs current previews against the same storage identity", async () => {
    const seen: { bucket: string; path: string }[][] = [];
    const { service } = serviceWith({
      ...fullDependencies(),
      sign: async (entries) => {
        seen.push([...entries]);
        const urls: Record<string, string> = {};
        for (const entry of entries) {
          urls[`${entry.bucket}:${entry.path}`] =
            `https://cdn.test/${entry.bucket}/${entry.path}?sig=1`;
        }
        return urls;
      },
    });

    const refreshed = await service.refreshPreviews({
      organizationId: ORG,
      selection: selection(),
    });

    expect(seen).toEqual([
      [
        { bucket: "creative-assets", path: `${ORG}/creative-history/${ITEM}/source` },
        { bucket: "studio-uploads", path: `${ORG}/${UPLOAD}/hero.png` },
        { bucket: "brand-assets", path: `${ORG}/${PROD_ASSET}/${PROD_VERSION}/source` },
        { bucket: "brand-assets", path: `${ORG}/${MARK_ASSET}/${MARK_VERSION}/source` },
      ],
    ]);
    expect(refreshed.excluded).toEqual([]);
    expect(refreshed.previews).toEqual({
      "design-1": expect.stringContaining("sig=1"),
      "upload-1": expect.stringContaining("sig=1"),
      "product-1": expect.stringContaining("sig=1"),
      "mark-1": expect.stringContaining("sig=1"),
    });
  });

  it("signs an expired preview anew without changing its identity", async () => {
    const seen: { bucket: string; path: string }[][] = [];
    let round = 0;
    const { service } = serviceWith({
      ...fullDependencies(),
      sign: async (entries) => {
        round += 1;
        seen.push([...entries]);
        const urls: Record<string, string> = {};
        for (const entry of entries) {
          urls[`${entry.bucket}:${entry.path}`] =
            `https://cdn.test/${entry.bucket}/${entry.path}?sig=${round}`;
        }
        return urls;
      },
    });
    const input = {
      organizationId: ORG,
      selection: selection({ uploads: [], products: [], marks: [] }),
    };

    const first = await service.refreshPreviews(input);
    const second = await service.refreshPreviews(input);

    // Same storage identity re-signed, new URL: nothing moved, nothing rewritten.
    expect(seen).toEqual([seen[0], seen[0]]);
    expect(first.previews["design-1"]).toContain("sig=1");
    expect(second.previews["design-1"]).toContain("sig=2");
    expect(second.excluded).toEqual([]);
  });

  it("signs nothing for a reference revoked since the manifest was built", async () => {
    const history = { [ITEM]: historyRecord() };
    const { service } = serviceWith({ ...fullDependencies(), history });
    const picked = selection({ uploads: [], products: [], marks: [] });

    const before = await service.refreshPreviews({ organizationId: ORG, selection: picked });
    expect(before.previews["design-1"]).toContain("sig=1");

    history[ITEM] = historyRecord({
      reviews: [historyReview({ verdict: "rejected", reviewedAt: "2026-04-01T00:00:00.000Z" })],
    });
    const after = await service.refreshPreviews({ organizationId: ORG, selection: picked });

    expect(after.previews).toEqual({ "design-1": null });
    expect(after.excluded).toEqual([
      expect.objectContaining({ referenceId: "design-1", reason: "rejected" }),
    ]);
  });

  it("lets an unsignable object cost only its own preview", async () => {
    const { service } = serviceWith({ ...fullDependencies(), sign: async () => ({}) });

    const refreshed = await service.refreshPreviews({
      organizationId: ORG,
      selection: selection(),
    });

    // The references still resolve; only their URLs are missing.
    expect(refreshed.previews).toEqual({
      "design-1": null,
      "upload-1": null,
      "product-1": null,
      "mark-1": null,
    });
    expect(refreshed.excluded).toEqual([]);
  });
});
