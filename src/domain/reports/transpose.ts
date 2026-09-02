import { normalizeReportStructureIdentifier } from "@/domain/reports/contracts";

/**
 * Rotating a statement that keeps its periods in the column headings.
 *
 * Every provider export the client sends is one row per period and one column
 * per figure. An accounting statement is the transpose: one row per account,
 * one column per month. All the information is there, rotated ninety degrees,
 * and a reader that only knows the first shape cannot follow it.
 *
 * Rotating once on the way in is what keeps the rest of the pipeline ignorant
 * of the difference. After this, `headerRow` and `dataStartRow` mean exactly
 * what they always meant, counted down the rotated grid, and validation, the
 * parsers, the projection language, the control totals and the lineage all
 * work unchanged. Nothing downstream asks which way round the file was.
 *
 * Nothing here interprets a figure or performs arithmetic. It moves cells.
 *
 * See `specs/018-governed-channel-intelligence.md` section 7.4 and ADR 0045.
 */

/**
 * The header this reader gives the column that holds the periods.
 *
 * A statement names its months in a column heading, so after rotation those
 * names become values with no header above them and nothing a contract could
 * bind. The reader supplies one. It is a reserved name: an account genuinely
 * called this would be reported as ambiguous rather than quietly overwritten.
 */
export const TRANSPOSED_PERIOD_HEADER = "report_period";

/**
 * Where a rotated sheet's header candidate is filed in a profile.
 *
 * A statement keeps its account names down the first column rather than along a
 * row, so recognising one means digesting that column. It is not row one, and
 * filing it as row one would collide with the sheet's actual first row -- on a
 * profit and loss, the company's own name.
 *
 * Zero is outside the range a contract may name for a header row, which is what
 * makes it safe: no ordinary contract can reach it by accident, and a rotated
 * one is sent here by its declared orientation rather than by its row number.
 */
export const TRANSPOSED_HEADER_ROW_POSITION = 0;

export type TransposedSheet = {
  rows: unknown[][];
  /**
   * Labels the statement uses more than once, normalized.
   *
   * A profit and loss repeats a label freely -- `Total for Cost of Goods Sold`
   * appears once for food and packaging and again including delivery
   * commission, with different figures both times. Binding one and silently
   * getting the other understates cost by the whole commission bill, so the
   * caller refuses any field that names one of these rather than picking.
   *
   * Only the caller knows which labels are actually bound, so an unused
   * duplicate is reported here and harms nothing.
   */
  ambiguousLabels: ReadonlySet<string>;
};

function labelOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Rotate a sheet whose records are its columns.
 *
 * `periodHeaderRow` is 1-based and counted down the sheet as it arrived, which
 * is how a human reading the statement would count it.
 */
export function transposePeriodColumns(input: {
  rows: readonly (readonly unknown[])[];
  periodHeaderRow: number;
}): TransposedSheet {
  const width = input.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const rows: unknown[][] = [];
  for (let column = 0; column < width; column += 1) {
    const rotated: unknown[] = [];
    for (let row = 0; row < input.rows.length; row += 1) {
      rotated.push(input.rows[row][column] ?? null);
    }
    rows.push(rotated);
  }

  // The label column becomes the header row, and every other column becomes one
  // record. A statement with no value columns leaves nothing to read, which the
  // caller reports through the fields it then cannot find.
  const header = rows[0] ?? [];
  const periodIndex = input.periodHeaderRow - 1;

  const seen = new Map<string, number>();
  header.forEach((cell, index) => {
    if (index === periodIndex) return;
    const label = labelOf(cell);
    if (!label) return;
    const normalized = normalizeReportStructureIdentifier(label);
    seen.set(normalized, (seen.get(normalized) ?? 0) + 1);
  });

  const ambiguousLabels = new Set<string>();
  for (const [normalized, count] of seen) {
    if (count > 1) ambiguousLabels.add(normalized);
  }
  // An account whose own name normalizes to the reserved one would be reached
  // by the same binding as the periods. Reporting it as ambiguous is the honest
  // outcome: two different things answer to one name.
  if (seen.has(TRANSPOSED_PERIOD_HEADER)) ambiguousLabels.add(TRANSPOSED_PERIOD_HEADER);

  // Written only where the statement really has that row. A contract naming a
  // row past the end of the sheet finds no period header, which the caller
  // reports as the missing source header it is.
  if (periodIndex >= 0 && periodIndex < (rows[0]?.length ?? 0)) {
    header[periodIndex] = TRANSPOSED_PERIOD_HEADER;
  }

  return { rows, ambiguousLabels };
}
