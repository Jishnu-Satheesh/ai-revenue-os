import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  setThreadLinks: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/agent-chat/application/thread-service", () => ({
  createThreadService: () => ({ setThreadLinks: mocks.setThreadLinks }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/agent/threads/[threadId]/links/route";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const USER = "70000000-0000-4000-8000-000000000007";
const THREAD = "80000000-0000-4000-8000-000000000008";
const DRAFT_REQUEST = "40000000-0000-4000-8000-000000000004";
const CORRELATION = "30000000-0000-4000-8000-000000000003";

function operatorContext() {
  return {
    supabase: {},
    user: { id: USER },
    organizationId: ORGANIZATION,
    membership: { role: "operator" },
  };
}

function request(body: unknown) {
  return new Request(`https://example.test/api/x`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": CORRELATION },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ organizationId: ORGANIZATION, threadId: THREAD }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue(operatorContext());
  mocks.setThreadLinks.mockResolvedValue({
    threadId: THREAD,
    projectId: null,
    requestId: null,
    draftRequestId: DRAFT_REQUEST,
    campaignId: null,
  });
});

describe("POST thread links", () => {
  it("links thread to draft request and returns the kept link ids", async () => {
    const response = await POST(request({ draftRequestId: DRAFT_REQUEST }), params);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ links: { threadId: THREAD, draftRequestId: DRAFT_REQUEST } });
    expect(mocks.setThreadLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        actorId: USER,
        role: "operator",
        threadId: THREAD,
        draftRequestId: DRAFT_REQUEST,
      }),
    );
  });

  it("refuses viewers before persistence and rejects unknown keys", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      membership: { role: "viewer" },
    });
    const viewer = await POST(request({ draftRequestId: DRAFT_REQUEST }), params);
    expect(viewer.status).toBe(403);
    expect(mocks.setThreadLinks).not.toHaveBeenCalled();

    mocks.getOrganizationContext.mockResolvedValue(operatorContext());
    const unknown = await POST(request({ opportunityId: DRAFT_REQUEST }), params);
    expect(unknown.status).toBe(400);
    expect(mocks.setThreadLinks).not.toHaveBeenCalled();
  });
});
