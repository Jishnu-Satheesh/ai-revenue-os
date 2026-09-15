import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
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
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/market-research/live-preview/route";
import { DomainError } from "@/lib/errors";
import { BRAVE_WEB_SEARCH_ENDPOINT } from "@/modules/growth-intelligence/infrastructure/research/brave-search-adapter";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000002";
const correlationId = "90000000-0000-4000-8000-000000000009";
const TEST_API_KEY = "test-brave-key";
const ORIGINAL_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.test/market-research/live-preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    branchId,
    topics: ["weekend brunch"],
    competitors: [],
    idempotencyKey: "live-preview-key-0001",
    ...overrides,
  };
}

function stubBranchLookup(row: { id: string } | null) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const secondEq = vi.fn(() => ({ maybeSingle }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, firstEq, secondEq, maybeSingle };
}

function stubContext(branchRow: { id: string } | null = { id: branchId }) {
  const branch = stubBranchLookup(branchRow);
  const supabase = {
    ...branch,
    rpc: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase,
  });
  return supabase;
}

function braveEnvelope(
  items: Array<{ url: string; title?: string; description?: string }>,
) {
  return {
    web: {
      results: items.map((item, index) => ({
        url: item.url,
        title: item.title ?? `Result ${index + 1}`,
        description: item.description ?? `Snippet ${index + 1}`,
      })),
    },
  };
}

function jsonFetchResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
let fetchImpl: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
  jsonFetchResponse(200, braveEnvelope([]));

function installFetchStub() {
  fetchCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BRAVE_SEARCH_API_KEY = TEST_API_KEY;
  fetchImpl = () => jsonFetchResponse(200, braveEnvelope([]));
  installFetchStub();
  mocks.hasPermission.mockReturnValue(true);
  stubContext();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_API_KEY === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
  else process.env.BRAVE_SEARCH_API_KEY = ORIGINAL_API_KEY;
});

describe("POST market-research live-preview", () => {
  it("denies a viewer with 403 before any branch lookup or provider call", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("maps a stranger organization to a safe 404", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("TENANT_SCOPE_ERROR", "You do not have access to this organization."),
    );

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("TENANT_SCOPE_ERROR");
    expect(fetchCalls).toHaveLength(0);
  });

  it("refuses a branch from another organization without calling the provider", async () => {
    stubContext(null);

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ organizationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("TENANT_SCOPE_ERROR");
    expect(fetchCalls).toHaveLength(0);
  });

  it("rejects an invalid body with 400", async () => {
    const response = await POST(
      request(validBody({ topics: [], competitors: [] })),
      { params: Promise.resolve({ organizationId }) },
    );

    expect(response.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns a safe 404 when the provider key is not configured", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ organizationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toEqual({
      code: "FEATURE_NOT_AVAILABLE",
      message: "Live preview is not configured.",
    });
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns attributed results with no-store headers and writes nothing", async () => {
    const supabase = stubContext();
    fetchImpl = () =>
      jsonFetchResponse(
        200,
        braveEnvelope([
          {
            url: "https://example.com/brunch-guide",
            title: "Brunch guide",
            description: "Fresh brunch spots",
          },
        ]),
      );

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ organizationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(body.liveOnly).toBe(true);
    expect(body.correlationId).toBe(correlationId);
    expect(body.queryCount).toBe(1);
    expect(body.resultCount).toBe(1);
    expect(typeof body.disclaimer).toBe("string");
    expect(body.disclaimer.length).toBeGreaterThan(0);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      title: "Brunch guide",
      url: "https://example.com/brunch-guide",
      publisher: "example.com",
      snippet: "Fresh brunch spots",
    });
    expect(typeof body.results[0].retrievedAt).toBe("string");
    expect(body.retrievedAt).toBe(body.results[0].retrievedAt);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url.startsWith(`${BRAVE_WEB_SEARCH_ENDPOINT}?`)).toBe(true);
    expect(fetchCalls[0]!.init.method).toBe("GET");
    expect(fetchCalls[0]!.init.redirect).toBe("manual");
    const sentHeaders = new Headers(fetchCalls[0]!.init.headers);
    expect(sentHeaders.get("X-Subscription-Token")).toBe(TEST_API_KEY);

    expect(supabase.from).toHaveBeenCalledWith("branches");
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.insert).not.toHaveBeenCalled();
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("continues past a single failed query and still returns the survivors", async () => {
    stubContext();
    let calls = 0;
    fetchImpl = () => {
      calls += 1;
      if (calls === 1) throw new Error("provider-boom");
      return jsonFetchResponse(
        200,
        braveEnvelope([
          {
            url: "https://example.com/survivor",
            title: "Survivor",
            description: "Surviving snippet",
          },
        ]),
      );
    };

    const response = await POST(
      request(validBody({ topics: ["brunch", "seafood"] })),
      { params: Promise.resolve({ organizationId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.queryCount).toBe(2);
    expect(body.resultCount).toBe(1);
    expect(body.results[0].title).toBe("Survivor");
    expect(JSON.stringify(body)).not.toContain("provider-boom");
  });

  it("degrades a total provider failure to a safe 422 without leaking", async () => {
    fetchImpl = () => {
      throw new Error("provider-boom-secret-detail");
    };

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ organizationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("INTEGRATION_ERROR");
    expect(JSON.stringify(body)).not.toContain("provider-boom");
    expect(JSON.stringify(body)).not.toContain(TEST_API_KEY);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.warn).toHaveBeenCalledWith(
      "growth_intelligence.market_research_live_preview_api_failed",
      expect.objectContaining({
        organizationId,
        correlationId,
        errorCode: "INTEGRATION_ERROR",
      }),
    );
    const logged = JSON.stringify(mocks.warn.mock.calls);
    expect(logged).not.toContain("provider-boom");
    expect(logged).not.toContain(TEST_API_KEY);
  });

  it("treats an over-budget provider body as a failed query", async () => {
    fetchImpl = () =>
      new Response("x".repeat(300 * 1024), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const response = await POST(request(validBody()), {
      params: Promise.resolve({ organizationId }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("INTEGRATION_ERROR");
  });
});
