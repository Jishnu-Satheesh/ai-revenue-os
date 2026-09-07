import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const mocks = vi.hoisted(() => ({
  assertEnabled: vi.fn(),
  getOrganizationContext: vi.fn(),
  requestChannelRecommendations: vi.fn(),
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
  requestChannelRecommendations: mocks.requestChannelRecommendations,
}));

const repositoryMocks = vi.hoisted(() => ({
  loadRun: vi.fn(),
}));

vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  createAuthenticatedChannelAnalysisRepository: vi.fn(() => ({
    loadRun: repositoryMocks.loadRun,
  })),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/channels/[channelId]/analysis-runs/[analysisRunId]/recommendations/route";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";
const RUN = "66666666-6666-4666-8666-666666666666";

function request() {
  return new Request("https://example.test/recommendations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

const params = Promise.resolve({
  organizationId: ORGANIZATION,
  channelId: CHANNEL,
  analysisRunId: RUN,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertEnabled.mockReturnValue(undefined);
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: {},
  });
  mocks.requestChannelRecommendations.mockResolvedValue(true);
  repositoryMocks.loadRun.mockResolvedValue({ id: RUN, channelId: CHANNEL, status: "completed" });
});

describe("POST run recommendations", () => {
  it("wakes the narrator for a completed run of this channel", async () => {
    const response = await POST(request(), { params });

    expect(response.status).toBe(202);
    expect(mocks.requestChannelRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        channelId: CHANNEL,
        analysisRunId: RUN,
      }),
    );
  });

  it("refuses a run that belongs to another channel", async () => {
    // The read is scoped to organization and channel, so another channel's run
    // comes back absent rather than coming back and being rejected here.
    repositoryMocks.loadRun.mockResolvedValue(null);

    const response = await POST(request(), { params });

    expect(response.status).toBe(400);
    expect(mocks.requestChannelRecommendations).not.toHaveBeenCalled();
    expect(repositoryMocks.loadRun).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      analysisRunId: RUN,
    });
  });

  it("reads the named run by id, so a run past the page's run cap still resolves", async () => {
    await POST(request(), { params });

    expect(repositoryMocks.loadRun).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      analysisRunId: RUN,
    });
  });

  it("refuses a run that has not completed", async () => {
    repositoryMocks.loadRun.mockResolvedValue({ id: RUN, channelId: CHANNEL, status: "running" });

    const response = await POST(request(), { params });

    expect(response.status).toBe(400);
    expect(mocks.requestChannelRecommendations).not.toHaveBeenCalled();
  });

  it("refuses a member whose role cannot retry governed work", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION,
      user: { id: "user-1" },
      membership: { role: "viewer" },
      supabase: {},
    });

    const response = await POST(request(), { params });

    expect(response.status).toBe(403);
    expect(mocks.requestChannelRecommendations).not.toHaveBeenCalled();
  });

  it("says the narration did not start rather than reporting a success nobody got", async () => {
    mocks.requestChannelRecommendations.mockResolvedValue(false);

    const response = await POST(request(), { params });

    expect(response.status).toBe(422);
  });
});
