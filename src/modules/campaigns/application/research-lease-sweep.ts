import type { ResearchRunStore } from "@/modules/campaigns/infrastructure/research-run-repository";

/**
 * Recovering research runs whose worker died (Task 6 follow-up, C03).
 *
 * A run is claimed with a lease. If the worker holding it dies, nothing in the
 * original lifecycle could ever move that row again: `claim` takes only queued
 * rows, and `complete` and `fail` both demand a live lease. The run kept its
 * pending slot and its reserved budget for good, so enough dead workers could
 * leave an organization unable to request research at all.
 *
 * This sweep is the way out. It asks which tenants hold a lapsed claim, then
 * has the database decide each one's fate against the policy that admitted it
 * — back to the queue, or given up on by name once its attempts are used.
 *
 * The judgement lives in SQL, not here. This function only decides who to ask
 * and how to report what came back.
 */

export type ResearchLeaseSweepStore = Pick<
  ResearchRunStore,
  "listLeaseExpiries" | "reclaimLeases"
>;

export type ResearchLeaseSweepResult = {
  organizationsSwept: number;
  reclaimed: number;
  abandoned: number;
  /** Tenants whose sweep failed. Named, so a partial run never reads as clean. */
  failed: readonly string[];
};

export async function sweepResearchLeases(dependencies: {
  store: ResearchLeaseSweepStore;
}): Promise<ResearchLeaseSweepResult> {
  // Deliberately uncaught. An empty list and an unreadable one look identical
  // to everything downstream, so a sweep that cannot see its work must fail to
  // its own alerting rather than log a quiet success.
  const organizationIds = await dependencies.store.listLeaseExpiries();

  // The reader is a governed call whose shape this module does not own, so a
  // repeated id is treated as a fact about the answer rather than assumed away.
  const targets = [...new Set(organizationIds)];

  let reclaimed = 0;
  let abandoned = 0;
  const failed: string[] = [];

  for (const organizationId of targets) {
    try {
      const outcome = await dependencies.store.reclaimLeases({ organizationId });
      reclaimed += outcome.reclaimed;
      abandoned += outcome.abandoned;
    } catch {
      // One tenant's fault must not strand every other tenant's dead runs
      // until the next tick. The id is collected rather than swallowed: the
      // caller reports a partial sweep as partial.
      failed.push(organizationId);
    }
  }

  return { organizationsSwept: targets.length, reclaimed, abandoned, failed };
}
