import { describe, expect, it } from "vitest";

import {
  computeSlotBudget,
  resurfacingCondition,
  screenCandidates,
  type ScreeningCandidate,
  type ScreeningContext,
} from "@/domain/decisions/screening";

const now = new Date("2026-08-12T12:00:00.000Z");

function ctx(overrides: Partial<ScreeningContext> = {}): ScreeningContext {
  return {
    now,
    grantedCapabilityKeys: new Set(["read_google_business_profile"]),
    activeGoalMetricKeys: new Set(["revenue.gross"]),
    goalAlignmentActive: true,
    suppressedFingerprints: new Map(),
    ...overrides,
  };
}

function candidate(overrides: Partial<ScreeningCandidate> = {}): ScreeningCandidate {
  return {
    candidateFingerprint: "a".repeat(64),
    requiredCapabilityKeys: ["read_google_business_profile"],
    primaryMetricKey: "revenue.gross",
    inputsObservedAt: new Date("2026-08-12T11:00:00.000Z"),
    freshnessBoundMinutes: 120,
    ...overrides,
  };
}

describe("slot budget", () => {
  it("is the configured maximum less the currently active recommendations", () => {
    expect(computeSlotBudget({ maxActiveRecommendations: 5, activeOpportunityCount: 2 })).toBe(3);
  });

  it("never goes negative when more are active than the maximum allows", () => {
    expect(computeSlotBudget({ maxActiveRecommendations: 3, activeOpportunityCount: 7 })).toBe(0);
  });

  it("is zero when the maximum is zero, which halts the cycle before screening", () => {
    expect(computeSlotBudget({ maxActiveRecommendations: 0, activeOpportunityCount: 0 })).toBe(0);
  });
});

describe("stage A screening", () => {
  it("keeps a candidate that satisfies freshness, capability, and goal alignment", () => {
    const result = screenCandidates([candidate()], ctx());

    expect(result.survivors).toHaveLength(1);
    expect(result.rejectionHistogram).toEqual({});
  });

  it("screens out inputs older than the declared freshness bound", () => {
    const result = screenCandidates(
      [candidate({ inputsObservedAt: new Date("2026-08-12T09:00:00.000Z") })],
      ctx(),
    );

    expect(result.survivors).toHaveLength(0);
    expect(result.rejectionHistogram).toEqual({ stale_inputs: 1 });
  });

  it("treats a candidate exactly at its freshness bound as still fresh", () => {
    const result = screenCandidates(
      [candidate({ inputsObservedAt: new Date("2026-08-12T10:00:00.000Z") })],
      ctx(),
    );

    expect(result.survivors).toHaveLength(1);
  });

  it("screens out a missing capability and names it", () => {
    const result = screenCandidates(
      [candidate({ requiredCapabilityKeys: ["publish_instagram"] })],
      ctx(),
    );

    expect(result.survivors).toHaveLength(0);
    expect(result.rejectionHistogram).toEqual({ capability_missing: 1 });
    expect(result.rejections[0]?.missingCapabilityKeys).toEqual(["publish_instagram"]);
  });

  it("screens out a playbook whose metric matches no active goal", () => {
    const result = screenCandidates([candidate({ primaryMetricKey: "reviews.count" })], ctx());

    expect(result.survivors).toHaveLength(0);
    expect(result.rejectionHistogram).toEqual({ goal_misaligned: 1 });
  });

  it("never screens on goal alignment when the organization has no active goals", () => {
    const result = screenCandidates(
      [candidate({ primaryMetricKey: "reviews.count" })],
      ctx({ activeGoalMetricKeys: new Set() }),
    );

    expect(result.survivors).toHaveLength(1);
  });

  it("reports goal alignment as inactive rather than silently passing when keys are unavailable", () => {
    const result = screenCandidates(
      [candidate({ primaryMetricKey: "reviews.count" })],
      ctx({ goalAlignmentActive: false }),
    );

    expect(result.survivors).toHaveLength(1);
    expect(result.goalAlignmentActive).toBe(false);
  });

  it("screens out a suppressed fingerprint whose window has not elapsed", () => {
    const result = screenCandidates(
      [candidate()],
      ctx({
        suppressedFingerprints: new Map([
          ["a".repeat(64), { suppressedUntil: new Date("2026-08-20T00:00:00.000Z") }],
        ]),
      }),
    );

    expect(result.survivors).toHaveLength(0);
    expect(result.rejectionHistogram).toEqual({ suppressed: 1 });
  });

  it("counts each rejection reason once per candidate, in a stable histogram", () => {
    const result = screenCandidates(
      [
        candidate({
          candidateFingerprint: "b".repeat(64),
          requiredCapabilityKeys: ["missing_one"],
        }),
        candidate({
          candidateFingerprint: "c".repeat(64),
          requiredCapabilityKeys: ["missing_two"],
        }),
        candidate({
          candidateFingerprint: "d".repeat(64),
          inputsObservedAt: new Date("2026-08-01T00:00:00.000Z"),
        }),
      ],
      ctx(),
    );

    expect(result.rejectionHistogram).toEqual({ capability_missing: 2, stale_inputs: 1 });
    expect(result.screenedCount).toBe(3);
  });

  it("applies the cheapest deterministic predicate first, so one reason is recorded", () => {
    // Suppression is known without reading inputs; a suppressed and stale
    // candidate is recorded as suppressed rather than counted twice.
    const result = screenCandidates(
      [candidate({ inputsObservedAt: new Date("2026-08-01T00:00:00.000Z") })],
      ctx({
        suppressedFingerprints: new Map([
          ["a".repeat(64), { suppressedUntil: new Date("2026-08-20T00:00:00.000Z") }],
        ]),
      }),
    );

    expect(result.rejectionHistogram).toEqual({ suppressed: 1 });
  });
});

