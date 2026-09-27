import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  createReaders: vi.fn(),
  propose: vi.fn(),
  publish: vi.fn(),
  trigger: vi.fn(),
  createProjects: vi.fn(),
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
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: mocks.publish }),
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: mocks.trigger },
}));
vi.mock("@/modules/growth-intelligence/infrastructure/research-project-repository", () => ({
  createAuthenticatedResearchProjectRepository: mocks.createProjects,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// The test organization sits inside the agent rollout allowlist; a refusal
// below proves authorization or validation, never the feature being off.
vi.mock("@/lib/env", () => ({
  env: { AGENT_CHAT_V1_ORGANIZATION_IDS: "10000000-0000-4000-8000-000000000001" },
}));

import { POST } from "@/app/api/organizations/[organizationId]/agent/threads/[threadId]/answers/route";

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

const ANSWERS_MESSAGE = {
  id: "90000000-0000-4000-8000-000000000009",
  threadId: THREAD,
  role: "user",
  body: "[answers missing_fields]\nfrequency: weekly",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:01:00.000Z",
};

const SPEC = {
  kind: "missing_fields",
  title: "One more detail",
  resumeKey: "router:watch:overview:abcdef1234567890",
  items: [
    {
      key: "frequency",
      label: "How often?",
      kind: "single_select",
      required: true,
      options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
      ],
    },
  ],
};

function operatorContext() {
  return {
    supabase: {},
    user: { id: USER },
    organizationId: ORGANIZATION,
    membership: { role: "operator" },
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
  mocks.getOrganizationContext.mockResolvedValue(operatorContext());
  mocks.createReaders.mockReturnValue({});
});

describe("agent thread answers route", () => {
  it("persists answers and re-routes with 201, replaying with 200", async () => {
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
    });
    mocks.propose.mockResolvedValue({ intent: "answer_memory", confidence: "high", missing: [] });
    const created = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "a-1234567890123456",
            resumeKey: SPEC.resumeKey,
            spec: SPEC,
            answers: { frequency: "weekly" },
          }),
        },
      ),
      params,
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({
      replayed: false,
      answers: { frequency: "weekly" },
      resumeKey: SPEC.resumeKey,
      intent: "answer_memory",
      correlationId: CORRELATION,
    });
    // Slice C F2/M6: the re-route's fresh codes travel in the response —
    // the drawer never renders the previous turn's codes beside the card.
    expect(body.confidence).toBe("high");
    expect(body.reasonCodes).toEqual(["MODEL_PROPOSAL_ACCEPTED"]);
    expect(created.headers.get("Cache-Control")).toBe("no-store");
  });

  it("binds the real context readers so the re-route digests the pack (M7)", async () => {
    const supabase = {};
    mocks.getOrganizationContext.mockResolvedValue({ ...operatorContext(), supabase });
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
    });
    mocks.propose.mockResolvedValue({ intent: "answer_memory", confidence: "high", missing: [] });
    const response = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "a-1234567890123456",
            resumeKey: SPEC.resumeKey,
            spec: SPEC,
            answers: { frequency: "weekly" },
          }),
        },
      ),
      params,
    );
    expect(response.status).toBe(201);
    expect(mocks.createReaders).toHaveBeenCalledWith(supabase);
  });

  it("refuses answers for viewers and invalid answers", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      membership: { role: "viewer" },
    });
    const forbidden = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "a-1234567890123456",
            resumeKey: SPEC.resumeKey,
            spec: SPEC,
            answers: { frequency: "weekly" },
          }),
        },
      ),
      params,
    );
    expect(forbidden.status).toBe(403);
    expect(mocks.createRepo).not.toHaveBeenCalled();

    mocks.getOrganizationContext.mockResolvedValue(operatorContext());
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
    });
    const invalid = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "a-1234567890123456",
            resumeKey: SPEC.resumeKey,
            spec: SPEC,
            answers: { frequency: "hourly" },
          }),
        },
      ),
      params,
    );
    expect(invalid.status).toBe(400);
  });

  it("refuses duplicate-watch answers without the manage grant", async () => {
    const watchSpec = {
      ...SPEC,
      kind: "duplicate_watch",
      resumeKey: "router:watch:overview:abcdef1234567890",
      items: [
        {
          key: "choice",
          label: "What should happen?",
          kind: "single_select",
          required: true,
          options: [
            { value: "view_existing", label: "View existing" },
            { value: "cancel", label: "Cancel" },
          ],
        },
      ],
    };
    const payload = {
      idempotencyKey: "w-1234567890123456",
      resumeKey: watchSpec.resumeKey,
      spec: watchSpec,
      answers: { choice: "view_existing" },
    };
    // Viewers hold no manage grant: the watch fence refuses before the
    // generic viewer gate, naming the grant so the drawer can say so.
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      membership: { role: "viewer" },
    });
    const refused = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
      params,
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.message).toMatch(/growth_intelligence\.manage/);
    expect(mocks.createRepo).not.toHaveBeenCalled();

    // Operators hold the grant: the watch card submits like any other.
    // Task B4: view_existing resolves the candidate server-side, so the
    // accepted half carries branch + message + project mocks (no live twin
    // here — the envelope reports a null candidate honestly).
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      supabase: {
        rpc: vi.fn(async () => ({ data: null, error: null })),
        from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
      },
    });
    mocks.createProjects.mockReturnValue({
      listActiveProjects: vi.fn(async () => []),
      createProject: vi.fn(async () => ({ projectId: "p2", lifecycle: "active", replayed: false })),
      updateProjectSchedule: vi.fn(),
    });
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
      listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
    });
    mocks.propose.mockResolvedValue({ intent: "answer_memory", confidence: "high", missing: [] });
    const accepted = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
      params,
    );
    expect(accepted.status).toBe(201);
  });

  it("accepts a campaign-ideas pick through the echoed spec and refuses a broken invariant", async () => {
    const ideasSpec = {
      kind: "campaign_ideas",
      title: "Campaign ideas",
      resumeKey: "router:campaign_advice:overview:abcdef1234567890",
      items: [
        {
          key: "idea",
          label: "Which idea should become a draft?",
          kind: "single_select",
          required: true,
          options: [
            {
              value: "idea-a",
              label: "Lunch rush bundle",
              description: "Noon combo for nearby offices.",
              recommended: false,
            },
            {
              value: "idea-b",
              label: "Weekend family table",
              description: "Saturday set menu for families.",
              recommended: true,
            },
            {
              value: "idea-c",
              label: "Late-night dessert",
              description: "After-9pm dessert counter.",
              recommended: false,
            },
          ],
        },
      ],
    };
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
    });
    mocks.propose.mockResolvedValue({ intent: "answer_memory", confidence: "high", missing: [] });
    // No eligible proposals: the pick resolves to the brief fallback.
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      supabase: {
        rpc: vi.fn(async () => ({ data: null, error: null })),
        from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
      },
    });
    const accepted = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "i-1234567890123456",
            resumeKey: ideasSpec.resumeKey,
            spec: ideasSpec,
            answers: { idea: "idea-b" },
          }),
        },
      ),
      params,
    );
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({
      answers: { idea: "idea-b" },
      resumeKey: ideasSpec.resumeKey,
    });

    // Two recommended flags break the exactly-one invariant, so the
    // echoed spec itself is refused before anything is persisted.
    const broken = {
      ...ideasSpec,
      items: [
        {
          ...ideasSpec.items[0],
          options: ideasSpec.items[0].options.map((option) => ({
            ...option,
            recommended: true,
          })),
        },
      ],
    };
    mocks.createRepo.mockClear();
    const refused = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "i-1234567890123457",
            resumeKey: broken.resumeKey,
            spec: broken,
            answers: { idea: "idea-b" },
          }),
        },
      ),
      params,
    );
    expect(refused.status).toBe(400);
    expect(mocks.createRepo).not.toHaveBeenCalled();
  });

  it("drafts immediately on a campaign-ideas pick with opportunity, one payload", async () => {
    const ideasSpec = {
      kind: "campaign_ideas",
      title: "Campaign ideas",
      resumeKey: "router:campaign_advice:overview:abcdef1234567890",
      items: [
        {
          key: "idea",
          label: "Which idea should become a draft?",
          kind: "single_select",
          required: true,
          options: [
            {
              value: "idea-a",
              label: "Lunch rush bundle",
              description: "Noon combo for nearby offices.",
              recommended: false,
            },
            {
              value: "idea-b",
              label: "Weekend family table",
              description: "Saturday set menu for families.",
              recommended: true,
            },
            {
              value: "idea-c",
              label: "Late-night dessert",
              description: "After-9pm dessert counter.",
              recommended: false,
            },
          ],
        },
      ],
    };
    const rpc = vi.fn(async () => ({
      data: {
        requestId: "44444444-4444-4444-8444-444444444444",
        status: "created",
        draftRequestStatus: "pending",
      },
      error: null,
    }));
    // One eligible proposal: the route binds it server-side (no
    // client-carried opportunity — no caller steers the binding).
    const from = vi.fn(async () => ({
      data: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          organization_id: ORGANIZATION,
          version: 2,
          status: "proposed",
          action_key: "campaign.governed_draft_v1",
          expires_at: "2026-12-31T00:00:00.000Z",
          assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
        },
      ],
      error: null,
    }));
    const supabase = {
      rpc,
      from: () => ({ select: () => ({ eq: from }) }),
    };
    const setThreadLinks = vi.fn(async (input: { draftRequestId?: string }) => ({
      threadId: THREAD,
      projectId: null,
      requestId: null,
      draftRequestId: input.draftRequestId ?? null,
      campaignId: null,
    }));
    mocks.getOrganizationContext.mockResolvedValue({ ...operatorContext(), supabase });
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
      setThreadLinks,
    });
    mocks.propose.mockResolvedValue({ intent: "answer_memory", confidence: "high", missing: [] });

    const response = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "i-1234567890123456",
            resumeKey: ideasSpec.resumeKey,
            spec: ideasSpec,
            answers: { idea: "idea-b" },
          }),
        },
      ),
      params,
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.answers).toEqual({ idea: "idea-b" });
    // One payload: draft id plus inline approve action plus Studio hyperlink.
    expect(body.ideaDraft.outcome).toBe("draft_requested");
    expect(body.ideaDraft.draftRequestId).toBe("44444444-4444-4444-8444-444444444444");
    expect(body.ideaDraft.replayed).toBe(false);
    expect(body.ideaDraft.opportunityId).toBe("33333333-3333-4333-8333-333333333333");
    expect(body.ideaDraft.idea).toMatchObject({ value: "idea-b", recommended: true });
    expect(body.ideaDraft.adviceFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(body.ideaDraft.approveAction.kind).toBe("campaign_idea_approve");
    // No reviewable version at pick time: the worker has not built it yet,
    // so the action carries no href — the component keeps it pending until
    // the thread links the campaign, never a dead link.
    expect(body.ideaDraft.approveAction.href).toBeNull();
    expect(body.ideaDraft.studioLink.href).toContain(`/organizations/${ORGANIZATION}/campaigns`);
    expect(body.ideaDraft.markers.map((marker: { stage: string }) => marker.stage)).toEqual([
      "requested",
      "claimed",
      "draft-ready",
    ]);
    // The draft seam ran immediately: the idea as objective/audience, the
    // opportunity's stored assertions echoed verbatim (the RPC admits only
    // pre-asserted keys).
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "request_campaign_draft_from_opportunity",
      expect.objectContaining({
        p_organization_id: ORGANIZATION,
        p_opportunity_id: "33333333-3333-4333-8333-333333333333",
        p_opportunity_version: 2,
        p_objective: "Weekend family table",
        p_audience: "Saturday set menu for families.",
        p_assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
      }),
    );
    // Thread → request link keeps the audit chain.
    expect(setThreadLinks).toHaveBeenCalledWith(
      expect.objectContaining({ draftRequestId: "44444444-4444-4444-8444-444444444444" }),
    );
  });

  it("briefs (no draft) when no eligible proposal exists", async () => {
    const ideasSpec = {
      kind: "campaign_ideas",
      title: "Campaign ideas",
      resumeKey: "router:campaign_advice:overview:abcdef1234567890",
      items: [
        {
          key: "idea",
          label: "Which idea should become a draft?",
          kind: "single_select",
          required: true,
          options: [
            {
              value: "idea-a",
              label: "Lunch rush bundle",
              description: "Noon combo for nearby offices.",
              recommended: false,
            },
            {
              value: "idea-b",
              label: "Weekend family table",
              description: "Saturday set menu for families.",
              recommended: true,
            },
            {
              value: "idea-c",
              label: "Late-night dessert",
              description: "After-9pm dessert counter.",
              recommended: false,
            },
          ],
        },
      ],
    };
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const from = vi.fn(async () => ({ data: [], error: null }));
    const supabase = {
      rpc,
      from: () => ({ select: () => ({ eq: from }) }),
    };
    const setThreadLinks = vi.fn(async () => ({}));
    mocks.getOrganizationContext.mockResolvedValue({ ...operatorContext(), supabase });
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
      setThreadLinks,
    });
    mocks.propose.mockResolvedValue({ intent: "answer_memory", confidence: "high", missing: [] });

    const response = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "i-1234567890123458",
            resumeKey: ideasSpec.resumeKey,
            spec: ideasSpec,
            answers: { idea: "idea-a" },
          }),
        },
      ),
      params,
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    // Retained fallback: pre-filled brief with the reason named, seams untouched.
    expect(body.ideaDraft.outcome).toBe("brief_prefilled");
    expect(body.ideaDraft.reasonCodes).toContain("ADVICE_NO_OPPORTUNITY");
    expect(body.ideaDraft.briefUrl).toContain("/campaigns/new");
    expect(body.ideaDraft.draftRequestId).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(setThreadLinks).not.toHaveBeenCalled();
  });

  it("briefs naming ambiguity when several proposals are eligible", async () => {
    const ideasSpec = {
      kind: "campaign_ideas",
      title: "Campaign ideas",
      resumeKey: "router:campaign_advice:overview:abcdef1234567890",
      items: [
        {
          key: "idea",
          label: "Which idea should become a draft?",
          kind: "single_select",
          required: true,
          options: [
            {
              value: "idea-a",
              label: "Lunch rush bundle",
              description: "Noon combo for nearby offices.",
              recommended: false,
            },
            {
              value: "idea-b",
              label: "Weekend family table",
              description: "Saturday set menu for families.",
              recommended: true,
            },
            {
              value: "idea-c",
              label: "Late-night dessert",
              description: "After-9pm dessert counter.",
              recommended: false,
            },
          ],
        },
      ],
    };
    const eligible = (id: string) => ({
      id,
      organization_id: ORGANIZATION,
      version: 2,
      status: "proposed",
      action_key: "campaign.governed_draft_v1",
      expires_at: "2026-12-31T00:00:00.000Z",
      assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
    });
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const from = vi.fn(async () => ({
      data: [
        eligible("33333333-3333-4333-8333-333333333333"),
        eligible("55555555-5555-4555-8555-555555555555"),
      ],
      error: null,
    }));
    const supabase = {
      rpc,
      from: () => ({ select: () => ({ eq: from }) }),
    };
    const setThreadLinks = vi.fn(async () => ({}));
    mocks.getOrganizationContext.mockResolvedValue({ ...operatorContext(), supabase });
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
      setThreadLinks,
    });
    mocks.propose.mockResolvedValue({ intent: "answer_memory", confidence: "high", missing: [] });

    const response = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "i-1234567890123460",
            resumeKey: ideasSpec.resumeKey,
            spec: ideasSpec,
            answers: { idea: "idea-b" },
          }),
        },
      ),
      params,
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    // Choice needs a human: the brief names the ambiguity, nothing executes.
    expect(body.ideaDraft.outcome).toBe("brief_prefilled");
    expect(body.ideaDraft.reasonCodes).toContain("ADVICE_OPPORTUNITY_AMBIGUOUS");
    expect(body.ideaDraft.briefUrl).toContain("/campaigns/new");
    expect(rpc).not.toHaveBeenCalled();
    expect(setThreadLinks).not.toHaveBeenCalled();
  });

  it("refuses campaign-ideas picks for viewers before persistence", async () => {
    const ideasSpec = {
      kind: "campaign_ideas",
      title: "Campaign ideas",
      resumeKey: "router:campaign_advice:overview:abcdef1234567890",
      items: [
        {
          key: "idea",
          label: "Which idea should become a draft?",
          kind: "single_select",
          required: true,
          options: [
            {
              value: "idea-a",
              label: "Lunch rush bundle",
              description: "Noon combo for nearby offices.",
              recommended: false,
            },
            {
              value: "idea-b",
              label: "Weekend family table",
              description: "Saturday set menu for families.",
              recommended: true,
            },
            {
              value: "idea-c",
              label: "Late-night dessert",
              description: "After-9pm dessert counter.",
              recommended: false,
            },
          ],
        },
      ],
    };
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      membership: { role: "viewer" },
    });
    mocks.createRepo.mockClear();
    const refused = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "i-1234567890123459",
            resumeKey: ideasSpec.resumeKey,
            spec: ideasSpec,
            answers: { idea: "idea-b" },
          }),
        },
      ),
      params,
    );
    expect(refused.status).toBe(403);
    expect(mocks.createRepo).not.toHaveBeenCalled();
  });
});

