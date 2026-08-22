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
  const validationKey = `report-validation:${input.packageId}:${input.contractVersionId}`;
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
  const idempotencyKey = `report-projection:${input.packageId}:${input.projectionVersionId}`;
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
