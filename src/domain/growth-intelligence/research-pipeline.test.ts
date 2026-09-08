import { describe, expect, it } from "vitest";

import {
  RESEARCH_BUDGET_LIMITS,
  RESEARCH_COVERAGE_OUTCOMES,
  RESEARCH_PIPELINE_STAGES,
  RESEARCH_PIPELINE_STAGE_DISPLAY,
  isTerminalPipelineStage,
  remainingRetryAttempts,
  researchCoverageEntrySchema,
  resolvePipelineStageAfterResearch,
  sumKnownAttemptCost,
} from "@/domain/growth-intelligence/research-pipeline";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM_ID = "22222222-2222-4222-8222-222222222222";

function coverageEntry() {
  return {
    slotKey: "local_market",
    kind: "local_market" as const,
    outcome: "supported" as const,
    attemptIds: [ATTEMPT_ID],
    acceptedClaimIds: [CLAIM_ID],
  };
}

describe("research pipeline stages", () => {
  it("uses the design's nine stages in lifecycle order", () => {
    expect(RESEARCH_PIPELINE_STAGES).toEqual([
      "queued",
      "researching",
      "preparing_insights",
      "ready",
      "partial",
      "no_findings",
      "research_failed",
      "synthesis_failed",
      "cancelled",
    ]);
  });

  it("labels every stage with the approved product display text", () => {
    expect(RESEARCH_PIPELINE_STAGE_DISPLAY).toEqual({
      queued: "Queued",
      researching: "Researching",
      preparing_insights: "Preparing insights",
      ready: "Ready",
      partial: "Ready with limitations",
      no_findings: "No usable findings",
      research_failed: "Research could not finish",
      synthesis_failed: "Research saved; insights could not finish",
      cancelled: "Replaced or cancelled",
    });
  });

  it("treats only settled outcomes as terminal", () => {
    expect(isTerminalPipelineStage("queued")).toBe(false);
    expect(isTerminalPipelineStage("researching")).toBe(false);
    expect(isTerminalPipelineStage("preparing_insights")).toBe(false);

    for (const stage of [
      "ready",
      "partial",
      "no_findings",
      "research_failed",
      "synthesis_failed",
      "cancelled",
    ] as const) {
      expect(isTerminalPipelineStage(stage)).toBe(true);
    }
  });
});

describe("research coverage entries", () => {
  it("accepts a supported slot linked to its attempts and accepted claims", () => {
    expect(researchCoverageEntrySchema.parse(coverageEntry())).toEqual(coverageEntry());
  });

  it("starts untouched slots without attempts or claims", () => {
    expect(
      researchCoverageEntrySchema.parse({
        slotKey: "kerala-food-festival",
        kind: "topic",
        outcome: "not_started",
      }),
    ).toEqual({
      slotKey: "kerala-food-festival",
      kind: "topic",
      outcome: "not_started",
      attemptIds: [],
      acceptedClaimIds: [],
    });
  });

  it("covers every planned slot kind and outcome from the design", () => {
    expect(RESEARCH_COVERAGE_OUTCOMES).toEqual([
      "not_started",
      "searched_no_usable_evidence",
      "supported",
      "failed",
      "skipped_budget",
      "skipped_policy",
    ]);

    for (const outcome of RESEARCH_COVERAGE_OUTCOMES) {
      expect(researchCoverageEntrySchema.parse({ ...coverageEntry(), outcome }).outcome).toBe(
        outcome,
      );
    }
  });

  it("rejects unknown outcomes, blank slot keys and non-attempt references", () => {
    expect(() =>
      researchCoverageEntrySchema.parse({ ...coverageEntry(), outcome: "done" }),
    ).toThrow();
    expect(() =>
      researchCoverageEntrySchema.parse({ ...coverageEntry(), kind: "channel" }),
    ).toThrow();
    expect(() =>
      researchCoverageEntrySchema.parse({ ...coverageEntry(), slotKey: "  " }),
    ).toThrow();
    expect(() =>
      researchCoverageEntrySchema.parse({ ...coverageEntry(), attemptIds: ["not-an-attempt"] }),
    ).toThrow();
  });

  it("refuses more attempt references than the whole run may issue", () => {
    expect(() =>
      researchCoverageEntrySchema.parse({
        ...coverageEntry(),
        attemptIds: Array.from(
          { length: 29 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      }),
    ).toThrow();
  });
});

describe("research completion lifecycle", () => {
  it("keeps a successful root in preparing_insights instead of declaring it ready", () => {
    const stage = resolvePipelineStageAfterResearch({
      rootOutcome: "succeeded",
      eligibleClaimCount: 3,
    });

    expect(stage).toBe("preparing_insights");
    expect(stage).not.toBe("ready");
  });

  it("reports no_findings rather than failure when nothing eligible survived", () => {
    const stage = resolvePipelineStageAfterResearch({
      rootOutcome: "succeeded",
      eligibleClaimCount: 0,
    });

    expect(stage).toBe("no_findings");
    expect(stage).not.toBe("research_failed");
  });

  it("reports research failure when the root run itself failed", () => {
    expect(
      resolvePipelineStageAfterResearch({ rootOutcome: "failed", eligibleClaimCount: 4 }),
    ).toBe("research_failed");
    expect(
      resolvePipelineStageAfterResearch({ rootOutcome: "failed", eligibleClaimCount: 0 }),
    ).toBe("research_failed");
  });

  it("rejects a negative eligible claim count instead of staging it", () => {
    expect(() =>
      resolvePipelineStageAfterResearch({ rootOutcome: "succeeded", eligibleClaimCount: -1 }),
    ).toThrow();
  });
});

describe("research budget limits", () => {
  it("pins the conservative launch ceilings from the approved plan", () => {
    expect(RESEARCH_BUDGET_LIMITS).toEqual({
      maxPrimarySearches: 26,
      maxRetryAttempts: 2,
      maxResultsPerQuery: 5,
      maxResponseBytes: 524_288,
      maxStreamedBytesTotal: 8_388_608,
      maxRetainedSources: 40,
      maxExcerptCharacters: 2_000,
      maxTotalExcerptCharacters: 65_536,
      maxPipelineReservationMicrosUsd: 1_000_000,
      maxOrganizationDayAllowanceMicrosUsd: 5_000_000,
    });
  });

  it("adds reported and estimated spend while keeping unknown cost reserved", () => {
    expect(
      sumKnownAttemptCost([
        { kind: "reported", microsUsd: 1_200 },
        { kind: "estimated", microsUsd: 800 },
        { kind: "unknown" },
      ]),
    ).toEqual({ knownMicrosUsd: 2_000, unknownCount: 1 });
  });

  it("never converts unknown cost to zero", () => {
    const summary = sumKnownAttemptCost([{ kind: "unknown" }, { kind: "unknown" }]);

    expect(summary.knownMicrosUsd).toBe(0);
    expect(summary.unknownCount).toBe(2);
  });

  it("preserves consumed retry limits across replays and lease retries", () => {
    expect(remainingRetryAttempts(0)).toBe(2);
    expect(remainingRetryAttempts(1)).toBe(1);
    expect(remainingRetryAttempts(2)).toBe(0);
    expect(remainingRetryAttempts(9)).toBe(0);
  });

  it("rejects a negative consumed retry count instead of granting extra retries", () => {
    expect(() => remainingRetryAttempts(-1)).toThrow();
  });
});