describe("resurfacing", () => {
  const suppression = {
    candidateFingerprint: "a".repeat(64),
    suppressedUntil: new Date("2026-08-20T00:00:00.000Z"),
    playbookVersionId: "v1",
    unsuppressedAt: null,
  };

  it("resurfaces when the operator explicitly un-suppressed it", () => {
    expect(
      resurfacingCondition({
        suppression: { ...suppression, unsuppressedAt: now },
        candidateFingerprint: suppression.candidateFingerprint,
        playbookVersionId: "v1",
        resurfaceSignalMet: false,
        now,
      }),
    ).toBe("operator_unsuppressed");
  });

  it("resurfaces when the fingerprint changed", () => {
    expect(
      resurfacingCondition({
        suppression,
        candidateFingerprint: "z".repeat(64),
        playbookVersionId: "v1",
        resurfaceSignalMet: false,
        now,
      }),
    ).toBe("fingerprint_changed");
  });

  it("resurfaces when the declared resurface condition is met", () => {
    expect(
      resurfacingCondition({
        suppression,
        candidateFingerprint: suppression.candidateFingerprint,
        playbookVersionId: "v1",
        resurfaceSignalMet: true,
        now,
      }),
    ).toBe("resurface_condition_met");
  });

  it("resurfaces when the suppression window elapsed", () => {
    expect(
      resurfacingCondition({
        suppression,
        candidateFingerprint: suppression.candidateFingerprint,
        playbookVersionId: "v1",
        resurfaceSignalMet: false,
        now: new Date("2026-08-21T00:00:00.000Z"),
      }),
    ).toBe("window_elapsed");
  });

  it("stays suppressed when none of the four conditions holds", () => {
    expect(
      resurfacingCondition({
        suppression,
        candidateFingerprint: suppression.candidateFingerprint,
        playbookVersionId: "v1",
        resurfaceSignalMet: false,
        now,
      }),
    ).toBeNull();
  });

  it("treats a never-expiring suppression as permanent until its playbook version changes", () => {
    const permanent = { ...suppression, suppressedUntil: null };

    expect(
      resurfacingCondition({
        suppression: permanent,
        candidateFingerprint: permanent.candidateFingerprint,
        playbookVersionId: "v1",
        resurfaceSignalMet: false,
        now: new Date("2099-01-01T00:00:00.000Z"),
      }),
    ).toBeNull();

    expect(
      resurfacingCondition({
        suppression: permanent,
        candidateFingerprint: permanent.candidateFingerprint,
        playbookVersionId: "v2",
        resurfaceSignalMet: false,
        now,
      }),
    ).toBe("playbook_version_changed");
  });
});
