import { describe, expect, it, vi } from "vitest";

import {
  createResearchService,
  ResearchClaimLost,
  type ResearchServiceDependencies,
} from "@/modules/campaigns/application/research-service";

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";
const RUN_ID = "fb430000-0000-4000-8000-000000000202";
const PROPOSAL_ID = "fb430000-0000-4000-8000-000000000203";
const MANIFEST_ID = "fb430000-0000-4000-8000-000000000204";
const DIGEST = "c".repeat(64);
const CLAIM = "fb430000-0000-4000-8000-000000000205";
const NOW = new Date("2026-09-13T12:00:00.000Z");

function readyPlan() {
  return {
    outcome: "ready" as const,
    document: { title: "draft" },
    marketClaimKeys: [],
    sourceRevisionManifest: { alternatives: [] },
    memoryContextManifestId: MANIFEST_ID,
    modelId: "research-draft@1",
    modelCostMinor: 12,
  };
}

function testContext() {
  return {
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
  } as never;
}

function dependencies(
  overrides: Partial<ResearchServiceDependencies> = {},
): ResearchServiceDependencies {
  return {
    runs: {
      claim: async () => ({ runId: RUN_ID, claimToken: CLAIM, policyVersion: 3, budgetMinor: 1000 }),
      assertClaimLive: async () => {},
      listLeaseExpiries: async () => [],
      reclaimLeases: async () => ({ reclaimed: 0, abandoned: 0 }),
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
      saveDerivedQuestion: async () => ({ outcome: "saved" as const }),
    },
    contexts: { read: async () => testContext() },
    planner: { plan: async () => readyPlan() as never },
    proposals: {
      request: async () => ({ status: "saved" as const, value: { proposalId: PROPOSAL_ID } }),
      requestRevision: async () => ({
        status: "saved" as const,
        value: { proposalVersionId: "v", version: 1, digest: DIGEST },
      }),
    } as never,
    subjectPack: { consume: async () => {} },
    now: () => NOW,
    nowIso: () => NOW.toISOString(),
    isCancelled: () => false,
    ...overrides,
  };
}

function runInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    evidenceMaxAgeDays: 30,
    ...overrides,
  };
}

