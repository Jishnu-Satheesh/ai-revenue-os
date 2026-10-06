import { z } from "zod";

import { REPORT_PACKAGE_LIMITS } from "@/domain/reports/types";
import { agentReportScopeSchema } from "./report-intake";

export const attachmentIntentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mediaType: z.string().trim().min(1).max(200),
  byteSize: z.number().int().positive().max(REPORT_PACKAGE_LIMITS.maxCompressedBytes),
  idempotencyKey: z.string().trim().min(16).max(200),
}).strict().superRefine((input, ctx) => {
  const kind = input.fileName.split(".").pop()?.toLowerCase();
  const valid = (kind === "csv" && ["text/csv", "application/csv"].includes(input.mediaType)) ||
    (kind === "xlsx" && input.mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  if (!valid) ctx.addIssue({ code: "custom", path: ["fileName"], message: "Choose a CSV or XLSX report." });
});

export const attachmentCompletionSchema = z.object({
  scope: agentReportScopeSchema.nullable().default(null),
}).strict();
