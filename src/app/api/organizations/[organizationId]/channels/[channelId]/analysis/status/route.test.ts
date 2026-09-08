import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertEnabled: vi.fn(),
  loadRunForWindow: vi.fn(),
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
vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  createAuthenticatedChannelAnalysisRepository: vi.fn(() => ({
    loadRunForWindow: mocks.loadRunForWindow,
  })),
}));

import { GET } from "@/app/api/organizations/[organizationId]/channels/[channelId]/analysis/status/route";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";
const RUN = "77777777-7777-4777-8777-777777777777";

const params = Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL });
const url = "https://example.test/status?from=2026-01-01&to=2026-01-04";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    membership: { role: "viewer" },
    user: { id: "66666666-6666-4666-8666-666666666666" },
    supabase: {},
  });
});

describe("GET analysis status", () => {
  it("reports queued when no run exists for the window yet", async () => {
    mocks.loadRunForWindow.mockResolvedValue(null);

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "queued", analysisRunId: null });
  });

  it("reports running while the detectors are counting", async () => {
    mocks.loadRunForWindow.mockResolvedValue({
      id: RUN,
      status: "running",
      recommendationCount: 0,
    });

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "running", analysisRunId: RUN });
  });

  it("reports narrating once the run has completed but no recommendation has landed", async () => {
    // Narration is a second Trigger task that finishes after the detector run
    // (ADR 0037), so "completed" is not yet "ready" for the operator.
    mocks.loadRunForWindow.mockResolvedValue({
      id: RUN,
      status: "completed",
      recommendationCount: 0,
    });

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "narrating", analysisRunId: RUN });
  });

  it("reports ready once recommendations exist", async () => {
    mocks.loadRunForWindow.mockResolvedValue({
      id: RUN,
      status: "completed",
      recommendationCount: 6,
    });

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "ready", analysisRunId: RUN });
  });

  it("reports a failed run rather than polling forever", async () => {
    mocks.loadRunForWindow.mockResolvedValue({ id: RUN, status: "failed", recommendationCount: 0 });

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "failed", analysisRunId: RUN });
  });

  it("refuses a malformed range without reaching the database", async () => {
    const response = await GET(new Request("https://example.test/status?from=nonsense"), {
      params,
    });

    expect(response.status).toBe(400);
    expect(mocks.loadRunForWindow).not.toHaveBeenCalled();
  });

  it("scopes the read to the organization in the URL", async () => {
    mocks.loadRunForWindow.mockResolvedValue(null);

    await GET(new Request(url), { params });

    expect(mocks.loadRunForWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-04",
    });
  });
});
