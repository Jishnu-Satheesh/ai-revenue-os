import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSynthesisRepository,
  type SynthesisPersistence,
} from "@/modules/growth-intelligence/infrastructure/synthesis-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const claimToken = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const actorId = "50000000-0000-4000-8000-000000000005";
const correlationId = "60000000-0000-4000-8000-000000000006";
const itemId = "90000000-0000-4000-8000-000000000009";

const metadata = {
  provider: "synthesis-test",
  modelVersion: null,
  runFingerprint: "f".repeat(64),
  correlationId,
};

const item = {
  kind: "insight" as const,
  narrative: "Recorded dinner demand clusters across Dubai this month.",
  itemFingerprint: "1".repeat(64),
  evidenceFingerprint: "2".repeat(64),
  branchId: "30000000-0000-4000-8000-000000000030",
  geographicLayer: "city" as const,
  geographyRef: "ae:du",
  supportGrade: "corroborated" as const,
  freshness: "current" as const,
  urgency: "high" as const,
  goalAlignment: "direct" as const,
  activityMonth: "2026-08",
  missingInput: null,
  claimIds: ["91000000-0000-4000-8000-000000000091"],
  findings: [{ id: "92000000-0000-4000-8000-000000000092", digest: "c".repeat(64) }],
  goals: [{ ref: "cover-more-occasions", alignment: "direct" as const }],
};

function persistence(overrides: Partial<Record<string, unknown>> = {}) {
  const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    if (name === "begin_growth_intelligence_synthesis") {
      return { data: { runId, status: "running", replayed: false }, error: null };
    }
    if (name === "complete_growth_intelligence_synthesis") {
      return {
        data: { runId, status: "completed", itemCount: 1, supersededItemIds: [] as string[] },
        error: null,
      };
    }
    if (name === "fail_growth_intelligence_synthesis") {
      return { data: { runId, status: "failed" }, error: null };
    }
    if (name === "decide_growth_intelligence_item") {
      return {
        data: { decisionId: "93000000-0000-4000-8000-000000000093", decision: "acknowledged" },
        error: null,
      };
    }
    if (name === "set_growth_intelligence_preference") {
      return { data: { sourceKind: "synthesis_item", pinned: true }, error: null };
    }
    if (name === "record_growth_intelligence_item_feedback") {
      return { data: null, error: null };
    }
    return { data: null, error: new Error(`unexpected call ${name}`) };
  });
  return { persistence: { rpc } as unknown as SynthesisPersistence, rpc, ...overrides };
}

