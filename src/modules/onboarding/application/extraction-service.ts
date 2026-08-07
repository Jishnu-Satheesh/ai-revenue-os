import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { onboardingSectionKeySchema, type OnboardingSectionKey } from "@/domain/onboarding/types";
import type { OnboardingExtractionRepository } from "@/modules/onboarding/infrastructure/repository";

export const maxOnboardingUploadBytes = 50 * 1024 * 1024;
const allowedMediaTypes = new Set([
  "text/csv",
  "text/plain",
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

const uploadInputSchema = z.object({
  organizationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sectionKey: onboardingSectionKeySchema,
  originalFilename: z.string().trim().min(1).max(255),
  mediaType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive().max(maxOnboardingUploadBytes),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});

export type UploadInput = z.infer<typeof uploadInputSchema>;

export type ExtractedCandidate = {
  candidateType: "fact" | "metric" | "catalog_row" | "clarification";
  candidatePayload: Record<string, unknown>;
  confidence: number | null;
  evidence: Array<{ sourceReference: string; location?: string }>;
};

export const candidateReviewSchema = z.object({
  action: z.enum(["confirm", "edit", "reject", "unknown"]),
  payload: z.record(z.string(), z.unknown()).optional(),
  evidence: z
    .array(z.object({ sourceReference: z.string().min(1), location: z.string().optional() }))
    .min(1),
});
export type CandidateReview = z.infer<typeof candidateReviewSchema>;

export function validateUploadInput(input: unknown): UploadInput {
  const parsed = uploadInputSchema.parse(input);
  if (!allowedMediaTypes.has(parsed.mediaType.toLowerCase())) {
    throw new DomainError("VALIDATION_ERROR", "This file type is not supported for onboarding.");
  }
  if (
    parsed.sectionKey === "business_identity" ||
    parsed.sectionKey === "branches_operations" ||
    parsed.sectionKey === "customers_consent" ||
    parsed.sectionKey === "review_readiness"
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Uploads are not available for this onboarding section.",
    );
  }
  return parsed;
}

export function buildOnboardingStoragePath(
  organizationId: string,
  sessionId: string,
  uploadId: string,
  originalFilename: string,
) {
  const safeFilename = originalFilename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180) || "upload";
  return `${organizationId}/${sessionId}/${uploadId}/${safeFilename}`;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function looksLikeInstruction(values: string[]) {
  const text = values.join(" ").toLowerCase();
  return /ignore previous|system message|developer message|assistant message|delete data|reveal secret/.test(
    text,
  );
}

export function extractDelimitedCandidates(
  text: string,
  sourceReference: string,
): ExtractedCandidate[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header, index) => header || `column_${index + 1}`);
  return lines.slice(1).flatMap((line, index) => {
    const values = parseCsvLine(line);
    if (looksLikeInstruction(values)) return [];
    const candidatePayload = Object.fromEntries(
      headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]),
    );
    return [
      {
        candidateType: "catalog_row" as const,
        candidatePayload,
        confidence: null,
        evidence: [{ sourceReference, location: `line ${index + 2}` }],
      },
    ];
  });
}

export function validateCandidateReview(input: unknown, expectedSectionKey?: OnboardingSectionKey) {
  const review = candidateReviewSchema.parse(input);
  if ((review.action === "confirm" || review.action === "edit") && !review.payload) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "A reviewed candidate must include its reviewed value.",
    );
  }
  return { ...review, expectedSectionKey };
}

export async function runOnboardingExtraction(input: {
  repository: OnboardingExtractionRepository;
  organizationId: string;
  uploadId: string;
  extractionId: string;
  readText: (upload: { storagePath: string; mediaType: string }) => Promise<string>;
  now?: () => string;
}) {
  const now = input.now ?? (() => new Date().toISOString());
  const upload = await input.repository.findUpload({
    organizationId: input.organizationId,
    uploadId: input.uploadId,
  });
  if (!upload)
    throw new DomainError("TENANT_SCOPE_ERROR", "The onboarding upload is not available.");
  await input.repository.updateUpload({
    organizationId: input.organizationId,
    uploadId: input.uploadId,
    patch: { status: "extracting", error_summary: null },
  });
  await input.repository.updateExtraction({
    organizationId: input.organizationId,
    extractionId: input.extractionId,
    patch: { status: "running", started_at: now(), error_summary: null },
  });

  try {
    if (upload.media_type !== "text/csv" && upload.media_type !== "text/plain") {
      throw new DomainError(
        "INTEGRATION_ERROR",
        "This file requires manual review or a configured document extractor.",
      );
    }
    const text = await input.readText({
      storagePath: upload.storage_path,
      mediaType: upload.media_type,
    });
    const candidates = extractDelimitedCandidates(text, upload.original_filename);
    for (const candidate of candidates) {
      await input.repository.createCandidate({
        organization_id: input.organizationId,
        extraction_id: input.extractionId,
        section_key: upload.section_key,
        candidate_type: candidate.candidateType,
        fact_key: null,
        candidate_payload: candidate.candidatePayload,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        contradiction_references: [],
        status: "pending",
        reviewed_by: null,
        reviewed_at: null,
      });
    }
    const extraction = await input.repository.updateExtraction({
      organizationId: input.organizationId,
      extractionId: input.extractionId,
      patch: { status: "succeeded", completed_at: now(), error_summary: null },
    });
    await input.repository.updateUpload({
      organizationId: input.organizationId,
      uploadId: input.uploadId,
      patch: { status: "succeeded", error_summary: null },
    });
    return { extraction, candidateCount: candidates.length };
  } catch (error) {
    const message =
      error instanceof DomainError
        ? error.message
        : "Extraction failed. Use manual entry or retry.";
    await input.repository.updateExtraction({
      organizationId: input.organizationId,
      extractionId: input.extractionId,
      patch: { status: "failed", completed_at: now(), error_summary: message },
    });
    await input.repository.updateUpload({
      organizationId: input.organizationId,
      uploadId: input.uploadId,
      patch: { status: "failed", error_summary: message },
    });
    throw error;
  }
}
