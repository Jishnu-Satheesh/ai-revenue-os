import { describe, expect, it } from "vitest";

import {
  recordRunCost,
  reserveStudioRun,
  studioGenerationPolicySchema,
} from "@/domain/creative-studio/policy";

function policy(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    enabled: true,
    currency: "AED",
    perRunCeilingMinor: 500,
    windowCeilingMinor: 5_000,
    windowSeconds: 3_600,
    maxPending: 2,
    maxAttempts: 3,
    ...overrides,
  };
}

describe("generation policy", () => {
  it("accepts an explicit, fully stated policy version", () => {
    expect(studioGenerationPolicySchema.safeParse(policy()).success).toBe(true);
  });

  it("invents no budget defaults: every ceiling is explicit", () => {
    const withoutCeiling: Record<string, unknown> = { ...policy() };
    delete withoutCeiling.perRunCeilingMinor;

    expect(studioGenerationPolicySchema.safeParse(withoutCeiling).success).toBe(false);
  });

  it("refuses an unknown field rather than dropping it", () => {
    expect(
      studioGenerationPolicySchema.safeParse({ ...policy(), allowedModels: ["x"] }).success,
    ).toBe(false);
  });
});

describe("reservation", () => {
  it("reserves the estimated cost inside every ceiling", () => {
    expect(
      reserveStudioRun({
        policy: policy(),
        estimatedCostMinor: 400,
        spentInWindowMinor: 1_000,
        pendingCount: 0,
        attempt: 1,
      }),
    ).toEqual({ reserved: true, reservationMinor: 400 });
  });

  it("refuses generation under a disabled policy with an honest explanation", () => {
    expect(
      reserveStudioRun({
        policy: policy({ enabled: false }),
        estimatedCostMinor: 400,
        spentInWindowMinor: 0,
        pendingCount: 0,
        attempt: 1,
      }),
    ).toMatchObject({ reserved: false, code: "generation_disabled" });
  });

  it("enforces the per-run and window ceilings separately", () => {
    expect(
      reserveStudioRun({
        policy: policy(),
        estimatedCostMinor: 501,
        spentInWindowMinor: 0,
        pendingCount: 0,
        attempt: 1,
      }),
    ).toMatchObject({ reserved: false, code: "per_run_ceiling_exceeded" });
    expect(
      reserveStudioRun({
        policy: policy(),
        estimatedCostMinor: 400,
        spentInWindowMinor: 4_700,
        pendingCount: 0,
        attempt: 1,
      }),
    ).toMatchObject({ reserved: false, code: "window_ceiling_exceeded" });
  });

  it("caps pending runs and attempts", () => {
    expect(
      reserveStudioRun({
        policy: policy(),
        estimatedCostMinor: 100,
        spentInWindowMinor: 0,
        pendingCount: 2,
        attempt: 1,
      }),
    ).toMatchObject({ reserved: false, code: "too_many_pending_runs" });
    expect(
      reserveStudioRun({
        policy: policy(),
        estimatedCostMinor: 100,
        spentInWindowMinor: 0,
        pendingCount: 0,
        attempt: 4,
      }),
    ).toMatchObject({ reserved: false, code: "attempt_limit_exceeded" });
  });
});

describe("cost settlement", () => {
  it("records a known actual cost against the reservation", () => {
    expect(recordRunCost({ reservationMinor: 400, actualCostMinor: 320 })).toEqual({
      recognizedMinor: 320,
      needsReconciliation: false,
    });
  });

  it("keeps the reservation for an unknown paid outcome: null, never zero", () => {
    const outcome = recordRunCost({ reservationMinor: 400, actualCostMinor: null });

    expect(outcome.recognizedMinor).toBeNull();
    expect(outcome.needsReconciliation).toBe(true);
  });
});
