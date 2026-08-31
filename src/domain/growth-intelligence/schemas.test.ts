import { describe, expect, it } from "vitest";

import { marketProfileDocumentV1Schema } from "@/domain/growth-intelligence/schemas";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";

function validProfile() {
  return {
    schemaVersion: 1 as const,
    publicIdentity: {
      approvedName: "  Kerala Kitchen  ",
      domains: ["Example.COM."],
      publicUrls: ["https://example.com/menu#today"],
    },
    nicheDescriptors: ["Kerala cuisine", "Restaurant"],
    geographies: [
      {
        layer: "trade_area" as const,
        locationRef: "ae:du:dubai-marina",
        name: "Dubai Marina delivery area",
        branchId: BRANCH_ID,
        radiusKm: 8,
      },
      {
        layer: "city" as const,
        locationRef: "ae:du",
        name: "Dubai",
        countryCode: "AE",
      },
      {
        layer: "country" as const,
        locationRef: "ae",
        name: "United Arab Emirates",
        countryCode: "AE",
      },
    ],
    competitors: [
      {
        key: "competitor-one",
        name: "Competitor One",
        publicUrl: "https://competitor.example/#home",
        geographyRefs: ["ae:du"],
        relevanceEvidenceUrls: ["https://directory.example/competitor-one#listing"],
        relevanceReason: "Serves the same confirmed city and cuisine category.",
      },
    ],
    topics: [
      {
        key: "local-events",
        label: "Local events",
        provenance: "core" as const,
      },
    ],
    sourcePolicy: {
      excludedDomains: ["Spam.EXAMPLE."],
      excludedPublishers: ["  Untrusted Publisher  "],
      excludedCompetitorKeys: [],
      allowBoundedQuotes: true,
      maxQuotationCharacters: 240,
    },
    cadence: {
      timeZone: "Asia/Dubai",
      dailyLocalTime: "06:30",
      weeklyDay: "monday" as const,
      weeklyLocalTime: "07:00",
    },
  };
}

describe("marketProfileDocumentV1Schema", () => {
  it("normalizes the public profile without changing its business meaning", () => {
    const profile = marketProfileDocumentV1Schema.parse(validProfile());

    expect(profile.publicIdentity).toEqual({
      approvedName: "Kerala Kitchen",
      domains: ["example.com"],
      publicUrls: ["https://example.com/menu"],
    });
    expect(profile.sourcePolicy.excludedDomains).toEqual(["spam.example"]);
    expect(profile.sourcePolicy.excludedPublishers).toEqual(["Untrusted Publisher"]);
    expect(profile.competitors[0]?.publicUrl).toBe("https://competitor.example/");
    expect(profile.competitors[0]?.relevanceEvidenceUrls).toEqual([
      "https://directory.example/competitor-one",
    ]);
  });

  it("rejects an unknown field instead of silently expanding approved scope", () => {
    const input = { ...validProfile(), unapprovedResearchInstruction: "Search everywhere" };

    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow();
  });

  it("rejects duplicate normalized domains", () => {
    const input = validProfile();
    input.publicIdentity.domains = ["example.com", "EXAMPLE.COM."];

    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow(/domains must be unique/i);
  });

  it("rejects duplicate competitor keys", () => {
    const input = validProfile();
    input.competitors = [input.competitors[0]!, { ...input.competitors[0]! }];

    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow(
      /competitor keys must be unique/i,
    );
  });

  it("rejects a non-public URL scheme", () => {
    const input = validProfile();
    input.publicIdentity.publicUrls = ["file:///private/menu"];

    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow(/http/i);
  });

  it("requires confirmed city and country context", () => {
    const input = validProfile();
    input.geographies = input.geographies.filter(({ layer }) => layer === "trade_area");

    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow(/city/i);
    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow(/country/i);
  });

  it("rejects an unbounded niche list", () => {
    const input = validProfile();
    input.nicheDescriptors = Array.from({ length: 13 }, (_, index) => `Niche ${index + 1}`);

    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow();
  });

  it("rejects an invalid organization timezone", () => {
    const input = validProfile();
    input.cadence.timeZone = "Mars/Olympus";

    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow(/timezone/i);
  });

  it("requires quote retention to be zero when quotations are disabled", () => {
    const input = validProfile();
    input.sourcePolicy.allowBoundedQuotes = false;

    expect(() => marketProfileDocumentV1Schema.parse(input)).toThrow(/quotation/i);
  });
});
