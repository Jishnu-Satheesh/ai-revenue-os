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
  resolveMonthInput: vi.fn(),
}));

vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  createAuthenticatedChannelAnalysisRepository: vi.fn(() => ({
    resolveMonthInput: repositoryMocks.resolveMonthInput,
  })),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() },
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

const validBody = { month: "2026-02" };

const params = Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertEnabled.mockReturnValue(undefined);
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: {},
  });
  mocks.requestChannelAnalysis.mockResolvedValue(true);
  repositoryMocks.resolveMonthInput.mockResolvedValue({
    windowStart: "2026-02-01",
    windowEnd: "2026-02-28",
    timeZone: "Asia/Dubai",
    grain: "day",
  });
});

describe("POST channel analysis", () => {
  it("resolves the month server-side and dispatches it", async () => {
    const response = await POST(request(validBody), { params });

    expect(response.status).toBe(202);
    const body = (await response.json()) as { analysisRunId: string };
    expect(body.analysisRunId).toMatch(/^[0-9a-f-]{36}$/);
    expect(repositoryMocks.resolveMonthInput).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      month: "2026-02",
    });
    expect(mocks.requestChannelAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        channelId: CHANNEL,
        branchId: null,
        windowStart: "2026-02-01",
        windowEnd: "2026-02-28",
        periodGrain: "day",
        month: "2026-02",
        windowTimezone: "Asia/Dubai",
      }),
    );
  });

  it("refuses a month outside the channel's known timeline", async () => {
    repositoryMocks.resolveMonthInput.mockResolvedValue(null);

    const response = await POST(request({ month: "2026-09" }), { params });

    expect(response.status).toBe(400);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses caller-supplied dates, which cannot bypass the resolver", async () => {
    const response = await POST(request({ month: "2026-02", windowStart: "2026-02-01" }), {
      params,
    });

    expect(response.status).toBe(400);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a member whose role cannot retry governed work", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION,
      user: { id: "user-1" },
      membership: { role: "viewer" },
      supabase: {},
    });

    const response = await POST(request(validBody), { params });

    expect(response.status).toBe(403);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a caller from outside the organization before doing any work", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access to this organization."),
    );

    const response = await POST(request(validBody), { params });

    expect(response.status).toBe(403);
    expect(mocks.assertEnabled).not.toHaveBeenCalled();
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses an organization the slice is not enabled for", async () => {
    mocks.assertEnabled.mockImplementation(() => {
      throw new DomainError("FEATURE_NOT_AVAILABLE", "Not enabled.");
    });

    const response = await POST(request(validBody), { params });

    expect(response.status).toBe(422);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a month that is not canonical", async () => {
    const response = await POST(request({ month: "2026-13" }), { params });

    expect(response.status).toBe(400);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a grain no caller may name, since the server resolves it", async () => {
    const response = await POST(request({ ...validBody, periodGrain: "hour" }), { params });

    expect(response.status).toBe(400);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a field the contract does not know rather than ignoring it", async () => {
    const response = await POST(request({ ...validBody, channelId: "someone-elses" }), { params });

    expect(response.status).toBe(400);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("says the run did not start rather than reporting a success nobody got", async () => {
    mocks.requestChannelAnalysis.mockResolvedValue(false);

    const response = await POST(request(validBody), { params });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/could not be started/i);
  });
});
