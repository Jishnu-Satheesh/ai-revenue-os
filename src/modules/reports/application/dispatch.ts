import "server-only";

import { tasks } from "@trigger.dev/sdk";

import { logger } from "@/lib/logger";
import type { dispatchDueWorkTask } from "@/trigger/growth-intelligence";
import type {
  reportPackageProfilingTask,
  reportPackageProjectionTask,
  reportPackageValidationTask,
} from "@/trigger/reports";
import {
  isGovernedReportProjectionEnabled,
  isGovernedReportValidationEnabled,
} from "@/modules/integrations/application/feature-access";

/** Trigger only orchestrates; the database owns package state. */
export async function requestReportPackageProfiling(input: {
  organizationId: string;
  packageId: string;
  correlationId: string;
  /**
   * The operator's own key for this retry, which is new on every press.
   *
   * Profiling needs the two keys to differ, unlike validation and projection.
   * The claim stores the key it first saw and refuses a different one -- there
   * is no branch that discards a stale profiling operation -- so what the
   * worker presents has to stay the package's key across attempts. What Trigger
   * de-duplicates on must not: a dispatch key that repeats makes it drop the
   * retry against the attempt that already finished, and the operator is told
   * the checks were queued when nothing ran.
   */
  attemptKey?: string;
}): Promise<boolean> {
  const profileKey = `report-profile:${input.packageId}`;
  const dispatchKey = input.attemptKey ? `${profileKey}:${input.attemptKey}` : profileKey;
  try {
    await tasks.trigger<typeof reportPackageProfilingTask>(
      "report-package.profile",
      {
        organizationId: input.organizationId,
        packageId: input.packageId,
        idempotencyKey: profileKey,
      },
      { idempotencyKey: dispatchKey },
    );
    return true;
  } catch (error) {
    logger.warn("report_package.profile_dispatch_failed", {
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

/** Trigger is transport only; the claim RPC re-checks every approval boundary. */
export async function requestReportPackageValidation(input: {
  organizationId: string;
  packageId: string;
  contractVersionId: string;
  correlationId: string;
  validationRunId?: string;
}): Promise<boolean> {
  if (!isGovernedReportValidationEnabled(input.organizationId)) {
    // Logged, not silent. This branch is the only way a package can reach
    // `awaiting_validation` and then simply stop, with no run, no failure and
    // nothing in the trace to say why -- and the rollout list is read from
    // the environment of whichever process calls this, so the worker and the
    // web app can disagree about it without anyone noticing.
    logger.warn("report_package.validation_dispatch_disabled", {
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });
    return false;
  }
  const validationRunId = input.validationRunId ?? crypto.randomUUID();
  // Keyed on the run, not on the package and contract. A key that is the same
  // string on every attempt makes Trigger de-duplicate the retry against the
  // attempt that already failed: the dispatch returns the old handle, the
  // caller is told the work is queued, and nothing runs. The database is built
  // to retry -- a failed run and a package back at `awaiting_*` makes the claim
  // discard the stale operation and start a fresh one -- so the only thing that
  // ever stopped a retry was this key. A redelivery of the same dispatch keeps
  // the same run id and is still de-duplicated, which is what the key is for.
  const validationKey = `report-validation:${validationRunId}`;
  try {
    await tasks.trigger<typeof reportPackageValidationTask>(
      "report-package.validate",
      {
        organizationId: input.organizationId,
        packageId: input.packageId,
        contractVersionId: input.contractVersionId,
        validationRunId,
        correlationId: input.correlationId,
        idempotencyKey: validationKey,
      },
      { idempotencyKey: validationKey },
    );
    return true;
  } catch (error) {
    logger.warn("report_package.validation_dispatch_failed", {
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

export async function requestReportPackageProjection(input: {
  organizationId: string;
  packageId: string;
  contractVersionId: string;
  projectionVersionId: string;
  correlationId: string;
  projectionRunId?: string;
}): Promise<boolean> {
  if (!isGovernedReportProjectionEnabled(input.organizationId)) {
    // Same reasoning as the validation dispatch above: a package that stops
    // at `awaiting_projection` for this reason leaves no other trace.
    logger.warn("report_package.projection_dispatch_disabled", {
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });
    return false;
  }
  const projectionRunId = input.projectionRunId ?? crypto.randomUUID();
  // Keyed on the run, for the reason `requestReportPackageValidation` gives.
  const idempotencyKey = `report-projection:${projectionRunId}`;
  try {
    await tasks.trigger<typeof reportPackageProjectionTask>(
      "report-package.project",
      {
        organizationId: input.organizationId,
        packageId: input.packageId,
        contractVersionId: input.contractVersionId,
        projectionVersionId: input.projectionVersionId,
        projectionRunId,
        correlationId: input.correlationId,
        idempotencyKey,
      },
      { idempotencyKey },
    );
    return true;
  } catch (error) {
    logger.warn("report_package.projection_dispatch_failed", {
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

/**
 * The two collaborators `continueAdmittedReportPackage` needs, injected so it
 * runs in a test without Trigger or a database.
 *
 * `advanceOnAdmission` calls Link A
 * (`advance_governed_report_package_on_admission`, Task 9B / ADR 0046)
 * directly, rather than reading an admission here and writing the package's
 * status in a separate call: a read-then-act split across two round trips is
 * racy in a way the RPC's own row lock and status guard are not, and the RPC
 * already refuses to move anything unless an active admission genuinely
 * matches -- see the migration for the fencing. Its outcome is narrowed to
 * exactly the two shapes this function needs; every other outcome the RPC
 * can return (`not_found`, `not_ready`, `no_admission`) collapses to
 * `"not_admitted"` at the call site, because none of them changes what
 * happens next here.
 *
 * `requestValidation` is a dispatch: in production it is
 * `requestReportPackageValidation` above, which already carries its own
 * feature-flag guard and idempotency key -- nothing here duplicates either.
 */
export type ContinueAdmittedReportPackageCollaborators = {
  advanceOnAdmission(input: {
    organizationId: string;
    packageId: string;
    correlationId: string;
  }): Promise<{ outcome: "admitted"; contractVersionId: string } | { outcome: "not_admitted" }>;
  requestValidation(input: {
    organizationId: string;
    packageId: string;
    contractVersionId: string;
    correlationId: string;
  }): Promise<boolean>;
};

/**
 * What a freshly profiled package does next, without waiting for a person.
 *
 * ADR 0046's whole point is that a structure is approved once: an admission
 * found here means someone already answered the four governance questions
 * for this exact set of columns, on a different upload, under this channel
 * and currency. Validation starts on its own because there is nothing left
 * for a person to decide.
 *
 * `"not_admitted"` is not a failure -- it is the ordinary case for a
 * structure nobody has vouched for yet, and the only correct move is the one
 * the product already made before this function existed: leave the package
 * waiting for a person. Nothing here is allowed to grant what only a human
 * approval can, so there is no path from `"not_admitted"` to a dispatch.
 */
export async function continueAdmittedReportPackage(
  input: { organizationId: string; packageId: string; correlationId: string },
  collaborators: ContinueAdmittedReportPackageCollaborators,
): Promise<"admitted" | "awaiting_approval"> {
  const advanced = await collaborators.advanceOnAdmission({
    organizationId: input.organizationId,
    packageId: input.packageId,
    correlationId: input.correlationId,
  });
  if (advanced.outcome !== "admitted") return "awaiting_approval";
  // Whether the dispatch itself lands is `requestValidation`'s own concern --
  // it already logs a warning on failure, the same as every other dispatch in
  // this file. "admitted" describes what the database already recorded (the
  // package now carries this admission), not the transport, so it is
  // returned either way.
  await collaborators.requestValidation({
    organizationId: input.organizationId,
    packageId: input.packageId,
    contractVersionId: advanced.contractVersionId,
    correlationId: input.correlationId,
  });
  return "admitted";
}

/**
 * Whether a completion document woke Growth Intelligence work: the RPCs merge
 * a non-empty `growthIntelligenceRequests` list only when evidence became
 * current. Anything else enqueued nothing, so the sweeper gets no nudge.
 */
export function hasEnqueuedGrowthIntelligenceRequests(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { growthIntelligenceRequests?: unknown }).growthIntelligenceRequests) &&
    (data as { growthIntelligenceRequests: unknown[] }).growthIntelligenceRequests.length > 0
  );
}

/**
 * Nudge the Growth Intelligence sweeper after report-current evidence lands.
 *
 * Latency optimization only: the requests the database just wrote are durable
 * and due, so a lost nudge only delays the wake-up. A nudge that fails must
 * never fail the report run that already counted, which is why this returns
 * nothing and logs a warning instead of throwing.
 */
export async function wakeGrowthIntelligenceDispatch(input: {
  organizationId: string;
  correlationId: string;
}): Promise<void> {
  try {
    await tasks.trigger<typeof dispatchDueWorkTask>(
      "growth-intelligence.dispatch-due",
      { correlationId: input.correlationId },
      { idempotencyKey: `growth-intelligence:wake:${input.correlationId}` },
    );
  } catch (error) {
    logger.warn("growth_intelligence.wake_dispatch_failed", {
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
  }
}