describe("research service", () => {
  it("completes a run with the prepared proposal and measured cost", async () => {
    const complete = vi.fn();
    const service = createResearchService(
      dependencies({ runs: { ...dependencies().runs, complete } }),
    );
    const result = await service.run(runInput({ externalCostMinor: 100 }));
    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      proposalId: PROPOSAL_ID,
      outcome: "proposal_prepared",
    });
    // Measured external spend plus measured model cost, never estimated.
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostMinor: 112, outcome: "proposal_prepared" }),
    );
  });

  it("stops when another worker holds the run", async () => {
    const service = createResearchService(
      dependencies({ runs: { ...dependencies().runs, claim: async () => ({ outcome: "already_claimed" as const }) } }),
    );
    await expect(service.run(runInput())).resolves.toEqual({
      status: "already_claimed",
      runId: RUN_ID,
    });
  });

  it("fails before billable work when the policy moved on", async () => {
    const fail = vi.fn();
    const plan = vi.fn();
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
          fail,
          load: async () => ({
            status: "claimed",
            triggerKind: "manual_request",
            policyVersion: 3,
            budgetMinor: 1000,
            researchQuestion: "weekday lunch decline",
            currentPolicyVersion: 4,
            manifestId: MANIFEST_ID,
            digest: DIGEST,
            entries: [],
          }),
        },
        planner: { plan },
      }),
    );
    await expect(service.run(runInput())).resolves.toEqual({
      status: "failed",
      runId: RUN_ID,
      failureCode: "policy_revised",
    });
    expect(plan).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "policy_revised" }));
  });

  it("cancels when asked before planning, keeping history", async () => {
    const cancel = vi.fn();
    const plan = vi.fn();
    const service = createResearchService(
      dependencies({
        runs: { ...dependencies().runs, cancel },
        planner: { plan },
        isCancelled: () => true,
      }),
    );
    await expect(service.run(runInput())).resolves.toEqual({ status: "cancelled", runId: RUN_ID });
    expect(plan).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("completes advice without opening a proposal", async () => {
    const request = vi.fn();
    const complete = vi.fn();
    const service = createResearchService(
      dependencies({
        proposals: {
          request,
          requestRevision: async () => {
            throw new Error("must not persist advice");
          },
        } as never,
        planner: { plan: async () => ({ outcome: "advice", advice: "Fix the kitchen first.", modelCostMinor: null }) } as never,
        runs: { ...dependencies().runs, complete },
      }),
    );
    const result = await service.run(runInput());
    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      proposalId: null,
      outcome: "advice_only",
    });
    expect(request).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ outcome: "advice_only" }));
  });

  it("fails the run when the draft cannot be admitted", async () => {
    const fail = vi.fn();
    const service = createResearchService(
      dependencies({
        planner: { plan: async () => ({ outcome: "refused", reasonCode: "draft_unparseable" }) } as never,
        runs: { ...dependencies().runs, fail },
      }),
    );
    await expect(service.run(runInput())).resolves.toEqual({
      status: "failed",
      runId: RUN_ID,
      failureCode: "proposal_inadmissible",
    });
  });

  it("fails the run when the proposal writer refuses a decided proposal", async () => {
    const fail = vi.fn();
    const service = createResearchService(
      dependencies({
        proposals: {
          request: async () => ({ status: "saved" as const, value: { proposalId: PROPOSAL_ID } }),
          requestRevision: async () => ({ status: "conflict" as const }),
        } as never,
        runs: { ...dependencies().runs, fail },
      }),
    );
    const result = await service.run(runInput());
    expect(result).toEqual({
      status: "failed",
      runId: RUN_ID,
      failureCode: "proposal_inadmissible",
    });
    // Nothing invented a second write path: the governed refusal stands.
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "proposal_inadmissible" }),
    );
  });

  it("throws claim-lost when the pin cannot be loaded", async () => {
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
          load: async () => {
            throw { kind: "not_found" };
          },
        },
      }),
    );
    await expect(service.run(runInput())).rejects.toBeInstanceOf(ResearchClaimLost);
  });

  it("derives when missing and continues to planning", async () => {
    const plan = vi.fn(async () => readyPlan() as never);
    const read = vi.fn(async () => testContext());
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
          load: async () => ({
            status: "claimed",
            triggerKind: "manual_request",
            policyVersion: 3,
            budgetMinor: 1000,
            researchQuestion: null,
            currentPolicyVersion: 3,
            manifestId: null,
            digest: null,
            entries: [],
          }),
        },
        questionDeriver: {
          derive: async () => ({
            question: "How do we lift weekday lunch?",
            provenance: { sourceIds: [], modelId: "test-deriver@1", derivedAt: NOW.toISOString() },
            gaps: [],
          }),
        },
        contexts: { read },
        planner: { plan },
      }),
    );
    const result = await service.run(runInput());
    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      proposalId: PROPOSAL_ID,
      outcome: "proposal_prepared",
    });
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ query: "How do we lift weekday lunch?" }),
    );
    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({ query: "How do we lift weekday lunch?" }),
    );
  });

  it("saves the derived question claim-bound before planning", async () => {
    const saveDerivedQuestion = vi.fn(async () => ({ outcome: "saved" as const }));
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
          load: async () => ({
            status: "claimed",
            triggerKind: "manual_request",
            policyVersion: 3,
            budgetMinor: 1000,
            researchQuestion: null,
            currentPolicyVersion: 3,
            manifestId: null,
            digest: null,
            entries: [],
          }),
          saveDerivedQuestion,
        },
        questionDeriver: {
          derive: async () => ({
            question: "How do we lift weekday lunch?",
            provenance: { sourceIds: ["m1"], modelId: "test-deriver@1", derivedAt: NOW.toISOString() },
            gaps: ["no evidence yet"],
          }),
        },
      }),
    );
    await service.run(runInput());
    expect(saveDerivedQuestion).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      claimToken: CLAIM,
      derivedQuestion: "How do we lift weekday lunch?",
      derivation: { sourceIds: ["m1"], modelId: "test-deriver@1", derivedAt: NOW.toISOString() },
    });
  });

  it("carries the derivation cost into the measured total", async () => {
    const complete = vi.fn();
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
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
          complete,
        },
        questionDeriver: {
          derive: async () => ({
            question: "How do we lift weekday lunch?",
            provenance: { sourceIds: [], modelId: "test-deriver@1", derivedAt: NOW.toISOString() },
            gaps: [],
          }),
        },
        derivationCostMinor: 7,
      }),
    );
    await service.run(runInput({ externalCostMinor: 100 }));
    // External spend plus derivation spend plus planner model cost.
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostMinor: 119 }),
    );
  });

  it("continues when the question is already set by a sibling delivery", async () => {
    const plan = vi.fn(async () => readyPlan() as never);
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
          load: async () => ({
            status: "claimed",
            triggerKind: "manual_request",
            policyVersion: 3,
            budgetMinor: 1000,
            researchQuestion: null,
            currentPolicyVersion: 3,
            manifestId: null,
            digest: null,
            entries: [],
          }),
          saveDerivedQuestion: async () => ({ outcome: "already_set" as const }),
        },
        questionDeriver: {
          derive: async () => ({
            question: "How do we lift weekday lunch?",
            provenance: { sourceIds: [], modelId: "test-deriver@1", derivedAt: NOW.toISOString() },
            gaps: [],
          }),
        },
        planner: { plan },
      }),
    );
    const result = await service.run(runInput());
    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      proposalId: PROPOSAL_ID,
      outcome: "proposal_prepared",
    });
    expect(plan).toHaveBeenCalled();
  });

  it("falls back to the standing manual question when no deriver is wired", async () => {
    const read = vi.fn(async () => testContext());
    const saveDerivedQuestion = vi.fn(async () => ({ outcome: "saved" as const }));
    const complete = vi.fn();
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
          load: async () => ({
            status: "claimed",
            triggerKind: "manual_request",
            policyVersion: 3,
            budgetMinor: 1000,
            researchQuestion: null,
            currentPolicyVersion: 3,
            manifestId: null,
            digest: null,
            entries: [],
          }),
          saveDerivedQuestion,
          complete,
        },
        contexts: { read },
      }),
    );
    const result = await service.run(runInput({ externalCostMinor: 100 }));
    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      proposalId: PROPOSAL_ID,
      outcome: "proposal_prepared",
    });
    expect(saveDerivedQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ derivedQuestion: "What campaign should we run next?" }),
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ query: "What campaign should we run next?" }),
    );
    // The fallback asks nothing of a model, so it adds no derivation cost.
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostMinor: 112 }),
    );
  });

  it("throws claim-lost when the derived save finds the claim gone", async () => {
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
          load: async () => ({
            status: "claimed",
            triggerKind: "manual_request",
            policyVersion: 3,
            budgetMinor: 1000,
            researchQuestion: null,
            currentPolicyVersion: 3,
            manifestId: null,
            digest: null,
            entries: [],
          }),
          saveDerivedQuestion: async () => {
            throw { kind: "not_found" };
          },
        },
        questionDeriver: {
          derive: async () => ({
            question: "How do we lift weekday lunch?",
            provenance: { sourceIds: [], modelId: "test-deriver@1", derivedAt: NOW.toISOString() },
            gaps: [],
          }),
        },
      }),
    );
    await expect(service.run(runInput())).rejects.toBeInstanceOf(ResearchClaimLost);
  });

  it("hands the admitted pin to context instead of re-deriving it", async () => {
    const read = vi.fn(async () => testContext());
    const service = createResearchService(dependencies({ contexts: { read } }));
    await service.run(runInput());
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        pinned: expect.objectContaining({ manifestId: MANIFEST_ID, digest: DIGEST }),
      }),
    );
  });

  it("throws claim-lost instead of retrying landed work", async () => {
    const service = createResearchService(
      dependencies({
        runs: {
          ...dependencies().runs,
          complete: async () => {
            throw { kind: "not_found" };
          },
        },
      }),
    );
    await expect(service.run(runInput())).rejects.toBeInstanceOf(ResearchClaimLost);
  });

  it("fails the run when the manifest cannot be consumed", async () => {
    const fail = vi.fn();
    const service = createResearchService(
      dependencies({
        subjectPack: {
          consume: async () => {
            throw new Error("pin store down");
          },
        },
        runs: { ...dependencies().runs, fail },
      }),
    );
    await expect(service.run(runInput())).resolves.toEqual({
      status: "failed",
      runId: RUN_ID,
      failureCode: "context_consume_failed",
    });
  });
});