describe("agent thread answers auto-run (B3)", () => {
  function submitAnswers(idempotencyKey: string) {
    return POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey,
            resumeKey: SPEC.resumeKey,
            spec: SPEC,
            answers: { frequency: "weekly" },
          }),
        },
      ),
      params,
    );
  }

  beforeEach(() => {
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
    });
    mocks.propose.mockResolvedValue({ intent: "research_once", confidence: "high", missing: [] });
  });

  it("auto-enqueues research on an escalated answers re-route and carries the receipt", async () => {
    mocks.createReaders.mockReturnValue({
      getMarketProfile: vi.fn(async () => ({
        status: "current",
        versionId: "55555555-5555-4555-8555-555555555555",
        digest: "fedcba9876543210",
      })),
    });
    mocks.trigger.mockResolvedValue({ id: "run_answers_auto_1" });
    const response = await submitAnswers("b3-answers-000000000001");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.reasonCodes).toEqual(expect.arrayContaining(["DEEPTHINK_AUTO_ESCALATED"]));
    expect(body.research).toMatchObject({ status: "dispatched", runId: "run_answers_auto_1" });
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
    });
    expect(options).toMatchObject({ idempotencyKey: payload["idempotencyKey"] });
  });

  it("degrades a closed gate on the answers path with PROFILE_UNBOUND", async () => {
    mocks.createReaders.mockReturnValue({});
    // A distinct turn from the dispatched test above, so the shared
    // dispatch-dedup store cannot replay the kept run here.
    const blockedMessage = { ...ANSWERS_MESSAGE, body: "[answers missing_fields]\nmenu: dinner" };
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => blockedMessage),
      latestUserMessage: vi.fn(async () => blockedMessage),
    });
    const response = await submitAnswers("b3-answers-000000000002");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.research).toMatchObject({ status: "blocked", runId: null });
    expect(body.research.reasonCode).toBe("PROFILE_UNBOUND");
    expect(body.reasonCodes).toContain("PROFILE_UNBOUND");
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
});

