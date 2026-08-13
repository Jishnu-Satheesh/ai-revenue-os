import { describe, expect, it } from "vitest";

import { decisionRecordSchema } from "@/domain/decisions/record";

const base = {
  decisionCycleId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  correlationId: "33333333-3333-4333-8333-333333333333",
  outcome: "action_selected" as const,
  reason: null,
  selectedCandidateFingerprint: "a".repeat(64),
  opportunityId: "44444444-4444-4444-8444-444444444444",
  rejectionHistogram: { stale_inputs: 2 },
  screenedCount: 10,
  scoredCount: 3,
  inputsDigest: "b".repeat(64),
  versionTuple: {
    policyVersionId: "55555555-5555-4555-8555-555555555555",
    playbookVersionId: "66666666-6666-4666-8666-666666666666",
    confidenceCalibrationId: "77777777-7777-4777-8777-777777777777",
    rankingWeightsId: "88888888-8888-4888-8888-888888888888",
  },
  propensity: 1,
  isExploration: false,
};

describe("decision record", () => {
  it("accepts a complete action_selected record", () => {
    expect(decisionRecordSchema.parse(base).outcome).toBe("action_selected");
  });

  it("records propensity 1 and no exploration, rather than omitting them", () => {
    expect(() => decisionRecordSchema.parse({ ...base, propensity: 0.5 })).toThrow();
    expect(() => decisionRecordSchema.parse({ ...base, isExploration: true })).toThrow();

    const { propensity: _p, ...withoutPropensity } = base;
    expect(() => decisionRecordSchema.parse(withoutPropensity)).toThrow();
  });

  it("requires the explicit version tuple with no null, unknown, or free-text artifact reference", () => {
    expect(() => decisionRecordSchema.parse({ ...base, versionTuple: {} })).toThrow();
    expect(() =>
      decisionRecordSchema.parse({
        ...base,
        versionTuple: { ...base.versionTuple, confidenceCalibrationId: null },
      }),
    ).toThrow();
    expect(() =>
      decisionRecordSchema.parse({
        ...base,
        versionTuple: { ...base.versionTuple, extra: "nope" },
      }),
    ).toThrow();
  });

  it("requires a selected candidate and an opportunity when an action was selected", () => {
    expect(() =>
      decisionRecordSchema.parse({ ...base, selectedCandidateFingerprint: null }),
    ).toThrow();
    expect(() => decisionRecordSchema.parse({ ...base, opportunityId: null })).toThrow();
  });

  it("never lets a needs_data decision create an opportunity", () => {
    const needsData = {
      ...base,
      outcome: "needs_data" as const,
      reason: "economics_ledger_indicative",
      selectedCandidateFingerprint: null,
      opportunityId: null,
    };

    expect(decisionRecordSchema.parse(needsData).opportunityId).toBeNull();
    expect(() =>
      decisionRecordSchema.parse({ ...needsData, opportunityId: base.opportunityId }),
    ).toThrow();
  });

  it("requires a reason for needs_data and no_action, because the timeline must explain itself", () => {
    for (const outcome of ["needs_data", "no_action"] as const) {
      expect(() =>
        decisionRecordSchema.parse({
          ...base,
          outcome,
          reason: null,
          selectedCandidateFingerprint: null,
          opportunityId: null,
        }),
      ).toThrow();
    }
  });

  it("never lets a no_action decision carry a selected candidate", () => {
    expect(() =>
      decisionRecordSchema.parse({
        ...base,
        outcome: "no_action",
        reason: "no_active_playbook",
        opportunityId: null,
      }),
    ).toThrow();
  });

  it("allows a slot-budget-exhausted record that screened nothing", () => {
    const record = decisionRecordSchema.parse({
      ...base,
      outcome: "no_action",
      reason: "slot_budget_exhausted",
      selectedCandidateFingerprint: null,
      opportunityId: null,
      rejectionHistogram: {},
      screenedCount: 0,
      scoredCount: 0,
    });

    expect(record.screenedCount).toBe(0);
  });

  it("rejects a scored count larger than the screened count", () => {
    expect(() =>
      decisionRecordSchema.parse({ ...base, screenedCount: 2, scoredCount: 5 }),
    ).toThrow();
  });

  it("rejects unknown fields, so a model cannot smuggle a value onto the record", () => {
    expect(() => decisionRecordSchema.parse({ ...base, modelConfidence: 0.9 })).toThrow();
  });
});
