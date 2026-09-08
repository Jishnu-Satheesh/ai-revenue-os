import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  startBranchResearch: vi.fn(),
  createRepository: vi.fn(() => ({ repository: true })),
  warn: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  assertGrowthIntelligenceAccess: mocks.assertAccess,
}));
vi.mock("@/domain/access/permissions", () => ({
  hasOrganizationPermission: mocks.hasPermission,
}));
vi.mock("@/modules/growth-intelligence/infrastructure/profile-repository", () => ({
  createAuthenticatedMarketProfileRepository: mocks.createRepository,
}));
vi.mock("@/modules/growth-intelligence/application/profile-service", () => ({
  createMarketProfileService: () => ({ startBranchResearch: mocks.startBranchResearch }),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/market-profile/research/route";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "60000000-0000-4000-8000-000000000006";
const profileVersionId = "40000000-0000-4000-8000-000000000004";
const pipelineId = "70000000-0000-4000-8000-000000000007";
const researchRequestId = "80000000-0000-4000-8000-000000000008";
const correlationId = "30000000-0000-4000-8000-000000000003";

const document = {
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

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    branchId,
    document,
    expectedCurrentVersionId: null,
    idempotencyKey: "branch-research-0001",
    ...overrides,
  };
}

function post(body: unknown, correlation = correlationId) {
  return POST(
    new Request("https://example.test/market-profile/research", {
      method: "POST",
      headers: { "x-correlation-id": correlation },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ organizationId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "owner" },
    supabase: { session: true },
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.startBranchResearch.mockResolvedValue({
    outcome: "started",
    profileVersionId,
    pipelineId,
    researchRequestId,
  });
});

describe("POST Market Profile branch research start", () => {
  it("starts research with an explicit branch scope and returns 201", async () => {
    const response = await post(requestBody());
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.startBranchResearch).toHaveBeenCalledWith({
      organizationId,
      actorId: "user-1",
      branchId,
      document: expect.objectContaining({ schemaVersion: 2, branchId }),
      expectedCurrentVersionId: null,
      idempotencyKey: "branch-research-0001",
      correlationId,
    });
    expect(payload.research).toMatchObject({
      outcome: "started",
      profileVersionId,
      pipelineId,
      researchRequestId,
    });
    expect(payload.correlationId).toBe(correlationId);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 200 for an identical active scope instead of a second pipeline", async () => {
    mocks.startBranchResearch.mockResolvedValue({
      outcome: "existing_active",
      profileVersionId,
      pipelineId,
      researchRequestId,
    });

    const response = await post(requestBody({ idempotencyKey: "branch-research-0002" }));

    expect(response.status).toBe(200);
    expect((await response.json()).research.outcome).toBe("existing_active");
  });

  it("returns 200 when the same retry key replays the same body", async () => {
    mocks.startBranchResearch.mockResolvedValue({
      outcome: "replayed",
      profileVersionId,
      pipelineId,
      researchRequestId,
    });

    const response = await post(requestBody());

    expect(response.status).toBe(200);
    expect((await response.json()).research.outcome).toBe("replayed");
  });

  it("rejects a viewer mutation before touching the service", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await post(requestBody());

    expect(response.status).toBe(403);
    expect(mocks.startBranchResearch).not.toHaveBeenCalled();
  });

  it("reports a stale expected version as a 422 conflict without a success toast", async () => {
    mocks.startBranchResearch.mockRejectedValue(
      new GrowthIntelligenceError(
        "PROFILE_VERSION_CONFLICT",
        "The reviewed settings are no longer current.",
      ),
    );

    const response = await post(requestBody({ expectedCurrentVersionId: profileVersionId }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("PROFILE_VERSION_CONFLICT");
    expect(payload.research).toBeUndefined();
  });

  it("reports a reused retry key with a different body as a 422 conflict", async () => {
    mocks.startBranchResearch.mockRejectedValue(
      new GrowthIntelligenceError(
        "RESEARCH_IDEMPOTENCY_CONFLICT",
        "This retry key was already used for different research settings.",
      ),
    );

    const response = await post(requestBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("RESEARCH_IDEMPOTENCY_CONFLICT");
  });

  it("rejects a v1 document at the branch entry point", async () => {
    const response = await post(requestBody({ document: { ...document, schemaVersion: 1 } }));

    expect(response.status).toBe(400);
    expect(mocks.startBranchResearch).not.toHaveBeenCalled();
  });

  it("rejects a document bound to another branch", async () => {
    const otherBranch = "90000000-0000-4000-8000-000000000009";
    const response = await post(
      requestBody({
        document: {
          ...document,
          geographies: [
            {
              layer: "trade_area",
              locationRef: "trade-area:dubai-marina",
              name: "Dubai Marina",
              branchId: otherBranch,
            },
            ...(document.geographies.slice(1) as unknown[]),
          ],
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.startBranchResearch).not.toHaveBeenCalled();
  });

  it("keeps unexpected database detail out of the public error", async () => {
    mocks.startBranchResearch.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", "The branch research could not be started.", {
        detail: "raw provider payload",
      }),
    );

    const response = await post(requestBody());
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(JSON.stringify(payload)).not.toMatch(/raw provider payload/);
    expect(mocks.warn).toHaveBeenCalled();
  });
});