describe("agent thread answers route watch one-tap (B4)", () => {
  const BRANCH = "66666666-6666-4666-8666-666666666666";
  const CANDIDATE = "77777777-7777-4777-8777-777777777777";
  const CREATED = "88888888-8888-4888-8888-888888888888";
  const ASK = "Keep watching lunch prices downtown";

  const USER_ASK = {
    ...ANSWERS_MESSAGE,
    id: "11111111-0000-4000-8000-000000000001",
    role: "user",
    body: ASK,
  };

  const DUPLICATE_SPEC = {
    kind: "duplicate_watch",
    title: "Watch already running",
    resumeKey: "router:watch:overview:abcdef1234567890",
    items: [
      {
        key: "choice",
        label: "A similar watch already exists. What should happen?",
        kind: "single_select",
        required: true,
        options: [
          { value: "view_existing", label: "View existing" },
          { value: "update_fields", label: "Update fields" },
          { value: "start_fresh", label: "Start fresh anyway" },
          { value: "cancel", label: "Cancel" },
        ],
      },
      {
        key: "frequency",
        label: "How often should this run?",
        kind: "single_select",
        required: false,
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
      },
      { key: "branch", label: "Which branch is this for?", kind: "text", required: false },
      {
        key: "research_area",
        label: "Which research area should change?",
        kind: "text",
        required: false,
      },
      { key: "competitors", label: "Which competitor should be added?", kind: "text", required: false },
      { key: "end_date", label: "When should monitoring stop?", kind: "date", required: false },
      {
        key: "confirm_start_fresh",
        label: "Start a second watch anyway?",
        kind: "confirm",
        required: false,
      },
    ],
  };

  const MISSING_WATCH_SPEC = {
    kind: "missing_fields",
    title: "One more detail",
    resumeKey: "router:watch:overview:abcdef1234567890",
    items: [
      {
        key: "frequency",
        label: "How often should this run?",
        kind: "single_select",
        required: true,
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
      },
      { key: "branch", label: "Which branch is this for?", kind: "text", required: true },
      {
        key: "research_area",
        label: "What should the research focus on?",
        kind: "text",
        required: true,
      },
    ],
  };

  const BRIEF_DOCUMENT = {
    revisionId: "33333333-3333-4333-8333-333333333333",
    projectId: CANDIDATE,
    organizationId: ORGANIZATION,
    revisionNumber: 1,
    question: ASK,
    locationId: BRANCH,
    researchArea: "downtown lunch",
    competitors: [],
    investigationAreas: ["demand"],
    evidencePeriods: [],
    businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
    frequency: "weekly",
    pinnedToUpdateId: null,
    createdAtUtc: "2026-09-25T10:00:00.000Z",
  };

  /** Supabase `from` dispatcher: branches, project row, brief document. */
  function watchFrom(overrides: {
    branches?: Array<{ id: string; name: string }>;
    projectRow?: Record<string, unknown> | null;
    briefDocument?: Record<string, unknown> | null;
  } = {}) {
    const branches = overrides.branches ?? [{ id: BRANCH, name: "Deira" }];
    return (table: string) => {
      if (table === "branches") {
        return { select: () => ({ eq: async () => ({ data: branches, error: null }) }) };
      }
      if (table === "growth_intelligence_research_projects") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: overrides.projectRow ?? null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "growth_intelligence_brief_revisions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data:
                          overrides.briefDocument === undefined
                            ? null
                            : { document: overrides.briefDocument },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    };
  }

  function watchRepo(projects: {
    listActiveProjects: () => Promise<Array<Record<string, unknown>>>;
    createProject?: () => Promise<{ projectId: string; lifecycle: string; replayed: boolean }>;
    updateProjectSchedule?: () => Promise<{
      projectId: string;
      revisionNumber: number | null;
      replayed: boolean;
      reasonCode: string | null;
    }>;
  }) {
    const createProject =
      projects.createProject ??
      (async () => ({ projectId: CREATED, lifecycle: "active", replayed: false }));
    const updateProjectSchedule =
      projects.updateProjectSchedule ??
      (async () => ({
        projectId: CANDIDATE,
        revisionNumber: 2,
        replayed: false,
        reasonCode: null,
      }));
    return {
      listActiveProjects: vi.fn(projects.listActiveProjects),
      createProject: vi.fn(createProject),
      updateProjectSchedule: vi.fn(updateProjectSchedule),
    };
  }

  function threadRepo(overrides: { messages?: unknown[] } = {}) {
    const setThreadLinks = vi.fn(async (input: { projectId?: string }) => ({
      threadId: THREAD,
      projectId: input.projectId ?? null,
      requestId: null,
      draftRequestId: null,
      campaignId: null,
    }));
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: ANSWERS_MESSAGE.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => ANSWERS_MESSAGE),
      latestUserMessage: vi.fn(async () => ANSWERS_MESSAGE),
      listMessages: vi.fn(async () => ({
        messages: overrides.messages ?? [USER_ASK, ANSWERS_MESSAGE],
        nextCursor: null,
      })),
      setThreadLinks,
    });
    return { setThreadLinks };
  }

  function postAnswers(body: Record<string, unknown>) {
    return POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/answers`,
        { method: "POST", body: JSON.stringify(body) },
      ),
      params,
    );
  }

  it("creates a second watch behind start_fresh with pre-filled payload, link, and audit event", async () => {
    const projects = watchRepo({ listActiveProjects: async () => [] });
    mocks.createProjects.mockReturnValue(projects);
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      supabase: { rpc: vi.fn(), from: watchFrom() },
    });
    const { setThreadLinks } = threadRepo();
    mocks.propose.mockResolvedValue({ intent: "watch", confidence: "high", missing: [] });

    const response = await postAnswers({
      idempotencyKey: "w-1234567890123456",
      resumeKey: DUPLICATE_SPEC.resumeKey,
      spec: DUPLICATE_SPEC,
      answers: {
        choice: "start_fresh",
        frequency: "weekly",
        branch: BRANCH,
        research_area: "downtown lunch",
      },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.watchChoice.outcome).toBe("created");
    expect(body.watchChoice.projectId).toBe(CREATED);
    expect(body.watchChoice.evidenceWindowDays).toBe(30);
    expect(body.watchChoice.assumptions.length).toBeGreaterThan(0);
    expect(body.watchChoice.link.href).toContain(
      `/organizations/${ORGANIZATION}/growth-intelligence`,
    );
    expect(projects.createProject).toHaveBeenCalledTimes(1);
    expect(projects.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        branchId: BRANCH,
        question: ASK,
        mode: "recurring",
        schedule: expect.objectContaining({ cadence: "weekly" }),
      }),
    );
    // Fresh titles carry the deterministic suffix (distinct fingerprint).
    const createCalls = projects.createProject.mock.calls as unknown as Array<
      [{ title?: string }]
    >;
    expect(createCalls[0]?.[0]?.title).toMatch(/\(fresh [0-9a-f]{6}\)$/);
    expect(setThreadLinks).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: THREAD, projectId: CREATED }),
    );
    // Identifier-only audit: the event says what happened to which record —
    // no question, title, or body travels in it.
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        eventName: "agent_thread.watch_created",
      }),
    );
    const published = mocks.publish.mock.calls.map((call) => call[0]) as Array<
      Record<string, unknown>
    >;
    const watchEvent = published.find((event) => event["eventName"] === "agent_thread.watch_created");
    expect(watchEvent).toBeDefined();
    const payload = watchEvent?.["payload"] as Record<string, unknown>;
    expect(payload["projectId"]).toBe(CREATED);
    expect(payload["threadId"]).toBe(THREAD);
    expect("question" in payload).toBe(false);
    expect("title" in payload).toBe(false);
    expect("body" in payload).toBe(false);
  });

  it("returns the existing watch link behind view_existing without writing", async () => {
    const projects = watchRepo({
      listActiveProjects: async () => [
        {
          projectId: CANDIDATE,
          branchId: BRANCH,
          title: ASK,
          question: ASK,
          mode: "recurring",
          scopeFingerprint: "0".repeat(64),
        },
      ],
    });
    mocks.createProjects.mockReturnValue(projects);
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      supabase: { rpc: vi.fn(), from: watchFrom() },
    });
    threadRepo();
    mocks.propose.mockResolvedValue({ intent: "watch", confidence: "high", missing: [] });

    const response = await postAnswers({
      idempotencyKey: "w-1234567890123457",
      resumeKey: DUPLICATE_SPEC.resumeKey,
      spec: DUPLICATE_SPEC,
      answers: {
        choice: "view_existing",
        branch: BRANCH,
        research_area: "downtown lunch",
      },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.watchChoice.outcome).toBe("view_existing");
    expect(body.watchChoice.projectId).toBe(CANDIDATE);
    expect(body.watchChoice.link.href).toContain("/growth-intelligence");
    expect(projects.createProject).not.toHaveBeenCalled();
    expect(projects.updateProjectSchedule).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "agent_thread.watch_created" }),
    );
  });

  it("cancels without reading or writing anything beyond the answers row", async () => {
    const from = vi.fn(() => {
      throw new Error("must not read");
    });
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      supabase: { rpc: vi.fn(), from },
    });
    threadRepo();
    mocks.propose.mockResolvedValue({ intent: "watch", confidence: "high", missing: [] });

    const response = await postAnswers({
      idempotencyKey: "w-1234567890123458",
      resumeKey: DUPLICATE_SPEC.resumeKey,
      spec: DUPLICATE_SPEC,
      answers: { choice: "cancel" },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.watchChoice).toEqual({ outcome: "cancelled" });
    expect(from).not.toHaveBeenCalled();
    expect(mocks.createProjects).not.toHaveBeenCalled();
  });

  it("applies in-place edits behind update_fields", async () => {
    const projects = watchRepo({
      listActiveProjects: async () => [
        {
          projectId: CANDIDATE,
          branchId: BRANCH,
          title: ASK,
          question: ASK,
          mode: "recurring",
          scopeFingerprint: "0".repeat(64),
        },
      ],
    });
    mocks.createProjects.mockReturnValue(projects);
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      supabase: {
        rpc: vi.fn(),
        from: watchFrom({
          projectRow: {
            title: ASK,
            question: ASK,
            mode: "recurring",
            branch_id: BRANCH,
            schedule: { cadence: "weekly", localTime: "09:00", timeZone: "UTC" },
          },
          briefDocument: BRIEF_DOCUMENT,
        }),
      },
    });
    const { setThreadLinks } = threadRepo();
    mocks.propose.mockResolvedValue({ intent: "watch", confidence: "high", missing: [] });

    const response = await postAnswers({
      idempotencyKey: "w-1234567890123459",
      resumeKey: DUPLICATE_SPEC.resumeKey,
      spec: DUPLICATE_SPEC,
      answers: { choice: "update_fields", frequency: "daily", end_date: "2026-12-31" },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.watchChoice.outcome).toBe("updated");
    expect(body.watchChoice.projectId).toBe(CANDIDATE);
    expect(body.watchChoice.appliedFields).toEqual(
      expect.arrayContaining(["frequency", "endDate"]),
    );
    expect(projects.updateProjectSchedule).toHaveBeenCalledTimes(1);
    expect(projects.updateProjectSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        projectId: CANDIDATE,
        schedule: expect.objectContaining({ cadence: "daily", endDate: "2026-12-31" }),
      }),
    );
    expect(setThreadLinks).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: THREAD, projectId: CANDIDATE }),
    );
  });

  it("creates behind a missing-fields submit only when the re-route stays watch", async () => {
    const projects = watchRepo({ listActiveProjects: async () => [] });
    mocks.createProjects.mockReturnValue(projects);
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      supabase: { rpc: vi.fn(), from: watchFrom() },
    });
    threadRepo();
    mocks.propose.mockResolvedValue({ intent: "watch", confidence: "high", missing: [] });

    const created = await postAnswers({
      idempotencyKey: "w-1234567890123460",
      resumeKey: MISSING_WATCH_SPEC.resumeKey,
      spec: MISSING_WATCH_SPEC,
      answers: { frequency: "weekly", branch: BRANCH, research_area: "downtown lunch" },
    });

    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.watchChoice.outcome).toBe("created");
    expect(projects.createProject).toHaveBeenCalledTimes(1);

    // A research re-route answers the same card shape without creating —
    // the watch lane never fires off-intent.
    projects.createProject.mockClear();
    mocks.propose.mockResolvedValue({ intent: "research_once", confidence: "high", missing: [] });
    const researched = await postAnswers({
      idempotencyKey: "w-1234567890123461",
      resumeKey: MISSING_WATCH_SPEC.resumeKey,
      spec: MISSING_WATCH_SPEC,
      answers: { frequency: "weekly", branch: BRANCH, research_area: "downtown lunch" },
    });
    expect(researched.status).toBe(201);
    const researchedBody = await researched.json();
    expect(researchedBody.watchChoice).toBeUndefined();
    expect(projects.createProject).not.toHaveBeenCalled();
  });

  it("converges to the duplicate card when a twin exists on the missing-fields path", async () => {
    const projects = watchRepo({
      listActiveProjects: async () => [
        {
          projectId: CANDIDATE,
          branchId: BRANCH,
          title: ASK,
          question: ASK,
          mode: "recurring",
          scopeFingerprint: "0".repeat(64),
        },
      ],
    });
    mocks.createProjects.mockReturnValue(projects);
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      supabase: { rpc: vi.fn(), from: watchFrom() },
    });
    threadRepo();
    mocks.propose.mockResolvedValue({ intent: "watch", confidence: "high", missing: [] });

    const response = await postAnswers({
      idempotencyKey: "w-1234567890123462",
      resumeKey: MISSING_WATCH_SPEC.resumeKey,
      spec: MISSING_WATCH_SPEC,
      answers: { frequency: "weekly", branch: BRANCH, research_area: "downtown lunch" },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.watchChoice.outcome).toBe("duplicate");
    expect(body.watchChoice.card.kind).toBe("duplicate_watch");
    expect(projects.createProject).not.toHaveBeenCalled();
  });

  it("carries the defaulted evidence window on the idea-draft envelope", async () => {
    const ideasSpec = {
      kind: "campaign_ideas",
      title: "Campaign ideas",
      resumeKey: "router:campaign_advice:overview:abcdef1234567890",
      items: [
        {
          key: "idea",
          label: "Which idea should become a draft?",
          kind: "single_select",
          required: true,
          options: [
            {
              value: "idea-a",
              label: "Lunch rush bundle",
              description: "Noon combo for nearby offices.",
              recommended: false,
            },
            {
              value: "idea-b",
              label: "Weekend family table",
              description: "Saturday set menu for families.",
              recommended: true,
            },
            {
              value: "idea-c",
              label: "Late-night dessert",
              description: "After-9pm dessert counter.",
              recommended: false,
            },
          ],
        },
      ],
    };
    const rpc = vi.fn(async () => ({
      data: {
        requestId: "44444444-4444-4444-8444-444444444444",
        status: "created",
        draftRequestStatus: "pending",
      },
      error: null,
    }));
    const supabase = {
      rpc,
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                organization_id: ORGANIZATION,
                version: 2,
                status: "proposed",
                action_key: "campaign.governed_draft_v1",
                expires_at: "2026-12-31T00:00:00.000Z",
                assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
              },
            ],
            error: null,
          }),
        }),
      }),
    };
    mocks.getOrganizationContext.mockResolvedValue({ ...operatorContext(), supabase });
    threadRepo();
    mocks.propose.mockResolvedValue({ intent: "answer_memory", confidence: "high", missing: [] });

    const response = await postAnswers({
      idempotencyKey: "i-1234567890123463",
      resumeKey: ideasSpec.resumeKey,
      spec: ideasSpec,
      answers: { idea: "idea-b" },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ideaDraft.outcome).toBe("draft_requested");
    expect(body.ideaDraft.evidenceWindow.windowDays).toBe(30);
    expect(body.ideaDraft.evidenceWindow.assumption).toMatch(/last 30 days/);
  });
});
