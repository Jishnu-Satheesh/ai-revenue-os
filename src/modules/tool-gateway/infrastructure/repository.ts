import { z } from "zod";

import type { PreflightRefusalCode } from "@/domain/tools/policy";
import type { ClaimResult, ToolGatewayStore } from "@/modules/tool-gateway/application/ports";

/**
 * The Tool Gateway's binding to its RPCs.
 *
 * Worker-only by construction: every function here is granted to `service_role`
 * alone, and each terminal write carries the claim token so a worker whose
 * lease lapsed cannot overwrite the result of the one that replaced it.
 */

type RpcResult<T> = { data: T | null; error: { code?: string } | null };

export type ToolGatewayPersistence = {
  rpc(
    name:
      | "claim_campaign_action"
      | "record_tool_invocation"
      | "complete_tool_invocation"
      | "fail_tool_invocation"
      | "reconcile_tool_invocation",
    args: Record<string, unknown>,
  ): Promise<RpcResult<unknown>>;
};

function gatewayError(): never {
  throw new Error("The campaign action could not be claimed or recorded.");
}

const claimSchema = z.union([
  z.strictObject({ outcome: z.literal("already_claimed") }),
  z.strictObject({ outcome: z.literal("already_completed"), receipt_id: z.string().uuid() }),
  z.strictObject({
    outcome: z.literal("provider_outcome_unknown"),
    invocation_id: z.string().uuid(),
  }),
  z.strictObject({ outcome: z.literal("refused"), reason_codes: z.array(z.string()) }),
  z.strictObject({
    outcome: z.literal("claimed"),
    claim_token: z.string().uuid(),
    attempt: z.number().int().positive(),
    reservation_minor: z.number().int().nonnegative().nullable(),
    currency: z.string().nullable(),
  }),
]);

export function createToolGatewayStore(persistence: ToolGatewayPersistence): ToolGatewayStore {
  return {
    async claim(input): Promise<ClaimResult> {
      const { data, error } = await persistence.rpc("claim_campaign_action", {
        target_organization_id: input.organizationId,
        input_claim: {
          organization_id: input.organizationId,
          action_run_id: input.actionRunId,
          capability_key: input.capabilityKey,
          lease_seconds: input.leaseSeconds,
          asserted_facts: {
            credential_healthy: input.assertedFacts.credentialHealthy,
            tracking_ready: input.assertedFacts.trackingReady,
            consent_withdrawn: input.assertedFacts.consentWithdrawn,
          },
        },
      });
      if (error || !data) gatewayError();

      const parsed = claimSchema.safeParse(data);
      if (!parsed.success) gatewayError();

      switch (parsed.data.outcome) {
        case "already_claimed":
          return { outcome: "already_claimed" };
        case "already_completed":
          return { outcome: "already_completed", receiptId: parsed.data.receipt_id };
        case "provider_outcome_unknown":
          return {
            outcome: "provider_outcome_unknown",
            invocationId: parsed.data.invocation_id,
          };
        case "refused":
          return {
            outcome: "refused",
            // The database and the domain share this vocabulary deliberately,
            // so a refusal reads the same wherever it surfaces.
            reasonCodes: parsed.data.reason_codes as readonly PreflightRefusalCode[],
          };
        case "claimed":
          return {
            outcome: "claimed",
            claimToken: parsed.data.claim_token,
            attempt: parsed.data.attempt,
            reservationMinor: parsed.data.reservation_minor,
            currency: parsed.data.currency,
          };
      }
    },

    async recordInvocation(input): Promise<string> {
      const { data, error } = await persistence.rpc("record_tool_invocation", {
        target_organization_id: input.organizationId,
        input_invocation: {
          action_run_id: input.actionRunId,
          claim_token: input.claimToken,
          tool_key: input.toolKey,
          idempotency_key: input.idempotencyKey,
          request_digest: input.requestDigest,
        },
      });
      if (error || typeof data !== "string") gatewayError();
      return data;
    },

    async complete(input): Promise<string> {
      const { data, error } = await persistence.rpc("complete_tool_invocation", {
        target_organization_id: input.organizationId,
        input_completion: {
          action_run_id: input.actionRunId,
          claim_token: input.claimToken,
          invocation_id: input.invocationId,
          external_reference: input.receipt.externalReference,
          provider_status: input.receipt.providerStatus,
          permalink: input.receipt.permalink ?? null,
          occurred_at: input.receipt.occurredAt,
          payload_digest: input.receipt.payloadDigest,
          // Bounded, normalized fields only. The raw provider response is never
          // stored: it can carry customer data the platform has no use for.
          normalized: input.receipt.normalized,
          settled_minor: input.receipt.settledMinor ?? null,
        },
      });
      if (error || typeof data !== "string") gatewayError();
      return data;
    },

    async fail(input): Promise<void> {
      const { error } = await persistence.rpc("fail_tool_invocation", {
        target_organization_id: input.organizationId,
        input_failure: {
          action_run_id: input.actionRunId,
          claim_token: input.claimToken,
          invocation_id: input.invocationId,
          failure_code: input.failureCode,
          outcome_unknown: input.outcomeUnknown,
        },
      });
      if (error) gatewayError();
    },
  };
}

/**
 * Reconciliation, kept off the main store because it is not part of executing
 * an action. It resolves an ambiguous send after someone has looked the action
 * up at the provider, and it is the only way out of `provider_outcome_unknown`.
 */
export function createToolReconciler(persistence: ToolGatewayPersistence) {
  return {
    async reconcile(input: {
      organizationId: string;
      actionRunId: string;
      invocationId: string;
      finding: "confirmed" | "absent";
      externalReference?: string;
      providerStatus?: string;
      payloadDigest?: string;
      normalized?: Record<string, unknown>;
    }): Promise<{ outcome: string }> {
      const { data, error } = await persistence.rpc("reconcile_tool_invocation", {
        target_organization_id: input.organizationId,
        input_reconciliation: {
          action_run_id: input.actionRunId,
          invocation_id: input.invocationId,
          finding: input.finding,
          external_reference: input.externalReference ?? null,
          provider_status: input.providerStatus ?? null,
          payload_digest: input.payloadDigest ?? null,
          normalized: input.normalized ?? {},
        },
      });
      if (error || !data) gatewayError();
      return data as { outcome: string };
    },
  };
}
