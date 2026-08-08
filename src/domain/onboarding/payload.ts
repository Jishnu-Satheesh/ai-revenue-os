import type { OnboardingSectionKey } from "@/domain/onboarding/types";

/** A structured control that was rendered but never answered, such as an
 * untouched month range, arrives as an object of empty strings. */
function isBlankRecord(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.values(value as Record<string, unknown>);
  return entries.length > 0 && entries.every((entry) => entry === "" || entry === null);
}

/**
 * Turns the values collected by a section editor into the payload that is
 * stored and evaluated.
 *
 * Two things happen here and nowhere else:
 * 1. Empty answers are dropped, so an untouched optional field never persists
 *    as an empty string that later reads as "answered".
 * 2. Slugs that the readiness rubric consumes as booleans are derived, so the
 *    operator-facing vocabulary and the rubric can evolve independently.
 */
export function toSectionPayload(
  sectionKey: OnboardingSectionKey,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string") {
      payload[key] = value.trim();
      continue;
    }
    if (isBlankRecord(value)) continue;
    payload[key] = value;
  }

  if (sectionKey === "channels_presence") {
    payload.conversionTracking = values.conversionTrackingStatus === "connected";
  }

  if (sectionKey === "customers_consent") {
    payload.consentConfirmed =
      values.consentStatus === "confirmed_by_client" ||
      values.consentStatus === "confirmed_by_operator";
  }

  if (sectionKey === "branches_operations") {
    payload.branchlessConfirmed = values.branchlessConfirmed === true;
  }

  return payload;
}
