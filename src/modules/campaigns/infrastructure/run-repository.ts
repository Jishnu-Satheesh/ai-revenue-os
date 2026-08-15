import { z } from "zod";

import { campaignGenerationRequestDigest } from "@/workflows/campaigns/contracts";
import type { GenerationRunClaim, GenerationRunStore } from "@/workflows/campaigns/generate-bundle";

/**
 * The durable record of generation work.
 *
 * Split deliberately in two. `createCampaignRunDispatcher` runs in a request,
 * under the caller's session, and may only enqueue. `createCampaignRunStore`
 * runs in a worker, under a service-role client, and owns the claim/complete/
 * fail lifecycle. A request path that could complete a run could mark work done
 * that never happened.
 */

type RpcResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

export type CampaignRunPersistence = {
  rpc(
    name:
      | "enqueue_campaign_generation_run"
      | "claim_campaign_generation_run"
      | "complete_campaign_generation_run"
      | "fail_campaign_generation_run"
      | "cancel_campaign_generation_run",
    args: Record<string, unknown>,
  ): Promise<RpcResult<unknown>>;
};

function runDatabaseError(): never {
  throw new Error("Campaign generation state could not be read or written.");
}

const enqueueResultSchema = z.strictObject({
  run_id: z.string().uuid(),
  status: z.string(),
  replayed: z.boolean(),
});

const claimResultSchema = z.union([
  z.strictObject({ outcome: z.literal("already_claimed") }),
  z.strictObject({
    outcome: z.literal("already_finished"),
    status: z.enum(["succeeded", "failed", "cancelled"]),
    result_version_id: z.string().uuid().nullable(),
    failure_code: z.string().nullable(),
  }),
  z.strictObject({
    outcome: z.literal("claimed"),
    claim_token: z.string().uuid(),
    attempt: z.number().int().positive(),
    campaign_id: z.string().uuid(),
    source_snapshot_id: z.string().uuid(),
    kind: z.enum(["generate", "revise"]),
    base_version_id: z.string().uuid().nullable(),
    base_digest: z.string().nullable(),
    correlation_id: z.string().uuid(),
  }),
]);

export type EnqueueRunInput = {
  organizationId: string;
  campaignId: string;
  sourceSnapshotId: string;
  kind: "generate" | "revise";
  idempotencyKey: string;
  correlationId: string;
  baseVersionId?: string | null;
  baseDigest?: string | null;
};

/**
 * The request-path dispatcher.
 *
 * This is what `createCampaignService` needs to record a generation intent
 * durably before returning. It cannot claim, complete, or fail anything.
 */
export function createCampaignRunDispatcher(persistence: CampaignRunPersistence) {
  return {
    async enqueue(input: EnqueueRunInput): Promise<{ runId: string; replayed: boolean }> {
      if (!input.organizationId || !input.campaignId) runDatabaseError();

      const { data, error } = await persistence.rpc("enqueue_campaign_generation_run", {
        target_organization_id: input.organizationId,
        input_run: {
          organization_id: input.organizationId,
          campaign_id: input.campaignId,
          source_snapshot_id: input.sourceSnapshotId,
          kind: input.kind,
          idempotency_key: input.idempotencyKey,
          // Computed here so the database can tell a genuine retry from a
          // caller that reused a key for different work.
          request_digest: campaignGenerationRequestDigest({
            organizationId: input.organizationId,
            campaignId: input.campaignId,
            sourceSnapshotId: input.sourceSnapshotId,
            kind: input.kind,
            baseVersionId: input.baseVersionId ?? null,
            baseDigest: input.baseDigest ?? null,
          }),
          correlation_id: input.correlationId,
          base_version_id: input.baseVersionId ?? null,
          base_digest: input.baseDigest ?? null,
        },
      });

      if (error || !data) runDatabaseError();

      const parsed = enqueueResultSchema.safeParse(data);
      if (!parsed.success) runDatabaseError();

      return { runId: parsed.data.run_id, replayed: parsed.data.replayed };
    },
  };
}

export type CampaignRunDispatcher = ReturnType<typeof createCampaignRunDispatcher>;

/** The worker-only lifecycle. Never constructed in a request path. */
export function createCampaignRunStore(persistence: CampaignRunPersistence): GenerationRunStore & {
  cancel(input: { organizationId: string; runId: string }): Promise<void>;
} {
  return {
    async claim(input): Promise<GenerationRunClaim> {
      const { data, error } = await persistence.rpc("claim_campaign_generation_run", {
        target_organization_id: input.organizationId,
        input_claim: {
          organization_id: input.organizationId,
          run_id: input.runId,
          lease_seconds: input.leaseSeconds,
        },
      });
      if (error || !data) runDatabaseError();

      const parsed = claimResultSchema.safeParse(data);
      if (!parsed.success) runDatabaseError();

      if (parsed.data.outcome === "already_claimed") return { outcome: "already_claimed" };
      if (parsed.data.outcome === "already_finished") {
        return {
          outcome: "already_finished",
          status: parsed.data.status,
          resultVersionId: parsed.data.result_version_id,
          failureCode: parsed.data.failure_code,
        };
      }

      return {
        outcome: "claimed",
        claimToken: parsed.data.claim_token,
        attempt: parsed.data.attempt,
        campaignId: parsed.data.campaign_id,
        sourceSnapshotId: parsed.data.source_snapshot_id,
        kind: parsed.data.kind,
        correlationId: parsed.data.correlation_id,
      };
    },

    async complete(input): Promise<void> {
      const { error } = await persistence.rpc("complete_campaign_generation_run", {
        target_organization_id: input.organizationId,
        input_completion: {
          run_id: input.runId,
          // The token is what fences a worker whose lease already lapsed.
          claim_token: input.claimToken,
          result_version_id: input.resultVersionId,
          cost_minor: input.costMinor,
        },
      });
      if (error) runDatabaseError();
    },

    async fail(input): Promise<void> {
      const { error } = await persistence.rpc("fail_campaign_generation_run", {
        target_organization_id: input.organizationId,
        input_failure: {
          run_id: input.runId,
          claim_token: input.claimToken,
          failure_code: input.failureCode,
          cost_minor: input.costMinor,
        },
      });
      if (error) runDatabaseError();
    },

    async cancel(input): Promise<void> {
      const { error } = await persistence.rpc("cancel_campaign_generation_run", {
        target_organization_id: input.organizationId,
        input_cancel: { run_id: input.runId },
      });
      if (error) runDatabaseError();
    },
  };
}
