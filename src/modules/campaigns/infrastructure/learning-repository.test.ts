import { describe, expect, it, vi } from "vitest";

import {
  createLearningRepository,
  type LearningPersistence,
} from "@/modules/campaigns/infrastructure/learning-repository";

function makePersistence() {
  const rpc = vi.fn();
  return { persistence: { rpc } as unknown as LearningPersistence, rpc };
}

const OUTCOME_ID = "10000000-0000-4000-8000-000000000001";
const BUNDLE_ID = "20000000-0000-4000-8000-000000000002";

const CONTEXT = {
  outcome_id: OUTCOME_ID,
  bundle_version_id: BUNDLE_ID,
  bundle_digest: "a".repeat(64),
  policy_version_ids: ["40000000-0000-4000-8000-000000000005"],
  variant_ids: ["30000000-0000-4000-8000-000000000003"],
  planned_exposure_count: "6",
  realized_exposure_count: 4,
  verdict: "inconclusive",
  evidence_tier: null,
  primary_metric_key: "margin.contribution",
  attribution_method: "observational_prepost",
  outcome_window_days: 14,
  settlement_delay_days: 3,
  baseline_source: "goal_baseline_measured:margin.contribution",
  baseline_lookback_days: 28,
  estimate_minor: null,
  estimate_currency: null,
  limitations: ["The preregistered evidence bar was not met."],
  settled_at: "2026-08-20T00:00:00.000Z",
};

describe("createLearningRepository", () => {
  it("reads the learning context and coerces numeric strings", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({ data: CONTEXT, error: null });

    const repo = createLearningRepository(persistence);
    const context = await repo.readContext("org1", "camp1");

    expect(rpc).toHaveBeenCalledWith("read_campaign_learning_context", {
      target_organization_id: "org1",
      target_campaign_id: "camp1",
    });
    expect(context).toMatchObject({
      organizationId: "org1",
      campaignId: "camp1",
      outcomeId: OUTCOME_ID,
      bundleVersionId: BUNDLE_ID,
      bundleDigest: "a".repeat(64),
      policyVersionIds: ["40000000-0000-4000-8000-000000000005"],
      variantIds: ["30000000-0000-4000-8000-000000000003"],
      plannedExposureCount: 6,
      realizedExposureCount: 4,
      verdict: "inconclusive",
    });
  });

  it("returns null, not an error, when the campaign has no settled outcome", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "campaign_has_no_settled_outcome", message: "not settled" },
    });

    const repo = createLearningRepository(persistence);
    await expect(repo.readContext("org1", "camp1")).resolves.toBeNull();
  });

  it("throws on any other read failure rather than inventing a context", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "something_else", message: "no" } });

    const repo = createLearningRepository(persistence);
    await expect(repo.readContext("org1", "camp1")).rejects.toThrow();
  });

  it("writes a proposal through the worker-only RPC and parses the result", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({
      data: { outcome: "proposed", proposal_id: "50000000-0000-4000-8000-000000000005" },
      error: null,
    });

    const repo = createLearningRepository(persistence);
    const result = await repo.writeProposal({
      organizationId: "org1",
      campaignId: "camp1",
      variantIds: ["30000000-0000-4000-8000-000000000003"],
      hypothesis: "hypothesis text",
      observation: "observation text",
      proposedLesson: "lesson text",
      suggestedNextTest: "next test",
      evidenceLinks: [{ kind: "outcome", id: OUTCOME_ID }],
    });

    expect(result).toEqual({
      result: "proposed",
      proposalId: "50000000-0000-4000-8000-000000000005",
    });
    expect(rpc).toHaveBeenCalledWith("propose_campaign_learning", {
      target_organization_id: "org1",
      input_proposal: expect.objectContaining({
        organization_id: "org1",
        campaign_id: "camp1",
        hypothesis: "hypothesis text",
        observation: "observation text",
        proposed_lesson: "lesson text",
      }),
    });
  });

  it("surfaces an RPC refusal with its reason code", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "campaign_learning_already_proposed", message: "already proposed" },
    });

    const repo = createLearningRepository(persistence);
    const result = await repo.writeProposal({
      organizationId: "org1",
      campaignId: "camp1",
      variantIds: [],
      hypothesis: "h",
      observation: "o",
      proposedLesson: "l",
      suggestedNextTest: "n",
      evidenceLinks: [],
    });

    expect(result).toEqual({
      result: "refused",
      reasonCode: "campaign_learning_already_proposed",
    });
  });
});
