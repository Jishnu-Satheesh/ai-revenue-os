import { z } from "zod";

import {
  reportContractDocumentSchema,
  type ReportContractDocument,
} from "@/domain/reports/contracts";
import {
  reportProjectionDocumentSchema,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";

/**
 * Turning an operator's answers into the two documents they would otherwise
 * have hand-written.
 *
 * This exists for the exports the platform does not recognise. The operator is
 * asked five plain questions about their own file — which column is the date,
 * which is the money, which is the count, how dates are written, whether there
 * is a totals row — and the answers assemble into a contract and a projection
 * declaration with exactly the same shape and the same guarantees as a
 * checked-in one.
 *
 * Nothing here is inferred from the data. Every answer is the operator's, which
 * is why the resulting version is recorded as hand-authored: the platform typed
 * the JSON, but a person decided every fact in it.
 */

const normalizedIdentifierSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const guidedReportMappingSchema = z
  .object({
    normalizedSheetName: normalizedIdentifierSchema,
    /** The candidate header row the chosen columns were read from. */
    headerRow: z.number().int().min(1).max(250_000),
    /**
     * The column holding the date each row belongs to, with the way this
     * provider writes it. Absent when the export is one total for the whole
     * period rather than a series.
     */
    periodColumn: z
      .object({
        sourceHeader: normalizedIdentifierSchema,
        encoding: z.enum(["iso_date", "compact_date", "text_date", "day_month", "excel_serial"]),
      })
      .strict()
      .optional(),
    /** The money column, if this export carries one. */
    salesColumn: normalizedIdentifierSchema.optional(),
    /** The order-count column, if this export carries one. */
    ordersColumn: normalizedIdentifierSchema.optional(),
    /** A row the provider renders as the sheet's own total. */
    totalsRow: z
      .object({ sourceHeader: normalizedIdentifierSchema, label: z.string().trim().min(1).max(64) })
      .strict()
      .optional(),
    /** Tokens this provider writes to mean "no data". */
    absentMarkers: z.array(z.string().trim().min(1).max(16)).max(5).optional(),
  })
  .strict()
  .superRefine((answers, context) => {
    if (!answers.salesColumn && !answers.ordersColumn) {
      context.addIssue({
        code: "custom",
        path: ["salesColumn"],
        // A mapping that records nothing is not a mapping, and approving one
        // would leave an operator believing their figures had been read.
        message: "Point at least one figure — sales or orders — at a column.",
      });
    }
    if (answers.salesColumn && answers.salesColumn === answers.ordersColumn) {
      context.addIssue({
        code: "custom",
        path: ["ordersColumn"],
        message: "Sales and orders cannot both come from the same column.",
      });
    }
    const period = answers.periodColumn?.sourceHeader;
    if (period && (period === answers.salesColumn || period === answers.ordersColumn)) {
      context.addIssue({
        code: "custom",
        path: ["periodColumn"],
        message: "The date column cannot also be a figure.",
      });
    }
    const label = answers.totalsRow?.sourceHeader;
    if (label && (label === answers.salesColumn || label === answers.ordersColumn || label === period)) {
      context.addIssue({
        code: "custom",
        path: ["totalsRow"],
        // The label cell would have to be read both as a word and as a figure.
        message: "The totals row must be labelled in a column that carries no figure.",
      });
    }
  });

export type GuidedReportMapping = z.output<typeof guidedReportMappingSchema>;

/** Source header to canonical field. Stable, so the projection can name them. */
const PERIOD_FIELD = "period_date";
const SALES_FIELD = "gross_sales";
const ORDERS_FIELD = "order_count";
const LABEL_FIELD = "row_label";

/**
 * A contract this path cannot turn into a set of figures.
 *
 * Refusing is the point. The alternative is proposing a declaration that reads
 * some of the file and quietly omits the rest, which an operator would approve
 * believing it complete.
 */
export class GuidedProjectionUndecidable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidedProjectionUndecidable";
  }
}

