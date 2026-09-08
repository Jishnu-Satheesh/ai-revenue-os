import { describe, expect, it } from "vitest";

import {
  marketProfileDocumentSchema,
  marketProfileDocumentV1Schema,
  marketProfileDocumentV2Schema,
} from "@/domain/growth-intelligence/schemas";
import type {
  MarketProfileCompetitorV2,
  MarketProfileTopic,
} from "@/domain/growth-intelligence/types";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const V2_BRANCH_ID = "22222222-2222-4222-8222-222222222222";

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

  it("uses database-stable code-point ordering for digest-bound sets", () => {
    const input = validProfile();
    input.nicheDescriptors = ["apple", "Zulu"];
    input.sourcePolicy.excludedPublishers = ["apple directory", "Zulu directory"];

    const profile = marketProfileDocumentV1Schema.parse(input);

    expect(profile.nicheDescriptors).toEqual(["Zulu", "apple"]);
    expect(profile.sourcePolicy.excludedPublishers).toEqual(["Zulu directory", "apple directory"]);
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

function validV2Profile() {
  const competitors: MarketProfileCompetitorV2[] = [
    {
      key: "competitor-one",
      name: "Competitor One",
      provenance: "operator_lead",
      suggestedBy: "operator",
      geographyRefs: ["ae:du"],
      relevanceEvidenceUrls: [],
    },
  ];
  const topics: MarketProfileTopic[] = [
    {
      key: "local-events",
      label: "Local events",
      provenance: "core",
    },
  ];
  return {
    schemaVersion: 2 as const,
    branchId: V2_BRANCH_ID,
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
        branchId: V2_BRANCH_ID,
        radiusKm: 8,
      },
      {
        layer: "city" as const,
        locationRef: "ae:du",
        name: "Dubai",
        countryCode: "ae",
      },
      {
        layer: "country" as const,
        locationRef: "ae",
        name: "United Arab Emirates",
        countryCode: "AE",
      },
    ],
    competitors,
    topics,
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

describe("marketProfileDocumentV2Schema", () => {
  it("accepts a name-only operator lead for a single branch", () => {
    const profile = marketProfileDocumentV2Schema.parse(validV2Profile());

    expect(profile.schemaVersion).toBe(2);
    expect(profile.branchId).toBe(V2_BRANCH_ID);
    expect(profile.competitors).toHaveLength(1);
  });

  it("normalizes new interface values before they reach the digest", () => {
    const profile = marketProfileDocumentV2Schema.parse(validV2Profile());

    expect(profile.publicIdentity.approvedName).toBe("Kerala Kitchen");
    expect(profile.publicIdentity.domains).toEqual(["example.com"]);
    expect(profile.publicIdentity.publicUrls).toEqual(["https://example.com/menu"]);
    expect(profile.geographies.find((geography) => geography.layer === "city")).toMatchObject({
      countryCode: "AE",
    });
  });

  it("permits an empty approved-domain list when the business has no website", () => {
    const input = validV2Profile();
    input.publicIdentity.domains = [];

    expect(marketProfileDocumentV2Schema.parse(input).publicIdentity.domains).toEqual([]);
  });

  it("accepts a cited competitor with relevance evidence", () => {
    const input = validV2Profile();
    input.competitors = [
      {
        key: "competitor-one",
        name: "Competitor One",
        publicUrl: "https://competitor.example/",
        locationHint: "Deira",
        provenance: "cited" as const,
        suggestedBy: "ai" as const,
        geographyRefs: ["ae:du"],
        relevanceEvidenceUrls: ["https://directory.example/competitor-one"],
        relevanceReason: "Serves the same confirmed city and cuisine category.",
      },
    ];

    expect(marketProfileDocumentV2Schema.parse(input).competitors).toHaveLength(1);
  });

  it("rejects an uncited artificial-intelligence competitor", () => {
    const input = validV2Profile();
    input.competitors = [
      {
        key: "competitor-one",
        name: "Competitor One",
        provenance: "operator_lead" as const,
        suggestedBy: "ai" as const,
        geographyRefs: ["ae:du"],
        relevanceEvidenceUrls: [],
      },
    ];

    expect(() => marketProfileDocumentV2Schema.parse(input)).toThrow(/cited/i);
  });

  it("rejects a cited competitor without relevance evidence", () => {
    const input = validV2Profile();
    input.competitors = [
      {
        key: "competitor-one",
        name: "Competitor One",
        provenance: "cited" as const,
        suggestedBy: "operator" as const,
        geographyRefs: ["ae:du"],
        relevanceEvidenceUrls: [],
      },
    ];

    expect(() => marketProfileDocumentV2Schema.parse(input)).toThrow(/evidence/i);
  });

  it("rejects a sixth competitor and a twenty-first topic", () => {
    const crowded = validV2Profile();
    crowded.competitors = Array.from({ length: 6 }, (_, index) => ({
      key: `competitor-${index + 1}`,
      name: `Competitor ${index + 1}`,
      provenance: "operator_lead" as const,
      suggestedBy: "operator" as const,
      geographyRefs: [] as string[],
      relevanceEvidenceUrls: [] as string[],
    }));

    expect(() => marketProfileDocumentV2Schema.parse(crowded)).toThrow();

    const wordy = validV2Profile();
    wordy.topics = Array.from({ length: 21 }, (_, index) => ({
      key: `topic-${index + 1}`,
      label: `Topic ${index + 1}`,
      provenance: "operator" as const,
    }));

    expect(() => marketProfileDocumentV2Schema.parse(wordy)).toThrow();
  });

  it("rejects duplicate competitor names and topic labels after normalization", () => {
    const duplicateCompetitors = validV2Profile();
    duplicateCompetitors.competitors = [
      {
        key: "competitor-one",
        name: "Competitor One",
        provenance: "operator_lead" as const,
        suggestedBy: "operator" as const,
        geographyRefs: [],
        relevanceEvidenceUrls: [],
      },
      {
        key: "competitor-two",
        name: "  COMPETITOR one ",
        provenance: "operator_lead" as const,
        suggestedBy: "operator" as const,
        geographyRefs: [],
        relevanceEvidenceUrls: [],
      },
    ];

    expect(() => marketProfileDocumentV2Schema.parse(duplicateCompetitors)).toThrow(
      /competitor names must be unique/i,
    );

    const duplicateTopics = validV2Profile();
    duplicateTopics.topics = [
      { key: "topic-one", label: "Local events", provenance: "operator" as const },
      { key: "topic-two", label: "local EVENTS", provenance: "operator" as const },
    ];

    expect(() => marketProfileDocumentV2Schema.parse(duplicateTopics)).toThrow(
      /topic labels must be unique/i,
    );
  });

  it("rejects credentialed and private competitor URLs", () => {
    const credentialed = validV2Profile();
    credentialed.competitors[0]!.publicUrl = "https://user:secret@competitor.example/private";

    expect(() => marketProfileDocumentV2Schema.parse(credentialed)).toThrow(/credential/i);

    const privateUrl = validV2Profile();
    privateUrl.competitors[0]!.publicUrl = "file:///private/competitor";

    expect(() => marketProfileDocumentV2Schema.parse(privateUrl)).toThrow(/http/i);
  });

  it("rejects competitor geography outside the branch snapshot", () => {
    const input = validV2Profile();
    input.competitors[0]!.geographyRefs = ["us:ny"];

    expect(() => marketProfileDocumentV2Schema.parse(input)).toThrow(/approved profile scope/i);
  });

  it("rejects a trade area bound to another branch", () => {
    const input = validV2Profile();
    input.geographies[0]!.branchId = BRANCH_ID;

    expect(() => marketProfileDocumentV2Schema.parse(input)).toThrow(/branch/i);
  });

  it("requires exactly one trade area, city and country", () => {
    const missingCity = validV2Profile();
    missingCity.geographies = missingCity.geographies.filter(
      ({ layer }) => layer !== "city",
    ) as typeof missingCity.geographies;

    expect(() => marketProfileDocumentV2Schema.parse(missingCity)).toThrow(/city/i);

    const twoTradeAreas = validV2Profile();
    twoTradeAreas.geographies = [
      ...twoTradeAreas.geographies,
      { ...twoTradeAreas.geographies[0]!, locationRef: "ae:du:jumeirah" },
    ];

    expect(() => marketProfileDocumentV2Schema.parse(twoTradeAreas)).toThrow(/trade area/i);
  });

  it("rejects a fourth geography entry because layers are limited to the required three", () => {
    const secondCity = validV2Profile();
    secondCity.geographies = [
      ...secondCity.geographies,
      { ...secondCity.geographies[1]!, locationRef: "ae:sh", name: "Sharjah" },
    ];

    expect(() => marketProfileDocumentV2Schema.parse(secondCity)).toThrow(/exactly one city/i);
  });

  it("preserves source policy and cadence validation from version one", () => {
    const input = validV2Profile();
    input.sourcePolicy.allowBoundedQuotes = false;

    expect(() => marketProfileDocumentV2Schema.parse(input)).toThrow(/quotation/i);

    const badCadence = validV2Profile();
    badCadence.cadence.timeZone = "Mars/Olympus";

    expect(() => marketProfileDocumentV2Schema.parse(badCadence)).toThrow(/timezone/i);
  });
});

describe("marketProfileDocumentSchema", () => {
  it("parses version one and version two by their schema version", () => {
    const v1 = {
      schemaVersion: 1 as const,
      publicIdentity: {
        approvedName: "Kerala Kitchen",
        domains: ["example.com"],
        publicUrls: ["https://example.com/menu"],
      },
      nicheDescriptors: ["Kerala cuisine"],
      geographies: [
        {
          layer: "trade_area" as const,
          locationRef: "ae:du:dubai-marina",
          name: "Dubai Marina delivery area",
          branchId: BRANCH_ID,
          radiusKm: 8,
        },
        { layer: "city" as const, locationRef: "ae:du", name: "Dubai", countryCode: "AE" },
        {
          layer: "country" as const,
          locationRef: "ae",
          name: "United Arab Emirates",
          countryCode: "AE",
        },
      ],
      competitors: [],
      topics: [{ key: "local-events", label: "Local events", provenance: "core" as const }],
      sourcePolicy: {
        excludedDomains: [],
        excludedPublishers: [],
        excludedCompetitorKeys: [],
        allowBoundedQuotes: false,
        maxQuotationCharacters: 0,
      },
      cadence: {
        timeZone: "Asia/Dubai",
        dailyLocalTime: "06:30",
        weeklyDay: "monday" as const,
        weeklyLocalTime: "07:00",
      },
    };

    expect(marketProfileDocumentSchema.parse(v1)).toEqual(marketProfileDocumentV1Schema.parse(v1));
    expect(marketProfileDocumentSchema.parse(validV2Profile()).schemaVersion).toBe(2);
  });

  it("rejects an unknown schema version instead of guessing", () => {
    expect(() =>
      marketProfileDocumentSchema.parse({ ...validV2Profile(), schemaVersion: 3 }),
    ).toThrow();
  });
});
