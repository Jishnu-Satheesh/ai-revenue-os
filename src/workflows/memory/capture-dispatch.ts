import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CAPTURE_CLAIM_BATCH_LIMIT,
  CAPTURE_LEASE_SECONDS,
  type CaptureSafeCode,
} from "@/domain/memory/capture";
import { MemoryError, memoryError } from "@/domain/memory/errors";
import type { CaptureRepository } from "@/modules/memory/infrastructure/capture-repository";

/**
 * Capture pump runners (Spec 023 §5). Pure modules: no Trigger SDK import, no
 * service client, no SQL. The Trigger schedules in `src/trigger/memory.ts`
 * supply the repository and the reconcile paging callbacks; unit tests supply
 * fakes. Every returned value carries identifiers, safe codes, and counts
 * only — never bodies, digests, or prompt text.
 */

const uuidSchema = z.string().uuid();

function parseDispatchInput(input: {
  organizationId: string;
  correlationId: string;
}): { organizationId: string; correlationId: string } {
  const parsed = z
    .object({ organizationId: uuidSchema, correlationId: uuidSchema })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw memoryError("VALIDATION_ERROR");
  return parsed.data;
}

export const captureReconcileAdapters = ["channel", "growth", "campaign"] as const;
export type CaptureReconcileAdapter = (typeof captureReconcileAdapters)[number];

const RECONCILE_LIMIT_MAX = 100;

