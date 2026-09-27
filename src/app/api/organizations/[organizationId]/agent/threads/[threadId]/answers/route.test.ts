import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  createReaders: vi.fn(),
  propose: vi.fn(),
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
vi.mock("@/modules/agent-router/infrastructure/light-model-provider", () => ({
  createLightModelProvider: () => ({ propose: mocks.propose }),
}));
vi.mock("@/modules/agent-chat/application/api", () => ({
  createAgentContextReaders: mocks.createReaders,
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: mocks.publish }),
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
