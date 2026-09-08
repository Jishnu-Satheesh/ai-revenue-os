import { describe, expect, it } from "vitest";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { marketProfileDocumentV1Schema } from "@/domain/growth-intelligence/schemas";
import {
  itemFeedbackBodySchema,
  itemDecisionBodySchema,
  marketProfileDecisionBodySchema,
  marketProfileProposalBodySchema,
  preferenceBodySchema,
  preferenceRouteParamsSchema,
  startBranchResearchBodySchema,
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

  it("binds an item decision to its kind-safe vocabulary and fingerprint", () => {
    expect(
      itemDecisionBodySchema.parse({
        decision: "snoozed",
        snoozedUntil: "2026-09-11T10:00:00.000Z",
        itemFingerprint: "a".repeat(64),
      }),
    ).toMatchObject({ decision: "snoozed" });
    expect(() =>
      itemDecisionBodySchema.parse({ decision: "maybe", itemFingerprint: "a".repeat(64) }),
    ).toThrow();
    expect(() =>
      itemDecisionBodySchema.parse({ decision: "snoozed", itemFingerprint: "a".repeat(64) }),
    ).toThrow();
    expect(() =>
      itemDecisionBodySchema.parse({
        decision: "dismissed",
        reason: "x".repeat(501),
        itemFingerprint: "a".repeat(64),
      }),
    ).toThrow();
  });

  it("accepts only an explicit helpful or not-helpful vote", () => {
    expect(itemFeedbackBodySchema.parse({ helpful: true })).toEqual({ helpful: true });
    expect(itemFeedbackBodySchema.parse({ helpful: false })).toEqual({ helpful: false });
    expect(() => itemFeedbackBodySchema.parse({ helpful: null })).toThrow();
    expect(() =>
      itemFeedbackBodySchema.parse({ helpful: true, decision: "acknowledged" }),
    ).toThrow();
  });

  it("binds a preference to a known source kind and an optional horizon", () => {
    expect(
      preferenceRouteParamsSchema.parse({
        organizationId: "10000000-0000-4000-8000-000000000001",
        sourceKind: "channel_recommendation",
        sourceId: "60000000-0000-4000-8000-000000000006",
      }),
    ).toMatchObject({ sourceKind: "channel_recommendation" });
    expect(() =>
      preferenceRouteParamsSchema.parse({
        organizationId: "10000000-0000-4000-8000-000000000001",
        sourceKind: "campaign",
        sourceId: "60000000-0000-4000-8000-000000000006",
      }),
    ).toThrow();
    expect(preferenceBodySchema.parse({ pinned: true, snoozedUntil: null })).toEqual({
      pinned: true,
      snoozedUntil: null,
    });
  });

  it("binds a branch research start to one branch, a v2 document and idempotency", () => {
    const branchDocument = {
      schemaVersion: 2,
      branchId: "20000000-0000-4000-8000-000000000002",
      publicIdentity: {
        approvedName: "Malabar Table",
        domains: [],
        publicUrls: [],
      },
      nicheDescriptors: ["Kerala cuisine"],
      geographies: [
        {
          layer: "trade_area",
          locationRef: "trade-area:dubai-marina",
          name: "Dubai Marina",
          branchId: "20000000-0000-4000-8000-000000000002",
        },
        { layer: "city", locationRef: "city:dubai", name: "Dubai", countryCode: "AE" },
        {
          layer: "country",
          locationRef: "country:ae",
          name: "United Arab Emirates",
          countryCode: "AE",
        },
      ],
      competitors: [
        {
          key: "lead-one",
          name: "Lead One",
          provenance: "operator_lead",
          suggestedBy: "operator",
          geographyRefs: [],
          relevanceEvidenceUrls: [],
        },
      ],
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

    expect(
      startBranchResearchBodySchema.parse({
        branchId: "20000000-0000-4000-8000-000000000002",
        document: branchDocument,
        expectedCurrentVersionId: null,
        idempotencyKey: "branch-research-0001",
      }),
    ).toMatchObject({
      branchId: "20000000-0000-4000-8000-000000000002",
      expectedCurrentVersionId: null,
    });

    expect(() =>
      startBranchResearchBodySchema.parse({
        branchId: "20000000-0000-4000-8000-000000000002",
        document,
        expectedCurrentVersionId: null,
        idempotencyKey: "branch-research-0002",
      }),
    ).toThrow();

    expect(() =>
      startBranchResearchBodySchema.parse({
        branchId: "not-a-branch",
        document: branchDocument,
        expectedCurrentVersionId: null,
        idempotencyKey: "branch-research-0003",
      }),
    ).toThrow();

    expect(() =>
      startBranchResearchBodySchema.parse({
        branchId: "20000000-0000-4000-8000-000000000002",
        document: branchDocument,
        expectedCurrentVersionId: "not-a-version",
        idempotencyKey: "branch-research-0004",
      }),
    ).toThrow();

    expect(() =>
      startBranchResearchBodySchema.parse({
        branchId: "20000000-0000-4000-8000-000000000002",
        document: branchDocument,
        expectedCurrentVersionId: null,
        idempotencyKey: "short",
        startResearch: true,
      }),
    ).toThrow();
  });

  it("reports start conflicts as domain errors instead of success outcomes", () => {
    expect(
      new GrowthIntelligenceError("PROFILE_VERSION_CONFLICT", "The reviewed scope changed.").code,
    ).toBe("PROFILE_VERSION_CONFLICT");
    expect(
      new GrowthIntelligenceError(
        "RESEARCH_IDEMPOTENCY_CONFLICT",
        "The same key arrived with different inputs.",
      ).code,
    ).toBe("RESEARCH_IDEMPOTENCY_CONFLICT");
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
