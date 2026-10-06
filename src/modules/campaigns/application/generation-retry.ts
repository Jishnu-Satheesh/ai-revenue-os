import {
  describeCampaignGenerationFailure,
  type CampaignReadinessBlocker,
  type CampaignReadinessRepairTarget,
} from "@/domain/campaigns/readiness";
import { verifiedChannelLimitsEvidence } from "@/modules/campaigns/application/verified-limits";
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
      reason:
        | "no_previous_run"
        | "previous_run_unfinished"
        | "prerequisite_changed"
        | "blocker_cleared"
        | "retryable";
    }
  | {
      outcome: "refused";
      failureCode: string;
      /** Plain wording. Never the stored code. */
      clientCopy: string;
      nextAction: string;
      blocker: CampaignReadinessBlocker;
    };

/**
 * Whether the thing the previous attempt died on is *still* true, asked now.
 *
 * The default asks the only repair target the platform can answer for itself:
 * a provider contract that has since been reverified is no longer expired, and
 * the blocker is gone. Everything else returns `true` — conservative, because
 * a repair this function cannot observe is one it must not assume happened.
 *
 * This is what makes the second half of the rule reachable. Keying "the
 * prerequisite changed" on the pinned snapshot alone meant the exact blocker
 * class this work is about — an expired contract that later becomes valid —
 * could never permit a new attempt, because reverifying a contract does not
 * change a campaign's evidence.
 */
export function providerContractBlockerStillStands(
  repair: CampaignReadinessRepairTarget,
  now: Date = new Date(),
): boolean {
  if (repair.kind !== "reverify_provider_contract") return true;
  return verifiedChannelLimitsEvidence(now).blockers.some(
    (blocker) => blocker.code === "provider_contract_expired",
  );
}

export function decideGenerationRetry(input: {
  latestRun: GenerationRunSnapshot | null;
  /** The snapshot this request would generate from. */
  requestedSourceSnapshotId: string;
  /** Injected so a test can ask the question against a fixed date. */
  blockerStillStands?: (repair: CampaignReadinessRepairTarget) => boolean;
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

  // The snapshot is not the only prerequisite that can change. A blocker whose
  // repair has actually been carried out — the contract reverified, the
  // platform's rules checked again — is no longer a reason to refuse, and
  // refusing anyway would strand the campaign permanently on a problem that is
  // already fixed.
  const stillStands = input.blockerStillStands ?? providerContractBlockerStillStands;
  if (!stillStands(described.blocker.repair)) {
    return { outcome: "permitted", reason: "blocker_cleared" };
  }

  return {
    outcome: "refused",
    failureCode: run.failureCode ?? "unknown",
    clientCopy: described.clientCopy,
    nextAction: described.nextAction,
    blocker: described.blocker,
  };
}
