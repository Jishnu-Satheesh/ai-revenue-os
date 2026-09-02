import { DomainError } from "@/lib/errors";
import {
  executeActionInputSchema,
  type ExecuteActionInput,
  type ExecuteActionResult,
  type ToolAdapter,
  type ToolGatewayStore,
  type ToolKey,
} from "@/modules/tool-gateway/application/ports";

/**
 * The deterministic Tool Gateway.
 *
 * One rule shapes the whole thing: the adapter is chosen *after* the claim
 * succeeds. A worker hands over a tool key and a parsed action; if the database
 * refuses, no adapter is ever looked up, so there is no code path from an
 * unauthorized action to a provider call.
 *
 * The gateway also owns the difference between a failure and an unknown
 * outcome. A rejected call is a failure and releases its reservation. A call
 * that may have gone through leaves the action in `provider_outcome_unknown`
 * with its money still committed, because retrying there is how a campaign
 * publishes or spends twice.
 */

const DEFAULT_LEASE_SECONDS = 300;

export type ToolGatewayDependencies = {
  store: ToolGatewayStore;
  /** The only route to a provider. Nothing else may hold an adapter. */
  adapters: readonly ToolAdapter[];
};

export function createToolGateway(dependencies: ToolGatewayDependencies) {
  const registry = new Map<ToolKey, ToolAdapter>(
    dependencies.adapters.map((adapter) => [adapter.toolKey, adapter]),
  );

  return {
    /** Which tools this deployment can actually perform. */
    registeredToolKeys(): readonly ToolKey[] {
      return [...registry.keys()];
    },

    async execute(rawInput: ExecuteActionInput, signal: AbortSignal): Promise<ExecuteActionResult> {
      const input = executeActionInputSchema.parse(rawInput);

      // Checked before the claim. Claiming for a tool this deployment cannot
      // perform would burn an attempt and leave a lease on work nothing can do.
      const adapter = registry.get(input.toolKey);
      if (!adapter) {
        throw new DomainError(
          "FEATURE_NOT_AVAILABLE",
          `No adapter is installed for ${input.toolKey}.`,
        );
      }

      const claim = await dependencies.store.claim({
        organizationId: input.organizationId,
        actionRunId: input.actionRunId,
        capabilityKey: input.capabilityKey,
        assertedFacts: input.assertedFacts,
        leaseSeconds: input.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
      });

      if (claim.outcome === "refused") {
        return { status: "refused", reasonCodes: claim.reasonCodes };
      }
      if (claim.outcome === "already_claimed") {
        return { status: "skipped", reason: "already_claimed" };
      }
      if (claim.outcome === "already_completed") {
        return { status: "replayed", receiptId: claim.receiptId };
      }
      if (claim.outcome === "provider_outcome_unknown") {
        return { status: "provider_outcome_unknown", invocationId: claim.invocationId };
      }

      const { claimToken } = claim;

      // Recorded before the call, not after. A worker that died mid-request
      // must leave a row saying a request was made, or reconciliation would
      // have nothing to look the action up by.
      const invocationId = await dependencies.store.recordInvocation({
        organizationId: input.organizationId,
        actionRunId: input.actionRunId,
        claimToken,
        toolKey: input.toolKey,
        idempotencyKey: input.idempotencyKey,
        requestDigest: input.requestDigest,
      });

      let outcome;
      try {
        outcome = await adapter.invoke({
          organizationId: input.organizationId,
          actionRunId: input.actionRunId,
          idempotencyKey: input.idempotencyKey,
          // Passed through, never re-derived. The adapter must apply a provider
          // ceiling no larger than what the database committed, and it can only
          // check that against the reservation this claim actually made.
          reservation: { amountMinor: claim.reservationMinor, currency: claim.currency },
          signal,
        });
      } catch {
        // An adapter that threw rather than reporting is ambiguous by
        // definition: nobody knows whether the request reached the provider.
        // Treating it as a clean failure would invite a duplicate.
        await dependencies.store.fail({
          organizationId: input.organizationId,
          actionRunId: input.actionRunId,
          claimToken,
          invocationId,
          failureCode: "adapter_threw",
          outcomeUnknown: true,
        });
        return { status: "provider_outcome_unknown", invocationId };
      }

      if (outcome.status === "succeeded") {
        const receiptId = await dependencies.store.complete({
          organizationId: input.organizationId,
          actionRunId: input.actionRunId,
          claimToken,
          invocationId,
          receipt: outcome,
        });
        return {
          status: "published",
          receiptId,
          externalReference: outcome.externalReference,
        };
      }

      await dependencies.store.fail({
        organizationId: input.organizationId,
        actionRunId: input.actionRunId,
        claimToken,
        invocationId,
        failureCode: outcome.failureCode,
        outcomeUnknown: outcome.status === "unknown",
      });

      return outcome.status === "unknown"
        ? { status: "provider_outcome_unknown", invocationId }
        : { status: "failed", failureCode: outcome.failureCode };
    },
  };
}

export type ToolGateway = ReturnType<typeof createToolGateway>;
