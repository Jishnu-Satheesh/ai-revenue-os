import { z } from "zod";

const normalizedIdentifierSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

const contractFieldSchema = z
  .object({
    canonicalField: normalizedIdentifierSchema,
    sourceHeader: normalizedIdentifierSchema,
    parser: z.enum([
      "integer",
      "decimal",
      "money",
      "local_date",
      "timestamp",
      "duration",
      "percentage",
      "text",
      "enum",
    ]),
    required: z.boolean(),
    financialSign: z.enum(["positive", "negative"]).optional(),
    /**
     * Tokens this provider writes to mean "no data", which are read as absent
     * rather than as a value. Keeta writes `-`; Talabat leaves the cell empty.
     * Declared rather than guessed, because the same character is a minus sign
     * somewhere else. See `@/domain/reports/absent`.
     */
    absentMarkers: z.array(z.string().trim().min(1).max(16)).max(5).optional(),
    /**
     * How this provider writes a date, for `local_date` fields only.
     *
     * It belongs to the source column rather than to anything read from it, so
     * validation and projection cannot end up disagreeing about what
     * `1 Jan 2026` means. Defaults to ISO, which is what every contract
     * approved before this existed was reading.
     */
    dateEncoding: z
      .enum(["iso_date", "compact_date", "text_date", "day_month", "excel_serial", "month_year"])
      .optional(),
    /**
     * How this provider writes a number, for numeric fields only.
     *
     * A spreadsheet hands over a number and its display format is nobody's
     * business. A PDF hands over what was printed, and an accounting statement
     * prints `1,234.56`. Declared rather than sniffed, for the same reason the
     * date encoding is. See `@/domain/reports/number-format`.
     */
    numberFormat: z.enum(["plain", "grouped"]).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.parser === "money" && !field.financialSign) {
      ctx.addIssue({
        code: "custom",
        path: ["financialSign"],
        message: "Money fields require an explicit financial sign.",
      });
    }
    if (field.parser !== "money" && field.financialSign) {
      ctx.addIssue({
        code: "custom",
        path: ["financialSign"],
        message: "Only money fields may declare a financial sign.",
      });
    }
    if (field.dateEncoding && field.parser !== "local_date") {
      ctx.addIssue({
        code: "custom",
        path: ["dateEncoding"],
        message: "Only a local date field may declare a date encoding.",
      });
    }
    if (
      field.numberFormat &&
      !["integer", "decimal", "money", "percentage"].includes(field.parser)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["numberFormat"],
        message: "Only a numeric field may declare a number format.",
      });
    }
    for (const marker of field.absentMarkers ?? []) {
      // A marker that reads as a figure would turn real data into silence. `0`
      // is the one every provider actually writes and the one that must never
      // be swallowed.
      if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(marker)) {
        ctx.addIssue({
          code: "custom",
          path: ["absentMarkers"],
          message: "A number cannot mean absent.",
        });
      }
    }
    if (new Set(field.absentMarkers ?? []).size !== (field.absentMarkers ?? []).length) {
      ctx.addIssue({
        code: "custom",
        path: ["absentMarkers"],
        message: "Each absent marker may be declared once.",
      });
    }
  });

