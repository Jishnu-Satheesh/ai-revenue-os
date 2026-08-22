import { createHash } from "node:crypto";

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
    headerRow: z.number().int().min(1).max(250_000),
    dataStartRow: z.number().int().min(2).max(250_000),
    allowFormula: z.boolean(),
    allowMergedCells: z.boolean(),
    fields: z.array(contractFieldSchema).min(1).max(250),
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
    for (const control of document.controls) {
      if (!sheets.has(control.normalizedSheetName)) {
        ctx.addIssue({
          code: "custom",
          path: ["controls"],
          message: "Every control must name a selected sheet.",
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

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createReportSchemaFingerprint(input: ReportSchemaFingerprintInput): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

export function createReportContractDocumentDigest(document: ReportContractDocument): string {
  return createHash("sha256").update(canonicalize(document)).digest("hex");
}

export function normalizeReportStructureIdentifier(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLocaleLowerCase("en-US")
    .slice(0, 64);
  return /^[a-z]/.test(normalized) ? normalized : `sheet_${normalized || "unknown"}`;
}
