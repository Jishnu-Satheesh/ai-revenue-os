import {
  normalizeReportStructureIdentifier,
  type ReportContractDocument,
} from "@/domain/reports/contracts";

type ContractSheet = ReportContractDocument["sheets"][number];

export type TotalsRowOutcome =
  | { outcome: "none_declared" }
  | { outcome: "found"; rowIndex: number }
  | { outcome: "missing" }
  | { outcome: "ambiguous"; rowIndexes: number[] };

/**
 * Find the row a provider rendered as the sheet's own total.
 *
 * Exactly one, or nothing usable. Zero means the export changed shape or this
 * is not the file the contract was approved for. Two or more means the label
 * does not identify a single row, and picking one — the first, the last, the
 * largest — would be a guess dressed up as a rule.
 *
 * The row index returned is zero-based into the sheet's rows, so it can be
 * compared directly against the loop counters that walk them.
 */
export function findTotalsRow(input: {
  rule: ContractSheet;
  rows: readonly (readonly unknown[])[];
  /** Column index of every bound field, keyed by canonical field name. */
  fieldColumns: ReadonlyMap<string, number>;
}): TotalsRowOutcome {
  const declaration = input.rule.totalsRow;
  if (!declaration) return { outcome: "none_declared" };

  const column = input.fieldColumns.get(declaration.canonicalField);
  if (column === undefined) return { outcome: "missing" };
  const label = normalizeReportStructureIdentifier(declaration.label);

  const matches: number[] = [];
  for (let rowIndex = input.rule.dataStartRow - 1; rowIndex < input.rows.length; rowIndex += 1) {
    const cell = input.rows[rowIndex]?.[column];
    if (typeof cell !== "string") continue;
    if (normalizeReportStructureIdentifier(cell) === label) matches.push(rowIndex);
  }

  if (matches.length === 0) return { outcome: "missing" };
  if (matches.length > 1) return { outcome: "ambiguous", rowIndexes: matches };
  return { outcome: "found", rowIndex: matches[0] };
}
