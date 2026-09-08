import { parse } from "tldts";
import { z } from "zod";

import {
  RESEARCH_BUDGET_LIMITS,
  researchAttemptUsageSchema,
  researchCoverageEntrySchema,
} from "@/domain/growth-intelligence/research-pipeline";

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

function isRegistrablePublicDomain(domain: string): boolean {
  const result = parse(domain, { allowPrivateDomains: false, detectIp: true });
  return result.hostname === domain && result.domain !== null && !result.isIp;
}

const publicDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
    "An approved domain must be a hostname without a scheme, path, port, or credentials.",
  )
  .refine(isRegistrablePublicDomain, "An approved domain must be publicly registrable.");

/**
 * A competitor lead from the approved scope. A website is identity context,
 * never proof; a name-only lead is unverified and alone can never support a
 * claim. Strict: business reports and customer data cannot parse here.
 */
export const researchCompetitorLeadSchema = z
  .object({
    name: boundedText(160),
    publicUrl: z.string().trim().min(1).max(2_048).optional(),
    locationHint: boundedText(240).optional(),
  })
  .strict();

export type ResearchCompetitorLead = z.infer<typeof researchCompetitorLeadSchema>;

export const approvedResearchScopeSchema = z
  .object({
    publicBusinessName: boundedText(160),
    approvedDomains: z.array(publicDomainSchema).max(20),
    niches: z.array(boundedText(120)).min(1).max(12),
    city: boundedText(160),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    topics: z.array(boundedText(160)).min(1).max(20),
    competitors: z.array(researchCompetitorLeadSchema).max(5).optional().default([]),
  })
  .strict()
  .superRefine((scope, context) => {
    for (const [field, values] of [
      ["approvedDomains", scope.approvedDomains],
      ["niches", scope.niches],
      ["topics", scope.topics],
    ] as const) {
      if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must not contain duplicates.`,
        });
      }
    }
    const competitorNames = scope.competitors.map((competitor) => competitor.name.toLowerCase());
    if (new Set(competitorNames).size !== competitorNames.length) {
      context.addIssue({
        code: "custom",
        path: ["competitors"],
        message: "competitors must not contain duplicates.",
      });
    }
  });

export type ApprovedResearchScope = z.infer<typeof approvedResearchScopeSchema>;

export const researchRequestSchema = z
  .object({
    scope: approvedResearchScopeSchema,
    maxQueries: z.number().int().min(1).max(3),
    maxResultsPerQuery: z.number().int().min(1).max(10),
    maxResponseBytes: z
      .number()
      .int()
      .min(1_024)
      .max(512 * 1_024),
    maxRedirects: z.number().int().min(0).max(3),
    timeoutMs: z.number().int().min(250).max(20_000),
    maxCostMicrosUsd: z.number().int().min(0).max(50_000_000),
  })
  .strict();

export type ResearchRequest = z.infer<typeof researchRequestSchema>;

export type ResearchAdapterAvailability = {
  available: boolean;
  provider: string;
};

const researchSourceUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      );
    } catch {
      return false;
    }
  }, "A source URL must be a public HTTP URL without credentials.");

export const researchAttemptReferenceSchema = z
  .object({
    attemptId: z.string().uuid(),
    slotKey: z.string().trim().min(1).max(160),
    usage: researchAttemptUsageSchema,
  })
  .strict();

export type ResearchAttemptReference = z.infer<typeof researchAttemptReferenceSchema>;

export const researchRetrievedSourceSchema = z
  .object({
    sourceUrl: researchSourceUrlSchema,
    domain: publicDomainSchema,
    publisher: boundedText(200).optional(),
    sourceClass: z
      .enum(["official", "first_party", "industry_research", "public_signal"])
      .optional(),
    excerptText: z
      .string()
      .min(1, "A retained source must carry excerpt text.")
      .max(RESEARCH_BUDGET_LIMITS.maxExcerptCharacters),
    excerptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    retrievedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ResearchRetrievedSource = z.infer<typeof researchRetrievedSourceSchema>;

/**
 * Validated retrieval output: bounded permitted excerpts, the coverage
 * manifest and attempt usage references. Provider qualification travels
 * separately; no raw provider payload belongs here.
 */
export const researchRetrievalResultSchema = z
  .object({
    sources: z.array(researchRetrievedSourceSchema).max(RESEARCH_BUDGET_LIMITS.maxRetainedSources),
    coverage: z
      .array(researchCoverageEntrySchema)
      .min(1)
      .max(
        RESEARCH_BUDGET_LIMITS.maxPrimarySearches,
        "Coverage cannot exceed the planned query slots.",
      ),
    attempts: z
      .array(researchAttemptReferenceSchema)
      .max(
        RESEARCH_BUDGET_LIMITS.maxPrimarySearches + RESEARCH_BUDGET_LIMITS.maxRetryAttempts,
        "Attempts cannot exceed the run ceiling.",
      ),
  })
  .strict()
  .superRefine((result, context) => {
    const totalExcerptCharacters = result.sources.reduce(
      (total, source) => total + source.excerptText.length,
      0,
    );
    if (totalExcerptCharacters > RESEARCH_BUDGET_LIMITS.maxTotalExcerptCharacters) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Total retained excerpt text must not exceed 64 KiB.",
      });
    }
  });

export type ResearchRetrievalResult = z.infer<typeof researchRetrievalResultSchema>;

export type ResearchAdapter = {
  readonly availability: ResearchAdapterAvailability;
  searchAndFetch(input: ResearchRequest): Promise<ResearchRetrievalResult>;
};
