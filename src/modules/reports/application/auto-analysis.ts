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
  periodTimezone: unknown;
};

export type AutoAnalysisInput = {
  channelId: string;
  branchId: string;
  windowStart: string;
  windowEnd: string;
  periodGrain: AnalysisGrain;
  windowTimezone: string;
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
  const { channelId, branchId, windowStart, windowEnd, periodGrain, periodTimezone } = completion;
  if (
    typeof channelId !== "string" ||
    typeof branchId !== "string" ||
    typeof windowStart !== "string" ||
    typeof windowEnd !== "string" ||
    // A run with no zone cannot be cache-keyed and cannot be reproduced, so it
    // is better not started than started unreproducibly.
    typeof periodTimezone !== "string" ||
    periodTimezone.length === 0 ||
    periodGrain === null
  ) {
    return null;
  }
  return {
    channelId,
    branchId,
    windowStart,
    windowEnd,
    periodGrain,
    windowTimezone: periodTimezone,
  };
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
 *
 * `requestAnalysis` is caught here, not merely relied on to swallow its own
 * failures. In production it is `requestChannelAnalysis`, which today does
 * catch everything and resolve to `false` -- but that is a property of one
 * collaborator in another module, not of this function's contract, and this
 * runs from `reports.ts` *after* the completion RPC has already committed
 * the package's new status. An escape here would abort the Trigger.dev task,
 * which retries; a retry re-claims a package that is no longer in the state
 * the claim expects, and the auto-continuation is lost for good rather than
 * merely delayed -- the exact hazard `advanceReportPackageOnAdmission`
 * documents for the same reason. Catching here makes "a lost dispatch only
 * delays the audit" true for every caller, not just the one collaborator
 * that happens to behave today.
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
  let dispatched: boolean;
  try {
    dispatched = await collaborators.requestAnalysis({
      ...selected,
      organizationId: input.organizationId,
      analysisRunId: crypto.randomUUID(),
      correlationId: input.correlationId,
    });
  } catch (error) {
    // `errorCode` only, per the logger's closed allowlist -- the same reason
    // `advanceReportPackageOnAdmission` logs `error.name` rather than
    // `error.message` for the same kind of caught escape: a message is free
    // text a collaborator wrote, and this stream never carries that.
    logger.warn("report_package.analysis_auto_dispatch_failed", {
      organizationId: input.organizationId,
      channelId: selected.channelId,
      branchId: selected.branchId,
      correlationId: input.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return "not_dispatched";
  }
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
