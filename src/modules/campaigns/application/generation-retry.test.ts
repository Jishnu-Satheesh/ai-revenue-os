import { describe, expect, it } from "vitest";

import { decideGenerationRetry } from "@/modules/campaigns/application/generation-retry";
import type { GenerationRunSnapshot } from "@/modules/campaigns/application/ports";

const SNAPSHOT = "aa000000-0000-4000-8000-000000000001";
const NEWER_SNAPSHOT = "aa000000-0000-4000-8000-000000000002";

function run(overrides: Partial<GenerationRunSnapshot> = {}): GenerationRunSnapshot {
  return {
    status: "failed",
    failureCode: "bootstrap:provider_contract_expired",
    leaseExpiresAt: null,
    updatedAt: "2026-09-12T15:53:50.169Z",
    sourceSnapshotId: SNAPSHOT,
    ...overrides,
  };
}

describe("starting generation again", () => {
  it("refuses when the last attempt died on something unchanged since", () => {
    const decision = decideGenerationRetry({
      latestRun: run(),
      requestedSourceSnapshotId: SNAPSHOT,
    });

    if (decision.outcome !== "refused") throw new Error("expected a refusal");
    expect(decision.clientCopy).toMatch(/out of date/i);
    expect(decision.nextAction).toMatch(/checked again/i);
    // The stored code never reaches the person. It reaches the log.
    expect(decision.clientCopy).not.toContain("bootstrap:");
    expect(decision.blocker.repair).toEqual({
      kind: "reverify_provider_contract",
      providerKey: "meta_campaign",
    });
  });

  it("allows it once the request is against different pinned evidence", () => {
    const decision = decideGenerationRetry({
      latestRun: run(),
      requestedSourceSnapshotId: NEWER_SNAPSHOT,
    });

    expect(decision).toEqual({ outcome: "permitted", reason: "prerequisite_changed" });
  });

  it("allows it when the last failure was something a person could have fixed", () => {
    expect(
      decideGenerationRetry({
        latestRun: run({ failureCode: "needs_data:brand_voice" }),
        requestedSourceSnapshotId: SNAPSHOT,
      }),
    ).toEqual({ outcome: "permitted", reason: "retryable" });
  });

  it("does not refuse on the strength of a run that has not finished", () => {
    expect(
      decideGenerationRetry({
        latestRun: run({ status: "queued", failureCode: null }),
        requestedSourceSnapshotId: SNAPSHOT,
      }).outcome,
    ).toBe("permitted");
  });

  it("allows the first attempt a campaign has ever had", () => {
    expect(decideGenerationRetry({ latestRun: null, requestedSourceSnapshotId: SNAPSHOT })).toEqual({
      outcome: "permitted",
      reason: "no_previous_run",
    });
  });

  it("refuses a cancelled run whose evidence has since disappeared", () => {
    const decision = decideGenerationRetry({
      latestRun: run({ status: "cancelled", failureCode: "source_snapshot_missing" }),
      requestedSourceSnapshotId: SNAPSHOT,
    });

    expect(decision.outcome).toBe("refused");
  });
});
