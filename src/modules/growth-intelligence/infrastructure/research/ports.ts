import { parse } from "tldts";
import { z } from "zod";

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

export const approvedResearchScopeSchema = z
  .object({
    publicBusinessName: boundedText(160),
    approvedDomains: z.array(publicDomainSchema).min(1).max(20),
    niches: z.array(boundedText(120)).min(1).max(12),
    city: boundedText(160),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    topics: z.array(boundedText(160)).min(1).max(20),
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

export type ResearchAdapter = {
  readonly availability: ResearchAdapterAvailability;
  searchAndFetch(input: ResearchRequest): Promise<never>;
};
