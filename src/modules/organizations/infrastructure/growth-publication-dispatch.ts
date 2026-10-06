import "server-only";

import { randomUUID } from "node:crypto";

import { tasks } from "@trigger.dev/sdk";

import { logger } from "@/lib/logger";
import type { revenueSnapshotsBuildOrgTask } from "@/trigger/revenue-snapshots";

/**
 * On-demand run of tonight's revenue/projection build for one organization.
 *
 * Transport and nothing else: the payload carries identifiers plus the same
 * gates the hourly dispatcher computes, and the worker re-reads everything
 * through its claim. The idempotency key intentionally matches the nightly
 * one (`revenue-snapshot:<org>:<date>`), so triggering now and the scheduled
 * midnight run collapse into a single build instead of queueing two.
 *
 * Returns true when the run was accepted. False means the worker could not
 * be reached — the scheduled run is unaffected, so this is "not started
 * yet", never "nothing will happen". A button that silently does nothing is
 * worse than one that says it could not.
 */
export type TriggerGrowthBuildInput = {
  organizationId: string;
  snapshotDate: string;
  timeZone: string;
  gates: { growth: boolean; campaigns: boolean };
};

export async function dispatchGrowthBuildNow(
  input: TriggerGrowthBuildInput,
): Promise<boolean> {
  const correlationId = randomUUID();
  try {
    await tasks.trigger<typeof revenueSnapshotsBuildOrgTask>(
      "revenue-snapshots.build-org",
      {
        organizationId: input.organizationId,
        snapshotDate: input.snapshotDate,
        timeZone: input.timeZone,
        gates: input.gates,
        correlationId,
      },
      {
        idempotencyKey: `revenue-snapshot:${input.organizationId}:${input.snapshotDate}`,
      },
    );
    return true;
  } catch (error) {
    logger.warn("growth.build_dispatch_failed", {
      organizationId: input.organizationId,
      correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
