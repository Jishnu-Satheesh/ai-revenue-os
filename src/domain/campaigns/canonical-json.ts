import { CampaignError } from "@/domain/campaigns/errors";

/**
 * Canonical JSON in the RFC 8785 spirit: object keys sorted, array order left
 * alone because the caller has already decided it, and anything that cannot be
 * represented exactly rejected rather than coerced. A digest that quietly
 * accepted a `Date` or a `NaN` would be stable only by luck.
 *
 * This lives apart from `digest.ts` because more than one thing is digested
 * now — the bundle manifest and the proposal document — and they must agree
 * byte for byte on what canonical means. Two implementations that merely look
 * alike would drift, and the drift would only ever show up as an approval that
 * silently fails to match its own record.
 */
export function canonicalJson(value: unknown, path = "$"): string {
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
        return `[${value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`)).join(",")}]`;
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
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry, `${path}.${key}`)}`)
        .join(",")}}`;
    }
    default:
      throw new CampaignError(
        "CAMPAIGN_MANIFEST_NOT_CANONICAL",
        `The value at ${path} has a type a digest cannot represent.`,
      );
  }
}
