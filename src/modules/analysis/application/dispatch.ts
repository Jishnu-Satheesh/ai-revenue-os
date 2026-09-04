import "server-only";

import { tasks } from "@trigger.dev/sdk";

import type { AnalysisGrain } from "@/domain/analysis/types";
import { logger } from "@/lib/logger";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";
import type { channelAnalysisTask } from "@/trigger/analysis";

/**
 * Asking for an analysis.
 *
 * Trigger is transport and nothing else. It carries identifiers; the claim RPC
 * re-resolves the channel, the branch timezone, and the metric vocabulary, and
 * refuses anything it cannot bind. A dispatch that fails is reported as a
 * failure to start rather than swallowed, because a button that silently does
 * nothing is worse than one that says it could not.
 */
export async function requestChannelAnalysis(input: {
  organizationId: string;
  /** Null asks how the channels compare; a value asks about one of them. */
  channelId: string | null;
  branchId: string | null;
  windowStart: string;
  windowEnd: string;
  periodGrain: AnalysisGrain;
  /** The canonical month the route selected. Absent on the legacy path. */
  month?: string;
  /** The zone the route resolved the month in. Required with `month`. */
  windowTimezone?: string;
  analysisRunId: string;
  correlationId: string;
}): Promise<boolean> {
  if (!isGovernedChannelAnalysisEnabled(input.organizationId)) return false;

  // The run id is part of the key, so re-pressing the button starts a new
  // analysis while a retried dispatch of the same one does not.
  const idempotencyKey = `channel-analysis:${input.analysisRunId}`;
  try {
    await tasks.trigger<typeof channelAnalysisTask>(
      "channel-analysis.run",
      {
        organizationId: input.organizationId,
        channelId: input.channelId,
        branchId: input.branchId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        periodGrain: input.periodGrain,
        month: input.month,
        windowTimezone: input.windowTimezone,
        analysisRunId: input.analysisRunId,
        correlationId: input.correlationId,
        idempotencyKey,
      },
      { idempotencyKey },
    );
    return true;
  } catch (error) {
    logger.warn("channel_analysis.dispatch_failed", {
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