describe("Synthesis repository", () => {
  it("sends only compact validated items through the fenced RPC", async () => {
    const db = persistence();

    const result = await createSynthesisRepository(db.persistence).complete({
      organizationId,
      requestId,
      claimToken,
      runId,
      result: { outcome: "completed", resultDigest: "b".repeat(64), items: [item] },
    });

    expect(result).toEqual({ runId, status: "completed", itemCount: 1, supersededItemIds: [] });
    expect(db.rpc).toHaveBeenCalledWith(
      "complete_growth_intelligence_synthesis",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_request_id: requestId,
        p_claim_token: claimToken,
        p_synthesis_run_id: runId,
      }),
    );
    const sent = db.rpc.mock.calls[0]![1] as { p_result: { items: unknown[] } };
    expect(sent.p_result.items).toHaveLength(1);
    const serialized = JSON.stringify(sent.p_result);
    expect(serialized).not.toContain("paraphrase");
    expect(serialized).not.toContain("quotation");
  });

  it("replays duplicate completions without erasing stored findings", async () => {
    const db = persistence();
    db.rpc.mockResolvedValueOnce({
      data: { runId, status: "completed", itemCount: 0, supersededItemIds: [] },
      error: null,
    });

    const result = await createSynthesisRepository(db.persistence).complete({
      organizationId,
      requestId,
      claimToken,
      runId,
      result: { outcome: "completed", resultDigest: "b".repeat(64), items: [] },
    });

    expect(result).toEqual({ runId, status: "completed", itemCount: 0, supersededItemIds: [] });
  });

  it("maps committed superseded ids as a strict uuid array", async () => {
    const db = persistence();
    const supersededItemId = "91000000-0000-4000-8000-000000000091";
    db.rpc.mockResolvedValueOnce({
      data: {
        runId,
        status: "completed",
        itemCount: 1,
        supersededItemIds: [supersededItemId],
      },
      error: null,
    });

    const result = await createSynthesisRepository(db.persistence).complete({
      organizationId,
      requestId,
      claimToken,
      runId,
      result: { outcome: "completed", resultDigest: "b".repeat(64), items: [item] },
    });

    expect(result.supersededItemIds).toEqual([supersededItemId]);

    db.rpc.mockResolvedValueOnce({
      data: { runId, status: "completed", itemCount: 1, supersededItemIds: ["not-a-uuid"] },
      error: null,
    });

    await expect(
      createSynthesisRepository(db.persistence).complete({
        organizationId,
        requestId,
        claimToken,
        runId,
        result: { outcome: "completed", resultDigest: "b".repeat(64), items: [item] },
      }),
    ).rejects.toThrow();
  });

  it("fails runs with a safe code and never invents retry semantics", async () => {
    const db = persistence();

    const result = await createSynthesisRepository(db.persistence).fail({
      organizationId,
      requestId,
      claimToken,
      runId,
      failure: { safeFailureCode: "SYNTHESIS_PROVIDER_REFUSED" },
    });

    expect(result).toEqual({ runId, status: "failed" });
    expect(db.rpc).toHaveBeenCalledWith("fail_growth_intelligence_synthesis", {
      p_organization_id: organizationId,
      p_request_id: requestId,
      p_claim_token: claimToken,
      p_synthesis_run_id: runId,
      p_safe_failure_code: "SYNTHESIS_PROVIDER_REFUSED",
    });
  });

  it("records operator triage under the fingerprint the actor saw", async () => {
    const db = persistence();

    const result = await createSynthesisRepository(db.persistence).decide({
      organizationId,
      actorId,
      itemId,
      decision: "acknowledged",
      reason: null,
      snoozedUntil: null,
      itemFingerprint: "1".repeat(64),
    });

    expect(result.decision).toBe("acknowledged");
    expect(db.rpc).toHaveBeenCalledWith(
      "decide_growth_intelligence_item",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_item_id: itemId,
        p_item_fingerprint: "1".repeat(64),
      }),
    );
  });

  it("writes actor-scoped preferences without organization policy", async () => {
    const db = persistence();

    const result = await createSynthesisRepository(db.persistence).setPreference({
      organizationId,
      actorId,
      sourceKind: "synthesis_item",
      sourceId: itemId,
      pinned: true,
      snoozedUntil: null,
    });

    expect(result).toEqual({ sourceKind: "synthesis_item", pinned: true });
  });

  it("records actor-scoped helpfulness through the fenced member RPC", async () => {
    const db = persistence();

    const result = await createSynthesisRepository(db.persistence).recordFeedback({
      organizationId,
      actorId,
      itemId,
      helpful: false,
    });

    expect(result).toEqual({ itemId, helpful: false });
    expect(db.rpc).toHaveBeenCalledWith("record_growth_intelligence_item_feedback", {
      p_organization_id: organizationId,
      p_item_id: itemId,
      p_helpful: false,
      p_actor_id: actorId,
    });
  });

  it("keeps a missing feedback item indistinguishable from another tenant's item", async () => {
    const repository = createSynthesisRepository({
      rpc: vi.fn(async () => ({ data: null, error: { code: "P0002", message: "not found" } })),
    });

    await expect(
      repository.recordFeedback({ organizationId, actorId, itemId, helpful: true }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it.each([
    [{ code: "42501", message: "forbidden" }, "AUTHORIZATION_ERROR"],
    [{ code: "23505", message: "stale" }, "DOMAIN_ERROR"],
    [{ code: "22023", message: "growth_intelligence_item_decision_invalid" }, "VALIDATION_ERROR"],
    [{ code: "22023", message: "growth_intelligence_item_not_found" }, "TENANT_SCOPE_ERROR"],
    [{ code: "23503", message: "fk" }, "TENANT_SCOPE_ERROR"],
  ])("maps a decide refusal %j to %s", async (error, code) => {
    const rpc = vi.fn(async () => ({ data: null, error }));
    const repository = createSynthesisRepository({ rpc } as never);

    await expect(
      repository.decide({
        organizationId,
        actorId,
        itemId,
        decision: "acknowledged",
        reason: null,
        snoozedUntil: null,
        itemFingerprint: "1".repeat(64),
      }),
    ).rejects.toMatchObject({ name: "DomainError", code });
  });

  it("maps a preference refusal to authorization without leaking internals", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "42501", message: "no" } }));
    const repository = createSynthesisRepository({ rpc } as never);

    await expect(
      repository.setPreference({
        organizationId,
        actorId,
        sourceKind: "synthesis_item",
        sourceId: itemId,
        pinned: true,
        snoozedUntil: null,
      }),
    ).rejects.toMatchObject({ name: "DomainError", code: "AUTHORIZATION_ERROR" });
  });

  it("rejects the retired nested decision and preference wrappers before any RPC", async () => {
    const db = persistence();
    const repository = createSynthesisRepository(db.persistence);

    await expect(
      repository.decide({
        organizationId,
        actorId,
        decision: {
          itemId,
          decision: "acknowledged",
          reason: null,
          snoozedUntil: null,
          itemFingerprint: "1".repeat(64),
        },
      } as never),
    ).rejects.toThrow();
    await expect(
      repository.setPreference({
        organizationId,
        actorId,
        preference: {
          sourceKind: "synthesis_item",
          sourceId: itemId,
          pinned: true,
          snoozedUntil: null,
        },
      } as never),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and unsafe codes before any RPC", async () => {
    const db = persistence();
    const repository = createSynthesisRepository(db.persistence);

    await expect(
      repository.complete({
        organizationId,
        requestId,
        claimToken,
        runId,
        result: {
          outcome: "completed",
          resultDigest: "b".repeat(64),
          items: [{ ...item, confidence: 0.9 } as never],
        },
      }),
    ).rejects.toThrow();
    await expect(
      repository.fail({
        organizationId,
        requestId,
        claimToken,
        runId,
        failure: { safeFailureCode: "lowercase-nope" },
      }),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps persistence failures to safe domain errors", async () => {
    const db = persistence();
    db.rpc.mockResolvedValueOnce({ data: null, error: new Error("denied") });

    await expect(
      createSynthesisRepository(db.persistence).begin({
        organizationId,
        requestId,
        claimToken,
        metadata,
      }),
    ).rejects.toThrow("Synthesis could not be started.");
  });
});

const branchA = "30000000-0000-4000-8000-000000000030";

describe("branch-fenced synthesis persistence", () => {
  it("refuses items that hide their branch before any RPC", async () => {
    const db = persistence();
    const repository = createSynthesisRepository(db.persistence);
    const { branchId, ...branchless } = item;
    void branchId;

    await expect(
      repository.complete({
        organizationId,
        requestId,
        claimToken,
        runId,
        result: {
          outcome: "completed",
          resultDigest: "b".repeat(64),
          items: [branchless as never],
        },
      }),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("forwards the exact item branch for SQL scope re-validation", async () => {
    const db = persistence();

    await createSynthesisRepository(db.persistence).complete({
      organizationId,
      requestId,
      claimToken,
      runId,
      result: {
        outcome: "completed",
        resultDigest: "b".repeat(64),
        items: [{ ...item, branchId: branchA }],
      },
    });

    const sent = db.rpc.mock.calls[0]![1] as { p_result: { items: Array<{ branchId: string }> } };
    expect(sent.p_result.items).toHaveLength(1);
    expect(sent.p_result.items[0]!.branchId).toBe(branchA);
  });
});
