import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/agent-chat/infrastructure/thread-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/agent-chat/infrastructure/thread-repository")>();
  return { ...actual, createThreadRepository: mocks.createRepo };
});
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: mocks.publish }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// The test organization sits inside the agent rollout allowlist; a refusal
// below proves authorization or tenancy, never the feature being off.
vi.mock("@/lib/env", () => ({
  env: { AGENT_CHAT_V1_ORGANIZATION_IDS: "10000000-0000-4000-8000-000000000001" },
}));

import { GET } from "@/app/api/organizations/[organizationId]/agent/threads/[threadId]/route";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const USER = "70000000-0000-4000-8000-000000000007";
const THREAD = "80000000-0000-4000-8000-000000000008";
const CORRELATION = "30000000-0000-4000-8000-000000000003";

const THREAD_ROW = {
  id: THREAD,
  organizationId: ORGANIZATION,
  title: "Hi",
  mode: "quick",
  status: "open",
  linkedResearchProjectId: null,
  linkedRequestId: null,
  linkedDraftRequestId: null,
  linkedCampaignId: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
};

function memberContext(role = "operator") {
  return {
    supabase: {},
    user: { id: USER },
    organizationId: ORGANIZATION,
    membership: { role },
  };
}

function request(url: string) {
  return new Request(url, { headers: { "x-correlation-id": CORRELATION } });
}

const params = { params: Promise.resolve({ organizationId: ORGANIZATION, threadId: THREAD }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue(memberContext());
});

describe("agent thread single read (M9 poll endpoint)", () => {
  it("returns the one thread row with no-store and correlation", async () => {
    mocks.createRepo.mockReturnValue({ getThread: vi.fn(async () => THREAD_ROW) });
    const response = await GET(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}`),
      params,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.thread).toMatchObject({ id: THREAD, status: "open" });
    expect(body.correlationId).toBe(CORRELATION);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reads as not-found for foreign threads, for viewers too", async () => {
    mocks.createRepo.mockReturnValue({ getThread: vi.fn(async () => null) });
    const missing = await GET(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}`),
      params,
    );
    expect(missing.status).toBe(404);

    mocks.getOrganizationContext.mockResolvedValue(memberContext("viewer"));
    mocks.createRepo.mockReturnValue({ getThread: vi.fn(async () => THREAD_ROW) });
    const viewer = await GET(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}`),
      params,
    );
    // Reading is classification-free: viewers may poll their own thread.
    expect(viewer.status).toBe(200);
  });
});
