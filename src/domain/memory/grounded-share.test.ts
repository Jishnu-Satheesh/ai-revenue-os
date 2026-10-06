import { describe, expect, it } from "vitest";

import {
  canonicalGroundedShareConsentText,
  decideGroundedShareEligibility,
  GROUNDED_SHARE_CONSENT_VERSION,
  MAX_GROUNDED_SHARE_BYTES,
  MAX_GROUNDED_SHARE_ENTRIES,
  selectGroundedShareSubset,
  type GroundedShareCandidate,
} from "@/domain/memory/grounded-share";

function baseCandidate(overrides: Partial<GroundedShareCandidate> = {}): GroundedShareCandidate {
  return {
    id: "candidate-1",
    sensitivity: "internal",
    reuseClass: "qualified_reusable",
    knowledgeKind: "observation",
    hasMoneyAmount: false,
    hasPii: false,
    rootsLive: true,
    scopeOk: true,
    isLegacyUnqualified: false,
    summary: "Branch closed an hour early during the mall event.",
    ...overrides,
  };
}

describe("grounded-share consent", () => {
  it("pins the consent version and wording", () => {
    expect(GROUNDED_SHARE_CONSENT_VERSION).toBe("grounded-share-v1");
    const text = canonicalGroundedShareConsentText();
    expect(text).toContain("grounded-share-v1");
    expect(text).toContain("Confidential and customer content never shares");
    expect(text).toContain("cannot be recalled from Google");
  });
});

describe("decideGroundedShareEligibility", () => {
  it("allows a qualified internal observation", () => {
    expect(decideGroundedShareEligibility(baseCandidate())).toEqual({ eligible: true });
  });

  it("allows public entries", () => {
    expect(
      decideGroundedShareEligibility(baseCandidate({ sensitivity: "public" })),
    ).toEqual({ eligible: true });
  });

  it("blocks confidential and customer content", () => {
    expect(
      decideGroundedShareEligibility(baseCandidate({ sensitivity: "confidential" })),
    ).toEqual({ eligible: false, code: "SENSITIVITY_BLOCKED" });
    expect(
      decideGroundedShareEligibility(baseCandidate({ sensitivity: "customer_content" })),
    ).toEqual({ eligible: false, code: "SENSITIVITY_BLOCKED" });
  });

  it("blocks internal_reusable without qualified reuse", () => {
    expect(
      decideGroundedShareEligibility(baseCandidate({ reuseClass: "internal_reusable" })),
    ).toEqual({ eligible: false, code: "REUSE_BLOCKED" });
    expect(
      decideGroundedShareEligibility(baseCandidate({ reuseClass: "metadata_only" })),
    ).toEqual({ eligible: false, code: "REUSE_BLOCKED" });
    expect(decideGroundedShareEligibility(baseCandidate({ reuseClass: "denied" }))).toEqual({
      eligible: false,
      code: "REUSE_BLOCKED",
    });
  });

  it("blocks outcomes, lessons, campaign state, and legacy kinds", () => {
    for (const knowledgeKind of [
      "measured_outcome",
      "lesson",
      "campaign_state",
      "legacy",
    ] as const) {
      expect(decideGroundedShareEligibility(baseCandidate({ knowledgeKind }))).toEqual({
        eligible: false,
        code: "KIND_BLOCKED",
      });
    }
  });

  it("blocks money amounts and PII even when otherwise eligible", () => {
    expect(decideGroundedShareEligibility(baseCandidate({ hasMoneyAmount: true }))).toEqual({
      eligible: false,
      code: "MONEY_BLOCKED",
    });
    expect(decideGroundedShareEligibility(baseCandidate({ hasPii: true }))).toEqual({
      eligible: false,
      code: "PII_BLOCKED",
    });
  });

  it("blocks dead roots, wrong scope, and unqualified legacy", () => {
    expect(decideGroundedShareEligibility(baseCandidate({ rootsLive: false }))).toEqual({
      eligible: false,
      code: "ROOT_NOT_LIVE",
    });
    expect(decideGroundedShareEligibility(baseCandidate({ scopeOk: false }))).toEqual({
      eligible: false,
      code: "SCOPE_BLOCKED",
    });
    expect(
      decideGroundedShareEligibility(baseCandidate({ isLegacyUnqualified: true })),
    ).toEqual({ eligible: false, code: "LEGACY_UNQUALIFIED" });
  });
});

describe("selectGroundedShareSubset", () => {
  it("caps entries and reports exclusions with codes", () => {
    const candidates = Array.from({ length: MAX_GROUNDED_SHARE_ENTRIES + 4 }, (_, index) =>
      baseCandidate({ id: `ok-${index}`, priority: index, summary: "Short note." }),
    );
    const blocked = baseCandidate({ id: "blocked-money", hasMoneyAmount: true });
    const result = selectGroundedShareSubset([...candidates, blocked]);

    expect(result.selected).toHaveLength(MAX_GROUNDED_SHARE_ENTRIES);
    expect(result.selected.map((candidate) => candidate.id)).toEqual(
      [...Array(MAX_GROUNDED_SHARE_ENTRIES).keys()].map((index) => `ok-${index}`),
    );
    expect(result.excluded).toContainEqual({ id: "blocked-money", code: "MONEY_BLOCKED" });
    expect(result.totalBytes).toBeLessThanOrEqual(MAX_GROUNDED_SHARE_BYTES);
  });

  it("enforces the byte budget deterministically", () => {
    const big = "x".repeat(3000);
    const result = selectGroundedShareSubset([
      baseCandidate({ id: "a", priority: 0, summary: big }),
      baseCandidate({ id: "b", priority: 1, summary: big }),
      baseCandidate({ id: "c", priority: 2, summary: "Small." }),
    ]);

    expect(result.totalBytes).toBeLessThanOrEqual(MAX_GROUNDED_SHARE_BYTES);
    expect(result.selected.map((candidate) => candidate.id)).toContain("a");
    expect(result.selected.map((candidate) => candidate.id)).toContain("c");
  });

  it("orders ties by stable id", () => {
    const result = selectGroundedShareSubset([
      baseCandidate({ id: "b", summary: "B." }),
      baseCandidate({ id: "a", summary: "A." }),
    ]);
    expect(result.selected.map((candidate) => candidate.id)).toEqual(["a", "b"]);
  });
});
