import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  createReaders: vi.fn(),
  propose: vi.fn(),
  publish: vi.fn(),
  info: vi.fn(),
  trigger: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/agent-chat/infrastructure/thread-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/agent-chat/infrastructure/thread-repository")>();
  return { ...actual, createThreadRepository: mocks.createRepo };
});
vi.mock("@/modules/agent-router/infrastructure/light-model-provider", () => ({
  createLightModelProvider: () => ({ propose: mocks.propose }),
}));
vi.mock("@/modules/agent-chat/application/api", () => ({
  createAgentContextReaders: mocks.createReaders,
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: mocks.trigger },
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: mocks.publish }),
}));
vi.mock("@/lib/logger", async (importOriginal) => {
  // Slice C F4: the route narrows codes through the real helper, so the
  // mock keeps every real export and only swaps the sink.
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return { ...actual, logger: { warn: vi.fn(), info: mocks.info, error: vi.fn() } };
});
// The test organization sits inside the agent rollout allowlist; a refusal
// below proves authorization or validation, never the feature being off.
vi.mock("@/lib/env", () => ({
  env: { AGENT_CHAT_V1_ORGANIZATION_IDS: "10000000-0000-4000-8000-000000000001" },
}));

import { POST } from "@/app/api/organizations/[organizationId]/agent/threads/[threadId]/route/route";

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

const MESSAGE_ROW = {
  id: "90000000-0000-4000-8000-000000000009",
  threadId: THREAD,
  role: "user",
  body: "research the downtown lunch crowd",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:01:00.000Z",
};

function contextWithRole(role: string) {
  return {
    supabase: {},
    user: { id: USER },
    organizationId: ORGANIZATION,
    membership: { role },
  };
}

function request(url: string, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: { "x-correlation-id": CORRELATION, ...(init?.headers ?? {}) },
  });
}

const params = { params: Promise.resolve({ organizationId: ORGANIZATION, threadId: THREAD }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue(contextWithRole("operator"));
  mocks.createRepo.mockReturnValue({
    getThread: vi.fn(async () => THREAD_ROW),
    latestUserMessage: vi.fn(async () => MESSAGE_ROW),
  });
  mocks.createReaders.mockReturnValue({});
  mocks.propose.mockResolvedValue({ intent: "research_once", confidence: "high", missing: [] });
});

describe("agent thread route endpoint", () => {
  it("classifies the newest message and returns intent, questionnaire, and thread", async () => {
    const response = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/route?page=overview`,
        { method: "POST", body: JSON.stringify({ idempotencyKey: "k-1111111111111111" }) },
      ),
      params,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    // Quick thread + research judgment: silent server-owned escalation,
    // never the retired upgrade nudge and never silent spend.
    expect(body.intent).toBe("research_once");
    expect(body.questionnaire).toBeNull();
    expect(body.thread.id).toBe(THREAD);
    expect(body.thread.mode).toBe("deepthink");
    expect(body.correlationId).toBe(CORRELATION);
    // The route answers confidence + reason codes for the drawer steps,
    // and the routed log line carries intent/confidence/reasons/threadId.
    expect(body.confidence).toBe("high");
    expect(body.reasonCodes).toEqual(expect.arrayContaining(["DEEPTHINK_AUTO_ESCALATED"]));
    expect(mocks.info).toHaveBeenCalledWith(
      "agent_thread.routed",
      expect.objectContaining({
        organizationId: ORGANIZATION,
        threadId: THREAD,
        intent: "research_once",
        confidence: "high",
      }),
    );
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.propose).toHaveBeenCalledWith(
      expect.objectContaining({ text: MESSAGE_ROW.body, page: "overview", activeWatchCount: 0 }),
    );
  });

  it("lets viewers route: classification is read-only", async () => {
    mocks.getOrganizationContext.mockResolvedValue(contextWithRole("viewer"));
    const response = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/route`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "k-2222222222222222" }),
      }),
      params,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).intent).toBe("answer_memory");
  });

  it("fails closed when the provider throws", async () => {
    mocks.propose.mockRejectedValue(new Error("provider down"));
    const response = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/route`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "k-3333333333333333" }),
      }),
      params,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.intent).toBe("answer_memory");
    expect(body.questionnaire.kind).toBe("clarify");
  });

  it("refuses an empty thread with 422", async () => {
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      latestUserMessage: vi.fn(async () => null),
    });
    const response = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/route`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "k-4444444444444444" }),
      }),
      params,
    );
    expect(response.status).toBe(422);
  });

  it("reads a foreign thread as not-found", async () => {
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => null),
      latestUserMessage: vi.fn(async () => null),
    });
    const response = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/route`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "k-5555555555555555" }),
      }),
      params,
    );
    expect(response.status).toBe(404);
  });

  it("requires the idempotency key in the body", async () => {
    const response = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/route`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      params,
    );
    expect(response.status).toBe(400);
  });
});

describe("agent thread route auto-run (B3)", () => {
  function send(idempotencyKey: string) {
    return POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/route`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey }),
      }),
      params,
    );
  }

  it("auto-enqueues research on an escalated send and carries the receipt", async () => {
    mocks.createReaders.mockReturnValue({
      getMarketProfile: vi.fn(async () => ({
        status: "current",
        versionId: "55555555-5555-4555-8555-555555555555",
        digest: "fedcba9876543210",
      })),
    });
    mocks.trigger.mockResolvedValue({ id: "run_route_auto_1" });
    const response = await send("k-b3-route-0000000001");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.thread.mode).toBe("deepthink");
    expect(body.research).toMatchObject({ status: "dispatched", runId: "run_route_auto_1" });
    expect(body.research.idempotencyKey).toMatch(/^agent_thread:/);
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
    const [taskId, payload, options] = mocks.trigger.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(taskId).toBe("agent-chat.research-once");
    expect(payload).toMatchObject({
      organizationId: ORGANIZATION,
      threadId: THREAD,
      profileVersionId: "55555555-5555-4555-8555-555555555555",
      correlationId: CORRELATION,
    });
    expect(options).toMatchObject({ idempotencyKey: payload["idempotencyKey"] });
  });

  it("degrades a closed gate on the send path with PROFILE_UNBOUND", async () => {
    mocks.createReaders.mockReturnValue({});
    // A distinct turn from the dispatched test above, so the shared
    // dispatch-dedup store cannot replay the kept run here.
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      latestUserMessage: vi.fn(async () => ({
        ...MESSAGE_ROW,
        body: "research the uptown dinner crowd",
      })),
    });
    const response = await send("k-b3-route-0000000002");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.research).toMatchObject({ status: "blocked", runId: null });
    expect(body.research.reasonCode).toBe("PROFILE_UNBOUND");
    expect(body.reasonCodes).toContain("PROFILE_UNBOUND");
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
});
