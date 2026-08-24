import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { bundleDigest, canonicalManifestJson, diffManifests } from "@/domain/campaigns/digest";
import { CampaignError } from "@/domain/campaigns/errors";
import { normalizeManifest } from "@/domain/campaigns/normalization";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import { validManifest } from "@/domain/campaigns/test-manifest";

function shuffled<T>(values: readonly T[], seed: number): T[] {
  return [...values].sort((left, right) =>
    (JSON.stringify(left).length + seed) % 2 === 0
      ? JSON.stringify(left).localeCompare(JSON.stringify(right))
      : JSON.stringify(right).localeCompare(JSON.stringify(left)),
  );
}

describe("bundleDigest", () => {
  it("is stable for the same proposal", () => {
    expect(bundleDigest(validManifest())).toBe(bundleDigest(validManifest()));
  });

  it("is a SHA-256 hex value", () => {
    expect(bundleDigest(validManifest())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores the order the directions happened to be listed in", () => {
    const manifest = validManifest();
    const reordered: CampaignBundleManifest = {
      ...manifest,
      directions: [manifest.directions[2]!, manifest.directions[0]!, manifest.directions[1]!],
    };

    expect(bundleDigest(reordered)).toBe(bundleDigest(manifest));
  });

  it("ignores the order the assets and actions happened to be listed in", () => {
    const manifest = validManifest();
    const reordered: CampaignBundleManifest = {
      ...manifest,
      assets: [...manifest.assets].reverse(),
      actions: [...manifest.actions].reverse(),
    };

    expect(bundleDigest(reordered)).toBe(bundleDigest(manifest));
  });

  it("ignores the order of internal content tags, which nobody reads in order", () => {
    const manifest = validManifest();
    manifest.directions[1]!.internalContentTags = ["margin-led", "lunch-offer"];

    expect(bundleDigest(manifest)).toBe(bundleDigest(validManifest()));
  });

  it("does NOT ignore the order of published hashtags, which a reader sees", () => {
    const manifest = validManifest();
    manifest.directions[0]!.hashtagSets[0]!.tags = ["#dubaieats", "#lunch"];

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("changes when an asset is swapped for different bytes", () => {
    const manifest = validManifest();
    manifest.assets[0]!.contentHash = "9".repeat(64);

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("changes when the generation profile changes", () => {
    const manifest = validManifest();
    manifest.generationProfile = "brand_restricted";

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("changes when the spend ceiling changes by one minor unit", () => {
    const manifest = validManifest();
    manifest.totalSpendCeiling = { amountMinor: 150_001, currency: "AED" };

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("changes when the execution mode changes", () => {
    const manifest = validManifest();
    manifest.executionMode = "all_channels_required";

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("changes when the measurement window changes", () => {
    const manifest = validManifest();
    manifest.measurementPlan.outcomeWindowDays = 21;

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("changes when the variant cap changes", () => {
    const manifest = validManifest();
    manifest.generationPolicy.maxVariantsPerDirection = 3;

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("changes when the policy expiry changes", () => {
    const manifest = validManifest();
    manifest.generationPolicy.policyExpiresAt = "2026-10-31T14:00:00.000Z";

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("changes when the locked offer changes", () => {
    const manifest = validManifest();
    manifest.generationPolicy.lockedOfferRef = "dinner-set-menu-2026-09";

    expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
  });

  it("ignores the order the locked assertion keys happened to be listed in", () => {
    const manifest = validManifest();
    manifest.generationPolicy.lockedAssertionKeys = [
      ...manifest.generationPolicy.lockedAssertionKeys,
    ].reverse();

    expect(bundleDigest(manifest)).toBe(bundleDigest(validManifest()));
  });

  it("refuses a value a digest cannot represent rather than coercing it", () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.objective = Number.NaN;

    expect(() => bundleDigest(manifest as unknown as CampaignBundleManifest)).toThrow(
      CampaignError,
    );
  });

  it("refuses a non-plain object rather than digesting its shape", () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.measurementPlan = new Map();

    expect(() => bundleDigest(manifest as unknown as CampaignBundleManifest)).toThrow(
      CampaignError,
    );
  });

  it("treats an explicitly-undefined optional as absent", () => {
    const manifest = { ...validManifest(), extra: undefined } as unknown as CampaignBundleManifest;

    expect(bundleDigest(manifest)).toBe(bundleDigest(validManifest()));
  });

  it("produces canonical JSON with sorted object keys", () => {
    const json = canonicalManifestJson(validManifest());

    expect(json.indexOf('"campaignId"')).toBeLessThan(json.indexOf('"schemaVersion"'));
  });
});

describe("digest properties", () => {
  it("gives semantically equal manifests the same digest", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (seed) => {
        const manifest = validManifest();
        const reordered: CampaignBundleManifest = {
          ...manifest,
          directions: shuffled(manifest.directions, seed),
          actions: shuffled(manifest.actions, seed),
          assets: shuffled(manifest.assets, seed),
        };

        expect(bundleDigest(reordered)).toBe(bundleDigest(manifest));
      }),
      { numRuns: 25 },
    );
  });

  it("gives a different digest to every single-character change in authored text", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (suffix) => {
        const manifest = validManifest();
        manifest.objective = `${manifest.objective}${suffix}`;

        expect(bundleDigest(manifest)).not.toBe(bundleDigest(validManifest()));
      }),
      { numRuns: 40 },
    );
  });

  it("normalizes idempotently", () => {
    const once = normalizeManifest(validManifest());
    const twice = normalizeManifest(once);

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("diffManifests", () => {
  it("reports no change and no invalidation for an unchanged proposal", () => {
    const diff = diffManifests(validManifest(), validManifest());

    expect(diff.changes).toEqual([]);
    expect(diff.invalidatesApproval).toBe(false);
    expect(diff.fromDigest).toBe(diff.toDigest);
  });

  it("classifies a caption change as material and invalidating", () => {
    const after = validManifest();
    after.version = 2;
    after.directions[0]!.copy[0]!.caption = "A different promise entirely.";

    const diff = diffManifests(validManifest(), after);

    expect(diff.invalidatesApproval).toBe(true);
    expect(diff.changes.map((change) => change.path)).toContain("directions[0].copy[0].caption");
    expect(diff.changes.every((change) => change.materiality === "material")).toBe(true);
  });

  it("classifies a widened variant cap as material and invalidating", () => {
    // Raising the cap authorizes creative the operator never agreed to, so it
    // is exactly as material as changing the copy itself.
    const after = validManifest();
    after.version = 2;
    after.generationPolicy.maxVariantsPerDirection = 6;
    after.generationPolicy.maxVariantsTotal = 18;

    const diff = diffManifests(validManifest(), after);

    expect(diff.invalidatesApproval).toBe(true);
    expect(diff.changes.map((change) => change.path)).toContain(
      "generationPolicy.maxVariantsPerDirection",
    );
    expect(diff.changes.every((change) => change.materiality === "material")).toBe(true);
  });

  it("classifies an extended policy expiry as material and invalidating", () => {
    const after = validManifest();
    after.version = 2;
    after.generationPolicy.policyExpiresAt = "2026-12-31T14:00:00.000Z";

    const diff = diffManifests(validManifest(), after);

    expect(diff.invalidatesApproval).toBe(true);
    expect(diff.changes.map((change) => change.path)).toContain("generationPolicy.policyExpiresAt");
  });

  it("reports the spend ceiling change with both values", () => {
    const after = validManifest();
    after.totalSpendCeiling = { amountMinor: 300_000, currency: "AED" };

    const change = diffManifests(validManifest(), after).changes.find(
      (entry) => entry.path === "totalSpendCeiling.amountMinor",
    );

    expect(change).toMatchObject({ kind: "changed", before: "150000", after: "300000" });
  });

  it("reports an added action rather than silently accepting a longer list", () => {
    const after = validManifest();
    after.actions.push({
      ...after.actions[0]!,
      id: "b0000000-0000-4000-8000-000000000009",
      scheduledFor: "2026-09-09T14:00:00.000Z",
    });

    const diff = diffManifests(validManifest(), after);

    expect(diff.changes.some((change) => change.kind === "added")).toBe(true);
  });

  it("reports a removed direction", () => {
    const after = validManifest();
    after.directions = after.directions.slice(0, 2);

    const diff = diffManifests(validManifest(), after);

    expect(diff.changes.some((change) => change.kind === "removed")).toBe(true);
  });

  it("truncates long copy in the diff instead of duplicating the campaign", () => {
    const after = validManifest();
    after.directions[0]!.copy[0]!.caption = "x".repeat(400);

    const change = diffManifests(validManifest(), after).changes.find((entry) =>
      entry.path.endsWith("caption"),
    );

    expect(change?.after?.length).toBeLessThanOrEqual(160);
    expect(change?.after?.endsWith("...")).toBe(true);
  });

  it("refuses to compare versions of two different campaigns", () => {
    const other = validManifest();
    other.campaignId = "c0000000-0000-4000-8000-000000000099";

    expect(() => diffManifests(validManifest(), other)).toThrow(CampaignError);
  });

  it("does not report a reordering as a change", () => {
    const after = validManifest();
    after.directions = [after.directions[2]!, after.directions[1]!, after.directions[0]!];

    expect(diffManifests(validManifest(), after).changes).toEqual([]);
  });
});
