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

import { GET } from "@/app/api/organizations/[organizationId]/growth-intelligence/performance-build/route";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const CHANNEL_A = "55555555-5555-4555-8555-555555555555";
const CHANNEL_B = "66666666-6666-4666-8666-666666666666";

const params = Promise.resolve({ organizationId: ORGANIZATION });
const url = `https://example.test/build?from=2026-01-01&to=2026-02-28&channels=${CHANNEL_A},${CHANNEL_B}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    membership: { role: "viewer" },
    user: { id: "66666666-6666-4666-8666-666666666666" },
    supabase: {},
  });
});

function run(status: string, recommendationCount: number) {
  return { id: "77777777-7777-4777-8777-777777777777", status, recommendationCount };
}

describe("GET performance build status", () => {
  it("reports building while any channel is still queued or running", async () => {
    mocks.loadRunForWindow
      .mockResolvedValueOnce(run("completed", 6))
      .mockResolvedValueOnce(run("running", 0));

    const body = await (await GET(new Request(url), { params })).json();

    expect(body.state).toBe("building");
    expect(body.stages).toEqual([
      { channelId: CHANNEL_A, stage: "ready" },
      { channelId: CHANNEL_B, stage: "running" },
    ]);
  });

  it("reports ready once every channel has something to read", async () => {
    mocks.loadRunForWindow
      .mockResolvedValueOnce(run("completed", 6))
      .mockResolvedValueOnce(run("completed", 2));

    const body = await (await GET(new Request(url), { params })).json();

    expect(body.state).toBe("ready");
  });

  it("reports failed when nothing is left to wait for and nothing is ready", async () => {
    mocks.loadRunForWindow
      .mockResolvedValueOnce(run("failed", 0))
      .mockResolvedValueOnce(run("failed", 0));

    const body = await (await GET(new Request(url), { params })).json();

    expect(body.state).toBe("failed");
  });

  it("treats a failed channel as absent rather than blocking ready ones", async () => {
    mocks.loadRunForWindow
      .mockResolvedValueOnce(run("completed", 6))
      .mockResolvedValueOnce(run("failed", 0));

    const body = await (await GET(new Request(url), { params })).json();

    expect(body.state).toBe("ready");
    expect(body.stages).toEqual([
      { channelId: CHANNEL_A, stage: "ready" },
      { channelId: CHANNEL_B, stage: "failed" },
    ]);
  });

  it("refuses a malformed channel list without reaching the database", async () => {
    const response = await GET(
      new Request("https://example.test/build?from=2026-01-01&to=2026-02-28&channels=nope"),
      { params },
    );

    expect(response.status).toBe(400);
    expect(mocks.loadRunForWindow).not.toHaveBeenCalled();
  });

  it("scopes every channel read to the organization in the URL", async () => {
    mocks.loadRunForWindow.mockResolvedValue(null);

    await GET(new Request(url), { params });

    expect(mocks.loadRunForWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: CHANNEL_A,
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
    });
  });
});
