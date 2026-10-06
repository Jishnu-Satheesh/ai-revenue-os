import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { isCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import { hasGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { isIntegrationHubEnabled } from "@/modules/integrations/application/feature-access";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import { readHomeCampaigns } from "@/modules/campaigns/infrastructure/home-campaign-reader";
import {
  readHomeLogo,
  readHomePosterAssets,
  readHomeReferenceAssets,
} from "@/modules/campaigns/infrastructure/home-asset-reader";
import { loadOrganizationHome } from "@/modules/organizations/infrastructure/home-loader";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import { buildBehindGrowthView } from "@/components/organizations/home/home-growth-fixtures";

vi.mock("@/modules/campaigns/application/feature-access", () => ({
  isCampaignsEnabled: vi.fn(() => true),
  assertCampaignsEnabled: vi.fn(),
  parseCampaignOrganizationIds: vi.fn(() => new Set<string>()),
}));

vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  hasGrowthIntelligenceAccess: vi.fn(() => true),
  assertGrowthIntelligenceAccess: vi.fn(),
  parseGrowthIntelligenceOrganizationIds: vi.fn(() => new Set<string>()),
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  isIntegrationHubEnabled: vi.fn(() => true),
  assertIntegrationHubEnabled: vi.fn(),
  parseIntegrationOrganizationIds: vi.fn(() => new Set<string>()),
  isGovernedReportValidationEnabled: vi.fn(() => false),
  isGovernedReportProjectionEnabled: vi.fn(() => false),
  assertGovernedReportProjectionEnabled: vi.fn(),
  isGovernedEconomicsReadinessEnabled: vi.fn(() => false),
  isGovernedChannelAnalysisEnabled: vi.fn(() => false),
  assertGovernedChannelAnalysisEnabled: vi.fn(),
  assertGovernedEconomicsReadinessEnabled: vi.fn(),
}));

vi.mock("@/domain/access/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/access/permissions")>();
  return {
    ...actual,
    hasOrganizationPermission: vi.fn(actual.hasOrganizationPermission),
  };
});

const mockGetCampaign = vi.fn();
const mockGetVersion = vi.fn();
const mockLatestGenerationRun = vi.fn();

vi.mock("@/modules/campaigns/infrastructure/repository", () => ({
  createCampaignReadRepository: vi.fn(() => ({
    getCampaign: (...args: unknown[]) => mockGetCampaign(...args),
    getVersion: (...args: unknown[]) => mockGetVersion(...args),
    latestGenerationRun: (...args: unknown[]) => mockLatestGenerationRun(...args),
  })),
}));

vi.mock("@/modules/campaigns/infrastructure/home-campaign-reader", () => ({
  readHomeCampaigns: vi.fn(async () => []),
}));

vi.mock("@/modules/campaigns/infrastructure/home-asset-reader", () => ({
  readHomePosterAssets: vi.fn(async () => []),
  readHomeReferenceAssets: vi.fn(async () => []),
  readHomeLogo: vi.fn(async () => null),
}));

const mockLoadAnalysedWindowKeys = vi.fn();
const mockLoadChannelBandsForWindow = vi.fn();
const mockListChannelRecommendationRecords = vi.fn();
const mockListWorkspaceItems = vi.fn();
const mockListProposals = vi.fn();

vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  createAuthenticatedChannelAnalysisRepository: vi.fn(() => ({
    loadAnalysedWindowKeys: (...args: unknown[]) => mockLoadAnalysedWindowKeys(...args),
    loadChannelBandsForWindow: (...args: unknown[]) => mockLoadChannelBandsForWindow(...args),
  })),
}));

vi.mock("@/modules/growth-intelligence/infrastructure/read-repository", () => ({
  createAuthenticatedGrowthIntelligenceReadRepository: vi.fn(() => ({
    listChannelRecommendationRecords: (...args: unknown[]) =>
      mockListChannelRecommendationRecords(...args),
    listWorkspaceItems: (...args: unknown[]) => mockListWorkspaceItems(...args),
  })),
}));

vi.mock("@/modules/campaigns/infrastructure/proposal-read-repository", () => ({
  createCampaignProposalReader: vi.fn(() => ({
    listProposals: (...args: unknown[]) => mockListProposals(...args),
  })),
}));

