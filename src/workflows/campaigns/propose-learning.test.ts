import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  runProposeLearning,
  type ProposeLearningDependencies,
} from "@/workflows/campaigns/propose-learning";
import type { ProposeLearningResult } from "@/modules/campaigns/application/learning-service";

function proposed(): ProposeLearningResult {
  return { result: "proposed", proposalId: "p1" };
}

function deps(overrides: Partial<ProposeLearningDependencies> = {}) {
  const listSettledCampaigns = vi.fn(async () => ["c1", "c2"]);
  const propose = vi.fn(
    async ({ campaignId }: { campaignId: string }): Promise<ProposeLearningResult> =>
      campaignId === "c1"
        ? proposed()
        : { result: "refused", reasonCode: "campaign_has_no_settled_outcome" },
  );
  const emitLearningProposed = vi.fn(async () => {});

  const built: ProposeLearningDependencies = {
    listSettledCampaigns,
    propose,
    emitLearningProposed,
    isCancelled: () => false,
    ...overrides,
  };
  return { built, listSettledCampaigns, propose, emitLearningProposed };
}

describe("runProposeLearning", () => {
  it("proposes one lesson per settled campaign, independently", async () => {
    const { built, listSettledCampaigns, propose } = deps();
    const result = await runProposeLearning(
      { organizationId: "org1" },
      built,
      new AbortController().signal,
    );

    expect(listSettledCampaigns).toHaveBeenCalledWith({ organizationId: "org1" });
    expect(propose).toHaveBeenCalledTimes(2);
    expect(propose).toHaveBeenNthCalledWith(1, { organizationId: "org1", campaignId: "c1" });
    expect(result.considered).toBe(2);
    expect(result.proposed).toBe(1);
  });

  it("emits learning_proposed only for a newly written proposal", async () => {
    const { built, emitLearningProposed } = deps();
    await runProposeLearning({ organizationId: "org1" }, built, new AbortController().signal);

    expect(emitLearningProposed).toHaveBeenCalledTimes(1);
    expect(emitLearningProposed).toHaveBeenCalledWith({
      organizationId: "org1",
      campaignId: "c1",
      proposalId: "p1",
    });
  });

  it("refuses to propose for a campaign with no settled outcome", async () => {
    const propose = vi.fn(
      async (): Promise<ProposeLearningResult> => ({
        result: "failed",
        failureCode: "campaign_has_no_settled_outcome",
      }),
    );
    const { built, emitLearningProposed } = deps({ propose });

    const result = await runProposeLearning(
      { organizationId: "org1" },
      built,
      new AbortController().signal,
    );

    expect(result.proposed).toBe(0);
    expect(emitLearningProposed).not.toHaveBeenCalled();
  });

  it("does not emit for an idempotent replay", async () => {
    const { built, emitLearningProposed } = deps({
      propose: vi.fn(async () => ({ result: "unchanged" as const, proposalId: "p1" })),
    });
    await runProposeLearning({ organizationId: "org1" }, built, new AbortController().signal);

    expect(emitLearningProposed).not.toHaveBeenCalled();
  });

  it("stops at the cancellation fence", async () => {
    const propose = vi.fn();
    const { built } = deps({ propose, isCancelled: () => true });
    const result = await runProposeLearning(
      { organizationId: "org1" },
      built,
      new AbortController().signal,
    );
    expect(propose).not.toHaveBeenCalled();
    expect(result.proposed).toBe(0);
  });
});

/**
 * The learning write wall, asserted at the source level.
 *
 * A learning job's only write is a proposal row (ADR 0013). None of the write
 * path may name a live-behavior table — brand policy, playbook, recipe,
 * threshold, or artifact versions — so no future edit can grow a write path to
 * live behavior without failing here first.
 */
describe("the learning write wall", () => {
  const sources = [
    "src/modules/campaigns/application/learning-service.ts",
    "src/modules/campaigns/infrastructure/learning-repository.ts",
    "src/workflows/campaigns/propose-learning.ts",
  ];

  it.each(sources)("modifies nothing but a proposal row in %s", (file) => {
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(text).not.toMatch(/artifact_versions/);
    expect(text).not.toMatch(/artifact_promotions/);
    expect(text).not.toMatch(/business_facts/);
    expect(text).not.toMatch(/playbook/);
    expect(text).not.toMatch(/brand_/);
    expect(text).not.toMatch(/\brecipe\b/);
    expect(text).not.toMatch(/\bthreshold/);
    expect(text).not.toMatch(/campaign_approvals/);
  });
});

/**
 * No auto-promotion exists, asserted at the source level.
 *
 * Promotion is a separate governed decision under ADR 0013. Nothing in the
 * learning service, workflow, route, or UI may call a promotion path — the
 * decision route records a human's choice, and the UI's "submit" sets a status
 * and a target artifact type, never a promotion.
 */
describe("no auto-promotion", () => {
  const sources = [
    "src/modules/campaigns/application/learning-service.ts",
    "src/modules/campaigns/infrastructure/learning-repository.ts",
    "src/workflows/campaigns/propose-learning.ts",
    "src/app/api/organizations/[organizationId]/campaigns/[campaignId]/learning/[proposalId]/decision/route.ts",
    "src/components/campaigns/learning-review.tsx",
  ];

  it.each(sources)("never calls a promotion path in %s", (file) => {
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(text).not.toMatch(/artifact_promotions/);
    expect(text).not.toMatch(/artifact_versions/);
    expect(text).not.toMatch(/promote_/);
  });
});
