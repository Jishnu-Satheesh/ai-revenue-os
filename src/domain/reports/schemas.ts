import { z } from "zod";

import {
  REPORT_FILE_KINDS,
  REPORT_PACKAGE_LIMITS,
  type ReportFileKind,
} from "@/domain/reports/types";
import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { guidedReportMappingSchema } from "@/domain/reports/guided-mapping";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const csvMimeTypes = ["text/csv", "application/csv"] as const;
const xlsxMimeTypes = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
const pdfMimeTypes = ["application/pdf"] as const;

/**
 * Formats that are recognised only so the refusal can say something useful.
 *
 * A provider in the pilot serves pre-2007 binary `.xls`, which no parser here
 * reads. Falling through to "only CSV, XLSX and PDF are accepted" leaves the
 * operator staring at a file whose icon says Excel, so the message names the
 * format and the fix instead.
 */
const namedUnsupportedExtensions: Readonly<Record<string, string>> = {
  xls: "This is an older Excel format (.xls). Open it and save as .xlsx, then upload again.",
  xlsm: "Macro-enabled workbooks are not accepted. Save as .xlsx, then upload again.",
  numbers: "Numbers files are not accepted. Export as .xlsx or CSV, then upload again.",
};

export const reportPackageUploadIntentSchema = z
  .object({
    channelId: z.string().uuid(),
    branchId: z.string().uuid(),
    // There is deliberately no provider/report-family registry in this slice.
    // A bounded explicit label preserves the operator declaration without
    // implying that the system understands its financial semantics.
    reportType: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[\p{L}\p{N} ._/-]+$/u),
    periodStart: dateOnlySchema,
    periodEnd: dateOnlySchema,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    originalFilename: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(200),
    contentLength: z.number().int().positive().max(REPORT_PACKAGE_LIMITS.maxCompressedBytes),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.periodEnd < value.periodStart) {
      ctx.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "Period end must not precede period start.",
      });
    }
    const extension = value.originalFilename.split(".").pop()?.toLowerCase() ?? "";
    const fileKind = REPORT_FILE_KINDS.includes(extension as ReportFileKind)
      ? (extension as ReportFileKind)
      : null;
    if (!fileKind) {
      ctx.addIssue({
        code: "custom",
        path: ["originalFilename"],
        message:
          namedUnsupportedExtensions[extension] ?? "Only CSV, XLSX, and PDF files are accepted.",
      });
      return;
    }
    const validMimeType =
      (fileKind === "csv" &&
        csvMimeTypes.includes(value.contentType as (typeof csvMimeTypes)[number])) ||
      (fileKind === "xlsx" &&
        xlsxMimeTypes.includes(value.contentType as (typeof xlsxMimeTypes)[number])) ||
      (fileKind === "pdf" &&
        pdfMimeTypes.includes(value.contentType as (typeof pdfMimeTypes)[number]));
    if (!validMimeType) {
      ctx.addIssue({
        code: "custom",
        path: ["contentType"],
        message: "The file type does not match its extension.",
      });
    }
  });

export type ReportPackageUploadIntent = z.output<typeof reportPackageUploadIntentSchema>;

export function reportFileKindFromFilename(filename: string): ReportFileKind {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!REPORT_FILE_KINDS.includes(extension as ReportFileKind)) {
    throw new Error(
      namedUnsupportedExtensions[extension] ?? "Only CSV, XLSX, and PDF files are accepted.",
    );
  }
  return extension as ReportFileKind;
}