const contractSheetSchema = z
  .object({
    normalizedSheetName: normalizedIdentifierSchema,
    /**
     * How to find this sheet in an uploaded file.
     *
     * `name` is the normal case. `position` exists because Talabat names its
     * worksheet after the export range — January's download is
     * `Talabat-Jan-Feb-2026-Performanc` — so a contract keyed on the name would
     * stop recognising the provider's own report the month after approval.
     * `normalizedSheetName` stays either way, as this sheet's stable identifier
     * inside the contract and the projection that extends it.
     */
    sheetLocator: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("name") }).strict(),
        z
          .object({ kind: z.literal("position"), position: z.number().int().min(1).max(25) })
          .strict(),
      ])
      .optional(),
    headerRow: z.number().int().min(1).max(250_000),
    dataStartRow: z.number().int().min(2).max(250_000),
    allowFormula: z.boolean(),
    allowMergedCells: z.boolean(),
    fields: z.array(contractFieldSchema).min(1).max(250),
    /**
     * A row the provider renders as the sheet's own total rather than as data.
     *
     * EatEasily and Smile — the same platform under two names — put one in
     * every sales export, with the literal word `Total` in whatever column
     * precedes the first figure. It is not always at the bottom: in the
     * branch-wise report it is the first data row.
     *
     * It has to be found and set aside, not summed. A till receipt whose last
     * line is the total charges the customer twice if you add up every line,
     * and that is exactly what an exact-range sum over these files would do.
     * Once found it is also the honest place to check the import against, so a
     * projection may reconcile to it. See ADR 0029.
     */
    totalsRow: z
      .object({
        canonicalField: normalizedIdentifierSchema,
        /** Matched against the cell after the same normalization headers get. */
        label: z.string().trim().min(1).max(64),
      })
      .strict()
      .optional(),
    /**
     * A provider that appends extra values into some rows mid-sheet.
     *
     * Talabat writes a second unavailability reason straight after the first
     * when a day closed for two causes. The extra cell has no column of its
     * own, so every later cell in that row sits further right than the header
     * says -- eleven of the fifty-nine rows of the drafting export carry two
     * reasons, and binding their later columns by header name alone reads the
     * wrong cell silently, on exactly the days that matter most.
     *
     * A row is ragged when it reaches further right than the header row does.
     * The overflow is read off the row itself rather than declared, so the
     * declaration stays one fact: which header columns are allowed to move.
     * Columns before it never shift.
     */
    raggedRows: z
      .object({
        injectedFromColumnIndex: z.number().int().min(0).max(249_999),
      })
      .strict()
      .optional(),
    /**
     * Which way round this sheet holds its records.
     *
     * Every provider export the client sends is `rows`: one row per period,
     * one column per figure. An accounting statement is the transpose -- one
     * row per account, one column per month -- and all the information is
     * there, rotated ninety degrees.
     *
     * Declaring the orientation rather than sniffing it keeps the rest of the
     * pipeline ignorant of the difference. The sheet is rotated once, on the
     * way in, and `headerRow` and `dataStartRow` then mean exactly what they
     * always meant, counted down the rotated grid: for a statement whose first
     * column is the account name, the header row is 1 and the data starts at 2.
     *
     * Defaults to `rows`, so every contract approved before this existed reads
     * byte-identically. See ADR 0045.
     */
    recordOrientation: z.enum(["rows", "period_columns"]).optional(),
    /**
     * The row of the original sheet that names the periods, 1-based.
     *
     * A statement puts its months in a column heading rather than in a cell of
     * their own, so after rotation that heading becomes a value with no header
     * above it. This says which row it was, and the reader gives it a header of
     * its own so the contract can bind it like any other field.
     *
     * Transposed sheets only. There is nothing for it to mean otherwise.
     */
    periodHeaderRow: z.number().int().min(1).max(250_000).optional(),
  })
  .strict()
  .superRefine((sheet, ctx) => {
    if (sheet.dataStartRow <= sheet.headerRow) {
      ctx.addIssue({
        code: "custom",
        path: ["dataStartRow"],
        message: "Data rows must begin after the declared header row.",
      });
    }
    const fields = new Set<string>();
    for (const field of sheet.fields) {
      if (fields.has(field.canonicalField)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: "A sheet may bind each canonical field once.",
        });
      }
      fields.add(field.canonicalField);
    }
    if (sheet.totalsRow && !fields.has(sheet.totalsRow.canonicalField)) {
      ctx.addIssue({
        code: "custom",
        path: ["totalsRow"],
        message: "The totals row must be labelled in a field this sheet binds.",
      });
    }
    const transposed = sheet.recordOrientation === "period_columns";
    if (transposed && sheet.periodHeaderRow === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["periodHeaderRow"],
        message: "A transposed sheet must say which row names its periods.",
      });
    }
    if (!transposed && sheet.periodHeaderRow !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["periodHeaderRow"],
        message: "Only a transposed sheet has a period header row.",
      });
    }
    // Both describe a shape the sheet has before it is rotated, and neither
    // survives the rotation with its meaning intact. A totals row becomes a
    // totals column, and a ragged row becomes a column that is longer than the
    // others -- which is what a statement's blank cells look like anyway.
    // Silently reinterpreting either would be worse than refusing it.
    if (transposed && sheet.totalsRow) {
      ctx.addIssue({
        code: "custom",
        path: ["totalsRow"],
        message: "A transposed sheet cannot declare a totals row.",
      });
    }
    if (transposed && sheet.raggedRows) {
      ctx.addIssue({
        code: "custom",
        path: ["raggedRows"],
        message: "A transposed sheet cannot declare ragged rows.",
      });
    }
  });

