import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const USER = "70000000-0000-4000-8000-000000000007";
const THREAD = "80000000-0000-4000-8000-000000000008";
const MESSAGE = "90000000-0000-4000-8000-000000000009";
const CORRELATION = "30000000-0000-4000-8000-000000000003";
const OPPORTUNITY = "33333333-3333-4333-8333-333333333333";
const DRAFT_REQUEST = "44444444-4444-4444-8444-444444444444";
const PROFILE_VERSION = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  getMarketProfile: vi.fn(),
  publish: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
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
vi.mock("@/modules/agent-chat/application/api", () => ({
  createAgentContextReaders: () => ({ getMarketProfile: mocks.getMarketProfile }),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: mocks.publish }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: mocks.info, error: vi.fn() },
}));
// The test organization sits inside the agent rollout allowlist; a refusal
// below proves authorization or validation, never the feature being off.
vi.mock("@/lib/env", () => ({
  env: { AGENT_CHAT_V1_ORGANIZATION_IDS: "10000000-0000-4000-8000-000000000001" },
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: mocks.trigger },
}));

import { POST } from "@/app/api/organizations/[organizationId]/agent/threads/[threadId]/dispatch/route";
import { buildDispatchPayload } from "@/modules/agent-chat/application/api-schemas";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import type { ThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";

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
  id: MESSAGE,
  threadId: THREAD,
  role: "user",
  body: "research the downtown lunch crowd",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:01:00.000Z",
};

const OPPORTUNITY_ROW = {
  id: OPPORTUNITY,
  organization_id: ORGANIZATION,
  version: 2,
  status: "proposed",
  action_key: "campaign.governed_draft_v1",
};

function contextWithRole(role: string, supabase: unknown) {
  return {
    supabase,
    user: { id: USER },
    organizationId: ORGANIZATION,
    membership: { role },
  };
}

function sessionSupabase() {
  const rpc = vi.fn(async (name: string) => {
    if (name === "request_campaign_draft_from_opportunity") {
      return {
        data: { requestId: DRAFT_REQUEST, status: "created", draftRequestStatus: "pending" },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { ...OPPORTUNITY_ROW }, error: null })),
        })),
        maybeSingle: vi.fn(async () => ({ data: { ...OPPORTUNITY_ROW }, error: null })),
      })),
    })),
  }));
  return { rpc, from };
}

