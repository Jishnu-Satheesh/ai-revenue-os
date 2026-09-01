import "server-only";

import { tasks } from "@trigger.dev/sdk";

import { logger } from "@/lib/logger";
import type { reportPackageProfilingTask, reportPackageProjectionTask, reportPackageValidationTask } from "@/trigger/reports";
import { isGovernedReportProjectionEnabled, isGovernedReportValidationEnabled } from "@/modules/integrations/application/feature-access";

/** Trigger only orchestrates; the database owns package state. */
export async function requestReportPackageProfiling(input: {
  organizationId: string;
  packageId: string;
  correlationId: string;
}): Promise<boolean> {
  const profileKey = `report-profile:${input.packageId}`;
  try {
    await tasks.trigger<typeof reportPackageProfilingTask>(
      "report-package.profile",
      {
        organizationId: input.organizationId,
        packageId: input.packageId,
        idempotencyKey: profileKey,
      },
      { idempotencyKey: profileKey },
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
  if (!isGovernedReportValidationEnabled(input.organizationId)) return false;
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
  if (!isGovernedReportProjectionEnabled(input.organizationId)) return false;
  const projectionRunId = input.projectionRunId ?? crypto.randomUUID();
  // Keyed on the run, for the reason `requestReportPackageValidation` gives.
  const idempotencyKey = `report-projection:${projectionRunId}`;
  try {
    await tasks.trigger<typeof reportPackageProjectionTask>("report-package.project", {
      organizationId: input.organizationId, packageId: input.packageId,
      contractVersionId: input.contractVersionId, projectionVersionId: input.projectionVersionId,
      projectionRunId, correlationId: input.correlationId, idempotencyKey,
    }, { idempotencyKey });
    return true;
  } catch (error) {
    logger.warn("report_package.projection_dispatch_failed", { organizationId: input.organizationId, correlationId: input.correlationId, errorCode: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}