const contractControlSchema = z
  .object({
    key: normalizedIdentifierSchema,
    kind: z.enum(["row_count", "populated_cell_count"]),
    normalizedSheetName: normalizedIdentifierSchema,
    tolerance: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const reportContractDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    outletGrain: z.literal("branch"),
    sheets: z.array(contractSheetSchema).min(1).max(25),
    controls: z.array(contractControlSchema).max(50),
    unmappedFieldDisposition: z.enum(["reviewed_ignore", "requires_mapping"]),
    /**
     * What to do about sheets in the file that this contract does not describe.
     *
     * Every real workbook the client's providers export has some. Keeta's
     * billing report carries a glossary, an order-level sheet and a settlement
     * sheet beside the daily one; Noon and EatEasily both ship an empty second
     * tab. Requiring all of them to be mapped would mean describing three
     * sheets nobody reads in order to read the fourth.
     *
     * Defaults to `requires_mapping`, so every contract approved before this
     * existed keeps refusing sheets it never saw.
     */
    unmappedSheetDisposition: z.enum(["reviewed_ignore", "requires_mapping"]).optional(),
  })
  .strict()
  .superRefine((document, ctx) => {
    const sheets = new Set<string>();
    for (const sheet of document.sheets) {
      if (sheets.has(sheet.normalizedSheetName)) {
        ctx.addIssue({
          code: "custom",
          path: ["sheets"],
          message: "A contract may select each sheet once.",
        });
      }
      sheets.add(sheet.normalizedSheetName);
    }
    const positions = new Set<number>();
    for (const sheet of document.sheets) {
      if (sheet.sheetLocator?.kind !== "position") continue;
      if (positions.has(sheet.sheetLocator.position)) {
        ctx.addIssue({
          code: "custom",
          path: ["sheets"],
          message: "Two sheets cannot be read from the same position.",
        });
      }
      positions.add(sheet.sheetLocator.position);
    }
    const transposedSheets = new Set(
      document.sheets
        .filter((sheet) => sheet.recordOrientation === "period_columns")
        .map((sheet) => sheet.normalizedSheetName),
    );
    for (const control of document.controls) {
      if (!sheets.has(control.normalizedSheetName)) {
        ctx.addIssue({
          code: "custom",
          path: ["controls"],
          message: "Every control must name a selected sheet.",
        });
      }
      // Both controls compare a count taken at validation against the one the
      // profile recorded, and the profile counted the sheet the way it arrived.
      // Twenty-four accounts over four months profiles as twenty-four rows and
      // validates as four, so the control would fail every time while nothing
      // was wrong.
      if (transposedSheets.has(control.normalizedSheetName)) {
        ctx.addIssue({
          code: "custom",
          path: ["controls"],
          message: "A transposed sheet cannot be checked by a row or cell count.",
        });
      }
    }
  });

export type ReportContractDocument = z.output<typeof reportContractDocumentSchema>;

export type ReportSchemaFingerprintInput = {
  reportType: string;
  currency: string;
  outletGrain: "branch";
  parserVersion: number;
  fingerprintVersion: number;
  sheets: Array<{
    position: number;
    normalizedSheetName: string;
    headerCandidateDigests: Array<{
      rowPosition: number;
      fieldCount: number;
      digest: string;
      normalizedHeaderDigests: string[];
    }>;
    hasFormula: boolean;
    hasMergedCells: boolean;
    hasRepeatedHeader: boolean;
  }>;
};

export function normalizeReportStructureIdentifier(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLocaleLowerCase("en-US")
    .slice(0, 64);
  return /^[a-z]/.test(normalized) ? normalized : `sheet_${normalized || "unknown"}`;
}
