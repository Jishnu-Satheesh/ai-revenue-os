import { describe, expect, it, vi } from "vitest";

import { reconcileUnknownInvocation } from "@/modules/integrations/application/reconcile-unknown";

const DEFINITION = {
  method: "GET" as const,
  pathTemplate: "objects/by-idempotency/{idempotency_key}",
  lookupInputs: [
    {
      key: "idempotency_key",
      source: "request" as const,
      valueReference: "request.idempotency_key",
    },
  ],
  resultIdentityField: "id",
};

const EVIDENCE = { "request.idempotency_key": "abc-123" };

function reconcile(
  result: unknown,
  overrides: { evidence?: Record<string, string>; absentStatuses?: number[] } = {},
) {
  return reconcileUnknownInvocation({
    definition: DEFINITION,
    evidence: overrides.evidence ?? EVIDENCE,
    absentStatuses: overrides.absentStatuses ?? [404],
    client: { request: vi.fn(async () => result) } as never,
    signal: new AbortController().signal,
  });
}

describe("a definite yes confirms the write", () => {
  it("returns the provider's identifier as the external reference", async () => {
    const finding = await reconcile({
      outcome: "succeeded",
      data: { id: "17841_999", status: "PUBLISHED" },
    });

    expect(finding).toEqual({
      finding: "confirmed",
      externalReference: "17841_999",
      providerStatus: "PUBLISHED",
    });
  });

  it("confirms without a status when the provider reports none", async () => {
    const finding = await reconcile({ outcome: "succeeded", data: { id: "17841_999" } });

    expect(finding).toMatchObject({ finding: "confirmed", providerStatus: null });
  });
});

describe("only a definite no releases a retry", () => {
  it("reports absent for a status the contract documents as not-found", async () => {
    const finding = await reconcile({
      outcome: "failed",
      status: 404,
      failureCode: "meta.404",
      retryable: false,
    });

    expect(finding).toEqual({ finding: "absent" });
  });

  it("stays unknown for any other failure status", async () => {
    // A 500 says the provider had a problem, not that the post is missing.
    // Reading it as absence would republish something that already went out.
    const finding = await reconcile({
      outcome: "failed",
      status: 500,
      failureCode: "meta.500",
      retryable: false,
    });

    expect(finding).toMatchObject({ finding: "still_unknown", reason: "meta.500" });
  });

  it("stays unknown when the lookup itself times out", async () => {
    const finding = await reconcile({ outcome: "unknown", reason: "timeout" });

    expect(finding).toMatchObject({ finding: "still_unknown", reason: "lookup_timeout" });
  });

  it("stays unknown when the lookup cannot even be built", async () => {
    const finding = await reconcile({ outcome: "succeeded", data: { id: "x" } }, { evidence: {} });

    expect(finding).toMatchObject({ finding: "still_unknown" });
    if (finding.finding !== "still_unknown") throw new Error("expected unknown");
    expect(finding.reason).toContain("lookup_impossible");
  });

  it("does not call the provider when the lookup is impossible", async () => {
    const request = vi.fn();
    await reconcileUnknownInvocation({
      definition: DEFINITION,
      evidence: {},
      absentStatuses: [404],
      client: { request } as never,
      signal: new AbortController().signal,
    });

    expect(request).not.toHaveBeenCalled();
  });

  it("stays unknown when the answer carries no identity", async () => {
    // A 200 without the field the contract names is not proof of anything.
    const finding = await reconcile({ outcome: "succeeded", data: { id: "" } });

    expect(finding).toMatchObject({
      finding: "still_unknown",
      reason: "lookup_identity_missing",
    });
  });

  it("treats an empty absent-status list as never proving absence", async () => {
    // A contract that documents no not-found status cannot release a retry,
    // which is the fail-closed reading of an unproven contract.
    const finding = await reconcile(
      { outcome: "failed", status: 404, failureCode: "meta.404", retryable: false },
      { absentStatuses: [] },
    );

    expect(finding).toMatchObject({ finding: "still_unknown" });
  });
});
