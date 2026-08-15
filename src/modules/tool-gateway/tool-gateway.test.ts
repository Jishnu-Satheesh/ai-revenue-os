import { beforeEach, describe, expect, it, vi } from "vitest";

import { createToolGateway } from "@/modules/tool-gateway/application/service";
import type {
  AdapterOutcome,
  ExecuteActionInput,
  ToolAdapter,
} from "@/modules/tool-gateway/application/ports";
import {
  createToolGatewayStore,
  type ToolGatewayPersistence,
} from "@/modules/tool-gateway/infrastructure/repository";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_RUN_ID = "7a000000-0000-4000-8000-000000000a01";
const CLAIM_TOKEN = "d0000000-0000-4000-8000-000000000009";
const INVOCATION_ID = "e0000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "f0000000-0000-4000-8000-000000000001";

const claim = vi.fn();
const recordInvocation = vi.fn();
const complete = vi.fn();
const fail = vi.fn();
const invoke = vi.fn();

const adapter: ToolAdapter = { toolKey: "meta.publish_image", invoke };

function gateway(adapters: readonly ToolAdapter[] = [adapter]) {
  return createToolGateway({ store: { claim, recordInvocation, complete, fail }, adapters });
}

const INPUT: ExecuteActionInput = {
  organizationId: ORGANIZATION_ID,
  actionRunId: ACTION_RUN_ID,
  toolKey: "meta.publish_image",
  capabilityKey: "publish_instagram",
  idempotencyKey: "invocation-key-1",
  requestDigest: "b".repeat(64),
  assertedFacts: { credentialHealthy: true, trackingReady: true, consentWithdrawn: false },
};

const SUCCESS: AdapterOutcome = {
  status: "succeeded",
  externalReference: "ig_media_1",
  providerStatus: "PUBLISHED",
  occurredAt: "2026-09-01T14:00:00.000Z",
  payloadDigest: "c".repeat(64),
  normalized: { id: "ig_media_1" },
};

beforeEach(() => {
  for (const spy of [claim, recordInvocation, complete, fail, invoke]) spy.mockReset();
  claim.mockResolvedValue({
    outcome: "claimed",
    claimToken: CLAIM_TOKEN,
    attempt: 1,
    reservationMinor: null,
    currency: null,
  });
  recordInvocation.mockResolvedValue(INVOCATION_ID);
  complete.mockResolvedValue(RECEIPT_ID);
  invoke.mockResolvedValue(SUCCESS);
});

describe("the adapter is unreachable without a claim", () => {
  it("never invokes an adapter when the claim is refused", async () => {
    claim.mockResolvedValue({ outcome: "refused", reasonCodes: ["approval_expired"] });

    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(result).toEqual({ status: "refused", reasonCodes: ["approval_expired"] });
    expect(invoke).not.toHaveBeenCalled();
    expect(recordInvocation).not.toHaveBeenCalled();
  });

  it("never invokes an adapter when another worker holds the claim", async () => {
    claim.mockResolvedValue({ outcome: "already_claimed" });

    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(result).toEqual({ status: "skipped", reason: "already_claimed" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("replays a completed action without calling the provider again", async () => {
    claim.mockResolvedValue({ outcome: "already_completed", receiptId: RECEIPT_ID });

    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(result).toEqual({ status: "replayed", receiptId: RECEIPT_ID });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses to act while a previous send is unresolved", async () => {
    claim.mockResolvedValue({
      outcome: "provider_outcome_unknown",
      invocationId: INVOCATION_ID,
    });

    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(result).toEqual({ status: "provider_outcome_unknown", invocationId: INVOCATION_ID });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses an unregistered tool before claiming anything", async () => {
    await expect(gateway([]).execute(INPUT, new AbortController().signal)).rejects.toThrow(
      /No adapter is installed/,
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it("refuses a tool key that is not in the closed set", async () => {
    await expect(
      gateway().execute(
        { ...INPUT, toolKey: "meta.delete_everything" } as unknown as ExecuteActionInput,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("a successful call", () => {
  it("records the invocation before calling the provider", async () => {
    const order: string[] = [];
    recordInvocation.mockImplementation(async () => {
      order.push("recorded");
      return INVOCATION_ID;
    });
    invoke.mockImplementation(async () => {
      order.push("invoked");
      return SUCCESS;
    });

    await gateway().execute(INPUT, new AbortController().signal);

    expect(order).toEqual(["recorded", "invoked"]);
  });

  it("carries the claim token into every write", async () => {
    await gateway().execute(INPUT, new AbortController().signal);

    expect(recordInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ claimToken: CLAIM_TOKEN }),
    );
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ claimToken: CLAIM_TOKEN }));
  });

  it("reports the receipt and the provider's own reference", async () => {
    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(result).toEqual({
      status: "published",
      receiptId: RECEIPT_ID,
      externalReference: "ig_media_1",
    });
  });

  it("never hands a credential or an endpoint to the caller", async () => {
    await gateway().execute(INPUT, new AbortController().signal);

    const call = invoke.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual([
      "actionRunId",
      "idempotencyKey",
      "organizationId",
      "signal",
    ]);
  });
});

describe("failure is not the same as ambiguity", () => {
  it("records a rejected call as a plain failure", async () => {
    invoke.mockResolvedValue({ status: "failed", failureCode: "provider_rejected" });

    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(result).toEqual({ status: "failed", failureCode: "provider_rejected" });
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ outcomeUnknown: false }));
  });

  it("records a timeout after sending as unknown, never as a failure", async () => {
    invoke.mockResolvedValue({ status: "unknown", failureCode: "timeout_after_send" });

    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(result).toEqual({ status: "provider_outcome_unknown", invocationId: INVOCATION_ID });
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ outcomeUnknown: true }));
  });

  it("treats an adapter that threw as ambiguous, because nobody knows what happened", async () => {
    invoke.mockRejectedValue(new Error("socket hang up"));

    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(result).toEqual({ status: "provider_outcome_unknown", invocationId: INVOCATION_ID });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "adapter_threw", outcomeUnknown: true }),
    );
  });

  it("does not let the adapter's error message escape", async () => {
    invoke.mockRejectedValue(new Error("token abc123 rejected for account 987"));

    const result = await gateway().execute(INPUT, new AbortController().signal);

    expect(JSON.stringify(result)).not.toContain("abc123");
  });
});