vi.mock("@/modules/organizations/application/growth-progress-access", () => ({
  isOverviewGrowthProgressEnabled: (...args: [organizationId: string]) => mockGrowthFlag(...args),
}));

vi.mock("@/modules/organizations/infrastructure/growth-progress-repository", () => ({
  createGrowthProgressRepository: vi.fn(() => ({
    readProjections: (...args: unknown[]) => mockReadProjections(...args),
    readRevenueFacts: (...args: unknown[]) => mockReadRevenueFacts(...args),
  })),
}));

vi.mock("@/modules/organizations/infrastructure/growth-advice-reader", () => ({
  createGrowthAdviceReader: vi.fn(() => ({
    readCandidates: (...args: unknown[]) => mockReadAdviceCandidates(...args),
  })),
}));

const mockReadLatestSnapshot = vi.fn();
const mockGrowthFlag = vi.fn<(organizationId: string) => boolean>();
const mockReadProjections = vi.fn();
const mockReadRevenueFacts = vi.fn();
const mockReadAdviceCandidates = vi.fn();

vi.mock("@/modules/organizations/infrastructure/revenue-snapshot-repository", () => ({
  readLatestRevenueSnapshot: (...args: unknown[]) => mockReadLatestSnapshot(...args),
}));

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-09-11T12:00:00.000Z";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN_ID = "44444444-4444-4444-8444-444444444441";
const POSTER_ID = "55555555-5555-4555-8555-555555555551";
const VERSION_ID = "66666666-6666-4666-8666-666666666661";

