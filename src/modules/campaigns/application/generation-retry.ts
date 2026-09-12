import {
  describeCampaignGenerationFailure,
  type CampaignReadinessBlocker,
} from "@/domain/campaigns/readiness";
import type { GenerationRunSnapshot } from "@/modules/campaigns/application/ports";

/**
 * Whether starting generation again is worth doing.
 *
 * "Generate again" is an expensive button. It queues a run, wakes a worker and
 * calls an image model, and the person pressing it is told the platform is
 * trying. When the last attempt died on something that has not changed since,
 * all of that produces the identical failure and bills for it — which is what
 * the deployed run did twice in eleven seconds against a review date nobody had
 * touched.
 *
 * So the rule is narrow and checkable: refuse only when the previous attempt
 * failed on a deterministic blocker *and* the request names the same pinned
 * evidence it failed on. A different snapshot is a genuinely different request.
 * Anything else is permitted, because the platform cannot see the other things
 * a person may have fixed in the meantime and must not assume they fixed
 * nothing.
 */

export type GenerationRetryDecision =
  | {
      outcome: "permitted";
      reason: "no_previous_run" | "previous_run_unfinished" | "prerequisite_changed" | "retryable";
    }
  | {
      outcome: "refused";
      failureCode: string;
      /** Plain wording. Never the stored code. */
      clientCopy: string;
      nextAction: string;
      blocker: CampaignReadinessBlocker;
    };

export function decideGenerationRetry(input: {
  latestRun: GenerationRunSnapshot | null;
  /** The snapshot this request would generate from. */
  requestedSourceSnapshotId: string;
}): GenerationRetryDecision {
  const run = input.latestRun;
  if (!run) return { outcome: "permitted", reason: "no_previous_run" };

  // Only a finished attempt can be a reason to refuse. A queued or claimed run
  // is the enqueue path's own idempotency problem, not this decision's.
  if (run.status !== "failed" && run.status !== "cancelled") {
    return { outcome: "permitted", reason: "previous_run_unfinished" };
  }

  const described = describeCampaignGenerationFailure(run.failureCode);
  if (described.retryable) return { outcome: "permitted", reason: "retryable" };

  // The prerequisite the run failed on is pinned to its snapshot. A request
  // naming a different one is asking a different question, and gets to ask it.
  if (run.sourceSnapshotId !== input.requestedSourceSnapshotId) {
    return { outcome: "permitted", reason: "prerequisite_changed" };
  }

  return {
    outcome: "refused",
    failureCode: run.failureCode ?? "unknown",
    clientCopy: described.clientCopy,
    nextAction: described.nextAction,
    blocker: described.blocker,
  };
}
