import type { Freshness, VerificationState } from "@/domain/memory/types";

const AGING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type FreshnessInput = {
  now?: Date;
  expiresAt?: string;
  effectiveTo?: string;
  supersededById?: string;
  reviewDueAt?: string;
};

/**
 * Freshness is derived at read time and never stored, so it cannot drift out of
 * step with the clock. The priority order is the rule: expiry outranks
 * supersession because an expired replacement chain is still expired, and both
 * outrank a passed review date.
 *
 * An unparseable timestamp is treated as absent rather than as expired. Hiding
 * an item because its date failed to parse would silently remove knowledge the
 * operator can still see in the workspace.
 */
export function deriveFreshness(input: FreshnessInput): Freshness {
  const now = (input.now ?? new Date()).getTime();

  if (isPast(input.expiresAt, now) || isPast(input.effectiveTo, now)) return "expired";
  if (input.supersededById) return "superseded";
  if (isPast(input.reviewDueAt, now)) return "stale";
  if (isWithin(input.reviewDueAt, now, AGING_WINDOW_MS)) return "aging";

  return "fresh";
}

function isPast(value: string | undefined, now: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed < now;
}

function isWithin(value: string | undefined, now: number, windowMs: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed - now <= windowMs;
}

export type DefaultRetrievabilityInput = {
  freshness: Freshness;
  verificationState: VerificationState;
};

/**
 * Default retrieval excludes knowledge that has been replaced, has lapsed, or
 * has not yet been confirmed. Stale and aging items stay visible: history is
 * still knowledge, and hiding it would leave a worker with nothing rather than
 * with something labelled old.
 *
 * A caller may ask for the excluded classes explicitly and receives them
 * labelled; see `MemoryRetrievalQuery.includeSuperseded` and `includeExpired`.
 */
export function isRetrievableByDefault(input: DefaultRetrievabilityInput): boolean {
  if (input.verificationState === "proposed" || input.verificationState === "rejected") {
    return false;
  }
  return input.freshness !== "expired" && input.freshness !== "superseded";
}