function request(body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/dispatch`,
    {
      method: "POST",
      headers: { "x-correlation-id": CORRELATION, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ organizationId: ORGANIZATION, threadId: THREAD }) };

function campaignAdviceBlock() {
  return {
    opportunity: { id: OPPORTUNITY, version: 2 },
    objective: "Lift weekday-evening gross profit",
    audience: "Families within a 15-minute drive",
    assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
    evidenceSnapshot: {
      windowDays: 30,
      observedAt: "2026-09-20T10:00:00.000Z",
      digest: "0123456789abcdef",
      citations: ["ledger:2026-09-01:2026-09-20"],
    },
    evidenceSnapshotFreezable: true,
    marketProfile: { versionId: "mp-v3", digest: "fedcba9876543210" },
    policyPass: true,
    capabilityPass: true,
    schedulePass: true,
    audienceReady: true,
    estimate: {
      valueText: "+AED 4,000 gross profit / week",
      inputs: ["weekday-evening covers, last 30 days"],
      assumptions: ["no menu-price change during the window"],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockImplementation(async () => contextWithRole("operator", sessionSupabase()));
  mocks.createRepo.mockReturnValue({
    getThread: vi.fn(async () => ({ ...THREAD_ROW })),
    latestUserMessage: vi.fn(async () => ({ ...MESSAGE_ROW })),
    getMessage: vi.fn(async () => ({ ...MESSAGE_ROW })),
    setThreadLinks: vi.fn(async (input: { draftRequestId?: string }) => ({
      threadId: THREAD,
      projectId: null,
      requestId: null,
      draftRequestId: input.draftRequestId ?? null,
      campaignId: null,
    })),
  });
  mocks.getMarketProfile.mockResolvedValue({
    status: "current",
    versionId: PROFILE_VERSION,
    digest: "fedcba9876543210",
  });
  mocks.trigger.mockResolvedValue({ id: "run_0000000000000001" });
});

describe("agent dispatch endpoint gates", () => {
  it("refuses viewers before touching the trigger lane", async () => {
    mocks.getOrganizationContext.mockResolvedValue(contextWithRole("viewer", sessionSupabase()));
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000001",
        action: "research_once",
        confirmation: { confirmed: true },
      }),
      params,
    );
    expect(response.status).toBe(403);
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("refuses campaign drafts for viewers without the create grant", async () => {
    mocks.getOrganizationContext.mockResolvedValue(contextWithRole("viewer", sessionSupabase()));
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000002",
        action: "campaign_advice",
        confirmation: { confirmed: true },
        campaignAdvice: campaignAdviceBlock(),
      }),
      params,
    );
    expect(response.status).toBe(403);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before any enqueue", async () => {
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000003",
        action: "research_once",
        confirmation: { confirmed: false },
      }),
      params,
    );
    expect(response.status).toBe(400);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("enqueues research once on the agent-chat lane with a thread-linked key", async () => {
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000004",
        action: "research_once",
        confirmation: { confirmed: true },
      }),
      params,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.outcome).toBe("dispatched");
    expect(body.replayed).toBe(false);
    expect(body.eventId).toBeNull();
    expect(body.runId).toBe("run_0000000000000001");
    expect(body.idempotencyKey).toMatch(/^agent_thread:/);
    expect(body.link.href).toContain("/growth-intelligence");
    expect(body.correlationId).toBe(CORRELATION);
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
    const [taskId, payload, options] = mocks.trigger.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(taskId).toBe("agent-chat.research-once");
    expect(payload).toMatchObject({
      organizationId: ORGANIZATION,
      actorId: USER,
      threadId: THREAD,
      profileVersionId: PROFILE_VERSION,
      correlationId: CORRELATION,
    });
    expect(options).toMatchObject({ idempotencyKey: payload["idempotencyKey"] });
  });

  it("replays the same token without a duplicate enqueue", async () => {
    const dispatchBody = {
      idempotencyKey: "dispatch-token-00000000000005",
      action: "research_once",
      confirmation: { confirmed: true },
    };
    const first = await POST(request(dispatchBody), params);
    expect(first.status).toBe(201);
    const second = await POST(request(dispatchBody), params);
    expect(second.status).toBe(200);
    const replayed = await second.json();
    expect(replayed.outcome).toBe("dispatched");
    expect(replayed.replayed).toBe(true);
    expect(replayed.idempotencyKey).toBe((await first.json()).idempotencyKey);
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("fails closed without enqueue when no profile version is bound", async () => {
    mocks.getMarketProfile.mockResolvedValue({ status: "missing" });
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000006",
        action: "research_once",
        confirmation: { confirmed: true },
      }),
      params,
    );
    expect(response.status).toBe(400);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("admits a campaign draft through the opportunity resolver with an identifier-only audit event", async () => {
    const supabase = sessionSupabase();
    mocks.getOrganizationContext.mockResolvedValue(contextWithRole("operator", supabase));
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000007",
        action: "campaign_advice",
        confirmation: { confirmed: true },
        campaignAdvice: campaignAdviceBlock(),
      }),
      params,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.outcome).toBe("draft_requested");
    expect(body.replayed).toBe(false);
    expect(body.draftRequestId).toBe(DRAFT_REQUEST);
    expect(typeof body.eventId).toBe("string");
    expect(supabase.from).toHaveBeenCalledWith("opportunities");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "request_campaign_draft_from_opportunity",
      expect.objectContaining({ p_opportunity_id: OPPORTUNITY, p_opportunity_version: 2 }),
    );
    // The audit event carries identifiers plus correlation only — never the
    // operator's objective, audience, estimates, or any message body.
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const event = mocks.publish.mock.calls[0]?.[0] as {
      eventName: string;
      correlationId: string;
      payload: Record<string, unknown>;
    };
    expect(event.eventName).toBe("agent_thread.draft_requested");
    expect(event.correlationId).toBe(CORRELATION);
    expect(Object.keys(event.payload).sort()).toEqual(
      ["draftRequestId", "idempotencyKey", "opportunityId", "threadId"].sort(),
    );
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("Lift weekday-evening");
    expect(serialized).not.toContain("Families within");
    expect(serialized).not.toContain("downtown lunch");
  });

  it("replays a campaign draft on the same token without readmitting", async () => {
    const supabase = sessionSupabase();
    mocks.getOrganizationContext.mockResolvedValue(contextWithRole("operator", supabase));
    const dispatchBody = {
      idempotencyKey: "dispatch-token-00000000000008",
      action: "campaign_advice",
      confirmation: { confirmed: true },
      campaignAdvice: campaignAdviceBlock(),
    };
    const first = await POST(request(dispatchBody), params);
    const firstBody = await first.json();
    const second = await POST(request(dispatchBody), params);
    const replayed = await second.json();
    expect(replayed.replayed).toBe(true);
    expect(replayed.draftRequestId).toBe(DRAFT_REQUEST);
    expect(replayed.eventId).toBe(firstBody.eventId);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("resolves an ineligible draft to a prefilled brief without touching the draft lane", async () => {
    const supabase = sessionSupabase();
    mocks.getOrganizationContext.mockResolvedValue(contextWithRole("operator", supabase));
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000009",
        action: "campaign_advice",
        confirmation: { confirmed: true },
        campaignAdvice: { ...campaignAdviceBlock(), marketProfile: null },
      }),
      params,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("brief_prefilled");
    expect(body.briefUrl).toContain("/campaigns/new");
    expect(body.reasonCodes).toContain("PROFILE_UNBOUND");
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("refuses a moved opportunity version instead of admitting against it", async () => {
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000010",
        action: "campaign_advice",
        confirmation: { confirmed: true },
        campaignAdvice: {
          ...campaignAdviceBlock(),
          opportunity: { id: OPPORTUNITY, version: 99 },
        },
      }),
      params,
    );
    expect(response.status).toBe(400);
  });

  it("requires the action block matching the action", async () => {
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000011",
        action: "watch_create",
        confirmation: { confirmed: true },
      }),
      params,
    );
    expect(response.status).toBe(400);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("reads a foreign thread as not-found", async () => {
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => null),
      latestUserMessage: vi.fn(async () => null),
    });
    const response = await POST(
      request({
        idempotencyKey: "dispatch-token-00000000000012",
        action: "research_once",
        confirmation: { confirmed: true },
      }),
      params,
    );
    expect(response.status).toBe(404);
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("requires the idempotency key in the body", async () => {
    const response = await POST(
      request({ action: "research_once", confirmation: { confirmed: true } }),
      params,
    );
    expect(response.status).toBe(400);
  });
});

describe("dispatch payload builder", () => {
  it("builds the exact confirmed body the drawer posts", () => {
    expect(
      buildDispatchPayload({ action: "research_once", idempotencyKey: "k-1234567890123456" }),
    ).toEqual({
      idempotencyKey: "k-1234567890123456",
      action: "research_once",
      confirmation: { confirmed: true },
    });
  });
});

describe("answer-append failure log (ruling F2)", () => {
  function mockThreads(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
    return {
      createThreadKeyed: vi.fn(async () => ({ threadId: "t1", status: "open", replayed: false })),
      appendMessageKeyed: vi.fn(async () => ({ messageId: "m1", threadId: "t1", replayed: false })),
      getThread: vi.fn(async () => ({
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
      })),
      getMessage: vi.fn(async () => ({ ...MESSAGE_ROW, id: MESSAGE, threadId: THREAD })),
      latestUserMessage: vi.fn(async () => ({ ...MESSAGE_ROW, id: MESSAGE, threadId: THREAD })),
      listThreads: vi.fn(async () => ({ threads: [], nextCursor: null })),
      listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
      ...overrides,
    } as unknown as ThreadRepository;
  }

  it("logs organization, thread, and message ids only when the answer append fails", async () => {
    const threads = mockThreads({
      appendMessageKeyed: vi.fn(async () => {
        throw new Error("idempotency conflict");
      }),
    });
    const service = createThreadService({
      threads,
      events: { publish: mocks.publish },
      proposeRouter: async () => ({ intent: "answer_memory", confidence: "high", missing: [] }),
      correlationId: CORRELATION,
    });
    const out = await service.routeLatest({
      organizationId: ORGANIZATION,
      actorId: USER,
      role: "operator",
      threadId: THREAD,
    });
    // The route still answers: the draft returns without a stored row.
    expect(out.answer?.message).toBeNull();
    expect(out.answer?.draft.body.length).toBeGreaterThan(0);
    expect(mocks.warn).toHaveBeenCalledWith(
      "agent_thread.answer_append_failed",
      expect.objectContaining({
        organizationId: ORGANIZATION,
        threadId: THREAD,
        messageId: MESSAGE,
        correlationId: CORRELATION,
      }),
    );
    const logged = mocks.warn.mock.calls
      .map((call) => JSON.stringify(call[1] ?? null))
      .join("\n");
    expect(logged).not.toContain("research the downtown lunch crowd");
  });
});
