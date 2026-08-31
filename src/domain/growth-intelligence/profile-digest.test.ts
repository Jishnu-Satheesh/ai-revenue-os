import { describe, expect, it } from "vitest";

import { createMarketProfileDigest } from "@/domain/growth-intelligence/profile-digest";
import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";

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
