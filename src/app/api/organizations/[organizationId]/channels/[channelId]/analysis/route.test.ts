import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The real organization-context module is kept, so `apiErrorResponse` maps the
// domain error codes exactly as production does. Only its Supabase client
// import is stubbed, because constructing one needs environment this test has
// no business carrying.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const mocks = vi.hoisted(() => ({
  assertEnabled: vi.fn(),
  getOrganizationContext: vi.fn(),
  requestChannelAnalysis: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  assertGovernedChannelAnalysisEnabled: mocks.assertEnabled,
}));
vi.mock("@/lib/api/organization-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/organization-context")>(
    "@/lib/api/organization-context",
  );
  return { ...actual, getOrganizationContext: mocks.getOrganizationContext };
});
vi.mock("@/modules/analysis/application/dispatch", () => ({
  requestChannelAnalysis: mocks.requestChannelAnalysis,
}));

const repositoryMocks = vi.hoisted(() => ({
  resolveWindowInput: vi.fn(),
}));

vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  createAuthenticatedChannelAnalysisRepository: vi.fn(() => ({
    resolveWindowInput: repositoryMocks.resolveWindowInput,
  })),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() },
}));

const rateMocks = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock("@/lib/cache/rate-limit", () => ({
  consumeAnalysisRunAllowance: rateMocks.consume,
}));

import { POST } from "@/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";

function request(body: unknown) {
  return new Request("https://example.test/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertEnabled.mockReturnValue(undefined);
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: {},
  });
});

describe("POST channel analysis, by window", () => {
  beforeEach(() => {
    rateMocks.consume.mockResolvedValue(true);
    mocks.requestChannelAnalysis.mockResolvedValue(true);
    repositoryMocks.resolveWindowInput.mockResolvedValue({
      windowStart: "2026-01-01",
      windowEnd: "2026-01-04",
      timeZone: "Asia/Dubai",
      grain: "day",
    });
  });

  it("starts a run for a covered four-day range", async () => {
    const response = await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(202);
    expect(mocks.requestChannelAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        channelId: CHANNEL,
        branchId: null,
        windowStart: "2026-01-01",
        windowEnd: "2026-01-04",
        periodGrain: "day",
        windowTimezone: "Asia/Dubai",
      }),
    );
  });

  it("refuses an organization the slice is not enabled for", async () => {
    mocks.assertEnabled.mockImplementation(() => {
      throw new DomainError("FEATURE_NOT_AVAILABLE", "Not enabled.");
    });

    const response = await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(422);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a range the reports do not cover", async () => {
    repositoryMocks.resolveWindowInput.mockResolvedValue(null);

    const response = await POST(request({ from: "2026-03-01", to: "2026-03-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    // 400, not 422: `apiErrorResponse` maps VALIDATION_ERROR to 400.
    expect(response.status).toBe(400);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a reversed range", async () => {
    const response = await POST(request({ from: "2026-01-04", to: "2026-01-01" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    // A Zod refusal, which this codebase answers with 400.
    expect(response.status).toBe(400);
    expect(repositoryMocks.resolveWindowInput).not.toHaveBeenCalled();
  });

  it("refuses a range wider than a run may cover", async () => {
    const response = await POST(request({ from: "2024-01-01", to: "2026-01-01" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(400);
    expect(repositoryMocks.resolveWindowInput).not.toHaveBeenCalled();
  });

  it("refuses a malformed date rather than passing it to the resolver", async () => {
    const response = await POST(request({ from: "2026-02-30", to: "2026-03-01" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(400);
  });

  it("refuses when the organization is over its run allowance", async () => {
    rateMocks.consume.mockResolvedValue(false);

    const response = await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(429);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("checks coverage before spending the allowance", async () => {
    // An uncovered range must not consume the organization's budget. Order
    // matters: a mistyped date should cost nothing.
    repositoryMocks.resolveWindowInput.mockResolvedValue(null);

    await POST(request({ from: "2026-03-01", to: "2026-03-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(rateMocks.consume).not.toHaveBeenCalled();
  });

  it("resolves coverage against the organization in the URL, never one supplied elsewhere", async () => {
    // Tenant isolation. The resolver is called with the route's own
    // organization id, read through the caller's RLS-scoped client, so a
    // range covered in another tenant is not covered here.
    await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(repositoryMocks.resolveWindowInput).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      from: "2026-01-01",
      to: "2026-01-04",
    });
  });

  it("refuses a member whose role cannot retry governed work", async () => {
    // Authorization and the rate limit are orthogonal controls: a caller who
    // may not act at all must be refused before either the coverage read or
    // the allowance is touched, so they cannot burn allowance that belongs to
    // callers who may act.
    mocks.getOrganizationContext.mockResolvedValue(contextWithRole("viewer"));

    const response = await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(403);
    expect(repositoryMocks.resolveWindowInput).not.toHaveBeenCalled();
    expect(rateMocks.consume).not.toHaveBeenCalled();
  });

  it("says the run did not start rather than reporting a success nobody got", async () => {
    mocks.requestChannelAnalysis.mockResolvedValue(false);

    const response = await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/could not be started/i);
  });
});

function contextWithRole(role: string) {
  return {
    organizationId: ORGANIZATION,
    membership: { role },
    user: { id: "66666666-6666-4666-8666-666666666666" },
    supabase: {},
  };
}
