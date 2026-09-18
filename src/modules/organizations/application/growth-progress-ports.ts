import { z } from "zod";

import { isoDateSchema } from "@/domain/organizations/growth-periods";
import {
  frozenGrowthProjectionSchema,
  scopePartitionSchema,
  type RevenueFact,
} from "@/domain/organizations/growth-progress";

/**
 * Read and write boundaries for the fixed-projection slice (data contract D07).
 *
 * Like a library desk with a vault: reads go through the member's own card
 * (the session client), and deposits into the vault go through one guarded
 * slot (the service-only publication RPC) that never rewrites history.
 *
 * Interfaces only — no database, crypto, model or Node built-in is touched,
 * so browser code may import these types. Implementations live in
 * infrastructure (session reads, worker-only writes) in later tasks.
 */

export const readProjectionsInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  asOfDate: isoDateSchema,
});
export type ReadProjectionsInput = z.output<typeof readProjectionsInputSchema>;

export const readRevenueFactsInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  from: isoDateSchema,
  toExclusive: isoDateSchema,
  scopePartitions: z.array(scopePartitionSchema).min(1).max(100),
});
export type ReadRevenueFactsInput = z.output<typeof readRevenueFactsInputSchema>;

/**
 * One stored frozen projection with its database identity.
 *
 * The document is the frozen numbers the browser draws; the id and digest
 * are the storage identity Task 5 composes into each view so two viewers of
 * the same projection id provably see the same numbers. Both travel
 * together — a document without its identity cannot be cited, and an
 * identity without its document cannot be drawn.
 */
export const storedGrowthProjectionSchema = z.strictObject({
  document: frozenGrowthProjectionSchema,
  projectionId: z.string().uuid(),
  digest: z
    .string()
    .trim()
    .length(64)
    .regex(/^[0-9a-f]{64}$/, { message: "Digests read as SHA-256 hex." }),
});
export type StoredGrowthProjection = z.output<typeof storedGrowthProjectionSchema>;

/**
 * Typed projection-read outcome. Returns at most one active/upcoming row per
 * horizon. Denials, corruption and read failures are explicit envelopes —
 * never laundered into an empty "no data" answer.
 */
export type ProjectionReadEnvelope =
  | { status: "ready"; projections: readonly StoredGrowthProjection[] }
  | { status: "missing"; reason: "PROJECTION_MISSING" }
  | { status: "corrupt"; reason: "PROJECTION_CORRUPT" }
  | { status: "denied"; reason: "PERMISSION_DENIED" }
  | { status: "failed"; reason: "SOURCE_READ_FAILED" };

/** Typed fact-read outcome; truncation is reported, never silently partial. */
export type RevenueFactsEnvelope =
  | { status: "ready"; facts: readonly RevenueFact[] }
  | { status: "denied"; reason: "PERMISSION_DENIED" }
  | { status: "limited"; reason: "SOURCE_LIMIT_EXCEEDED" }
  | { status: "failed"; reason: "SOURCE_READ_FAILED" };

export type GrowthProgressReadPort = {
  readProjections(input: ReadProjectionsInput): Promise<ProjectionReadEnvelope>;
  readRevenueFacts(input: ReadRevenueFactsInput): Promise<RevenueFactsEnvelope>;
};

export const publishProjectionInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  document: frozenGrowthProjectionSchema,
  correlationId: z.string().uuid(),
});
export type PublishGrowthProjectionInput = z.output<typeof publishProjectionInputSchema>;

export type PublishGrowthProjectionResult = {
  projectionId: string;
  digest: string;
  /** False when the identity already existed: the original is replayed untouched. */
  published: boolean;
};

/**
 * Worker-only publication boundary. It can insert an original or replay one;
 * it cannot update or delete an original, and duplicates return the stored
 * identity without a second audit event.
 */
export type GrowthProjectionWritePort = {
  publish(input: PublishGrowthProjectionInput): Promise<PublishGrowthProjectionResult>;
};
