const CANONICAL_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * The activity month from navigation. A canonical `YYYY-MM` selects which
 * month's activity history the workspace shows; anything else resolves to
 * null and the service falls back to the organization's current local month.
 * Month navigation never relabels an evidence period, so a refusal here is
 * the same view with a different month, never an error surface.
 */
export function parseWorkspaceMonth(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  return CANONICAL_MONTH.test(value) ? value : null;
}

/** One activity month back, for history navigation. Pure calendar arithmetic. */
export function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const part = Number(month.slice(5, 7));
  if (part === 1) return `${year - 1}-12`;
  return `${year}-${String(part - 1).padStart(2, "0")}`;
}
