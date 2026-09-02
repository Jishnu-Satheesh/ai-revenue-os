import { describe, expect, it } from "vitest";

import {
  createMarketEvidenceMaterialFingerprint,
  hasMaterialMarketEvidenceChange,
  type MarketEvidenceMaterialSnapshot,
} from "@/domain/growth-intelligence/material-change";

const SOURCE_ONE = "11111111-1111-4111-8111-111111111111";
const SOURCE_TWO = "22222222-2222-4222-8222-222222222222";

function snapshot(): MarketEvidenceMaterialSnapshot {
  return {
    subjectKind: "market_topic",
    subjectRef: "local-events",
    claimKind: "event",
    contentDigest: "a".repeat(64),
    supportGrade: "corroborated",
    freshness: "current",
    sourceState: "active",
    geography: {
      layer: "city",
      locationRef: "ae:du",
    },
    sourceIds: [SOURCE_ONE, SOURCE_TWO],
    corroboratingClaimIds: [],
    contradictingClaimIds: [],
    limitationCodes: [],
    retrievedAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-09-14T00:00:00.000Z",
    narrativeDigest: "b".repeat(64),
  };
}

describe("market evidence material change", () => {
  it("returns a stable SHA-256 material fingerprint", () => {
    expect(createMarketEvidenceMaterialFingerprint(snapshot())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ignores retrieval, expiry, and narration churn when evidence meaning is unchanged", () => {
    const before = snapshot();
    const after = snapshot();
    after.retrievedAt = "2026-09-01T00:00:00.000Z";
    after.expiresAt = "2026-09-15T00:00:00.000Z";
    after.narrativeDigest = "c".repeat(64);

    expect(hasMaterialMarketEvidenceChange(before, after)).toBe(false);
  });

  it("treats source and limitation arrays as sets", () => {
    const before = snapshot();
    before.limitationCodes = ["BROADER_MARKET_INFERENCE", "SINGLE_PERIOD"];
    const after = snapshot();
    after.sourceIds.reverse();
    after.limitationCodes = ["SINGLE_PERIOD", "BROADER_MARKET_INFERENCE"];

    expect(hasMaterialMarketEvidenceChange(before, after)).toBe(false);
  });

  it.each([
    ["content", (value: MarketEvidenceMaterialSnapshot) => (value.contentDigest = "d".repeat(64))],
    ["support", (value: MarketEvidenceMaterialSnapshot) => (value.supportGrade = "conflicted")],
    ["freshness", (value: MarketEvidenceMaterialSnapshot) => (value.freshness = "stale")],
    ["source state", (value: MarketEvidenceMaterialSnapshot) => (value.sourceState = "withdrawn")],
    ["geography", (value: MarketEvidenceMaterialSnapshot) => (value.geography.locationRef = "ae")],
    ["source set", (value: MarketEvidenceMaterialSnapshot) => value.sourceIds.pop()],
    [
      "conflict set",
      (value: MarketEvidenceMaterialSnapshot) =>
        value.contradictingClaimIds.push("33333333-3333-4333-8333-333333333333"),
    ],
    [
      "limitation",
      (value: MarketEvidenceMaterialSnapshot) =>
        value.limitationCodes.push("BROADER_MARKET_INFERENCE"),
    ],
  ])("detects a material %s change", (_label, mutate) => {
    const before = snapshot();
    const after = snapshot();
    mutate(after);

    expect(hasMaterialMarketEvidenceChange(before, after)).toBe(true);
  });

  it("rejects a non-digest content identity", () => {
    const value = snapshot();
    value.contentDigest = "not-a-digest";

    expect(() => createMarketEvidenceMaterialFingerprint(value)).toThrow(/digest/i);
  });
});
