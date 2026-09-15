/**
 * The two home date shapes, defined once.
 *
 * Four copies of the long shape (activity, assets, campaigns dialog, goals)
 * and one short campaign-foot shape drifted apart before; every home file
 * imports from here now. Both resolve the day in the organization timezone
 * passed as a prop, never guessed. en-GB abbreviates September as "Sept";
 * the reference writes "Sep".
 */

/** Short foot shape: "10 Sep" — day + short month, no year, no time. */
export function formatShortDate(value: string, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(value));
  return formatted.replace("Sept", "Sep");
}

/** Long shape: "10 Sep 2026 · 14:00, Asia/Dubai" — the org zone trails. */
export function formatInstant(value: string, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(value));
  // The org timezone name always trails the time, separated exactly as shown.
  return `${formatted.replace("Sept", "Sep").replace(",", " ·")}, ${timeZone}`;
}
