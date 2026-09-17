import { describe, expect, it, vi } from "vitest";

import { createResearchDueReader } from "@/modules/campaigns/infrastructure/research-due-reader";
import type { ResearchPersistence } from "@/modules/campaigns/infrastructure/research-policy-repository";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "11111111-1111-4111-8111-111111111111";

function client(
  data: unknown,
  error: { code?: string; message?: string } | null = null,
): ResearchPersistence & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data, error };
    }),
  };
}

const EVALUATION = {
  organizationId: ORG,
  evidenceFingerprint: "memory:abc",
  candidateRevision: "rev-1",
  requestDigest: "d".repeat(64),
  idempotencyKey: "schedule-key-1",
};

describe("the scheduler's due reader", () => {
  it("lists due organizations, repeating the tenant set the database returned", async () => {
    const rpc = client(["org-a", "org-b"]);

    const due = await createResearchDueReader(rpc).listDueOrganizations();

    expect(due).toEqual(["org-a", "org-b"]);
    expect(rpc.calls).toEqual([
      { name: "list_campaign_research_due_organizations", args: {} },
    ]);
  });

  it("reads nothing when the list contract is unrecognised", async () => {
    const rpc = client({ unexpected: "shape" });

    // Sweeping nothing is the safe reading of an answer the sweep does not
    // understand — it must not invent tenants to evaluate.
    expect(await createResearchDueReader(rpc).listDueOrganizations()).toEqual([]);
  });

  it("evaluates one window through the governed writer, tenant-scoped", async () => {
    const rpc = client({
      outcome: "admitted",
      run_id: RUN,
      policy_version: 3,
      evidence_max_age_days: 30,
      budget_minor: 5000,
      allowance_currency: "AED",
    });

    const result = await createResearchDueReader(rpc).evaluateDue(EVALUATION);

    expect(result).toMatchObject({
      outcome: "admitted",
      runId: RUN,
      policyVersion: 3,
      evidenceMaxAgeDays: 30,
    });
    expect(rpc.calls[0]?.name).toBe("evaluate_campaign_research_schedule_due");
    expect(rpc.calls[0]?.args.target_organization_id).toBe(ORG);
  });

  it("carries no-warrant and refused outcomes without inventing a run", async () => {
    for (const outcome of ["already_evaluated", "no_qualifying_change", "not_due"] as const) {
      const rpc = client({ outcome });
      const result = await createResearchDueReader(rpc).evaluateDue(EVALUATION);

      expect(result.outcome).toBe(outcome);
      expect(result.runId).toBeNull();
    }

    const rpc = client({ outcome: "refused", reason: "allowance_exceeded" });
    const refused = await createResearchDueReader(rpc).evaluateDue(EVALUATION);
    expect(refused).toMatchObject({ outcome: "refused", reason: "allowance_exceeded" });
  });

  it("maps a denied tenant to forbidden rather than a guess", async () => {
    const rpc = client(null, { code: "42501", message: "permission denied" });

    await expect(createResearchDueReader(rpc).listDueOrganizations()).rejects.toMatchObject({
      kind: "forbidden",
    });
    await expect(createResearchDueReader(rpc).evaluateDue(EVALUATION)).rejects.toMatchObject({
      kind: "forbidden",
    });
  });

  it("parses a sparse verdict with nulls rather than guessing", async () => {
    const rpc = client({ outcome: "admitted" });

    // Missing fields read as null, never as invented values. An admitted
    // verdict without a run id still parses — and the scheduler refuses to
    // dispatch it, because a worker cannot be asked for a run nobody named.
    const result = await createResearchDueReader(rpc).evaluateDue(EVALUATION);
    expect(result).toMatchObject({ outcome: "admitted", runId: null });
  });
});
