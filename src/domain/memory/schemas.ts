import { z } from "zod";

import {
  degradedReasons,
  freshnessStates,
  memoryOrigins,
  memoryPurposes,
  memoryTypes,
  retrievalModes,
  sensitivities,
  verificationStates,
} from "@/domain/memory/types";

export const memoryTypeSchema = z.enum(memoryTypes);
export const memoryOriginSchema = z.enum(memoryOrigins);
export const verificationStateSchema = z.enum(verificationStates);
export const sensitivitySchema = z.enum(sensitivities);
export const freshnessSchema = z.enum(freshnessStates);
export const memoryPurposeSchema = z.enum(memoryPurposes);
export const retrievalModeSchema = z.enum(retrievalModes);
export const degradedReasonSchema = z.enum(degradedReasons);

export const memoryRetrievalQuerySchema = z.object({
  organizationId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  purpose: memoryPurposeSchema,
  query: z.string().trim().min(1).max(500),
  memoryTypes: z.array(memoryTypeSchema).max(8).optional(),
  sensitivityAllowance: sensitivitySchema,
  maxAgeDays: z.number().int().positive().max(3_650).optional(),
  includeSuperseded: z.boolean().default(false),
  includeExpired: z.boolean().default(false),
  limit: z.number().int().positive().max(50).default(20),
  correlationId: z.string().uuid(),
});

export type MemoryRetrievalQueryInput = z.input<typeof memoryRetrievalQuerySchema>;
export type MemoryRetrievalQuery = z.output<typeof memoryRetrievalQuerySchema>;

export const memoryProvenanceSchema = z.object({
  origin: memoryOriginSchema,
  sourceTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  sourceSystem: z.string().optional(),
  sourceReference: z.string().optional(),
  verificationState: verificationStateSchema,
  verifiedAt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const memoryRetrievalResultSchema = z.object({
  itemId: z.string().uuid().nullable(),
  memoryType: memoryTypeSchema,
  title: z.string(),
  body: z.string().optional(),
  structuredValue: z.unknown().optional(),
  provenance: memoryProvenanceSchema,
  trustRank: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  freshness: freshnessSchema,
  observedAt: z.string().optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
  sensitivity: sensitivitySchema,
  scores: z.object({
    lexical: z.number(),
    semantic: z.number(),
    blended: z.number(),
  }),
});

export type MemoryRetrievalResult = z.infer<typeof memoryRetrievalResultSchema>;

export const memoryRetrievalResponseSchema = z.object({
  results: z.array(memoryRetrievalResultSchema),
  retrievalMode: retrievalModeSchema,
  degradedReason: degradedReasonSchema.optional(),
  servedFromCache: z.boolean().default(false),
  builtAt: z.string().optional(),
  serverTime: z.string(),
});

export type MemoryRetrievalResponse = z.infer<typeof memoryRetrievalResponseSchema>;

export type MemoryRetrievalPort = {
  retrieve(query: MemoryRetrievalQueryInput): Promise<MemoryRetrievalResponse>;
};
