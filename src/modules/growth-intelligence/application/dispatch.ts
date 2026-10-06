import "server-only";

import { tasks } from "@trigger.dev/sdk";

import { logger } from "@/lib/logger";
import type { dispatchDueWorkTask } from "@/trigger/growth-intelligence";

/**
 * Nudge the Growth Intelligence dispatcher after an operator starts branch
 * research.
 *
 * Latency optimization only: the request the database just wrote is durable
 * and due, so a lost nudge only delays the wake-up until the next report
 * lands or the lease expires. A nudge that fails must never fail the
 * research start that already counted, which is why this returns nothing
 * and logs a warning instead of throwing. The dispatcher claims only due
 * rows under a cooldown, so a repeated wake converges instead of forking
 * work.
 */
export async function wakeBranchResearchDispatch(input: {
  organizationId: string;
  correlationId: string;
}): Promise<void> {
  try {
    await tasks.trigger<typeof dispatchDueWorkTask>(
      "growth-intelligence.dispatch-due",
      { correlationId: input.correlationId },
      { idempotencyKey: `growth-intelligence:branch-wake:${input.correlationId}` },
    );
  } catch (error) {
    logger.warn("growth_intelligence.branch_dispatch_wake_failed", {
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
  }
}