export const completeReportPackageUploadSchema = z
  .object({
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const retryReportPackageSchema = z
  .object({
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

/**
 * A body that names no source is a hand-written one.
 *
 * A discriminated union will not fall back to a default when its discriminator
 * is absent, and every caller written before the library existed omits it.
 * Filling it in here keeps those callers working and keeps the union's
 * guarantee — that a document and a library key can never arrive together —
 * exactly as strict.
 */
function withDefaultProposalSource(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const body = input as Record<string, unknown>;
  return body.source === undefined ? { ...body, source: "human" } : body;
}

/**
 * A proposal names either a mapping written by hand or a report family the
 * platform already knows.
 *
 * The two are mutually exclusive by construction rather than by a rule someone
 * has to remember. A caller that sends a document cannot also claim it came
 * from the library, and a caller that names a definition sends no document at
 * all — the server builds it from the checked-in artifact, so the provenance
 * recorded against the version is the server's statement and not the caller's.
 */
export const proposeReportContractSchema = z.preprocess(
  withDefaultProposalSource,
  z.discriminatedUnion("source", [
    z
      .object({
        source: z.literal("human").default("human"),
        mappingDocument: reportContractDocumentSchema,
        idempotencyKey: z.string().trim().min(16).max(200),
      })
      .strict(),
    z
      .object({
        source: z.literal("library"),
        providerDefinitionKey: z.string().trim().min(2).max(80),
        idempotencyKey: z.string().trim().min(16).max(200),
      })
      .strict(),
    z
      .object({
        source: z.literal("guided"),
        guided: guidedReportMappingSchema,
        idempotencyKey: z.string().trim().min(16).max(200),
      })
      .strict(),
  ]),
);

export const decideReportContractSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "rejected" && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A rejection reason is required.",
      });
    }
  });

export const proposeReportProjectionSchema = z.preprocess(
  withDefaultProposalSource,
  z.discriminatedUnion("source", [
    z
      .object({
        source: z.literal("human").default("human"),
        projectionDocument: reportProjectionDocumentSchema,
        idempotencyKey: z.string().trim().min(16).max(200),
      })
      .strict(),
    z
      .object({
        source: z.literal("library"),
        providerDefinitionKey: z.string().trim().min(2).max(80),
        idempotencyKey: z.string().trim().min(16).max(200),
      })
      .strict(),
    z
      .object({
        // Carries no document and no answers: the declaration follows from the
        // contract an owner already approved, so the two cannot drift.
        source: z.literal("guided"),
        idempotencyKey: z.string().trim().min(16).max(200),
      })
      .strict(),
  ]),
);

/**
 * Accept one accidental double-envelope from clients that wrapped the full
 * proposal request inside `projectionDocument`. The outer idempotency key is
 * authoritative; the inner key is discarded before strict validation.
 */
export function normalizeReportProjectionProposalBody(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const body = input as Record<string, unknown>;
  const nested = body.projectionDocument;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return input;
  const nestedBody = nested as Record<string, unknown>;
  if (
    !nestedBody.projectionDocument ||
    typeof nestedBody.projectionDocument !== "object" ||
    Array.isArray(nestedBody.projectionDocument) ||
    typeof nestedBody.idempotencyKey !== "string" ||
    typeof body.idempotencyKey !== "string"
  )
    return input;
  return {
    source: "human",
    projectionDocument: nestedBody.projectionDocument,
    idempotencyKey: body.idempotencyKey,
  };
}

export const decideReportProjectionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "rejected" && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A rejection reason is required.",
      });
    }
  });

export const requestReportProjectionSchema = z
  .object({ idempotencyKey: z.string().trim().min(16).max(200) })
  .strict();

export const resolveReportProjectionOverlapSchema = z
  .object({
    resolution: z.enum(["accept_correction", "keep_existing"]),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const reportProfilingTaskSchema = z
  .object({
    organizationId: z.string().uuid(),
    packageId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const reportValidationTaskSchema = z
  .object({
    organizationId: z.string().uuid(),
    packageId: z.string().uuid(),
    contractVersionId: z.string().uuid(),
    validationRunId: z.string().uuid(),
    correlationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const reportProjectionTaskSchema = z
  .object({
    organizationId: z.string().uuid(),
    packageId: z.string().uuid(),
    contractVersionId: z.string().uuid(),
    projectionVersionId: z.string().uuid(),
    projectionRunId: z.string().uuid(),
    correlationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();
