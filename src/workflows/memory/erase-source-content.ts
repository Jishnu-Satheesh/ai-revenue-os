import { z } from "zod";

import type { ContextRepository } from "@/modules/memory/infrastructure/context-repository";
import { captureSourceKinds } from "@/domain/memory/capture";

/**
 * Rights-driven source erasure (Spec 023 §§11/14). Bounded and audited: one
 * source identity per run, the database RPC nulls projection documents, safe
 * snapshots, and derived embeddings while retaining permitted
 * ids/digests/decision metadata, and writes an audit row for every call.
 * Registration source-tests only — no live runs in this slice.
 */

export const eraseSourceKinds = [...captureSourceKinds, "memory_item"] as const;

export type EraseSourceKind = (typeof eraseSourceKinds)[number];

export const eraseSourceContentPayloadSchema = z
  .object({
    taskName: z.literal("memory.erase-source-content"),
    organizationId: z.string().uuid(),
    correlationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
    sourceKind: z.enum(eraseSourceKinds),
    sourceId: z.string().uuid(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();

export type EraseSourceContentPayload = z.infer<typeof eraseSourceContentPayloadSchema>;

export type EraseSourceContentOutcome =
  | { outcome: "cancelled"; erased: 0 }
  | {
      outcome: "succeeded";
      erasedEvents: number;
      erasedItems: number;
      erasedEntries: number;
    };

export type EraseSourceDependencies = {
  erasure: Pick<ContextRepository, "eraseSourceContent">;
  signal?: AbortSignal;
  logger?: { warn(message: string, context?: { organizationId?: string }): void };
};

/** Actor-scoped runs carry the user; worker runs pass null and ride service_role. */
export async function runEraseSourceContent(
  input: unknown,
  dependencies: EraseSourceDependencies & { actorId?: string | null },
): Promise<EraseSourceContentOutcome> {
  const parsed = eraseSourceContentPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("memory.erase-source-content payload is invalid");
  }
  if (dependencies.signal?.aborted) return { outcome: "cancelled", erased: 0 };

  const result = await dependencies.erasure.eraseSourceContent({
    organizationId: parsed.data.organizationId,
    actorId: dependencies.actorId ?? null,
    sourceKind: parsed.data.sourceKind,
    sourceId: parsed.data.sourceId,
    reason: parsed.data.reason,
  });
  return {
    outcome: "succeeded",
    erasedEvents: result.erasedEvents,
    erasedItems: result.erasedItems,
    erasedEntries: result.erasedEntries,
  };
}
