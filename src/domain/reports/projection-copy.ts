import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import { describeMetric } from "@/domain/reports/provider-library/copy";

/**
 * Saying what a declaration will record, in the words the operator uses.
 *
 * This is the last thing a person reads before figures enter the ledger, and
 * until now it showed them a digest. A hash is a fine way to prove two
 * documents are the same and a useless way to decide whether to approve one.
 *
 * Nothing here reads a workbook. The contract supplies the column names, which
 * are schema; the declaration supplies what is done with them.
 */

export type ProjectionEntry = {
  /** "Sales", "Orders". */
  label: string;
  /** The column it comes from, as the file spells it. Null if unmappable. */
  sourceColumn: string | null;
};

export type ProjectionSummary = {
  /** "one figure for each day", "one figure for the whole period". */
  shape: string;
  entries: ProjectionEntry[];
  /** How the import is checked, or null when nothing states a total. */
  checkedAgainst: string | null;
  /** Whether absent periods are possible, and so worth warning about. */
  mayHaveGaps: boolean;
};

const GRAIN_SHAPE: Readonly<Record<string, string>> = {
  day: "one figure for each day",
  week: "one figure for each week",
  month: "one figure for each month",
};

/** Each named conversion, in the words an operator approves it by. */
const UNIT_CONVERSION_COPY: Readonly<Record<string, string>> = {
  hours_to_minutes: "converted from hours to minutes",
};

function columnLabel(sourceHeader: string): string {
  return sourceHeader.replaceAll("_", " ");
}

export function summarizeReportProjection(
  projectionDocument: unknown,
  mappingDocument: unknown,
): ProjectionSummary | null {
  const projection = reportProjectionDocumentSchema.safeParse(projectionDocument);
  if (!projection.success) return null;
  const contract = reportContractDocumentSchema.safeParse(mappingDocument);
  const document = projection.data;

  const sourceColumnFor = (normalizedSheetName: string, canonicalField: string) => {
    if (!contract.success) return null;
    const sheet = contract.data.sheets.find(
      (candidate) => candidate.normalizedSheetName === normalizedSheetName,
    );
    const field = sheet?.fields.find((candidate) => candidate.canonicalField === canonicalField);
    return field ? columnLabel(field.sourceHeader) : null;
  };

  const entries = document.outputs.map((output) => {
    // A figure built from several columns has to name all of them here. This
    // screen is the approval: an owner told only the first column is agreeing
    // to something narrower than what will actually be read.
    const columns = [output.canonicalField, ...(output.sumWith ?? [])]
      .map((canonicalField) => sourceColumnFor(output.normalizedSheetName, canonicalField))
      .filter((column): column is string => column !== null);
    const read =
      columns.length === 0
        ? null
        : columns.length === 1
          ? (columns[0] as string)
          : `${columns.slice(0, -1).join(", ")} and ${columns[columns.length - 1]}`;
    // Without this, "Scheduled Open Minutes, from total open duration h" reads
    // as a mistake: the column says hours, the metric says minutes, and nothing
    // on screen accounts for the step between them.
    const conversion = output.convert ? UNIT_CONVERSION_COPY[output.convert] : undefined;
    return {
      label: describeMetric(output.metricKey),
      sourceColumn: read !== null && conversion ? `${read}, ${conversion}` : read,
    };
  });

  const control = document.controlTotals[0];
  const checkedAgainst = control
    ? control.source === "sheet_totals_row"
      ? "the total the file states about itself"
      : `${control.statedSource ?? "a figure recorded at approval"}`
    : null;

  const periodGrain = document.outputKind === "period_grain";
  return {
    shape: periodGrain
      ? (GRAIN_SHAPE[document.grain] ?? "one figure for each period")
      : "one figure for the whole period",
    entries,
    checkedAgainst,
    // Only a series can leave a period absent. A single total covers the whole
    // declared period or fails, so there is nothing to warn about.
    mayHaveGaps: periodGrain,
  };
}
