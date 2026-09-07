import { DomainError } from "@/lib/errors";
import type { AllocationRuleThresholds } from "@/domain/campaigns/allocation";

/**
 * The thresholds the fast loop pauses on, and why they have no defaults.
 *
 * These four numbers decide when the platform stops spending a client's money
 * on a variant. `AGENTS.md` prohibits autonomous budget changes "beyond
 * configured policy", and a default invented here would not be configured
 * policy -- it would be this file's opinion, applied to somebody's advertising.
 *
 * So an unconfigured deployment refuses to run the cycle rather than running it
 * on numbers nobody chose. That is a louder failure than a quiet default and a
 * much smaller one than pausing a campaign for a reason the client never agreed.
 *
 * The generation cost ceiling takes the opposite approach a few files away, and
 * the difference is deliberate: that ceiling bounds what the platform spends on
 * itself, and its safe direction is to stop early. This one bounds what the
 * platform does to a client's campaigns, and there is no safe direction to
 * guess in.
 */

const KEYS = [
  "CAMPAIGN_ALLOCATION_SPEND_CEILING_MINOR",
  "CAMPAIGN_ALLOCATION_CTR_FLOOR",
  "CAMPAIGN_ALLOCATION_MARGIN_FLOOR_MINOR",
  "CAMPAIGN_ALLOCATION_MINIMUM_IMPRESSIONS",
] as const;

function integer(raw: string | undefined, key: string, options: { allowZero: boolean }): number {
  // Digits only, checked before parsing. `parseInt` reads "1e9" as 1 and
  // "500abc" as 500, so a mistyped ceiling would silently become a much smaller
  // one -- and a spend limit that quietly shrinks is still a limit nobody chose.
  const value = raw?.trim() ?? "";
  if (!/^\d+$/.test(value)) {
    throw new DomainError("VALIDATION_ERROR", `${key} must be a whole number of minor units.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || (!options.allowZero && parsed <= 0)) {
    throw new DomainError("VALIDATION_ERROR", `${key} must be a positive whole number.`);
  }
  return parsed;
}

function share(raw: string | undefined, key: string): number {
  const parsed = Number.parseFloat(raw?.trim() ?? "");
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new DomainError("VALIDATION_ERROR", `${key} must be a share between 0 and 1.`);
  }
  return parsed;
}

export function allocationThresholdsConfigured(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return KEYS.every((key) => (source[key]?.trim() ?? "") !== "");
}

export function allocationThresholds(
  source: Record<string, string | undefined> = process.env,
): AllocationRuleThresholds {
  const missing = KEYS.filter((key) => (source[key]?.trim() ?? "") === "");
  if (missing.length > 0) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      `The allocation cycle has no configured policy. Set ${missing.join(", ")} before it can pause a variant.`,
    );
  }

  return {
    spendCeilingMinor: integer(
      source.CAMPAIGN_ALLOCATION_SPEND_CEILING_MINOR,
      "CAMPAIGN_ALLOCATION_SPEND_CEILING_MINOR",
      { allowZero: false },
    ),
    ctrFloor: share(source.CAMPAIGN_ALLOCATION_CTR_FLOOR, "CAMPAIGN_ALLOCATION_CTR_FLOOR"),
    // Zero is a real, deliberate floor: pause a variant whose contribution
    // margin has gone negative. So zero is allowed where the spend ceiling's is
    // not, because a ceiling of zero would pause everything immediately.
    marginFloorMinor: integer(
      source.CAMPAIGN_ALLOCATION_MARGIN_FLOOR_MINOR,
      "CAMPAIGN_ALLOCATION_MARGIN_FLOOR_MINOR",
      { allowZero: true },
    ),
    minimumImpressions: integer(
      source.CAMPAIGN_ALLOCATION_MINIMUM_IMPRESSIONS,
      "CAMPAIGN_ALLOCATION_MINIMUM_IMPRESSIONS",
      { allowZero: false },
    ),
  };
}

/** Named so an operator can be told exactly what to set. */
export const allocationEnvKeys = KEYS;
