export type ReconciliationClassification =
  | "exact_duplicate"
  | "non_overlapping"
  | "ambiguous_overlap"
  | "approved_correction";

/** Client-safe copy for the Integration Hub reconciliation state view. */
export function getReconciliationNextStep(
  classification: ReconciliationClassification,
  resolved: boolean,
): string {
  if (classification === "exact_duplicate") {
    return "This package replayed existing evidence; no new observation was created.";
  }
  if (classification === "ambiguous_overlap" && !resolved) {
    return "Owner or admin review is required before this evidence can become current.";
  }
  if (classification === "approved_correction") {
    return "The approved correction is current and the prior revision remains in history.";
  }
  return "This exact-range evidence is current and remains separate from non-overlapping periods.";
}
