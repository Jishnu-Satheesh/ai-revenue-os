import { describe, expect, it } from "vitest";

import {
  createGrowthIntelligenceRequestFingerprint,
  type GrowthIntelligenceRequestFingerprintInput,
} from "@/domain/growth-intelligence/request-fingerprint";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CHANNEL_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const EVIDENCE_DIGEST = "a".repeat(64);
const POLICY_DIGEST = "b".repeat(64);

function input(): GrowthIntelligenceRequestFingerprintInput {
  return {
    organizationId: ORGANIZATION_ID,
    branchId: null,
    channelId: CHANNEL_ID,
    kind: "market_research",
    triggerReason: "daily_due",
    businessEvidenceDigest: EVIDENCE_DIGEST,
    marketProfileVersionId: PROFILE_VERSION_ID,
    sourcePolicyDigest: POLICY_DIGEST,
    researchRuleVersion: "market-research-rules@1",
    localTimeBucket: "daily:2026-08-31",
    synthesisVersionTuple: null,
    playbookVersionTuple: null,
  };
}

describe("createGrowthIntelligenceRequestFingerprint", () => {
  it("returns a stable SHA-256 fingerprint", () => {
    expect(createGrowthIntelligenceRequestFingerprint(input())).toMatch(/^[a-f0-9]{64}$/);
    expect(createGrowthIntelligenceRequestFingerprint(input())).toBe(
      createGrowthIntelligenceRequestFingerprint({
        localTimeBucket: "daily:2026-08-31",
        playbookVersionTuple: null,
        sourcePolicyDigest: POLICY_DIGEST,
        organizationId: ORGANIZATION_ID,
        businessEvidenceDigest: EVIDENCE_DIGEST,
        marketProfileVersionId: PROFILE_VERSION_ID,
        branchId: null,
        synthesisVersionTuple: null,
        triggerReason: "daily_due",
        researchRuleVersion: "market-research-rules@1",
        kind: "market_research",
        channelId: CHANNEL_ID,
      }),
    );
  });

  it("matches the database fingerprint contract for the canonical fixture", () => {
    expect(createGrowthIntelligenceRequestFingerprint(input())).toBe(
      "83ff7ff74b7da6205d7f09cb66c95d83bec41516160e4eef7bdde618719e262f",
    );
  });

  it.each([
    [
      "organization",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.organizationId = "44444444-4444-4444-8444-444444444444"),
    ],
    [
      "branch",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.branchId = "55555555-5555-4555-8555-555555555555"),
    ],
    ["channel", (value: GrowthIntelligenceRequestFingerprintInput) => (value.channelId = null)],
    [
      "request kind",
      (value: GrowthIntelligenceRequestFingerprintInput) => (value.kind = "weekly_synthesis"),
    ],
    [
      "trigger reason",
      (value: GrowthIntelligenceRequestFingerprintInput) => (value.triggerReason = "weekly_due"),
    ],
    [
      "business evidence",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.businessEvidenceDigest = "c".repeat(64)),
    ],
    [
      "profile version",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.marketProfileVersionId = "66666666-6666-4666-8666-666666666666"),
    ],
    [
      "source policy",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.sourcePolicyDigest = "d".repeat(64)),
    ],
    [
      "research rules",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.researchRuleVersion = "market-research-rules@2"),
    ],
    [
      "local bucket",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.localTimeBucket = "daily:2026-09-01"),
    ],
    [
      "synthesis version",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.synthesisVersionTuple = "synthesis@1"),
    ],
    [
      "playbook version",
      (value: GrowthIntelligenceRequestFingerprintInput) =>
        (value.playbookVersionTuple = "campaign-draft@1"),
    ],
  ])("changes when bound %s changes", (_label, mutate) => {
    const before = input();
    const after = input();
    mutate(after);

    expect(createGrowthIntelligenceRequestFingerprint(after)).not.toBe(
      createGrowthIntelligenceRequestFingerprint(before),
    );
  });

  it("accepts explicit absence of business evidence", () => {
    const value = input();
    value.businessEvidenceDigest = null;

    expect(createGrowthIntelligenceRequestFingerprint(value)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an invalid digest instead of fingerprinting ambiguous evidence", () => {
    const value = input();
    value.businessEvidenceDigest = "not-a-digest";

    expect(() => createGrowthIntelligenceRequestFingerprint(value)).toThrow(/digest/i);
  });

  it("rejects a time bucket that is not daily, weekly, or immediate", () => {
    const value = input();
    value.localTimeBucket = "whenever";

    expect(() => createGrowthIntelligenceRequestFingerprint(value)).toThrow(/bucket/i);
  });

  it("stays frozen while pipeline contracts are introduced alongside it", () => {
    expect(createGrowthIntelligenceRequestFingerprint(input())).toBe(
      "83ff7ff74b7da6205d7f09cb66c95d83bec41516160e4eef7bdde618719e262f",
    );
  });

  it("rejects unknown fields instead of silently widening the bound scope", () => {
    expect(() =>
      createGrowthIntelligenceRequestFingerprint({
        ...input(),
        pipelineId: "99999999-9999-4999-8999-999999999999",
      } as GrowthIntelligenceRequestFingerprintInput),
    ).toThrow();
  });
});
