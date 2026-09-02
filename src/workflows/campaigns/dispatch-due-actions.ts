import { logger } from "@/lib/logger";
import type { ExecuteActionResult, ToolKey } from "@/modules/tool-gateway/application/ports";

/**
 * Sending approved actions to their provider, and recovering the ones that were
 * never sent.
 *
 * Scheduling writes an action run and hands it to Trigger. If that hand-off is
 * lost — a deploy, a dropped connection, a run that never starts — the action
 * sits queued with nobody looking for it, and a campaign silently does nothing
 * on the day it was meant to publish. So Postgres holds what is due and this
 * sweeps it, which turns a lost dispatch into a delay rather than a no-show.
 *
 * Nothing here decides whether an action may run. Every due row goes to the
 * Tool Gateway, which re-checks tenancy, approval, capability, policy, schedule
 * and budget atomically before an adapter is even chosen. A refusal is an
 * answer, not an error: the run is left for an operator with its reason.
 *
 * Task completion never implies success. The status written is the gateway's,
 * and an unknown outcome stays unknown until reconciliation resolves it.
 */

export type DueAction = {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  actionRunId: string;
  actionKey: string;
  scheduledFor: string;
};

export type DueActionReader = {
  listDue(limit: number): Promise<readonly DueAction[]>;
};

export type DispatchPlan = {
  toolKey: ToolKey;
  capabilityKey: string;
  idempotencyKey: string;
  requestDigest: string;
  assertedFacts: Record<string, boolean>;
};

export type DispatchPlanner = {
  /**
   * What this action needs to execute, or why it cannot.
   *
   * Null when the action cannot be turned into a provider call at all — a
   * missing asset, an unpublishable image. Reported rather than attempted.
   */
  plan(action: DueAction): Promise<DispatchPlan | null>;
};

export type ExposureRecorder = {
  record(input: {
    organizationId: string;
    actionRunId: string;
    externalReference: string;
    providerStatus: string;
    publishedAt: string;
    metricsEligibleAt: string;
  }): Promise<void>;
};

export type CampaignToolGateway = {
  execute(
    input: {
      organizationId: string;
      actionRunId: string;
      toolKey: ToolKey;
      capabilityKey: string;
      idempotencyKey: string;
      requestDigest: string;
      assertedFacts: Record<string, boolean>;
    },
    signal: AbortSignal,
  ): Promise<ExecuteActionResult>;
};

export type DispatchDependencies = {
  due: DueActionReader;
  planner: DispatchPlanner;
  gateway: CampaignToolGateway;
  exposures: ExposureRecorder;
  isCancelled: () => boolean;
  now?: () => Date;
  /**
   * How long after publication a metric fetch is worth making. Provider
   * insights are empty immediately after a post, and a zero recorded then
   * reads exactly like a measured zero.
   */
  metricsDelayMinutes?: number;
};

export type DispatchOutcome = {
  actionRunId: string;
  result: "published" | "refused" | "failed" | "unknown" | "skipped" | "replayed" | "unplannable";
  detail?: string;
};

export type DispatchResult = {
  considered: number;
  published: number;
  outcomes: readonly DispatchOutcome[];
};

const DEFAULT_METRICS_DELAY_MINUTES = 60;
const DEFAULT_BATCH = 50;

export async function dispatchDueActions(
  payload: { limit?: number },
  dependencies: DispatchDependencies,
  signal: AbortSignal,
): Promise<DispatchResult> {
  const now = dependencies.now ?? (() => new Date());
  const due = await dependencies.due.listDue(payload.limit ?? DEFAULT_BATCH);

  const outcomes: DispatchOutcome[] = [];
  let published = 0;

  for (const action of due) {
    if (dependencies.isCancelled() || signal.aborted) break;

    const plan = await dependencies.planner.plan(action);
    if (!plan) {
      outcomes.push({
        actionRunId: action.actionRunId,
        result: "unplannable",
        detail: "This action could not be turned into a provider call.",
      });
      continue;
    }

    const result = await dependencies.gateway.execute(
      {
        organizationId: action.organizationId,
        actionRunId: action.actionRunId,
        toolKey: plan.toolKey,
        capabilityKey: plan.capabilityKey,
        idempotencyKey: plan.idempotencyKey,
        requestDigest: plan.requestDigest,
        assertedFacts: plan.assertedFacts,
      },
      signal,
    );

    outcomes.push(await interpret({ action, result, dependencies, now }));
    if (result.status === "published") published += 1;
  }

  logger.info("campaign.dispatch_swept", {
    // Counts only. Which campaigns were touched belongs in their own rows.
    variantsStored: published,
    variantsRequested: due.length,
  });

  return { considered: due.length, published, outcomes };
}

async function interpret(input: {
  action: DueAction;
  result: ExecuteActionResult;
  dependencies: DispatchDependencies;
  now: () => Date;
}): Promise<DispatchOutcome> {
  const { action, result, dependencies } = input;

  switch (result.status) {
    case "published": {
      const publishedAt = input.now();
      const delay = dependencies.metricsDelayMinutes ?? DEFAULT_METRICS_DELAY_MINUTES;

      // Written immediately, because when something published is a fact that
      // gets harder to establish the longer it is left.
      await dependencies.exposures.record({
        organizationId: action.organizationId,
        actionRunId: action.actionRunId,
        externalReference: result.externalReference,
        providerStatus: "PUBLISHED",
        publishedAt: publishedAt.toISOString(),
        metricsEligibleAt: new Date(publishedAt.getTime() + delay * 60_000).toISOString(),
      });

      return { actionRunId: action.actionRunId, result: "published" };
    }

    case "refused":
      // The gateway declined for a reason an operator can act on. The run is
      // blocked, not failed, and its codes travel with it.
      return {
        actionRunId: action.actionRunId,
        result: "refused",
        detail: result.reasonCodes.join(","),
      };

    case "provider_outcome_unknown":
      // Left for reconciliation. A retry here is how a post publishes twice.
      return {
        actionRunId: action.actionRunId,
        result: "unknown",
        detail: result.invocationId,
      };

    case "failed":
      return {
        actionRunId: action.actionRunId,
        result: "failed",
        detail: result.failureCode,
      };

    case "skipped":
      // Another worker holds it. Standing down is the whole point of the lease.
      return { actionRunId: action.actionRunId, result: "skipped" };

    case "replayed":
      return { actionRunId: action.actionRunId, result: "replayed" };
  }
}
