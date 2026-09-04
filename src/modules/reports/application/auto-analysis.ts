import "server-only";

import type { AnalysisGrain } from "@/domain/analysis/types";
import { logger } from "@/lib/logger";

/**
 * What the projection worker knows at the moment a run completes, in the
 * order it learned it. The outcome is the worker's own; everything else is
 * read off the package row the completion RPC returned. Unknowns stay
 * unknown-typed until the selector narrows them, so a shape change in the
 * row fails closed (no dispatch) rather than dispatching a half-read window.
 */
export type ProjectionCompletionSummary = {
  projectionOutcome: string;
  packageStatus: unknown;
  channelId: unknown;
  branchId: unknown;
  windowStart: unknown;
  windowEnd: unknown;
  periodGrain: AnalysisGrain | null;
};

export type AutoAnalysisInput = {
  channelId: string;
  branchId: string;
  windowStart: string;
  windowEnd: string;
  periodGrain: AnalysisGrain;
};

/**
 * Whether a finished projection earns an audit of its own.
 *
 * Only a clean projection does: the run said `projected` and the package
 * row agrees, meaning no overlap is holding the figures for a human
 * decision. Anything disputed -- `reconciliation_required`,
 * `partially_projected`, a failure, or a retry replay -- is nobody's audit
 * to present, so there is nothing to dispatch. Auditing disputed numbers
 * and presenting the result as an audit would state a conclusion the
 * platform cannot stand behind.
 */
export function selectAutoAnalysisInput(
  completion: ProjectionCompletionSummary,
): AutoAnalysisInput | null {
  if (completion.projectionOutcome !== "projected" || completion.packageStatus !== "projected") {
    return null;
  }
  const { channelId, branchId, windowStart, windowEnd, periodGrain } = completion;
  if (
    typeof channelId !== "string" ||
    typeof branchId !== "string" ||
    typeof windowStart !== "string" ||
    typeof windowEnd !== "string" ||
    periodGrain === null
  ) {
    return null;
  }
  return { channelId, branchId, windowStart, windowEnd, periodGrain };
}

/**
 * The one collaborator `dispatchAnalysisForCleanProjection` needs, injected
 * so it runs in a test without Trigger. In production it is
 * `requestChannelAnalysis`, which already carries its own feature-flag guard
 * and idempotency key -- nothing here duplicates either.
 */
export type AutoAnalysisCollaborators = {
  requestAnalysis(
    input: AutoAnalysisInput & {
      organizationId: string;
      analysisRunId: string;
      correlationId: string;
    },
  ): Promise<boolean>;
};

/**
 * What a cleanly projected package does next, without waiting for a person.
 *
 * The figures just landed for this window, channel and branch, so the audit
 * runs for exactly that scope, with the grain the approved figures declare.
 * A fresh analysis run id is minted because this projection is the one
 * asking; a retried projection never reaches here with a fresh outcome, so
 * it cannot start a second audit. A dispatch that does not land is logged
 * and left: the button on the channel workspace still starts the same run
 * by hand, so a lost transport delays the audit rather than losing it.
 */
export async function dispatchAnalysisForCleanProjection(
  input: {
    organizationId: string;
    correlationId: string;
    completion: ProjectionCompletionSummary;
  },
  collaborators: AutoAnalysisCollaborators,
): Promise<"dispatched" | "not_dispatched"> {
  const selected = selectAutoAnalysisInput(input.completion);
  if (selected === null) return "not_dispatched";
  const dispatched = await collaborators.requestAnalysis({
    ...selected,
    organizationId: input.organizationId,
    analysisRunId: crypto.randomUUID(),
    correlationId: input.correlationId,
  });
  if (!dispatched) return "not_dispatched";
  logger.info("report_package.analysis_auto_dispatched", {
    organizationId: input.organizationId,
    channelId: selected.channelId,
    branchId: selected.branchId,
    windowStart: selected.windowStart,
    windowEnd: selected.windowEnd,
    correlationId: input.correlationId,
  });
  return "dispatched";
}
