import { z } from "zod";

import { memoryPurposeSchema, sensitivitySchema } from "@/domain/memory/schemas";

const idempotencyKeySchema = z.string().trim().min(1).max(200);

export const createMemoryItemSchema = z.object({
  memoryType: z.enum(["note", "document"]),
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().max(8_000).optional(),
  branchId: z.string().uuid().optional(),
  sensitivity: sensitivitySchema.default("internal"),
  markVerified: z.boolean().default(true),
  reviewDueAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const updateMemoryItemSchema = z
  .object({
    action: z.enum(["verify", "reject", "reclassify"]),
    reason: z.string().trim().min(1).max(500).optional(),
    sensitivity: sensitivitySchema.optional(),
    reviewDueAt: z.string().datetime().nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .refine((value) => value.action !== "reject" || Boolean(value.reason), {
    message: "A rejection must say why.",
    path: ["reason"],
  });

export const supersedeMemoryItemSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().max(8_000).optional(),
  sensitivity: sensitivitySchema.default("internal"),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

export const confirmProposalSchema = z.object({
  overrideVerified: z.boolean().default(false),
  idempotencyKey: idempotencyKeySchema,
});

export const rejectProposalSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

/**
 * Search is a POST because its body carries a structured query, not because it
 * mutates. It is idempotent, so it deliberately refuses an idempotency key:
 * accepting one would imply a write that never happens.
 */
export const searchMemorySchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    purpose: memoryPurposeSchema.default("operator_search"),
    branchId: z.string().uuid().optional(),
    memoryTypes: z
      .array(
        z.enum(["structured_fact", "document", "note", "episode", "decision", "outcome", "lesson"]),
      )
      .max(8)
      .optional(),
    sensitivityAllowance: sensitivitySchema.optional(),
    maxAgeDays: z.number().int().positive().max(3_650).optional(),
    includeSuperseded: z.boolean().default(false),
    includeExpired: z.boolean().default(false),
    limit: z.number().int().positive().max(50).default(20),
  })
  .strict();

export const timelineCursorSchema = z
  .object({
    observedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();

export const timelineQuerySchema = z
  .object({
    branchId: z.string().uuid().optional(),
    sourceSystems: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    limit: z.coerce.number().int().positive().max(100).default(50),
    cursor: timelineCursorSchema.optional(),
  })
  .strict();

export type CreateMemoryItemInput = z.infer<typeof createMemoryItemSchema>;
export type UpdateMemoryItemInput = z.infer<typeof updateMemoryItemSchema>;
export type SupersedeMemoryItemInput = z.infer<typeof supersedeMemoryItemSchema>;
export type ConfirmProposalInput = z.infer<typeof confirmProposalSchema>;
export type RejectProposalInput = z.infer<typeof rejectProposalSchema>;
export type SearchMemoryInput = z.infer<typeof searchMemorySchema>;
export type TimelineCursor = z.infer<typeof timelineCursorSchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
