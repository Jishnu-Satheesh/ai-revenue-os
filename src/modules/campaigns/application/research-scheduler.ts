import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";
import {
  scheduledEvidenceFingerprint,
  scheduledIdempotencyKey,
} from "@/domain/campaigns/research-cadence";
import type {
  EvaluateDueResult,
  ResearchDueReader,
} from "@/modules/campaigns/infrastructure/research-due-reader";
import type { ResearchWorkerDispatch } from "@/modules/campaigns/application/research-dispatch";

/**
 * The hourly tick that asks for research on an organization's behalf.
 *
 * The order is the safety case, and it mirrors the manual path: the database
 * evaluates the window first — schedule still on, policy still binding,
 * change still qualifying, allowance/pending/cooldown still admitting — and
 * only an admitted (or replayed) run is handed to a worker. A tick that
 * warrants nothing stores its outcome in the receipt and proposes nothing;
 * a tick that finds no settings never reaches the database at all, so no
 * settings means zero model spend by construction — this module never calls
 * a model, and it dispatches a worker only after an admission exists.
 *
 * Memory writes alone never trigger research. Nothing subscribes this tick
 * to memory events; the digest below is read inside the tick (poll), and a
 * capture between ticks changes what the next tick compares against — that
 * is all it can do. Scheduled runs admitted without a staged question derive
 * their scope through the same tier ladder the manual path uses (ADR 0062:
 * Business Memory, then interacted picks, then untouched, then org details,
 * then goals; dismissed and snoozed never resurrected) — there is no
 * separate question logic for scheduled runs.
 *
 * Containment for live spend is never consulted here and therefore never
 * disabled here: this tick admits research, and research precedes the
 * proposal, the approval, the launch authority and the dispatch that spends.
 */

export type ResearchScheduleSweepDue = Pick<
  ResearchDueReader,
  "listDueOrganizations" | "evaluateDue"
>;

export type ResearchScheduleSweepMemory = {
  /**
   * The organization's latest Business Memory manifest identity, if any.
   *
   * Identifiers only: the digest the tick compares and the revision it
   * records. Entry bytes stay behind their own access rules; the worker
   * reads those later through its claim.
   */
  readManifestDigest(input: {
    organizationId: string;
  }): Promise<{ digest: string; revision: string } | null>;
};

export type ResearchScheduleSweepResult = {
  organizationsSwept: number;
  admitted: number;
  replayed: number;
  /** Same evidence seen before: the receipt stands, no second run. */
  deduplicated: number;
  /** Due but nothing warranted: the outcome is stored, nothing proposed. */
  notWarranted: number;
  /** Due and warranted, but the purse said no. Named in the logs, not silent. */
  refused: number;
  /** No longer due when its turn came, or never set up. */
  notDue: number;
  /** Admitted runs no worker picked up. The run stays queued; the lease sweep offers it again. */
  dispatchFailed: readonly string[];
  /** Tenants whose tick failed. Named, so a partial sweep never reads as clean. */
  failed: readonly string[];
};

const DEFAULT_MAX_ORGANIZATIONS_PER_TICK = 25;

export async function runResearchScheduleSweep(dependencies: {
  due: ResearchScheduleSweepDue;
  memory: ResearchScheduleSweepMemory;
  dispatch: ResearchWorkerDispatch;
  now: () => Date;
  newCorrelationId: () => string;
  maxOrganizationsPerTick?: number;
}): Promise<ResearchScheduleSweepResult> {
  // Deliberately uncaught, like the lease sweep: an empty list and an
  // unreadable one look identical downstream, so a tick that cannot see its
  // work must fail to its own alerting rather than log a quiet success.
  const organizationIds = await dependencies.due.listDueOrganizations();

  // Bounded per tick, oldest evaluation first (the reader's order). A missed
  // sweep never floods catch-up: each organization claims only its current
  // window, and anything beyond the bound waits for the next tick.
  const targets = [...new Set(organizationIds)].slice(
    0,
    dependencies.maxOrganizationsPerTick ?? DEFAULT_MAX_ORGANIZATIONS_PER_TICK,
  );

  const result: {
    admitted: number;
    replayed: number;
    deduplicated: number;
    notWarranted: number;
    refused: number;
    notDue: number;
    dispatchFailed: string[];
    failed: string[];
  } = {
    admitted: 0,
    replayed: 0,
    deduplicated: 0,
    notWarranted: 0,
    refused: 0,
    notDue: 0,
    dispatchFailed: [],
    failed: [],
  };

  for (const organizationId of targets) {
    try {
      await evaluateOneOrganization(dependencies, organizationId, result);
    } catch (error) {
      // One tenant's fault must not strand every other tenant's tick until
      // the next hour. Collected rather than swallowed: the caller reports a
      // partial sweep as partial. The fault itself is logged with the tenant
      // it belongs to — counts alone cannot diagnose a failing tick, and an
      // organization id is routing metadata, not tenant content.
      logger.error("campaign.research_schedule_tick_failed", {
        organizationId,
        errorName: error instanceof Error ? error.name : "unknown",
        errorCode:
          typeof (error as { code?: unknown } | null)?.code === "string"
            ? String((error as { code: string }).code).slice(0, 24)
            : undefined,
      });
      result.failed.push(organizationId);
    }
  }

  return { organizationsSwept: targets.length, ...result };
}

