import { describe, expect, it } from "vitest";

import { createMarketProfileDigest } from "@/domain/growth-intelligence/profile-digest";
import type {
  MarketProfileDocumentV1,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const V2_BRANCH_ID = "22222222-2222-4222-8222-222222222222";

function profile(): MarketProfileDocumentV1 {
  return {
    schemaVersion: 1,
    publicIdentity: {
      approvedName: "Kerala Kitchen",
      domains: ["example.com"],
      publicUrls: ["https://example.com/menu"],
    },
    nicheDescriptors: ["Kerala cuisine", "Restaurant"],
    geographies: [
      {
        layer: "trade_area",
        locationRef: "ae:du:dubai-marina",
        name: "Dubai Marina delivery area",
        branchId: BRANCH_ID,
        radiusKm: 8,
      },
      {
        layer: "city",
        locationRef: "ae:du",
        name: "Dubai",
        countryCode: "AE",
      },
      {
        layer: "country",
        locationRef: "ae",
        name: "United Arab Emirates",
        countryCode: "AE",
      },
    ],
    competitors: [
      {
        key: "competitor-one",
        name: "Competitor One",
        publicUrl: "https://competitor.example/",
        geographyRefs: ["ae:du"],
        relevanceEvidenceUrls: ["https://directory.example/competitor-one"],
        relevanceReason: "Serves the same confirmed city and cuisine category.",
      },
    ],
    topics: [{ key: "local-events", label: "Local events", provenance: "core" }],
    sourcePolicy: {
      excludedDomains: ["spam.example"],
      excludedPublishers: ["Untrusted Publisher"],
      excludedCompetitorKeys: [],
      allowBoundedQuotes: true,
      maxQuotationCharacters: 240,
    },
    cadence: {
      timeZone: "Asia/Dubai",
      dailyLocalTime: "06:30",
      weeklyDay: "monday",
      weeklyLocalTime: "07:00",
    },
  };
}

describe("createMarketProfileDigest", () => {
  it("returns a SHA-256 digest for the approved normalized profile", () => {
    expect(createMarketProfileDigest(profile())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches the database digest contract for the version-one fixture", () => {
    expect(createMarketProfileDigest(profile())).toBe(
      "e054b02adfd9e95c4030430d7689819aa231bc58134b38160c173c88486c9f82",
    );
  });

  it("is stable when set-like arrays and normalized public identifiers arrive in another order", () => {
    const left = profile();
    const right = profile();
    right.nicheDescriptors.reverse();
    right.geographies.reverse();
    right.publicIdentity.domains = ["EXAMPLE.COM."];
    right.publicIdentity.publicUrls = ["https://example.com/menu#section"];

    expect(createMarketProfileDigest(right)).toBe(createMarketProfileDigest(left));
  });

  it.each([
    [
      "public identity",
      (value: MarketProfileDocumentV1) => (value.publicIdentity.approvedName = "New name"),
    ],
    ["niche", (value: MarketProfileDocumentV1) => value.nicheDescriptors.push("Late night")],
    ["geography", (value: MarketProfileDocumentV1) => (value.geographies[0]!.name = "Jumeirah")],
    [
      "competitor scope",
      (value: MarketProfileDocumentV1) => (value.competitors[0]!.name = "Another competitor"),
    ],
    ["topic", (value: MarketProfileDocumentV1) => (value.topics[0]!.label = "City events")],
    [
      "source policy",
      (value: MarketProfileDocumentV1) =>
        value.sourcePolicy.excludedDomains.push("blocked.example"),
    ],
    ["cadence", (value: MarketProfileDocumentV1) => (value.cadence.dailyLocalTime = "08:30")],
  ])("changes when approved %s changes", (_label, mutate) => {
    const before = profile();
    const after = profile();
    mutate(after);

    expect(createMarketProfileDigest(after)).not.toBe(createMarketProfileDigest(before));
  });

  it("refuses a value outside the strict profile contract", () => {
    const invalid = { ...profile(), unapprovedField: "expand scope" };

    expect(() => createMarketProfileDigest(invalid as MarketProfileDocumentV1)).toThrow();
  });
});

function branchProfile(): MarketProfileDocumentV2 {
  return {
    schemaVersion: 2,
    branchId: V2_BRANCH_ID,
    publicIdentity: {
      approvedName: "Kerala Kitchen",
      domains: ["example.com"],
      publicUrls: ["https://example.com/menu"],
    },
    nicheDescriptors: ["Kerala cuisine", "Restaurant"],
    geographies: [
      {
        layer: "trade_area",
        locationRef: "ae:du:dubai-marina",
        name: "Dubai Marina delivery area",
        branchId: V2_BRANCH_ID,
        radiusKm: 8,
      },
      {
        layer: "city",
        locationRef: "ae:du",
        name: "Dubai",
        countryCode: "AE",
      },
      {
        layer: "country",
        locationRef: "ae",
        name: "United Arab Emirates",
        countryCode: "AE",
      },
    ],
    competitors: [
      {
        key: "competitor-one",
        name: "Competitor One",
        provenance: "operator_lead",
        suggestedBy: "operator",
        geographyRefs: ["ae:du"],
        relevanceEvidenceUrls: [],
      },
    ],
    topics: [{ key: "local-events", label: "Local events", provenance: "core" }],
    sourcePolicy: {
      excludedDomains: ["spam.example"],
      excludedPublishers: ["Untrusted Publisher"],
      excludedCompetitorKeys: [],
      allowBoundedQuotes: true,
      maxQuotationCharacters: 240,
    },
    cadence: {
      timeZone: "Asia/Dubai",
      dailyLocalTime: "06:30",
      weeklyDay: "monday",
      weeklyLocalTime: "07:00",
    },
  };
}

function branchTradeArea(profile: MarketProfileDocumentV2) {
  const tradeArea = profile.geographies.find((geography) => geography.layer === "trade_area");
  if (!tradeArea || tradeArea.layer !== "trade_area") {
    throw new Error("The branch fixture must bind one trade area.");
  }
  return tradeArea;
}

describe("createMarketProfileDigest for branch profiles", () => {
  it("keeps the frozen version-one fixture hash while reading both versions", () => {
    expect(createMarketProfileDigest(profile())).toBe(
      "e054b02adfd9e95c4030430d7689819aa231bc58134b38160c173c88486c9f82",
    );
    expect(createMarketProfileDigest(branchProfile())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes new interface values before digesting version two", () => {
    const left = branchProfile();
    const right = branchProfile();
    right.publicIdentity.approvedName = "  Kerala Kitchen  ";
    right.publicIdentity.domains = ["EXAMPLE.COM."];
    right.publicIdentity.publicUrls = ["https://example.com/menu#section"];
    right.geographies.reverse();

    expect(createMarketProfileDigest(right)).toBe(createMarketProfileDigest(left));
  });

  it("binds the digest to the reviewed branch scope", () => {
    const before = branchProfile();
    const after = branchProfile();
    branchTradeArea(after).branchId = "33333333-3333-4333-8333-333333333333";
    after.branchId = "33333333-3333-4333-8333-333333333333";

    expect(createMarketProfileDigest(after)).not.toBe(createMarketProfileDigest(before));
  });

  it("changes when approved branch competitors, topics or source policy change", () => {
    const before = branchProfile();

    const competitorChanged = branchProfile();
    competitorChanged.competitors[0]!.name = "Another competitor";
    expect(createMarketProfileDigest(competitorChanged)).not.toBe(
      createMarketProfileDigest(before),
    );

    const topicChanged = branchProfile();
    topicChanged.topics[0]!.label = "City events";
    expect(createMarketProfileDigest(topicChanged)).not.toBe(createMarketProfileDigest(before));

    const policyChanged = branchProfile();
    policyChanged.sourcePolicy.excludedDomains.push("blocked.example");
    expect(createMarketProfileDigest(policyChanged)).not.toBe(createMarketProfileDigest(before));
  });

  it("refuses a branch document bound to another branch", () => {
    const invalid = branchProfile();
    branchTradeArea(invalid).branchId = BRANCH_ID;

    expect(() => createMarketProfileDigest(invalid)).toThrow();
  });
});