describe("the store's RPC binding", () => {
  function persistenceReturning(data: unknown, error: { code?: string } | null = null) {
    const rpc = vi.fn(async () => ({ data, error }));
    return { store: createToolGatewayStore({ rpc } as unknown as ToolGatewayPersistence), rpc };
  }

  it("maps a refusal into the shared reason-code vocabulary", async () => {
    const { store } = persistenceReturning({
      outcome: "refused",
      reason_codes: ["capability_not_granted", "tracking_not_ready"],
    });

    const result = await store.claim({
      organizationId: ORGANIZATION_ID,
      actionRunId: ACTION_RUN_ID,
      capabilityKey: "publish_instagram",
      assertedFacts: { credentialHealthy: true, trackingReady: false, consentWithdrawn: false },
      leaseSeconds: 300,
    });

    expect(result).toEqual({
      outcome: "refused",
      reasonCodes: ["capability_not_granted", "tracking_not_ready"],
    });
  });

  it("sends the asserted facts so a refusal stays explicable afterwards", async () => {
    const { store, rpc } = persistenceReturning({ outcome: "already_claimed" });

    await store.claim({
      organizationId: ORGANIZATION_ID,
      actionRunId: ACTION_RUN_ID,
      capabilityKey: "publish_instagram",
      assertedFacts: { credentialHealthy: false, trackingReady: true, consentWithdrawn: true },
      leaseSeconds: 300,
    });

    const [, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(args.input_claim.asserted_facts).toEqual({
      credential_healthy: false,
      tracking_ready: true,
      consent_withdrawn: true,
    });
  });

  it("sends normalized fields and a digest, never a raw payload", async () => {
    const { store, rpc } = persistenceReturning(RECEIPT_ID);

    await store.complete({
      organizationId: ORGANIZATION_ID,
      actionRunId: ACTION_RUN_ID,
      claimToken: CLAIM_TOKEN,
      invocationId: INVOCATION_ID,
      receipt: SUCCESS,
    });

    const [, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(args.input_completion).not.toHaveProperty("raw_response");
    expect(args.input_completion.payload_digest).toBe("c".repeat(64));
  });

  it("reports one safe message when a claim is refused by the database", async () => {
    const { store } = persistenceReturning(null, { code: "42501" });

    await expect(
      store.claim({
        organizationId: ORGANIZATION_ID,
        actionRunId: ACTION_RUN_ID,
        capabilityKey: "publish_instagram",
        assertedFacts: { credentialHealthy: true, trackingReady: true, consentWithdrawn: false },
        leaseSeconds: 300,
      }),
    ).rejects.toThrow(/could not be claimed or recorded/);
  });

  it("refuses a claim response that does not match the contract", async () => {
    const { store } = persistenceReturning({ outcome: "something_else" });

    await expect(
      store.claim({
        organizationId: ORGANIZATION_ID,
        actionRunId: ACTION_RUN_ID,
        capabilityKey: "publish_instagram",
        assertedFacts: { credentialHealthy: true, trackingReady: true, consentWithdrawn: false },
        leaseSeconds: 300,
      }),
    ).rejects.toThrow();
  });
});
