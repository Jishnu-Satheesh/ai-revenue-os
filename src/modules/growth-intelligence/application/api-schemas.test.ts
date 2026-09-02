import { describe, expect, it } from "vitest";

import { marketProfileDocumentV1Schema } from "@/domain/growth-intelligence/schemas";
import {
  marketProfileDecisionBodySchema,
  marketProfileProposalBodySchema,
} from "@/modules/growth-intelligence/application/api-schemas";

const document = {
  schemaVersion: 1,
  publicIdentity: {
    approvedName: "Malabar Table",
    domains: ["malabartable.example"],
    publicUrls: ["https://malabartable.example/"],
  },
  nicheDescriptors: ["Kerala cuisine"],
  geographies: [
    {
      layer: "trade_area",
      locationRef: "trade-area:dubai-marina",
      name: "Dubai Marina",
      branchId: "10000000-0000-4000-8000-000000000001",
    },
    { layer: "city", locationRef: "city:dubai", name: "Dubai", countryCode: "AE" },
    {
      layer: "country",
      locationRef: "country:ae",
      name: "United Arab Emirates",
      countryCode: "AE",
    },
  ],
  competitors: [],
  topics: [{ key: "kerala-cuisine", label: "Kerala cuisine", provenance: "operator" }],
  sourcePolicy: {
    excludedDomains: [],
    excludedPublishers: [],
    excludedCompetitorKeys: [],
    allowBoundedQuotes: false,
    maxQuotationCharacters: 0,
  },
  cadence: {
    timeZone: "Asia/Dubai",
    dailyLocalTime: "06:00",
    weeklyDay: "monday",
    weeklyLocalTime: "07:00",
  },
};

describe("Market Profile API schemas", () => {
  it("accepts an AI proposal request without letting the client supply discovery context", () => {
    expect(
      marketProfileProposalBodySchema.parse({
        source: "ai",
        idempotencyKey: "profile-proposal-0001",
      }),
    ).toEqual({ source: "ai", idempotencyKey: "profile-proposal-0001" });

    expect(() =>
      marketProfileProposalBodySchema.parse({
        source: "ai",
        idempotencyKey: "profile-proposal-0001",
        context: { rawWorkbook: true },
      }),
    ).toThrow();
  });

  it("accepts an exact operator-authored revision and rejects unknown fields", () => {
    expect(
      marketProfileProposalBodySchema.parse({
        source: "operator",
        profileDocument: document,
        idempotencyKey: "profile-proposal-0002",
      }),
    ).toMatchObject({
      source: "operator",
      profileDocument: marketProfileDocumentV1Schema.parse(document),
    });
    expect(() =>
      marketProfileProposalBodySchema.parse({
        source: "operator",
        profileDocument: document,
        idempotencyKey: "profile-proposal-0002",
        startResearch: true,
      }),
    ).toThrow();
  });

  it("binds a decision to an exact digest and bounded reason", () => {
    expect(
      marketProfileDecisionBodySchema.parse({
        decision: "confirmed",
        profileDigest: "a".repeat(64),
        reason: "Approved scope",
        idempotencyKey: "profile-decision-0001",
      }),
    ).toMatchObject({ decision: "confirmed", profileDigest: "a".repeat(64) });
    expect(() =>
      marketProfileDecisionBodySchema.parse({
        decision: "confirmed",
        profileDigest: "a".repeat(63),
        reason: "x".repeat(501),
        idempotencyKey: "profile-decision-0001",
      }),
    ).toThrow();
  });
});
