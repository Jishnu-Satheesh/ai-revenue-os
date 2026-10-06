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
 * One rule shapes the whole thing: the provider is *called* only after the
 * claim succeeds. A worker hands over a tool key and a parsed action; if the
 * database refuses, no adapter is ever invoked, so there is no code path from
 * an unauthorized action to a provider call.
 *
 * The gateway also owns the difference between a failure and an unknown
 * outcome. A rejected call is a failure and releases its reservation. A call
 * that may have gone through leaves the action in `provider_outcome_unknown`
 * with its money still committed, because retrying there is how a campaign
 * publishes or spends twice.
 */

const DEFAULT_LEASE_SECONDS = 300;

/**
 * Which adapter serves which organization.
 *
 * A resolver rather than a list, because the sweep that drives this gateway
 * spans every tenant while a provider credential belongs to exactly one. One
 * shared adapter would have to hold one tenant's token and would publish
 * everybody's work to that account.
 *
 * The two questions are deliberately separate. `supportedToolKeys` is about the
 * deployment — can this build perform this kind of call at all — and is
 * answered without touching the database, so a tool that is switched off costs
 * nothing to refuse. `resolve` is about one organization, and may read that
 * organization's stored connection.
 */
export type ToolAdapterResolver = {
  /** Tool keys this deployment could perform for some organization. */
  supportedToolKeys(): readonly ToolKey[];
  /** This organization's adapter, or null when it has no usable connection. */
  resolve(input: {
    organizationId: string;
    toolKey: ToolKey;
  }): Promise<ToolAdapter | null>;
};

/**
 * A resolver over a fixed list, for adapters that carry no per-tenant
 * credential — fixtures, tests, and any provider configured once for the whole
 * deployment.
 */
export function staticAdapters(adapters: readonly ToolAdapter[]): ToolAdapterResolver {
  const registry = new Map<ToolKey, ToolAdapter>(
    adapters.map((adapter) => [adapter.toolKey, adapter]),
  );
  return {
    supportedToolKeys: () => [...registry.keys()],
    resolve: async ({ toolKey }) => registry.get(toolKey) ?? null,
  };
}

export type ToolGatewayDependencies = {
  store: ToolGatewayStore;
  /** The only route to a provider. Nothing else may hold an adapter. */
  adapters: ToolAdapterResolver;
};

export function createToolGateway(dependencies: ToolGatewayDependencies) {
  return {
    /** Which tools this deployment can actually perform. */
    registeredToolKeys(): readonly ToolKey[] {
      return dependencies.adapters.supportedToolKeys();
    },

    async execute(rawInput: ExecuteActionInput, signal: AbortSignal): Promise<ExecuteActionResult> {
      const input = executeActionInputSchema.parse(rawInput);

      // Both checks happen before the claim, because claiming for work that
      // cannot be done would burn an attempt and leave a lease behind. The
      // store's `fail` needs an invocation id, and there is no invocation to
      // record for a call that was never made.
      if (!dependencies.adapters.supportedToolKeys().includes(input.toolKey)) {
        throw new DomainError(
          "FEATURE_NOT_AVAILABLE",
          `No adapter is installed for ${input.toolKey}.`,
        );
      }

      // Separate from the refusal above, and worth keeping separate: this
      // deployment can do the thing, this organization has not connected an
      // account that lets it. The sweep records that against the action and
      // carries on to the next one.
      const adapter = await dependencies.adapters.resolve({
        organizationId: input.organizationId,
        toolKey: input.toolKey,
      });
      if (!adapter) {
        throw new DomainError(
          "FEATURE_NOT_AVAILABLE",
          `No connected account can perform ${input.toolKey} for this organization.`,
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
