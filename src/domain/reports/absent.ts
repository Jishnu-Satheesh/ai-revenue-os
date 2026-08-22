/**
 * Deciding whether a cell said nothing.
 *
 * Providers disagree about how to write "nothing happened here". Talabat leaves
 * the cell empty. Keeta writes `-` in its restaurant report on a day with no
 * orders, beside a column that still records the customers who looked. Both
 * mean absent, and neither means zero — a zero is a claim that the day traded
 * and sold nothing, and `specs/012` section 6.2 keeps the two apart because a
 * margin calculated over invented zeros is wrong in a way nobody can see.
 *
 * The markers are declared per field in the approved contract, never inferred.
 * A `-` is only absent because the operator said this provider writes absence
 * that way; in another export it could be a minus sign or a real label.
 */

/** Structurally empty: no cell, or a cell holding only whitespace. */
export function isEmptyCell(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === "string" && value.trim().length === 0)
  );
}

/** Empty, or one of the tokens this field's provider uses to mean "no data". */
export function isAbsentValue(value: unknown, absentMarkers: readonly string[] = []): boolean {
  if (isEmptyCell(value)) return true;
  if (absentMarkers.length === 0 || typeof value !== "string") return false;
  return absentMarkers.includes(value.trim());
}