function fakeSupabase() {
  return {
    from: vi.fn(() => {
      throw new Error("loader must not query directly; readers own the database port");
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: {
      from: vi.fn(() => {
        throw new Error("loader must not sign directly; readers own the storage port");
      }),
    },
  };
}

function snapshot(): DigitalTwinSnapshot {
  return {
    organization: {
      id: ORG_ID,
      name: "Al Noor Kitchen",
      slug: "al-noor-kitchen",
      industry: "restaurant",
      country_code: "AE",
      base_currency: "AED",
      default_timezone: "Asia/Dubai",
      industry_pack_slug: "restaurant",
      branchless_confirmed: false,
      status: "active",
      account_id: "77777777-7777-4777-8777-777777777777",
      created_by: "88888888-8888-4888-888888888888",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-12T08:00:00.000Z",
      archived_at: null,
    },
    branches: [],
    profile: null,
    facts: [],
    goals: [],
    constraints: [],
    policies: [],
    auditEvents: [],
  } as unknown as DigitalTwinSnapshot;
}

function campaignRecord() {
  return {
    item: {
      id: CAMPAIGN_ID,
      title: "Ramadan Push",
      state: "draft",
      sourceKind: "manual_brief",
      sourceLabel: "Manual brief",
      updatedAt: "2026-09-10T10:00:00.000Z",
      awaitingFirstVersion: false,
      openable: true,
      generation: { status: "settled", detail: null },
      version: 1,
      objective: "Drive iftar orders",
      channels: ["direct"],
      spendCeiling: null,
    },
    cover: null,
    coverLabel: null,
  };
}

function posterRecord() {
  return {
    id: `poster:${POSTER_ID}`,
    sourceKind: "poster_render",
    label: "Ramadan Push · hero · iftar spread",
    sourceLabel: "Finished poster render",
    reviewLabel: "Review not recorded",
    reviewState: "unreviewed",
    recordedAt: "2026-09-09T10:00:00.000Z",
    image: null,
    sourceHref: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_ID}?version=${VERSION_ID}`,
  };
}

function referenceRecord() {
  return {
    id: `reference:${VERSION_ID}`,
    sourceKind: "brand_reference",
    label: "House logo lockup",
    sourceLabel: "Brand reference",
    reviewLabel: "Approved reference",
    reviewState: "approved",
    recordedAt: "2026-09-08T10:00:00.000Z",
    image: null,
    sourceHref: `/organizations/${ORG_ID}/assets`,
  };
}

function logoImage() {
  return {
    url: "https://signed.example/logo",
    alt: "Organization logo",
    width: 400,
    height: 400,
    expiresAt: "2026-09-11T12:10:00.000Z",
  };
}

const mockedPermissions = vi.mocked(hasOrganizationPermission);
const mockedCampaignsGate = vi.mocked(isCampaignsEnabled);
const mockedGrowthGate = vi.mocked(hasGrowthIntelligenceAccess);
const mockedIntegrationsGate = vi.mocked(isIntegrationHubEnabled);
const mockedReadCampaigns = vi.mocked(readHomeCampaigns);
const mockedPosters = vi.mocked(readHomePosterAssets);
const mockedReferences = vi.mocked(readHomeReferenceAssets);
const mockedLogo = vi.mocked(readHomeLogo);
const mockedCreateRepo = vi.mocked(createCampaignReadRepository);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCampaignsGate.mockReturnValue(true);
  mockedGrowthGate.mockReturnValue(true);
  mockedIntegrationsGate.mockReturnValue(true);
  mockedPermissions.mockImplementation(
    (role, permission) =>
      (
        ({
          "campaign.read": true,
          "asset.read": true,
          "channel.read": true,
          "growth_intelligence.read": true,
          "memory.read": true,
          "integration.read": true,
          "campaign.create": true,
          "campaign.edit": true,
          "campaign.approve": true,
        }) as Record<string, boolean>
      )[permission] ?? false,
  );
  mockedReadCampaigns.mockResolvedValue([]);
  mockedPosters.mockResolvedValue([]);
  mockedReferences.mockResolvedValue([]);
  mockedLogo.mockResolvedValue(null);
  mockLoadAnalysedWindowKeys.mockResolvedValue([]);
  mockLoadChannelBandsForWindow.mockResolvedValue([]);
  mockListChannelRecommendationRecords.mockResolvedValue([]);
  mockListWorkspaceItems.mockResolvedValue([]);
  mockListProposals.mockResolvedValue([]);
  mockReadLatestSnapshot.mockResolvedValue({ state: "missing" });
  mockGrowthFlag.mockReturnValue(false);
  mockReadProjections.mockResolvedValue({ status: "missing", reason: "PROJECTION_MISSING" });
  mockReadRevenueFacts.mockResolvedValue({ status: "ready", facts: [] });
  mockReadAdviceCandidates.mockResolvedValue({ candidates: [], laneErrors: {} });
  mockGetCampaign.mockResolvedValue(null);
  mockGetVersion.mockResolvedValue(null);
  mockLatestGenerationRun.mockResolvedValue(null);
  vi.spyOn(logger, "error").mockImplementation(() => {});
});

function loadWith(supabase: unknown, role: "admin" = "admin") {
  return loadOrganizationHome({
    supabase: supabase as never,
    organizationId: ORG_ID,
    role,
    actorId: "99999999-9999-4999-8999-999999999999",
    snapshot: snapshot(),
    correlationId: CORRELATION_ID,
    now: NOW,
  });
}

describe("gated and unauthorized sources are never called", () => {
  it("campaigns rollout off means no campaign or asset reader runs", async () => {
    mockedCampaignsGate.mockReturnValue(false);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockedReadCampaigns).not.toHaveBeenCalled();
    expect(mockedPosters).not.toHaveBeenCalled();
    expect(mockedReferences).not.toHaveBeenCalled();
    expect(mockedLogo).not.toHaveBeenCalled();
    expect(supabase.storage.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(view.campaigns.status).toBe("disabled");
    expect(view.assets.status).toBe("disabled");
    expect(view.logo).toBeNull();
  });

  it("asset.read denied keeps campaign text but skips every cover and gallery reader", async () => {
    mockedPermissions.mockImplementation((role, permission) =>
      permission === "asset.read" ? false : permission === "campaign.read",
    );
    mockedReadCampaigns.mockResolvedValue([campaignRecord()] as never);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockedReadCampaigns).toHaveBeenCalledTimes(1);
    expect(mockedReadCampaigns.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG_ID,
      correlationId: CORRELATION_ID,
      canReadArtwork: false,
    });
    expect(mockedPosters).not.toHaveBeenCalled();
    expect(mockedReferences).not.toHaveBeenCalled();
    expect(mockedLogo).not.toHaveBeenCalled();
    expect(supabase.storage.from).not.toHaveBeenCalled();
    expect(view.campaigns.status).toBe("ready");
  });

  it("campaign.read denied disables campaigns and posters but keeps references and logo", async () => {
    mockedPermissions.mockImplementation((role, permission) =>
      permission === "campaign.read" ? false : permission === "asset.read",
    );
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockedReadCampaigns).not.toHaveBeenCalled();
    expect(mockedPosters).not.toHaveBeenCalled();
    expect(mockedReferences).toHaveBeenCalledTimes(1);
    expect(mockedLogo).toHaveBeenCalledTimes(1);
    expect(view.campaigns.status).toBe("disabled");
  });
});

describe("permission bypass is impossible", () => {
  it("reference denial still gets no logo bytes", async () => {
    mockedPermissions.mockImplementation((role, permission) => permission === "campaign.read");
    mockedReadCampaigns.mockResolvedValue([campaignRecord()] as never);
    const supabase = fakeSupabase();

    await loadWith(supabase);

    expect(mockedReferences).not.toHaveBeenCalled();
    expect(mockedLogo).not.toHaveBeenCalled();
    expect(mockedReadCampaigns.mock.calls[0]?.[0]).toMatchObject({
      canReadArtwork: false,
    });
  });

  it("campaign-read denial gets no poster bytes via covers or gallery", async () => {
    mockedPermissions.mockImplementation((role, permission) =>
      permission === "asset.read" ? true : false,
    );
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockedReadCampaigns).not.toHaveBeenCalled();
    expect(mockedPosters).not.toHaveBeenCalled();
    expect(view.campaigns.status).toBe("disabled");
    // References stay allowed (asset.read + rollout), so the gallery is ready
    // from references alone — but no poster bytes flow via covers or gallery.
    expect(mockedReferences).toHaveBeenCalledTimes(1);
    expect(view.assets.status).toBe("ready");
  });
});

describe("loader touches only database, read, and storage ports", () => {
  it("performs no direct database, storage, or rpc work itself", async () => {
    const supabase = fakeSupabase();

    await loadWith(supabase);

    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.storage.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("same session client and organization for every read", () => {
  it("passes the exact supabase object, organization id, correlation, and now to every reader", async () => {
    const supabase = fakeSupabase();

    await loadWith(supabase);

    expect(mockedCreateRepo).toHaveBeenCalledTimes(1);
    expect(mockedCreateRepo.mock.calls[0]?.[0]).toBe(supabase);
    for (const call of mockedReadCampaigns.mock.calls) {
      expect(call[0]).toMatchObject({
        organizationId: ORG_ID,
        correlationId: CORRELATION_ID,
        now: NOW,
      });
      expect((call[0] as { database: unknown }).database).toBe(supabase);
      expect((call[0] as { storage: { storage: unknown } }).storage.storage).toBe(supabase.storage);
    }
    for (const mock of [mockedPosters, mockedReferences, mockedLogo]) {
      expect(mock).toHaveBeenCalledTimes(1);
      const call = mock.mock.calls[0]?.[0] as {
        database: unknown;
        storage: { storage: unknown };
        organizationId: string;
        correlationId: string;
        now: string;
      };
      expect(call.organizationId).toBe(ORG_ID);
      expect(call.correlationId).toBe(CORRELATION_ID);
      expect(call.now).toBe(NOW);
      expect(call.database).toBe(supabase);
      expect(call.storage.storage).toBe(supabase.storage);
    }
  });
});

describe("failure isolation", () => {
  const RAW_SENTINEL = "RAW_DB_PATH_/etc/passwd_SECRET_PAYLOAD";

  it("campaigns failure keeps assets ready and serializes no raw detail", async () => {
    mockedReadCampaigns.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", `The campaign preview could not be loaded. ${RAW_SENTINEL}`),
    );
    mockedPosters.mockResolvedValue([posterRecord()] as never);
    mockedReferences.mockResolvedValue([referenceRecord()] as never);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.campaigns.status).toBe("failed");
    expect(view.assets.status).toBe("ready");
    expect(view.goals).toEqual([]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(RAW_SENTINEL);
    expect(serialized).not.toContain("/etc/passwd");
    expect(serialized).not.toContain("storage_path");
    expect(logger.error).toHaveBeenCalledWith(
      "organization_home.section_read_failed",
      expect.objectContaining({
        organizationId: ORG_ID,
        correlationId: CORRELATION_ID,
      }),
    );
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).not.toContain(RAW_SENTINEL);
    expect(logged).not.toContain("/etc/passwd");
  });

  it("posters-only failure stays ready with partial gallery", async () => {
    mockedReadCampaigns.mockResolvedValue([campaignRecord()] as never);
    mockedPosters.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", "The home gallery could not be loaded."),
    );
    mockedReferences.mockResolvedValue([referenceRecord()] as never);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.assets.status).toBe("ready");
    expect(view.assetsPartial).toBe(true);
    if (view.assets.status === "ready") expect(view.assets.data).toHaveLength(1);
  });

  it("both gallery sources failing fails assets without failing campaigns", async () => {
    mockedReadCampaigns.mockResolvedValue([campaignRecord()] as never);
    mockedPosters.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", "The home gallery could not be loaded."),
    );
    mockedReferences.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", "The home gallery could not be loaded."),
    );
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.assets.status).toBe("failed");
    expect(view.campaigns.status).toBe("ready");
  });

  it("logo failure degrades to null logo with everything else ready", async () => {
    mockedReadCampaigns.mockResolvedValue([campaignRecord()] as never);
    mockedPosters.mockResolvedValue([posterRecord()] as never);
    mockedReferences.mockResolvedValue([referenceRecord()] as never);
    mockedLogo.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", "The home logo could not be loaded."),
    );
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.logo).toBeNull();
    expect(view.campaigns.status).toBe("ready");
    expect(view.assets.status).toBe("ready");
  });

  it("ready sources carry the single request timestamp as fetchedAt", async () => {
    mockedReadCampaigns.mockResolvedValue([campaignRecord()] as never);
    mockedPosters.mockResolvedValue([posterRecord()] as never);
    mockedReferences.mockResolvedValue([referenceRecord()] as never);
    mockedLogo.mockResolvedValue(logoImage() as never);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.campaigns.status).toBe("ready");
    if (view.campaigns.status === "ready") expect(view.campaigns.fetchedAt).toBe(NOW);
    expect(view.assets.status).toBe("ready");
    if (view.assets.status === "ready") expect(view.assets.fetchedAt).toBe(NOW);
    expect(view.logo).not.toBeNull();
  });
});

describe("revenue section reads", () => {
  const LOSS_ID = "22222222-2222-4222-8222-222222222221";

  function grossFinding(channelId: string, minorUnits: number) {
    return {
      id: `33333333-3333-4333-8333-3333333333${channelId === "chan-a" ? "31" : "32"}`,
      analysisRunId: "44444444-4444-4444-8444-444444444441",
      channelId,
      branchId: null,
      detectorKey: "revenue.window",
      detectorVersion: 1,
      kind: "observation",
      code: "WINDOW_GROSS_REVENUE",
      severity: null,
      priority: null,
      metricKey: null,
      periodStart: "2026-08-04",
      periodEnd: "2026-08-10",
      valueKind: "money",
      valueNumerator: minorUnits,
      valueDenominator: null,
      currency: "AED",
      monetaryImpactMinorUnits: null,
      expectedPeriodCount: null,
      observedPeriodCount: null,
      absentPeriodCount: null,
      qualityState: "complete",
      needsDataReason: null,
      limitations: [],
      calculationDigest: "digest",
      createdAt: "2026-08-11T00:00:00.000Z",
    };
  }

  function lossFinding() {
    return {
      ...grossFinding("chan-a", 12),
      id: LOSS_ID,
      code: "ORDER_CANCELLATION_LOSS",
      valueKind: "count",
      valueNumerator: 12,
      monetaryImpactMinorUnits: 200_00,
    };
  }

  function settleRevenue() {
    mockLoadAnalysedWindowKeys.mockResolvedValue([
      { windowStart: "2026-08-11", windowEnd: "2026-08-17", grain: "week" },
      { windowStart: "2026-08-04", windowEnd: "2026-08-10", grain: "week" },
    ]);
    mockLoadChannelBandsForWindow.mockImplementation(async (input: unknown) => {
      const window = input as { windowStart: string };
      if (window.windowStart === "2026-08-11") {
        return [
          {
            channelId: "chan-a",
            analysisRunId: "44444444-4444-4444-8444-444444444441",
            findings: [grossFinding("chan-a", 700_00)],
          },
        ];
      }
      return [
        {
          channelId: "chan-a",
          analysisRunId: "44444444-4444-4444-8444-444444444441",
          findings: [grossFinding("chan-a", 500_00), lossFinding()],
        },
        {
          channelId: "chan-b",
          analysisRunId: "44444444-4444-4444-8444-444444444442",
          findings: [grossFinding("chan-b", 300_00)],
        },
      ];
    });
    mockListChannelRecommendationRecords.mockResolvedValue([
      {
        id: "rec-1",
        headline: "Recover avoidable cancellations",
        label: "recommendation",
        decision: {
          decision: "planned",
          snoozedUntil: null,
          createdAt: "2026-08-12T00:00:00.000Z",
        },
        citationFindingIds: [LOSS_ID],
      },
    ] as never);
    mockListWorkspaceItems.mockResolvedValue([
      {
        id: "ins-1",
        kind: "insight",
        narrative: "Weekend demand is climbing.",
        decision: "acknowledged",
      },
    ] as never);
    mockListProposals.mockResolvedValue([
      {
        proposal: {
          id: "66666666-6666-4666-8666-666666666666",
          sourceKind: "manual_request",
          sourceId: null,
          state: "ready_for_review",
          currentVersionId: null,
          linkedCampaignId: null,
          snoozedUntil: null,
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
        version: null,
        decisions: [],
      },
    ] as never);
  }

  it("composes history, losses, and the three action kinds", async () => {
    settleRevenue();
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockLoadAnalysedWindowKeys).toHaveBeenCalledWith({ organizationId: ORG_ID });
    expect(mockLoadChannelBandsForWindow).toHaveBeenCalledTimes(2);
    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready") return;
    expect(view.revenue.fetchedAt).toBe(NOW);
    expect(view.revenue.data.state).toBe("ready");
    if (view.revenue.data.state !== "ready") return;
    expect(view.revenue.data.history).toHaveLength(2);
    expect(view.revenue.data.baselineMinorUnits).toBe(700_00);
    expect(view.revenue.data.unquantified).toHaveLength(3);
    const cited = view.revenue.data.unquantified.find((entry) => entry.actionId === "rec:rec-1");
    expect(cited?.status).toBe("planned");
    const proposal = view.revenue.data.unquantified.find((entry) => entry.kind === "proposal");
    expect(proposal?.href).toContain("campaign-proposals");
  });

  it("keeps observations and needs-data rows out of the feasible set", async () => {
    settleRevenue();
    mockListChannelRecommendationRecords.mockResolvedValue([
      {
        id: "obs-1",
        headline: "Gross revenue data is unavailable for this time period.",
        label: "observation",
        decision: null,
        citationFindingIds: [],
      },
      {
        id: "nd-1",
        headline: "Provide matching sales data for the selected date range.",
        label: "needs_data",
        decision: null,
        citationFindingIds: [],
      },
    ] as never);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready" || view.revenue.data.state !== "ready") return;
    const ids = view.revenue.data.unquantified.map((entry) => entry.actionId);
    expect(ids).not.toContain("rec:obs-1");
    expect(ids).not.toContain("rec:nd-1");
  });

  it("a failed band read fails the section but keeps campaigns", async () => {
    settleRevenue();
    mockLoadChannelBandsForWindow.mockRejectedValue(new Error("db down"));
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.revenue).toEqual({ status: "failed", code: "HOME_READ_FAILED" });
    expect(view.campaigns.status).toBe("ready");
  });

  it("a failed action read fails the section rather than shipping partial actions", async () => {
    settleRevenue();
    mockListChannelRecommendationRecords.mockRejectedValue(new Error("db down"));
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.revenue).toEqual({ status: "failed", code: "HOME_READ_FAILED" });
  });

  it("channel.read denied disables the section and schedules no analysis reads", async () => {
    mockedPermissions.mockImplementation((role, permission) => permission !== "channel.read");
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.revenue).toEqual({ status: "disabled" });
    expect(mockLoadAnalysedWindowKeys).not.toHaveBeenCalled();
    expect(mockListChannelRecommendationRecords).not.toHaveBeenCalled();
    expect(mockListProposals).not.toHaveBeenCalled();
  });

  it("growth gate off contributes no recommendations or insights", async () => {
    settleRevenue();
    mockedGrowthGate.mockReturnValue(false);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockListChannelRecommendationRecords).not.toHaveBeenCalled();
    expect(mockListWorkspaceItems).not.toHaveBeenCalled();
    expect(mockListProposals).toHaveBeenCalled();
    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready") return;
    expect(view.revenue.data.state).toBe("ready");
    if (view.revenue.data.state !== "ready") return;
    expect(
      view.revenue.data.unquantified.filter((entry) => entry.kind === "recommendation"),
    ).toHaveLength(0);
    expect(view.revenue.data.unquantified.some((entry) => entry.kind === "proposal")).toBe(true);
  });
});

describe("revenue snapshot reads", () => {
  const SNAP_ORG = ORG_ID;
  function snapshotInput() {
    return {
      organizationId: SNAP_ORG,
      grain: "month" as const,
      history: [{ label: "2026-08", minorUnits: 800_00, currency: "AED" }],
      losses: [],
      actions: [
        {
          id: "proposal:11111111-1111-4111-8111-111111111111",
          title: "Stored proposal",
          kind: "proposal" as const,
          status: "Ready",
          href: `/organizations/${SNAP_ORG}/campaign-proposals/11111111-1111-4111-8111-111111111111`,
          citedFindingId: null,
          citedBasisMinorUnits: null,
          citedCurrency: null,
          assumptionLow: null,
          assumptionHigh: null,
        },
      ],
      lastObservationDate: "2026-08-31",
      today: "2026-09-16",
      cutoffNote: "Reports through 2026-08-31.",
      coverageNote: "1 reporting channel · monthly buckets.",
    };
  }

  it("serves the stored snapshot without touching analysis reads", async () => {
    mockReadLatestSnapshot.mockResolvedValue({
      state: "ready",
      snapshotDate: "2026-09-16",
      input: snapshotInput(),
      aiNote: "Nightly model-proposed ranges applied as explicit assumptions.",
      digest: "digest",
    });
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockLoadAnalysedWindowKeys).not.toHaveBeenCalled();
    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready" || view.revenue.data.state !== "ready") return;
    expect(view.revenue.data.baselineMinorUnits).toBe(800_00);
    expect(view.revenue.data.notes).toContain(
      "Nightly model-proposed ranges applied as explicit assumptions.",
    );
  });

  it("marks an older snapshot as stale but still serves it", async () => {
    mockReadLatestSnapshot.mockResolvedValue({
      state: "ready",
      snapshotDate: "2026-09-10",
      input: snapshotInput(),
      aiNote: null,
      digest: "digest",
    });
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready" || view.revenue.data.state !== "ready") return;
    expect(view.revenue.data.notes).toContain(
      "Snapshot from 2026-09-10; the nightly refresh has not landed yet.",
    );
  });

  it("narrows stored proposals by the viewer's campaign access", async () => {
    mockReadLatestSnapshot.mockResolvedValue({
      state: "ready",
      snapshotDate: "2026-09-16",
      input: snapshotInput(),
      aiNote: null,
      digest: "digest",
    });
    mockedCampaignsGate.mockReturnValue(false);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready" || view.revenue.data.state !== "ready") return;
    expect(view.revenue.data.unquantified).toHaveLength(0);
  });

  it("falls back to live reads when no snapshot validates", async () => {
    mockReadLatestSnapshot.mockResolvedValue({ state: "corrupt" });
    mockLoadAnalysedWindowKeys.mockResolvedValue([]);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);
    expect(mockLoadAnalysedWindowKeys).toHaveBeenCalled();
    expect(view.revenue.status).toBe("ready");
    if (view.revenue.status !== "ready") return;
    expect(view.revenue.data.state).toBe("refused");
  });
});

describe("growth flag loading", () => {
  it("flag OFF keeps legacy behavior exactly with growth disabled", async () => {
    mockGrowthFlag.mockReturnValue(false);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockGrowthFlag).toHaveBeenCalledWith(ORG_ID);
    expect(view.growthProgress).toEqual({ state: "disabled" });
    expect(mockReadProjections).not.toHaveBeenCalled();
    expect(mockReadRevenueFacts).not.toHaveBeenCalled();
    expect(mockReadAdviceCandidates).not.toHaveBeenCalled();
  });

  it("flag ON bypasses the legacy revenue path and composes growth instead", async () => {
    mockGrowthFlag.mockReturnValue(true);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockReadLatestSnapshot).not.toHaveBeenCalled();
    expect(mockLoadAnalysedWindowKeys).not.toHaveBeenCalled();
    expect(mockLoadChannelBandsForWindow).not.toHaveBeenCalled();
    expect(mockListChannelRecommendationRecords).not.toHaveBeenCalled();
    expect(mockListWorkspaceItems).not.toHaveBeenCalled();
    expect(view.revenue).toEqual({ status: "disabled" });
    expect(mockReadProjections).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      asOfDate: "2026-09-11",
    });
    expect(view.growthProgress.state).toBe("ready");
    if (view.growthProgress.state !== "ready") return;
    expect(view.growthProgress.views[1].state).toBe("missing");
  });

  it("flag ON leaves campaigns, assets and permissions untouched", async () => {
    mockedReadCampaigns.mockResolvedValue([campaignRecord()] as never);
    mockedPosters.mockResolvedValue([posterRecord()] as never);
    mockedReferences.mockResolvedValue([referenceRecord()] as never);
    const supabase = fakeSupabase();

    mockGrowthFlag.mockReturnValue(false);
    const legacy = await loadWith(supabase);
    mockGrowthFlag.mockReturnValue(true);
    const flagged = await loadWith(fakeSupabase());

    expect(flagged.campaigns).toEqual(legacy.campaigns);
    expect(flagged.assets).toEqual(legacy.assets);
    expect(flagged.assetsPartial).toBe(legacy.assetsPartial);
    expect(flagged.permissions).toEqual(legacy.permissions);
    expect(flagged.attention).toEqual(legacy.attention);
    expect(flagged.destinations).toEqual(legacy.destinations);
    expect(flagged.activity).toEqual(legacy.activity);
  });

  it("channel.read denied never schedules the projection read", async () => {
    mockGrowthFlag.mockReturnValue(true);
    mockedPermissions.mockImplementation((role, permission) => permission !== "channel.read");
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(mockReadProjections).not.toHaveBeenCalled();
    expect(mockReadRevenueFacts).not.toHaveBeenCalled();
    expect(mockReadAdviceCandidates).not.toHaveBeenCalled();
    expect(view.growthProgress.state).toBe("ready");
    if (view.growthProgress.state !== "ready") return;
    expect(view.growthProgress.views[1]).toMatchObject({
      state: "unavailable",
      reasonCode: "PERMISSION_DENIED",
    });
  });

  it("a throwing growth read degrades the section with a safe log, never the lower home", async () => {
    mockGrowthFlag.mockReturnValue(true);
    mockReadProjections.mockRejectedValue(new Error("transport down"));
    mockedReadCampaigns.mockResolvedValue([campaignRecord()] as never);
    const supabase = fakeSupabase();

    const view = await loadWith(supabase);

    expect(view.growthProgress).toEqual({
      state: "failed",
      reasonCode: "SOURCE_READ_FAILED",
      retainedView: null,
    });
    expect(view.campaigns.status).toBe("ready");
    expect(logger.error).toHaveBeenCalledWith(
      "organization_home.section_read_failed",
      expect.objectContaining({
        organizationId: ORG_ID,
        correlationId: CORRELATION_ID,
        errorCode: "growth:home_read_failed",
      }),
    );
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).not.toContain("transport down");
  });

  it("carries a caller-supplied last-good view on a throwing growth read", async () => {
    mockGrowthFlag.mockReturnValue(true);
    mockReadProjections.mockRejectedValue(new Error("transport down"));
    const supabase = fakeSupabase();
    const retained = buildBehindGrowthView(ORG_ID);

    const view = await loadOrganizationHome({
      supabase: supabase as never,
      organizationId: ORG_ID,
      role: "admin",
      actorId: "99999999-9999-4999-8999-999999999999",
      snapshot: snapshot(),
      correlationId: CORRELATION_ID,
      now: NOW,
      retainedGrowthView: retained,
    });

    expect(view.growthProgress).toEqual({
      state: "failed",
      reasonCode: "SOURCE_READ_FAILED",
      retainedView: retained,
    });
  });
});
