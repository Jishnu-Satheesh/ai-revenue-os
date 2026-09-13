import { createHash } from "node:crypto";

import { diffManifestChanges, type CampaignDiff } from "@/domain/campaigns/diff";
import { canonicalJson } from "@/domain/campaigns/canonical-json";
import { normalizeManifest } from "@/domain/campaigns/normalization";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";

/**
 * The value an approval is bound to.
 *
 * An approval that pointed at a campaign name or a row id would still be valid
 * after the creative changed underneath it. Binding to a digest of the whole
 * normalized manifest means any change an operator would care about produces a
 * different value, and the old approval can no longer authorize anything.
 *
 * Asset content hashes are inside the manifest, so a swapped image changes the
 * digest even when every word stays the same. Storage paths, timestamps,
 * provider responses, and review-session ids are deliberately absent from the
 * manifest and therefore absent from the digest.
 */

/** The canonical text a digest is taken over. Exposed for diffing and tests. */
export function canonicalManifestJson(manifest: CampaignBundleManifest): string {
  // Checked on the manifest as it was handed over, before normalization. A
  // normalizing spread turns an exotic object into a plain one, which would
  // launder exactly the values this guard exists to reject: a `Map` where an
  // object belongs would digest cleanly as `{}` and the loss would be silent.
  canonicalJson(manifest, "$");
  return canonicalJson(normalizeManifest(manifest), "$");
}

export function bundleDigest(manifest: CampaignBundleManifest): string {
  return createHash("sha256").update(canonicalManifestJson(manifest), "utf8").digest("hex");
}

/**
 * The diff as it is recorded, digests included.
 *
 * The change list is computed by `diffManifestChanges`, which is pure and runs
 * anywhere. Only the two digests need Node, so only this wrapper does — which
 * is why it sits here rather than beside the comparison it delegates to.
 */
export function diffManifests(
  before: CampaignBundleManifest,
  after: CampaignBundleManifest,
): CampaignDiff {
  const changes = diffManifestChanges(before, after);

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