async function evaluateOneOrganization(
  dependencies: {
    due: ResearchScheduleSweepDue;
    memory: ResearchScheduleSweepMemory;
    dispatch: ResearchWorkerDispatch;
    now: () => Date;
    newCorrelationId: () => string;
  },
  organizationId: string,
  result: {
    admitted: number;
    replayed: number;
    deduplicated: number;
    notWarranted: number;
    refused: number;
    notDue: number;
    dispatchFailed: string[];
  },
): Promise<void> {
  // An unreadable manifest is an unknown evidence state, not an empty one.
  // Skipping the tick is the honest reading: evaluating against a guessed
  // fingerprint would either admit on fiction or record "seen" for evidence
  // never actually compared.
  let manifest: { digest: string; revision: string } | null;
  try {
    manifest = await dependencies.memory.readManifestDigest({ organizationId });
  } catch {
    throw new Error(`Cannot compare evidence for ${organizationId}.`);
  }

  const evidenceFingerprint = scheduledEvidenceFingerprint({
    manifestDigest: manifest?.digest ?? null,
  });
  const candidateRevision = manifest?.revision ?? null;
  const idempotencyKey = scheduledIdempotencyKey({
    organizationId,
    evidenceFingerprint,
    candidateRevision,
  });
  // What was asked, as a value. The digest covers the tenant, the kind and
  // the evidence — the same shape the manual route digests, with the policy
  // version bound by the writer rather than the caller (the scheduler never
  // sees the policy, so it cannot name a stale version to spend under).
  const requestDigest = createHash("sha256")
    .update(
      JSON.stringify({
        organizationId,
        triggerKind: "scheduled",
        evidenceFingerprint,
        candidateRevision,
        idempotencyKey,
      }),
      "utf8",
    )
    .digest("hex");

  const evaluated: EvaluateDueResult = await dependencies.due.evaluateDue({
    organizationId,
    evidenceFingerprint,
    candidateRevision,
    requestDigest,
    idempotencyKey,
  });

  switch (evaluated.outcome) {
    case "not_due":
      result.notDue += 1;
      return;
    case "already_evaluated":
      result.deduplicated += 1;
      return;
    case "no_qualifying_change":
      result.notWarranted += 1;
      return;
    case "refused":
      result.refused += 1;
      return;
    case "admitted":
    case "replayed": {
      if (
        evaluated.runId === null ||
        evaluated.evidenceMaxAgeDays === null ||
        evaluated.allowanceCurrency === null
      ) {
        throw new Error(`An admitted evaluation without a run for ${organizationId}.`);
      }
      // A replayed admission still dispatches: the worker's own claim is
      // what stops a second delivery doing the work twice, so re-asking is
      // safe while not re-asking would strand a run whose first dispatch was
      // lost. Same rule as the manual path.
      const started = await dependencies.dispatch({
        organizationId,
        runId: evaluated.runId,
        correlationId: dependencies.newCorrelationId(),
        evidenceMaxAgeDays: evaluated.evidenceMaxAgeDays,
        allowanceCurrency: evaluated.allowanceCurrency,
      });
      if (evaluated.outcome === "admitted") result.admitted += 1;
      else result.replayed += 1;
      // The run is admitted either way. Saying "started" when no worker was
      // asked would leave nobody watching for a proposal nothing is writing.
      if (!started) result.dispatchFailed.push(evaluated.runId);
      return;
    }
  }
}
