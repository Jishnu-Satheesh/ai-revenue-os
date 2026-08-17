import { createHash } from "node:crypto";

import { CampaignError } from "@/domain/campaigns/errors";
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

/**
 * Canonical JSON in the RFC 8785 spirit: object keys sorted, array order left
 * alone because normalization has already decided it, and anything that cannot
 * be represented exactly rejected rather than coerced. A digest that quietly
 * accepted a `Date` or a `NaN` would be stable only by luck.
 */
function canonicalise(value: unknown, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CampaignError(
          "CAMPAIGN_MANIFEST_NOT_CANONICAL",
          `The value at ${path} is not a finite number.`,
        );
      }
      return JSON.stringify(value);
    }
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((entry, index) => canonicalise(entry, `${path}[${index}]`)).join(",")}]`;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        throw new CampaignError(
          "CAMPAIGN_MANIFEST_NOT_CANONICAL",
          `The value at ${path} is not a plain value.`,
        );
      }
      const entries = Object.entries(value as Record<string, unknown>)
        // `undefined` is not representable in JSON, and treating it as absent
        // keeps an explicitly-omitted optional identical to a missing one.
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      return `{${entries
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalise(entry, `${path}.${key}`)}`)
        .join(",")}}`;
    }
    default:
      throw new CampaignError(
        "CAMPAIGN_MANIFEST_NOT_CANONICAL",
        `The value at ${path} has a type a digest cannot represent.`,
      );
  }
}

/** The canonical text a digest is taken over. Exposed for diffing and tests. */
export function canonicalManifestJson(manifest: CampaignBundleManifest): string {
  // Checked on the manifest as it was handed over, before normalization. A
  // normalizing spread turns an exotic object into a plain one, which would
  // launder exactly the values this guard exists to reject: a `Map` where an
  // object belongs would digest cleanly as `{}` and the loss would be silent.
  canonicalise(manifest, "$");
  return canonicalise(normalizeManifest(manifest), "$");
}

export function bundleDigest(manifest: CampaignBundleManifest): string {
  return createHash("sha256").update(canonicalManifestJson(manifest), "utf8").digest("hex");
}
