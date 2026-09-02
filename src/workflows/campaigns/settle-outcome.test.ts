import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  runSettleOutcome,
  type SettleOutcomeDependencies,
} from "@/workflows/campaigns/settle-outcome";
import type { SettleCampaignResult } from "@/modules/campaigns/application/measurement-service";

type SettledResult = Extract<SettleCampaignResult, { result: "settled" }>;

function settled(): SettledResult {
  return {
    result: "settled",
    outcome: {
      verdict: "inconclusive",
      evidenceTier: null,
      estimate: null,
      limitations: ["The preregistered evidence bar was not met."],
    },
    write: { result: "recorded", outcomeId: "o1" },
  };
}

function deps(overrides: Partial<SettleOutcomeDependencies> = {}) {
  const listDueCampaigns = vi.fn(async () => ["c1", "c2"]);
  const settle = vi.fn(
    async ({ campaignId }: { campaignId: string }): Promise<SettleCampaignResult> =>
      campaignId === "c1"
        ? settled()
        : { result: "not_ready", eligibleAt: "2026-09-01T00:00:00.000Z" },
  );
  const emitOutcomeSettled = vi.fn(async () => {});

  const built: SettleOutcomeDependencies = {
    listDueCampaigns,
    settle,
    emitOutcomeSettled,
    isCancelled: () => false,
    ...overrides,
  };
  return { built, listDueCampaigns, settle, emitOutcomeSettled };
}

describe("runSettleOutcome", () => {
  it("settles each due campaign independently", async () => {
    const { built, listDueCampaigns, settle } = deps();
    const result = await runSettleOutcome(
      { organizationId: "org1" },
      built,
      new AbortController().signal,
    );

    expect(listDueCampaigns).toHaveBeenCalledWith({ organizationId: "org1" });
    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenNthCalledWith(1, { organizationId: "org1", campaignId: "c1" });
    expect(result.considered).toBe(2);
    expect(result.settled).toBe(1);
  });

  it("emits outcome_settled only for campaigns that actually settled", async () => {
    const { built, emitOutcomeSettled } = deps();
    await runSettleOutcome({ organizationId: "org1" }, built, new AbortController().signal);

    expect(emitOutcomeSettled).toHaveBeenCalledTimes(1);
    expect(emitOutcomeSettled).toHaveBeenCalledWith({
      organizationId: "org1",
      campaignId: "c1",
      verdict: "inconclusive",
    });
  });

  it("does not emit for an unchanged replay", async () => {
    const { built, emitOutcomeSettled } = deps({
      settle: vi.fn(async () => ({
        result: "settled" as const,
        outcome: settled().outcome,
        write: { result: "unchanged" as const, outcomeId: "o1" },
      })),
    });
    await runSettleOutcome({ organizationId: "org1" }, built, new AbortController().signal);

    expect(emitOutcomeSettled).not.toHaveBeenCalled();
  });

  it("stops at the cancellation fence", async () => {
    const settle = vi.fn();
    const { built } = deps({ settle, isCancelled: () => true });
    const result = await runSettleOutcome(
      { organizationId: "org1" },
      built,
      new AbortController().signal,
    );
    expect(settle).not.toHaveBeenCalled();
    expect(result.settled).toBe(0);
  });
});

/**
 * The wall, asserted at the source level in the evidence direction.
 *
 * The evidence loop may reconstruct exposure from receipts and allocation
 * pauses, and it may evaluate the money guardrail from spend. It may never read
 * engagement diagnostics (`delivery.impressions`, `delivery.clicks`) as
 * evidence for a verdict — those are the fast loop's inputs, not the slow
 * loop's proof. Proving the sources never even name them means no future edit
 * can grow a path that uses engagement as a verdict without failing here first.
 */
describe("the evidence loop wall", () => {
  const sources = [
    "src/domain/campaigns/measurement.ts",
    "src/modules/campaigns/application/measurement-service.ts",
    "src/modules/campaigns/infrastructure/measurement-repository.ts",
    "src/workflows/campaigns/settle-outcome.ts",
  ];

  it.each(sources)("never reads engagement diagnostics as evidence in %s", (file) => {
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(text).not.toMatch(/delivery\.impressions/);
    expect(text).not.toMatch(/delivery\.clicks/);
  });
});
