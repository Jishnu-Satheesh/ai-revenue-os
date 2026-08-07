import { z } from "zod";

import { DomainError } from "@/lib/errors";

export const onboardingSectionKeys = [
  "business_identity",
  "branches_operations",
  "products_services",
  "channels_presence",
  "historical_performance",
  "customers_consent",
  "brand_assets",
  "governance",
  "integrations_uploads",
  "review_readiness",
] as const;

export const onboardingSectionKeySchema = z.enum(onboardingSectionKeys);
export type OnboardingSectionKey = z.infer<typeof onboardingSectionKeySchema>;

export const onboardingSectionStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "complete",
  "needs_attention",
  "blocked",
]);
export type OnboardingSectionStatus = z.infer<typeof onboardingSectionStatusSchema>;

export const onboardingPhaseSchema = z.enum([
  "foundation",
  "commercial_context",
  "customer_context",
  "governance",
  "data_intake",
  "review",
]);
export type OnboardingPhase = z.infer<typeof onboardingPhaseSchema>;

export const sourceTypeSchema = z.enum(["operator", "client", "upload", "inferred", "system"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const factStatusSchema = z.enum(["verified", "imported", "inferred", "stale"]);
export type FactStatus = z.infer<typeof factStatusSchema>;

export const evidenceSchema = z.object({
  sourceReference: z.string().trim().min(1).max(500),
  location: z.string().trim().max(200).optional(),
  excerpt: z.string().trim().max(1000).optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const sectionSaveSchema = z.object({
  sectionKey: onboardingSectionKeySchema.optional(),
  status: onboardingSectionStatusSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  sourceMetadata: z.array(evidenceSchema).default([]),
  idempotencyKey: z.string().trim().min(16).max(200).optional(),
});
export type SectionSave = z.infer<typeof sectionSaveSchema>;

export const onboardingRequestInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  sectionKey: onboardingSectionKeySchema,
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(2).max(2000),
  assigneeUserId: z.string().uuid().nullable().optional(),
  clientContact: z.string().trim().max(320).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
});
export type OnboardingRequestInput = z.infer<typeof onboardingRequestInputSchema>;

export const candidateFactSchema = z.object({
  factKey: z.string().trim().min(2).max(120),
  value: z.unknown(),
  status: factStatusSchema,
  confidence: z.number().min(0).max(1).nullable().optional(),
  evidence: z.array(evidenceSchema).default([]),
});
export type CandidateFact = z.infer<typeof candidateFactSchema>;

export type ConfirmedFact = CandidateFact & {
  status: "verified";
  confirmedAt: string;
};

export function confirmCandidateFact(input: CandidateFact): ConfirmedFact {
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "A candidate fact requires evidence before confirmation.",
    );
  }
  const candidate = candidateFactSchema.parse(input);

  return {
    ...candidate,
    status: "verified",
    confirmedAt: new Date().toISOString(),
  };
}
