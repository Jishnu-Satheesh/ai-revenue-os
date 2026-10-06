import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventPublisher } from "@/domain/events/types";
import { marketProfileDocumentV1Schema } from "@/domain/growth-intelligence/schemas";
import type {
  MarketProfileDocumentV1,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";
import type {
  MarketProfileProposalContext,
  MarketProfileProposalProvider,
  MarketProfileRepository,
} from "@/modules/growth-intelligence/application/ports";
import { createMarketProfileService } from "@/modules/growth-intelligence/application/profile-service";

const organizationId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const correlationId = "30000000-0000-4000-8000-000000000003";
const versionId = "40000000-0000-4000-8000-000000000004";
const profileId = "50000000-0000-4000-8000-000000000005";

const context: MarketProfileProposalContext = {
  publicIdentity: {
    approvedName: "Malabar Table",
    publicUrls: ["https://malabartable.example/"],
  },
  market: { countryCode: "AE", timeZone: "Asia/Dubai" },
  nicheDescriptors: ["restaurant", "Kerala cuisine"],
  locations: [
    {
      branchId: "60000000-0000-4000-8000-000000000006",
      name: "Dubai Marina",
      serviceAreas: ["Dubai Marina"],
      countryCode: "AE",
      timeZone: "Asia/Dubai",
    },
  ],
  topics: ["Kerala cuisine", "family dining"],
};

const document: MarketProfileDocumentV1 = {
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
      branchId: "60000000-0000-4000-8000-000000000006",
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
  topics: [{ key: "kerala-cuisine", label: "Kerala cuisine", provenance: "ai_proposed" }],
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

const read = vi.fn();
const readProposalContext = vi.fn();
const findProposalReplay = vi.fn();
const propose = vi.fn();
const decide = vi.fn();
const startBranchResearch = vi.fn();
const generate = vi.fn();
const publish = vi.fn();

const branchId = "60000000-0000-4000-8000-000000000006";

const branchDocument: MarketProfileDocumentV2 = {
  schemaVersion: 2,
  branchId,
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
      branchId,
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

function service() {
  const repository: MarketProfileRepository = {
    read,
    readProposalContext,
    findProposalReplay,
    propose,
    decide,
    startBranchResearch,
  };
  const proposalProvider: MarketProfileProposalProvider = {
    modelProvider: "google",
    modelName: "gemini-profile",
    modelVersion: "market-profile-proposal@1",
    generate,
  };
  return createMarketProfileService({
    repository,
    proposalProvider,
    events: { publish } as EventPublisher,
    now: () => new Date("2026-09-01T00:00:00.000Z"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readProposalContext.mockResolvedValue(context);
  findProposalReplay.mockResolvedValue(null);
  generate.mockResolvedValue(document);
  propose.mockResolvedValue({
    profileId,
    profileVersionId: versionId,
    version: 1,
    profileDigest: "a".repeat(64),
    replayed: false,
    isRevision: false,
  });
  decide.mockResolvedValue({
    decisionId: "70000000-0000-4000-8000-000000000007",
    profileVersionId: versionId,
    requestId: "80000000-0000-4000-8000-000000000008",
    decision: "confirmed",
    replayed: false,
  });
});

describe("MarketProfileService", () => {
  it("gives the provider only bounded public proposal context and persists a proposal", async () => {
    await service().propose({
      organizationId,
      actorId,
      source: "ai",
      idempotencyKey: "profile-proposal-0001",
      correlationId,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({ context, repairIssues: null, correlationId });
    expect(JSON.stringify(generate.mock.calls[0]?.[0])).not.toMatch(
      /workbook|customer|phone|email|revenue|raw/i,
    );
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        actorId,
        document: marketProfileDocumentV1Schema.parse(document),
        idempotencyKey: "profile-proposal-0001",
        correlationId,
        proposalContext: expect.objectContaining({
          source: "ai",
          modelProvider: "google",
          modelName: "gemini-profile",
          modelVersion: "market-profile-proposal@1",
          modelInputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it("spends one repair attempt on malformed model output and then persists the valid candidate", async () => {
    generate.mockResolvedValueOnce({ unsafe: true }).mockResolvedValueOnce(document);

    await service().propose({
      organizationId,
      actorId,
      source: "ai",
      idempotencyKey: "profile-proposal-0001",
      correlationId,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toMatchObject({
      context,
      repairIssues: expect.arrayContaining([expect.any(String)]),
      correlationId,
    });
    expect(propose).toHaveBeenCalledTimes(1);
  });

  it("repairs a structurally valid candidate that invents public scope", async () => {
    generate
      .mockResolvedValueOnce({
        ...document,
        publicIdentity: {
          ...document.publicIdentity,
          domains: ["invented.example"],
          publicUrls: ["https://invented.example/"],
        },
        competitors: [
          {
            key: "invented-competitor",
            name: "Invented Competitor",
            geographyRefs: ["city:dubai"],
            relevanceEvidenceUrls: ["https://invented.example/"],
            relevanceReason: "The model guessed.",
          },
        ],
      })
      .mockResolvedValueOnce(document);

    await service().propose({
      organizationId,
      actorId,
      source: "ai",
      idempotencyKey: "profile-proposal-0001",
      correlationId,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]?.repairIssues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Public URLs must come from confirmed context"),
        expect.stringContaining("Competitors require bounded public discovery evidence"),
      ]),
    );
    expect(propose).toHaveBeenCalledTimes(1);
  });

  it("fails safely after one invalid repair and stores nothing", async () => {
    generate.mockResolvedValue({ rawCustomerReport: "do not leak" });

    await expect(
      service().propose({
        organizationId,
        actorId,
        source: "ai",
        idempotencyKey: "profile-proposal-0001",
        correlationId,
      }),
    ).rejects.toThrow("A valid Market Profile proposal could not be prepared.");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(propose).not.toHaveBeenCalled();
  });

  it("persists an operator source-exclusion revision without calling the model", async () => {
    const revision = {
      ...document,
      sourcePolicy: { ...document.sourcePolicy, excludedDomains: ["untrusted.example"] },
    };
    propose.mockResolvedValueOnce({
      profileId,
      profileVersionId: versionId,
      version: 2,
      profileDigest: "b".repeat(64),
      replayed: false,
      isRevision: true,
    });

    await service().propose({
      organizationId,
      actorId,
      source: "operator",
      document: revision,
      idempotencyKey: "profile-proposal-0002",
      correlationId,
    });

    expect(readProposalContext).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({
        document: marketProfileDocumentV1Schema.parse(revision),
        proposalContext: { source: "operator" },
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "market_profile.revision_proposed",
        payload: { profileId, profileVersionId: versionId },
      }),
    );
  });

  it("does not emit another event when persistence replays a proposal", async () => {
    findProposalReplay.mockResolvedValueOnce({
      profileId,
      profileVersionId: versionId,
      version: 1,
      profileDigest: "a".repeat(64),
      replayed: true,
      isRevision: false,
    });

    await service().propose({
      organizationId,
      actorId,
      source: "ai",
      idempotencyKey: "profile-proposal-0001",
      correlationId,
    });

    expect(publish).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
  });

  it("confirms an exact version and emits identifiers only after the committed outcome", async () => {
    await service().decide({
      organizationId,
      actorId,
      profileVersionId: versionId,
      profileDigest: "a".repeat(64),
      decision: "confirmed",
      reason: "Approved scope",
      idempotencyKey: "profile-decision-0001",
      correlationId,
    });

    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ profileVersionId: versionId, profileDigest: "a".repeat(64) }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "market_profile.confirmed",
        payload: {
          decisionId: "70000000-0000-4000-8000-000000000007",
          profileVersionId: versionId,
          requestId: "80000000-0000-4000-8000-000000000008",
        },
      }),
    );
    expect(JSON.stringify(publish.mock.calls[0]?.[0])).not.toContain("Approved scope");
  });

  it("emits disablement but no event for a rejection", async () => {
    decide
      .mockResolvedValueOnce({
        decisionId: "70000000-0000-4000-8000-000000000007",
        profileVersionId: versionId,
        requestId: null,
        decision: "disabled",
        replayed: false,
      })
      .mockResolvedValueOnce({
        decisionId: "90000000-0000-4000-8000-000000000009",
        profileVersionId: versionId,
        requestId: null,
        decision: "rejected",
        replayed: false,
      });

    const instance = service();
    await instance.decide({
      organizationId,
      actorId,
      profileVersionId: versionId,
      profileDigest: "a".repeat(64),
      decision: "disabled",
      reason: "Research paused",
      idempotencyKey: "profile-decision-0002",
      correlationId,
    });
    await instance.decide({
      organizationId,
      actorId,
      profileVersionId: versionId,
      profileDigest: "a".repeat(64),
      decision: "rejected",
      reason: "Wrong scope",
      idempotencyKey: "profile-decision-0003",
      correlationId,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "market_profile.disabled" }),
    );
  });

  it("starts branch research for one branch and emits the start event once", async () => {
    startBranchResearch.mockResolvedValue({
      outcome: "started",
      profileVersionId: versionId,
      pipelineId: "70000000-0000-4000-8000-000000000007",
      researchRequestId: "80000000-0000-4000-8000-000000000008",
    });

    const result = await service().startBranchResearch({
      organizationId,
      actorId,
      branchId,
      document: branchDocument,
      expectedCurrentVersionId: null,
      idempotencyKey: "branch-research-0001",
      correlationId,
    });

    expect(result.outcome).toBe("started");
    expect(startBranchResearch).toHaveBeenCalledWith({
      organizationId,
      actorId,
      branchId,
      document: expect.objectContaining({ schemaVersion: 2, branchId }),
      profileDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      expectedCurrentVersionId: null,
      idempotencyKey: "branch-research-0001",
      correlationId,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "growth_intelligence.research_started",
        payload: {
          profileVersionId: versionId,
          pipelineId: "70000000-0000-4000-8000-000000000007",
          researchRequestId: "80000000-0000-4000-8000-000000000008",
        },
      }),
    );
  });

  it("emits no start event when the scope converges on existing work", async () => {
    startBranchResearch.mockResolvedValue({
      outcome: "existing_active",
      profileVersionId: versionId,
      pipelineId: "70000000-0000-4000-8000-000000000007",
      researchRequestId: "80000000-0000-4000-8000-000000000008",
    });

    const result = await service().startBranchResearch({
      organizationId,
      actorId,
      branchId,
      document: branchDocument,
      expectedCurrentVersionId: null,
      idempotencyKey: "branch-research-0002",
      correlationId,
    });

    expect(result.outcome).toBe("existing_active");
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a v1 document at the branch start entry point", async () => {
    await expect(
      service().startBranchResearch({
        organizationId,
        actorId,
        branchId,
        document: { ...branchDocument, schemaVersion: 1 } as never,
        expectedCurrentVersionId: null,
        idempotencyKey: "branch-research-0001",
        correlationId,
      }),
    ).rejects.toThrow();
    expect(startBranchResearch).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a document bound to another branch without persisting anything", async () => {
    const otherBranch = "90000000-0000-4000-8000-000000000009";
    const foreignDocument = {
      ...branchDocument,
      branchId: otherBranch,
      geographies: branchDocument.geographies.map((geography) =>
        geography.layer === "trade_area" ? { ...geography, branchId: otherBranch } : geography,
      ),
    };
    await expect(
      service().startBranchResearch({
        organizationId,
        actorId,
        branchId,
        document: foreignDocument as never,
        expectedCurrentVersionId: null,
        idempotencyKey: "branch-research-0001",
        correlationId,
      }),
    ).rejects.toThrow("The reviewed scope does not match the selected branch.");
    expect(startBranchResearch).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