export function buildGuidedContractDocument(input: {
  answers: GuidedReportMapping;
  declaredCurrency: string;
}): ReportContractDocument {
  const { answers } = input;
  // A daily series expects gaps: a provider writes a row for every day and
  // leaves the figures blank on the days it has nothing to say about. A single
  // period total does not, and is unknowable if any row is silent.
  const required = !answers.periodColumn;
  const absentMarkers = answers.absentMarkers?.length ? answers.absentMarkers : undefined;

  const fields: unknown[] = [];
  if (answers.periodColumn) {
    fields.push({
      canonicalField: PERIOD_FIELD,
      sourceHeader: answers.periodColumn.sourceHeader,
      parser: "local_date",
      dateEncoding: answers.periodColumn.encoding,
      required: true,
    });
  }
  if (answers.salesColumn) {
    fields.push({
      canonicalField: SALES_FIELD,
      sourceHeader: answers.salesColumn,
      parser: "money",
      financialSign: "positive",
      required,
      absentMarkers,
    });
  }
  if (answers.ordersColumn) {
    fields.push({
      canonicalField: ORDERS_FIELD,
      sourceHeader: answers.ordersColumn,
      parser: "integer",
      required,
      absentMarkers,
    });
  }
  if (answers.totalsRow) {
    fields.push({
      canonicalField: LABEL_FIELD,
      sourceHeader: answers.totalsRow.sourceHeader,
      parser: "text",
      required: false,
    });
  }

  return reportContractDocumentSchema.parse({
    schemaVersion: 1,
    currency: input.declaredCurrency,
    outletGrain: "branch",
    sheets: [
      {
        normalizedSheetName: answers.normalizedSheetName,
        headerRow: answers.headerRow,
        // The row after the headings. A provider that puts description rows in
        // between is a shape this path cannot describe, and one the operator
        // should be given a checked-in definition for instead.
        dataStartRow: answers.headerRow + 1,
        allowFormula: false,
        allowMergedCells: true,
        totalsRow: answers.totalsRow
          ? { canonicalField: LABEL_FIELD, label: answers.totalsRow.label }
          : undefined,
        fields,
      },
    ],
    controls: [],
    unmappedFieldDisposition: "reviewed_ignore",
    unmappedSheetDisposition: "reviewed_ignore",
  });
}

/**
 * The declaration that follows from an approved contract.
 *
 * Read from the contract's own fields rather than from the answers a second
 * time, so whatever an owner approved is exactly what gets read. Answers given
 * twice can differ; a contract cannot.
 *
 * Fields are recognised by what they are, not by what they are called. A
 * contract written by hand before the guided path existed names its columns
 * whatever its author chose, and keying off those names would silently drop
 * figures it does not recognise — a mapping that looks approved and records
 * half of what it should.
 */
export class GuidedProjectionUndeterminable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidedProjectionUndeterminable";
  }
}

export function buildGuidedProjectionDocument(
  contract: ReportContractDocument,
): ReportProjectionDocument {
  const sheet = contract.sheets[0];
  if (!sheet) throw new GuidedProjectionUndecidable("That mapping describes no sheet to read.");

  // Read from what each column *is*, not from what it is called. The names a
  // guided mapping assigns are its own; a mapping written before this path
  // existed uses whatever the person chose, and both have to work.
  const of = (parser: string) => sheet.fields.filter((field) => field.parser === parser);
  const only = (parser: string, whatItIs: string) => {
    const matches = of(parser);
    if (matches.length > 1) {
      throw new GuidedProjectionUndecidable(
        `That mapping has ${matches.length} columns that could be ${whatItIs}, so we cannot tell which one to read. Map this upload again and point at the one you mean.`,
      );
    }
    return matches[0];
  };

  const period = only("local_date", "the date");
  const sales = only("money", "your sales");
  const orders = only("integer", "your orders");

  if (!sales && !orders) {
    throw new GuidedProjectionUndecidable(
      "That mapping has no sales or orders column, so there is nothing to record from it.",
    );
  }

  const outputs: unknown[] = [];
  if (sales) {
    outputs.push({
      key: "gross_revenue",
      normalizedSheetName: sheet.normalizedSheetName,
      canonicalField: sales.canonicalField,
      metricKey: "revenue.gross",
      valueKind: "money",
      aggregation: "sum",
    });
  }
  if (orders) {
    outputs.push({
      key: "orders",
      normalizedSheetName: sheet.normalizedSheetName,
      canonicalField: orders.canonicalField,
      metricKey: "transactions.count",
      valueKind: "count",
      aggregation: "sum",
    });
  }

  // A stated total is only checkable against money, and only when the sheet
  // states one. See ADR 0029.
  const controlTotals =
    sheet.totalsRow && sales
      ? [{ outputKey: "gross_revenue", source: "sheet_totals_row", toleranceMinorUnits: 0 }]
      : [];

  // A date column only dates rows if every row is required to carry one.
  if (period?.required) {
    return reportProjectionDocumentSchema.parse({
      schemaVersion: 1,
      outputKind: "period_grain",
      grain: "day",
      periodKey: {
        normalizedSheetName: sheet.normalizedSheetName,
        canonicalField: period.canonicalField,
      },
      outputs,
      controlTotals,
    });
  }

  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "exact_range",
    outputs,
    controlTotals,
  });
}
