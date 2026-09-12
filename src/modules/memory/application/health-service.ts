import { z } from "zod";

/**
 * Governed Business Memory health (Spec 023 §§13/14, release 1 close).
 *
 * Pure aggregation only: no I/O, no clock, no randomness. Callers (the
 * memory/health route) read bounded counts through RLS selects and hand the
 * rows here; this module turns them into the operator-facing view. Nothing
 * here carries a snippet, a body, a summary, or a prompt — counts, statuses,
 * timestamps, and safe codes only, so a health read can never leak knowledge.
 *
 * Role-awareness lives here too: viewers see the same counts but no
 * retry/configure affordances and no privileged ids. The route enforces who
 * may call what; this module only decides what the view offers each role.
 */

export const healthAdapterStatuses = [
  "pending",
  "claimed",
  "completed",
  "failed",
  "quarantined",
  "obsolete",
] as const;

export type HealthAdapterStatus = (typeof healthAdapterStatuses)[number];

export const healthAdapterRowSchema = z
  .object({
    sourceKind: z.string().trim().min(1).max(120),
    status: z.enum(healthAdapterStatuses),
    count: z.number().int().nonnegative(),
    /** ISO timestamp of the newest completed event, or null when none. */
    lastSuccessAt: z.string().nullable(),
  })
  .strict();

export type HealthAdapterRow = z.infer<typeof healthAdapterRowSchema>;

export const healthContextRowSchema = z
  .object({
    purpose: z.string().trim().min(1).max(60),
    status: z.enum(["ready", "empty", "partial", "unavailable", "disabled"]),
    count: z.number().int().nonnegative(),
    lastPreparedAt: z.string().nullable(),
  })
  .strict();

export type HealthContextRow = z.infer<typeof healthContextRowSchema>;

export const healthInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    role: z.enum(["owner", "admin", "operator", "viewer"]),
    serverTime: z.string().min(1),
    adapters: z.array(healthAdapterRowSchema).max(32),
    contexts: z.array(healthContextRowSchema).max(32),
    embeddingBacklog: z.number().int().nonnegative(),
  })
  .strict();

export type HealthInput = z.infer<typeof healthInputSchema>;

export type AdapterHealth = {
  sourceKind: string;
  registered: boolean;
  pending: number;
  claimed: number;
  completed: number;
  failed: number;
  quarantined: number;
  obsolete: number;
  /** Pending + claimed: work waiting for the dispatcher, never silent success. */
  backlog: number;
  /** Retryable failures an owner/admin may requeue, or 0 for viewers. */
  retryable: number;
  lastSuccessAt: string | null;
};

export type ContextHealth = {
  purpose: string;
  ready: number;
  empty: number;
  partial: number;
  unavailable: number;
  disabled: number;
  total: number;
  lastPreparedAt: string | null;
};

export type MemoryHealth = {
  organizationId: string;
  serverTime: string;
  adapters: AdapterHealth[];
  contexts: ContextHealth[];
  embeddingBacklog: number;
  /** False for viewers: the UI hides retry/configure affordances. */
  canRetry: boolean;
  canConfigure: boolean;
};

const RETRYABLE_STATUSES: ReadonlySet<HealthAdapterStatus> = new Set(["failed", "quarantined"]);

function latestTimestamp(values: readonly (string | null)[]): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (latest === null || value > latest) latest = value;
  }
  return latest;
}

/**
 * One bounded health view per organization. Adapter rows arrive pre-grouped
 * (sourceKind × status) so this function never sees an event body; context
 * rows arrive pre-grouped (purpose × status) so it never sees a summary.
 * Output is sorted by key so two reads of the same counts render identically.
 */
export function buildMemoryHealth(input: HealthInput): MemoryHealth {
  const parsed = healthInputSchema.parse(input);
  const privileged = parsed.role === "owner" || parsed.role === "admin";

  const byAdapter = new Map<string, AdapterHealth>();
  for (const row of parsed.adapters) {
    let adapter = byAdapter.get(row.sourceKind);
    if (!adapter) {
      adapter = {
        sourceKind: row.sourceKind,
        registered: true,
        pending: 0,
        claimed: 0,
        completed: 0,
        failed: 0,
        quarantined: 0,
        obsolete: 0,
        backlog: 0,
        retryable: 0,
        lastSuccessAt: null,
      };
      byAdapter.set(row.sourceKind, adapter);
    }
    adapter[row.status] += row.count;
    if (RETRYABLE_STATUSES.has(row.status)) adapter.retryable += row.count;
    if (row.status === "completed") {
      adapter.lastSuccessAt = latestTimestamp([adapter.lastSuccessAt, row.lastSuccessAt]);
    }
  }
  for (const adapter of byAdapter.values()) {
    adapter.backlog = adapter.pending + adapter.claimed;
    if (!privileged) adapter.retryable = 0;
  }

  const byContext = new Map<string, ContextHealth>();
  for (const row of parsed.contexts) {
    let context = byContext.get(row.purpose);
    if (!context) {
      context = {
        purpose: row.purpose,
        ready: 0,
        empty: 0,
        partial: 0,
        unavailable: 0,
        disabled: 0,
        total: 0,
        lastPreparedAt: null,
      };
      byContext.set(row.purpose, context);
    }
    context[row.status] += row.count;
    context.total += row.count;
    context.lastPreparedAt = latestTimestamp([context.lastPreparedAt, row.lastPreparedAt]);
  }

  return {
    organizationId: parsed.organizationId,
    serverTime: parsed.serverTime,
    adapters: [...byAdapter.values()].sort((left, right) =>
      left.sourceKind < right.sourceKind ? -1 : 1,
    ),
    contexts: [...byContext.values()].sort((left, right) =>
      left.purpose < right.purpose ? -1 : 1,
    ),
    embeddingBacklog: parsed.embeddingBacklog,
    canRetry: privileged,
    canConfigure: privileged,
  };
}
