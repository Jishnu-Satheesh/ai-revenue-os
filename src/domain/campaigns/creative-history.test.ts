import { describe, expect, it } from "vitest";

import {
  creativeEligibility,
  creativeItemSchema,
  creativeReviewSchema,
  type CreativeHistoryItem,
} from "@/domain/campaigns/creative-history";

const organizationId = "10000000-0000-4000-8000-000000000001";
const itemId = "20000000-0000-4000-8000-000000000001";
const versionId = "30000000-0000-4000-8000-000000000001";

function item(overrides: Partial<CreativeHistoryItem> = {}): CreativeHistoryItem {
  return {
    organizationId,
    id: itemId,
    folderId: null,
    label: "Ramadan family poster",
    creativeType: "poster",
    sourceKind: "historical_upload",
    rights: { status: "owned", confirmedAt: "2026-09-09T10:00:00.000Z" },
    confirmedMetadata: {
      subjectTags: ["chicken mandi"],
      occasionTags: ["ramadan"],
      channels: ["instagram"],
      formats: ["feed"],
      markets: ["dubai"],
      languages: ["en"],
      objectives: ["acquisition"],
      styleTags: ["warm"],
    },
    proposedMetadata: null,
    currentVersion: {
      organizationId,
      id: versionId,
      itemId,
      source: {
        kind: "stored_file",
        storagePath: `${organizationId}/${itemId}/${versionId}/source`,
      },
      mimeType: "image/png",
      byteSize: 1_024,
      widthPx: 1080,
      heightPx: 1350,
      contentHash: "a".repeat(64),
      createdAt: "2026-09-09T10:00:00.000Z",
    },
    currentReview: {
      verdict: "approved",
      reasonCodes: [],
      reviewedAt: "2026-09-09T10:05:00.000Z",
      reviewedBy: "40000000-0000-4000-8000-000000000001",
    },
    archivedAt: null,
    ...overrides,
  };
}

describe("Creative History review and eligibility", () => {
  it("refuses a rejected review without a human reason", () => {
    expect(() =>
      creativeReviewSchema.parse({
        creativeItemVersionId: versionId,
        verdict: "rejected",
        reasonCodes: [],
        note: null,
        reviewedAt: "2026-09-09T10:05:00.000Z",
        reviewedBy: "40000000-0000-4000-8000-000000000001",
      }),
    ).toThrow(/reason/i);
  });

  it("refuses rejection reasons on an approved review", () => {
    expect(() =>
      creativeReviewSchema.parse({
        creativeItemVersionId: versionId,
        verdict: "approved",
        reasonCodes: ["wrong_style"],
        note: null,
        reviewedAt: "2026-09-09T10:05:00.000Z",
        reviewedBy: "40000000-0000-4000-8000-000000000001",
      }),
    ).toThrow(/approved/i);
  });

  it("keeps proposed metadata outside the eligible record", () => {
    const parsed = creativeItemSchema.parse(
      item({
        confirmedMetadata: null,
        proposedMetadata: {
          subjectTags: ["chicken mandi"],
          occasionTags: ["ramadan"],
          channels: ["instagram"],
          formats: ["feed"],
          markets: ["dubai"],
          languages: ["en"],
          objectives: ["acquisition"],
          styleTags: ["warm"],
        },
      }),
    );

    expect(creativeEligibility(parsed)).toBe("metadata_unconfirmed");
  });

  it("keeps an unreviewed design out of both evidence paths", () => {
    expect(creativeEligibility(item({ currentReview: null }))).toBe("unreviewed");
  });
});
