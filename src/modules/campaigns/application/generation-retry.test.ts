import { describe, expect, it } from "vitest";

import {
  decideGenerationRetry,
  providerContractBlockerStillStands,
} from "@/modules/campaigns/application/generation-retry";
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

  it("allows it once the contract the last attempt died on has been reverified", () => {
    // The blocker class this whole task is about. Reverifying a provider
    // contract does not change a campaign's pinned evidence, so keying
    // "prerequisite changed" on the snapshot alone made this case unreachable:
    // the campaign would have been refused forever on a problem already fixed.
    const decision = decideGenerationRetry({
      latestRun: run(),
      requestedSourceSnapshotId: SNAPSHOT,
      blockerStillStands: () => false,
    });

    expect(decision).toEqual({ outcome: "permitted", reason: "blocker_cleared" });
  });

  it("still refuses while that contract is genuinely still out of date", () => {
    expect(
      decideGenerationRetry({
        latestRun: run(),
        requestedSourceSnapshotId: SNAPSHOT,
        blockerStillStands: () => true,
      }).outcome,
    ).toBe("refused");
  });

  it("asks the question against the real contract by default", () => {
    // Today's checked-in contract is past its review date, so the blocker
    // stands and the refusal holds -- proving the default probe is wired and
    // not a constant. R5: the date is not touched to make this pass.
    const repair = { kind: "reverify_provider_contract", providerKey: "meta_campaign" } as const;

    expect(providerContractBlockerStillStands(repair, new Date("2026-09-13T00:00:00.000Z"))).toBe(
      true,
    );
    // Inside the review window the same question answers the other way, which
    // is what makes a reverified contract release the retry.
    expect(providerContractBlockerStillStands(repair, new Date("2026-08-12T00:00:00.000Z"))).toBe(
      false,
    );
  });

  it("stays conservative about a repair it cannot observe", () => {
    // Evidence a person may or may not have supplied is not something this can
    // check, so it does not assume they did.
    expect(providerContractBlockerStillStands({ kind: "supply_campaign_evidence" })).toBe(true);
  });

  it("refuses a cancelled run whose evidence has since disappeared", () => {
    const decision = decideGenerationRetry({
      latestRun: run({ status: "cancelled", failureCode: "source_snapshot_missing" }),
      requestedSourceSnapshotId: SNAPSHOT,
    });

    expect(decision.outcome).toBe("refused");
  });
});
