import { z } from "zod";

/**
 * The scheduled sweeper.
 *
 * Postgres owns due time: `claim_due_growth_intelligence_requests` leases a
 * bounded batch of pending and lease-expired requests ordered by due time,
 * and the dispatch cooldown keeps a lost immediate wake discoverable without
 * busy redelivery. This worker only routes the leased rows to identifier-only
 * Trigger runs. A lost dispatch is therefore recovered by the next sweeper
 * run reading the due index, never by worker memory.
 */

export const dispatchDuePayloadSchema = z
  .object({
    correlationId: z.string().uuid(),
    limit: z.number().int().min(1).max(100).default(25),
    cooldownSeconds: z.number().int().min(0).max(3_600).default(300),
  })
  .strict();

export type DispatchDuePayload = z.infer<typeof dispatchDuePayloadSchema>;

export type DueGrowthIntelligenceRequest = {
  organizationId: string;
  requestId: string;
  kind: string;
  correlationId: string;
};

export type DispatchDueDependencies = {
  claimDue(input: {
    limit: number;
    cooldownSeconds: number;
  }): Promise<readonly DueGrowthIntelligenceRequest[]>;
  trigger(input: {
    taskId:
      | "growth-intelligence.run-market-research"
      | "growth-intelligence.consolidate-market-evidence";
    organizationId: string;
    requestId: string;
    correlationId: string;
  }): Promise<void>;
};

export type DispatchDueResult = {
  outcome: "dispatched";
  dispatched: number;
  skipped: number;
  limit: number;
  cooldownSeconds: number;
};

const RESEARCH_TASK_ID = "growth-intelligence.run-market-research" as const;
const CONSOLIDATION_TASK_ID = "growth-intelligence.consolidate-market-evidence" as const;

const RESEARCH_KINDS = new Set([
  "market_research",
  "evidence_reassessment",
  "business_evidence_changed",
]);

export async function dispatchDueWork(
  input: unknown,
  dependencies: DispatchDueDependencies,
): Promise<DispatchDueResult> {
  const payload = dispatchDuePayloadSchema.parse(input);
  const due = await dependencies.claimDue({
    limit: payload.limit,
    cooldownSeconds: payload.cooldownSeconds,
  });

  let dispatched = 0;
  let skipped = 0;
  for (const request of due) {
    const taskId = RESEARCH_KINDS.has(request.kind)
      ? RESEARCH_TASK_ID
      : request.kind === "weekly_synthesis"
        ? CONSOLIDATION_TASK_ID
        : null;
    // profile_discovery is owned by the Market Profile proposal flow and any
    // unknown kind is owned by a future increment. Skipping leaves the row
    // for its owner instead of triggering work nobody can complete.
    if (taskId === null) {
      skipped += 1;
      continue;
    }
    // A trigger failure propagates: the row keeps its dispatch attempt, the
    // cooldown governs redelivery, and nothing is silently skipped.
    await dependencies.trigger({
      taskId,
      organizationId: request.organizationId,
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
    dispatched += 1;
  }

  return {
    outcome: "dispatched",
    dispatched,
    skipped,
    limit: payload.limit,
    cooldownSeconds: payload.cooldownSeconds,
  };
}
