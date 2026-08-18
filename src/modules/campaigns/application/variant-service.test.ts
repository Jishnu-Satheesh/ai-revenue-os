import { describe, expect, it } from "vitest";

import { admitVariant, remainingCapacity } from "@/modules/campaigns/application/variant-service";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";

const VERSION_ID = "d1000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);
const ASSET = "e0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-01T00:00:00.000Z");

function approval(overrides: Record<string, unknown> = {}) {
  return {
    bundleVersionId: VERSION_ID,
    bundleDigest: DIGEST,
    expiresAt: "2026-09-30T00:00:00.000Z",
    revokedAt: null,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  const manifest = validManifest();
  return {
    manifest,
    approval: approval(),
    bundleVersionId: VERSION_ID,
    bundleDigest: DIGEST,
    variant: {
      id: "f0000000-0000-4000-8000-000000000001",
      directionId: manifestIds.evidenceLed,
      assetId: ASSET,
      channel: "instagram" as const,
      placement: "feed_image" as const,
      hook: "Two courses, one price, weekdays only",
      caption: "Lunch that pays for itself.",
      hashtags: ["#lunchdeal"],
      callToAction: "Book a table",
    },
    producedAssetIds: [ASSET],
    evidence: {
      offer: manifest.generationPolicy.lockedOfferRef,
      factKeys: manifest.generationPolicy.lockedAssertionKeys,
      factText: "lunch set price weekday capacity",
      restrictedTerms: [] as readonly string[],
    },
    limits: { maxHashtags: 30, maxCopyCharacters: 2_200 },
    existingContentHashes: [] as readonly string[],
    capacity: { usedInDirection: 0, usedInTotal: 0 },
    now: NOW,
    ...overrides,
  };
}

function refusalOf(result: ReturnType<typeof admitVariant>) {
  return result.outcome === "refused" ? result.refusal.reason : "admitted";
}

describe("a variant needs live authority above it", () => {
  it("admits one under a live approval for this exact version", () => {
    expect(admitVariant(input()).outcome).toBe("admitted");
  });

  it("refuses when nothing has been approved at all", () => {
    expect(refusalOf(admitVariant(input({ approval: null })))).toBe("no_live_approval");
  });

  it("refuses when the approval has expired", () => {
    const result = admitVariant(
      input({ approval: approval({ expiresAt: "2026-08-01T00:00:00.000Z" }) }),
    );

    expect(refusalOf(result)).toBe("no_live_approval");
    if (result.outcome !== "refused") throw new Error("expected refusal");
    expect(result.refusal.detail).toMatch(/expired/i);
  });

  it("refuses when the approval was revoked", () => {
    const result = admitVariant(
      input({ approval: approval({ revokedAt: "2026-08-20T00:00:00.000Z" }) }),
    );

    expect(refusalOf(result)).toBe("no_live_approval");
  });

  it("refuses when the approval covers a different version", () => {
    const result = admitVariant(
      input({ approval: approval({ bundleVersionId: "d1000000-0000-4000-8000-000000000099" }) }),
    );

    expect(refusalOf(result)).toBe("approval_superseded");
  });

  it("refuses when the content changed under a matching version id", () => {
    // Same version, different digest: the row was edited after approval, which
    // is exactly the case binding both id and digest exists to catch.
    const result = admitVariant(input({ approval: approval({ bundleDigest: "b".repeat(64) }) }));

    expect(refusalOf(result)).toBe("approval_superseded");
  });
});

describe("authority is checked before capacity, and capacity before content", () => {
  it("reports a closed policy window rather than a content problem", () => {
    const manifest = validManifest();
    manifest.generationPolicy.policyExpiresAt = "2026-08-01T00:00:00.000Z";

    expect(refusalOf(admitVariant(input({ manifest })))).toBe("policy_expired");
  });

  it("reports a full direction rather than judging the creative", () => {
    // The variant here is also invalid, and must still be refused for the
    // reason the caller can act on: there was no room for it in any case.
    const result = admitVariant(
      input({
        capacity: { usedInDirection: 4, usedInTotal: 4 },
        variant: { ...input().variant, assetId: "e0000000-0000-4000-8000-0000000000ff" },
      }),
    );

    expect(refusalOf(result)).toBe("direction_cap_reached");
  });

  it("distinguishes a full version from a full direction", () => {
    const result = admitVariant(input({ capacity: { usedInDirection: 1, usedInTotal: 12 } }));

    expect(refusalOf(result)).toBe("total_cap_reached");
  });

  it("refuses creative that left the envelope, naming the codes and not model text", () => {
    const result = admitVariant(
      input({ variant: { ...input().variant, assetId: "e0000000-0000-4000-8000-0000000000ff" } }),
    );

    expect(refusalOf(result)).toBe("not_derived");
    if (result.outcome !== "refused" || result.refusal.reason !== "not_derived") {
      throw new Error("expected a derivation refusal");
    }
    expect(result.refusal.detail).toContain("asset_not_produced");
    expect(result.refusal.failures.length).toBeGreaterThan(0);
  });
});

describe("remaining capacity is reported, never silently applied", () => {
  it("counts what the direction can still take", () => {
    expect(remainingCapacity(validManifest(), { usedInDirection: 1, usedInTotal: 1 })).toBe(3);
  });

  it("is bounded by the total when the total is the tighter limit", () => {
    expect(remainingCapacity(validManifest(), { usedInDirection: 0, usedInTotal: 11 })).toBe(1);
  });

  it("never goes negative when a cap was already reached", () => {
    expect(remainingCapacity(validManifest(), { usedInDirection: 9, usedInTotal: 20 })).toBe(0);
  });
});
