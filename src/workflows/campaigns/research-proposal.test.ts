import { describe, expect, it, vi } from "vitest";

import { researchProposal } from "@/workflows/campaigns/research-proposal";

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";
const RUN_ID = "fb430000-0000-4000-8000-000000000202";
const PROPOSAL_ID = "fb430000-0000-4000-8000-000000000203";
const MANIFEST_ID = "fb430000-0000-4000-8000-000000000204";
const DIGEST = "c".repeat(64);
const CLAIM = "fb430000-0000-4000-8000-000000000205";
const NOW = new Date("2026-09-13T12:00:00.000Z");

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    runs: {
      claim: async () => ({ runId: RUN_ID, claimToken: CLAIM, policyVersion: 3, budgetMinor: 1000 }),
      load: async () => ({
        status: "claimed",
        triggerKind: "manual_request",
        policyVersion: 3,
        budgetMinor: 1000,
        researchQuestion: "weekday lunch decline",
        currentPolicyVersion: 3,
        manifestId: MANIFEST_ID,
        digest: DIGEST,
        entries: [],
      }),
      complete: async () => {},
      fail: async () => {},
      cancel: async () => {},
    },
    contexts: {
      read: async () => ({
        source: {
          organizationProfile: "Kitchen.",
          objectives: [],
          capacityNotes: [],
          operationalBlockers: [],
          hardConstraints: [],
        },
        memory: { manifestId: MANIFEST_ID, digest: DIGEST, entries: [], excludedCount: 0 },
        evidence: { status: "unavailable", requestId: null, reason: "no_requests", failureCode: null },
        marketingFit: "viable",
      }),
    },
    planner: {
      plan: async () => ({
        outcome: "advice",
        advice: "Fix the kitchen first.",
        modelCostMinor: null,
      }),
    },
    proposals: {
      request: async () => ({ status: "saved", value: { proposalId: PROPOSAL_ID } }),
      requestRevision: async () => ({
        status: "saved",
        value: { proposalVersionId: "v", version: 1, digest: DIGEST },
      }),
    },
    subjectPack: { consume: async () => {} },
    now: () => NOW,
    nowIso: () => NOW.toISOString(),
    isCancelled: () => false,
    ...overrides,
  } as never;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    evidenceMaxAgeDays: 30,
    preparationAllowance: { amountMinor: 500, currency: "AED" },
    ...overrides,
  };
}

function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

function deadSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

describe("research proposal worker", () => {
  it("runs the admitted run through to advice without opening a proposal", async () => {
    const result = await researchProposal(payload(), dependencies(), liveSignal());
    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      proposalId: null,
      outcome: "advice_only",
    });
  });

  it("derives a missing question and runs through to advice", async () => {
    const saveDerivedQuestion = vi.fn(async () => ({ outcome: "saved" as const }));
    const result = await researchProposal(
      payload(),
      dependencies({
        runs: {
          claim: async () => ({
            runId: RUN_ID,
            claimToken: CLAIM,
            policyVersion: 3,
            budgetMinor: 1000,
          }),
          load: async () => ({
            status: "claimed",
            triggerKind: "manual_request",
            policyVersion: 3,
            budgetMinor: 1000,
            researchQuestion: null,
            currentPolicyVersion: 3,
            manifestId: MANIFEST_ID,
            digest: DIGEST,
            entries: [],
          }),
          complete: async () => {},
          fail: async () => {},
          cancel: async () => {},
          saveDerivedQuestion,
        },
        questionDeriver: {
          derive: async () => ({
            question: "How do we lift weekday lunch?",
            provenance: { sourceIds: [], modelId: "test-deriver@1", derivedAt: NOW.toISOString() },
            gaps: [],
          }),
        },
      }),
      liveSignal(),
    );
    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      proposalId: null,
      outcome: "advice_only",
    });
    expect(saveDerivedQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ derivedQuestion: "How do we lift weekday lunch?" }),
    );
  });

  it("stands down with claim_lost when the pin cannot be loaded", async () => {
    const result = await researchProposal(
      payload(),
      dependencies({
        runs: {
          claim: async () => ({
            runId: RUN_ID,
            claimToken: CLAIM,
            policyVersion: 3,
            budgetMinor: 1000,
          }),
          load: async () => {
            throw { kind: "not_found" };
          },
          complete: async () => {},
          fail: async () => {},
          cancel: async () => {},
        },
      }),
      liveSignal(),
    );
    expect(result).toEqual({ status: "claim_lost", runId: RUN_ID });
  });

  it("cancels without claiming when the delivery is already aborted", async () => {
    const cancel = vi.fn();
    const claim = vi.fn(async () => {
      throw new Error("must not claim a dead delivery");
    });
    const result = await researchProposal(
      payload(),
      dependencies({ runs: { cancel, claim } }),
      deadSignal(),
    );
    expect(result).toEqual({ status: "cancelled", runId: RUN_ID });
    expect(cancel).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID, runId: RUN_ID });
    expect(claim).not.toHaveBeenCalled();
  });

  it("rejects a poison payload before any client exists", async () => {
    const cancel = vi.fn();
    await expect(
      researchProposal(
        // Deliberately malformed: the contract rejects it before any client.
        { organizationId: "not-a-uuid", runId: RUN_ID } as never,
        dependencies({ runs: { cancel } }),
        liveSignal(),
      ),
    ).rejects.toThrow();
    expect(cancel).not.toHaveBeenCalled();
  });
});