function parseReconcileInput(input: {
  organizationId: string;
  adapter: string;
  cursor: string | null;
  limit: number;
}): {
  organizationId: string;
  adapter: CaptureReconcileAdapter;
  cursor: string | null;
  limit: number;
} {
  const parsed = z
    .object({
      organizationId: uuidSchema,
      adapter: z.enum(captureReconcileAdapters),
      cursor: z.string().min(1).max(200).nullable(),
      limit: z.number().int().min(1).max(RECONCILE_LIMIT_MAX),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw memoryError("VALIDATION_ERROR");
  return parsed.data;
}

export type CaptureDispatchEventOutcome =
  | { captureId: string; outcome: "completed" | "replayed"; projectedItemId: string }
  | { captureId: string; outcome: "obsolete" | "quarantined" }
  | {
      captureId: string;
      outcome: "retry_scheduled" | "terminal";
      safeCode: CaptureSafeCode;
      status: string;
    }
  | { captureId: string; outcome: "lease_lost" }
  | { captureId: string; outcome: "unsettled"; safeCode: CaptureSafeCode };

export type CaptureDispatchCounts = {
  claimed: number;
  completed: number;
  replayed: number;
  obsolete: number;
  quarantined: number;
  retryScheduled: number;
  terminal: number;
  leaseLost: number;
  unsettled: number;
};

export type CaptureDispatchResult = {
  organizationId: string;
  correlationId: string;
  claimToken: string;
  finishedAt: string;
  events: CaptureDispatchEventOutcome[];
  counts: CaptureDispatchCounts;
};

export type CaptureDispatchDependencies = {
  repository: CaptureRepository;
  clock?: () => Date;
};

/**
 * The database names an error through the Postgres code on the cause the
 * repository preserved. A raw client failure (no code at all) carries no
 * diagnosis either. Either way the message below is never logged or
 * returned: only the derived safe code leaves this module.
 */
function databaseCodeOf(error: unknown): string | null {
  const carrier =
    error instanceof MemoryError ? (error.internalCause ?? null) : (error ?? null);
  if (typeof carrier === "object" && carrier !== null && "code" in carrier) {
    const code = (carrier as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function databaseMessageOf(error: unknown): string {
  const carrier =
    error instanceof MemoryError ? (error.internalCause ?? null) : (error ?? null);
  if (typeof carrier === "object" && carrier !== null && "message" in carrier) {
    const message = (carrier as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

const LEASE_LOST = "LEASE_LOST" as const;

/**
 * Fixed classifier for a complete_ failure. Lease loss (42501) is not a
 * failure to record: the event belongs to someone else now, so the batch
 * moves on without calling fail_. An invalid shape quarantines only when the
 * database itself named it — the projector's documented 23514 refusal. Per
 * the controller ruling, everything else (connection/timeout-like failures,
 * runner-side unknown status codes, any other database complaint) retries as
 * TRANSIENT_DB, bounded to five attempts by the fail_ RPC before terminal.
 */
function classifyCompleteError(error: unknown): CaptureSafeCode | typeof LEASE_LOST {
  if (databaseCodeOf(error) === "42501") return LEASE_LOST;
  if (databaseCodeOf(error) === "23514" && /not projectable/i.test(databaseMessageOf(error))) {
    return "QUARANTINE_INVALID_SHAPE";
  }
  return "TRANSIENT_DB";
}

function emptyCounts(): CaptureDispatchCounts {
  return {
    claimed: 0,
    completed: 0,
    replayed: 0,
    obsolete: 0,
    quarantined: 0,
    retryScheduled: 0,
    terminal: 0,
    leaseLost: 0,
    unsettled: 0,
  };
}

function recordOutcome(
  events: CaptureDispatchEventOutcome[],
  counts: CaptureDispatchCounts,
  event: CaptureDispatchEventOutcome,
): void {
  events.push(event);
  switch (event.outcome) {
    case "completed":
      counts.completed += 1;
      break;
    case "replayed":
      counts.replayed += 1;
      break;
    case "obsolete":
      counts.obsolete += 1;
      break;
    case "quarantined":
      counts.quarantined += 1;
      break;
    case "retry_scheduled":
      counts.retryScheduled += 1;
      break;
    case "terminal":
      counts.terminal += 1;
      break;
    case "lease_lost":
      counts.leaseLost += 1;
      break;
    case "unsettled":
      counts.unsettled += 1;
      break;
  }
}

/**
 * Claims up to one batch for a single organization and drives every claimed
 * event through load then complete. One event's lease loss or failure never
 * stops the batch: each id is settled independently and the summary counts
 * tell the schedule log exactly what happened, in safe codes only.
 */
export async function runCaptureDispatch(
  input: { organizationId: string; correlationId: string },
  dependencies: CaptureDispatchDependencies,
): Promise<CaptureDispatchResult> {
  const parsed = parseDispatchInput(input);
  const clock = dependencies.clock ?? (() => new Date());
  const claimToken = randomUUID();

  const captureIds = await dependencies.repository.claim({
    organizationId: parsed.organizationId,
    claimToken,
    limit: CAPTURE_CLAIM_BATCH_LIMIT,
    leaseSeconds: CAPTURE_LEASE_SECONDS,
  });

  const events: CaptureDispatchEventOutcome[] = [];
  const counts = emptyCounts();
  counts.claimed = captureIds.slice(0, CAPTURE_CLAIM_BATCH_LIMIT).length;

  for (const captureId of captureIds.slice(0, CAPTURE_CLAIM_BATCH_LIMIT)) {
    let loaded = false;
    try {
      await dependencies.repository.load({
        organizationId: parsed.organizationId,
        captureId,
        claimToken,
      });
      loaded = true;
    } catch (loadError) {
      if (databaseCodeOf(loadError) === "42501") {
        recordOutcome(events, counts, { captureId, outcome: "lease_lost" });
        continue;
      }
    }

    if (!loaded) {
      // The event could not be read under this lease. Hand it back to the
      // queue with bounded backoff rather than holding it claimed until the
      // lease expires; a vanished event makes fail_ fail too, which is
      // recorded as unsettled and the batch moves on.
      try {
        const failure = await dependencies.repository.fail({
          organizationId: parsed.organizationId,
          captureId,
          claimToken,
          safeCode: "TRANSIENT_DB",
        });
        if (failure.status === "pending") {
          recordOutcome(events, counts, {
            captureId,
            outcome: "retry_scheduled",
            safeCode: "TRANSIENT_DB",
            status: failure.status,
          });
        } else {
          recordOutcome(events, counts, {
            captureId,
            outcome: "terminal",
            safeCode: "TRANSIENT_DB",
            status: failure.status,
          });
        }
      } catch {
        recordOutcome(events, counts, {
          captureId,
          outcome: "unsettled",
          safeCode: "TRANSIENT_DB",
        });
      }
      continue;
    }

    try {
      const completion = await dependencies.repository.complete({
        organizationId: parsed.organizationId,
        captureId,
        claimToken,
      });
      if (completion.status === "completed" || completion.status === "replayed") {
        recordOutcome(events, counts, {
          captureId,
          outcome: completion.status,
          projectedItemId: completion.projectedItemId,
        });
      } else {
        recordOutcome(events, counts, { captureId, outcome: completion.status });
      }
    } catch (completeError) {
      const classification = classifyCompleteError(completeError);
      if (classification === LEASE_LOST) {
        recordOutcome(events, counts, { captureId, outcome: "lease_lost" });
        continue;
      }
      try {
        const failure = await dependencies.repository.fail({
          organizationId: parsed.organizationId,
          captureId,
          claimToken,
          safeCode: classification,
        });
        if (failure.status === "pending") {
          recordOutcome(events, counts, {
            captureId,
            outcome: "retry_scheduled",
            safeCode: classification,
            status: failure.status,
          });
        } else {
          recordOutcome(events, counts, {
            captureId,
            outcome: "terminal",
            safeCode: classification,
            status: failure.status,
          });
        }
      } catch (failError) {
        if (databaseCodeOf(failError) === "42501") {
          recordOutcome(events, counts, { captureId, outcome: "lease_lost" });
        } else {
          // fail_ itself refused (for example the event vanished under a
          // cascade): the classification is still the honest record, but no
          // queue state was written, so the event stays claimed until the
          // lease expires and the queue reclaims it.
          recordOutcome(events, counts, {
            captureId,
            outcome: "unsettled",
            safeCode: classification,
          });
        }
      }
    }
  }

  return {
    organizationId: parsed.organizationId,
    correlationId: parsed.correlationId,
    claimToken,
    finishedAt: clock().toISOString(),
    events,
    counts,
  };
}

export type CaptureReconcileIdentity = {
  /** Which enqueue helper owns this identity (for example 'channel_findings'). */
  kind: string;
  /** The source the helper enumerates: an analysis run id or a decision id. */
  id: string;
};

export type CaptureReconcilePage = {
  /** At most `limit` identities, oldest first. */
  identities: readonly CaptureReconcileIdentity[];
  /**
   * Opaque cursor to persist when every identity in this page reconciles.
   * Null keeps the input cursor. The runner never interprets it; the
   * Trigger-side implementation owns rotation and keyset encoding.
   */
  completeCursor: string | null;
};

export type CaptureReconcileResult = {
  organizationId: string;
  adapter: CaptureReconcileAdapter;
  scanned: number;
  enqueued: number;
  nextCursor: string | null;
  advanced: boolean;
  finishedAt: string;
};

export type CaptureReconcileDependencies = {
  listIdentities(input: {
    organizationId: string;
    adapter: CaptureReconcileAdapter;
    cursor: string | null;
    limit: number;
  }): Promise<CaptureReconcilePage>;
  enqueueMissing(input: {
    organizationId: string;
    identity: CaptureReconcileIdentity;
  }): Promise<number>;
  clock?: () => Date;
};

/**
 * Reconciles one page of source identities for one adapter. The cursor
 * advances past fully reconciled pages only: the first enqueue error (or a
 * malformed identity, which is a paging bug, not a source problem) freezes
 * the cursor so the next pass retries the same page.
 */
export async function runCaptureReconcile(
  input: { organizationId: string; adapter: string; cursor: string | null; limit: number },
  dependencies: CaptureReconcileDependencies,
): Promise<CaptureReconcileResult> {
  const parsed = parseReconcileInput(input);
  const clock = dependencies.clock ?? (() => new Date());

  const page = await dependencies.listIdentities({
    organizationId: parsed.organizationId,
    adapter: parsed.adapter,
    cursor: parsed.cursor,
    limit: parsed.limit,
  });
  const identities = page.identities.slice(0, parsed.limit);

  const finish = (
    scanned: number,
    enqueued: number,
    nextCursor: string | null,
    advanced: boolean,
  ): CaptureReconcileResult => ({
    organizationId: parsed.organizationId,
    adapter: parsed.adapter,
    scanned,
    enqueued,
    nextCursor,
    advanced,
    finishedAt: clock().toISOString(),
  });

  let scanned = 0;
  let enqueued = 0;
  for (const identity of identities) {
    if (
      typeof identity !== "object" ||
      identity === null ||
      typeof identity.kind !== "string" ||
      identity.kind.length === 0 ||
      uuidSchema.safeParse(identity.id).success === false
    ) {
      return finish(scanned, enqueued, parsed.cursor, false);
    }
    let inserted: number;
    try {
      inserted = await dependencies.enqueueMissing({
        organizationId: parsed.organizationId,
        identity,
      });
    } catch {
      return finish(scanned, enqueued, parsed.cursor, false);
    }
    if (!Number.isInteger(inserted) || inserted < 0) {
      return finish(scanned, enqueued, parsed.cursor, false);
    }
    scanned += 1;
    enqueued += inserted;
  }

  return finish(scanned, enqueued, page.completeCursor ?? parsed.cursor, true);
}
