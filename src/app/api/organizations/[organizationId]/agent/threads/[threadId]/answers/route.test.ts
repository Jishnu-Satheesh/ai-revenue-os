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
});
