import { CampaignError } from "@/domain/campaigns/errors";
import { bundleDigest } from "@/domain/campaigns/digest";
import { normalizeManifest } from "@/domain/campaigns/normalization";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";

/**
 * What changed between two versions, in the terms an operator asked about.
 *
 * Every path in the manifest is material by construction: the manifest holds
 * only what an approval covers, and everything else — storage locations,
 * timestamps, provider state — was kept out of it precisely so this question
 * has one answer. The classification is still explicit rather than assumed, so
 * a later field that genuinely is cosmetic has somewhere honest to live.
 */

export type CampaignDiffChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  materiality: "material";
  /** Human-readable, already redacted to a short form for review and audit. */
  before: string | null;
  after: string | null;
};

export type CampaignDiff = {
  fromVersion: number;
  toVersion: number;
  fromDigest: string;
  toDigest: string;
  changes: readonly CampaignDiffChange[];
  /** True when any change invalidates an approval covering the earlier version. */
  invalidatesApproval: boolean;
};

export function diffManifests(
  before: CampaignBundleManifest,
  after: CampaignBundleManifest,
): CampaignDiff {
  if (before.campaignId !== after.campaignId) {
    throw new CampaignError(
      "CAMPAIGN_VERSION_NOT_COMPARABLE",
      "Two versions of different campaigns cannot be compared.",
    );
  }

  const changes: CampaignDiffChange[] = [];
  collect(normalizeManifest(before), normalizeManifest(after), "", changes);

  return {
    fromVersion: before.version,
    toVersion: after.version,
    fromDigest: bundleDigest(before),
    toDigest: bundleDigest(after),
    changes,
    // Any manifest change is material, so any change invalidates. Stated as a
    // derived fact rather than a constant, so the rule stays visible if the
    // manifest ever gains a genuinely cosmetic field.
    invalidatesApproval: changes.some((change) => change.materiality === "material"),
  };
}

function collect(
  before: unknown,
  after: unknown,
  path: string,
  changes: CampaignDiffChange[],
): void {
  if (Object.is(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      collect(before[key], after[key], path ? `${path}.${key}` : key, changes);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      collect(before[index], after[index], `${path}[${index}]`, changes);
    }
    return;
  }

  if (before === undefined) {
    changes.push({
      path,
      kind: "added",
      materiality: "material",
      before: null,
      after: summarise(after),
    });
    return;
  }
  if (after === undefined) {
    changes.push({
      path,
      kind: "removed",
      materiality: "material",
      before: summarise(before),
      after: null,
    });
    return;
  }
  if (summarise(before) === summarise(after)) return;

  changes.push({
    path,
    kind: "changed",
    materiality: "material",
    before: summarise(before),
    after: summarise(after),
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * A short, safe rendering for review and audit. Long copy is truncated because
 * a diff row is a pointer to the change, not a second copy of the campaign.
 */
function summarise(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "null";
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}
