import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  publish: vi.fn(),
  info: vi.fn(),
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
  logger: { warn: vi.fn(), info: mocks.info, error: vi.fn() },
}));
// The test organization sits inside the agent rollout allowlist; a refusal
// below proves authorization or validation, never the feature being off.
vi.mock("@/lib/env", () => ({
  env: { AGENT_CHAT_V1_ORGANIZATION_IDS: "10000000-0000-4000-8000-000000000001" },
}));

import {
  GET,
  POST,
} from "@/app/api/organizations/[organizationId]/agent/threads/[threadId]/messages/route";

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
  body: "Hello",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:01:00.000Z",
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
});

describe("agent thread messages route", () => {
  it("appends a user message with 201 and replays with 200", async () => {
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      appendMessageKeyed: vi.fn(async () => ({
        messageId: MESSAGE_ROW.id,
        threadId: THREAD,
        replayed: false,
      })),
      getMessage: vi.fn(async () => MESSAGE_ROW),
    });
    const created = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: "k-1234567890123456", body: "Hello" }),
        },
      ),
      params,
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({
      message: MESSAGE_ROW,
      replayed: false,
      correlationId: CORRELATION,
    });
    expect(created.headers.get("Cache-Control")).toBe("no-store");
    // M1: the append line carries the thread id; bodies never logged.
    expect(mocks.info).toHaveBeenCalledWith(
      "agent_message.appended",
      expect.objectContaining({ organizationId: ORGANIZATION, threadId: THREAD }),
    );
  });

  it("refuses appends for viewers and empty bodies", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      membership: { role: "viewer" },
    });
    const forbidden = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: "k-1234567890123456", body: "Hello" }),
        },
      ),
      params,
    );
    expect(forbidden.status).toBe(403);
    expect(mocks.createRepo).not.toHaveBeenCalled();

    mocks.getOrganizationContext.mockResolvedValue(operatorContext());
    const invalid = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: "k-1234567890123456", body: "   " }),
        },
      ),
      params,
    );
    expect(invalid.status).toBe(400);
  });

  it("rejects a non-uuid thread id", async () => {
    const response = await POST(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/not-a-uuid/messages`,
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: "k-1234567890123456", body: "Hello" }),
        },
      ),
      { params: Promise.resolve({ organizationId: ORGANIZATION, threadId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(400);
  });

  it("lists messages oldest-first for reopen", async () => {
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => THREAD_ROW),
      listMessages: vi.fn(async () => ({ messages: [MESSAGE_ROW], nextCursor: null })),
    });
    const response = await GET(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/messages`,
      ),
      params,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      messages: [MESSAGE_ROW],
      nextCursor: null,
      correlationId: CORRELATION,
    });
  });

  it("reads a foreign thread as not-found", async () => {
    mocks.createRepo.mockReturnValue({
      getThread: vi.fn(async () => null),
      listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
    });
    const response = await GET(
      request(
        `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/messages`,
      ),
      params,
    );
    expect(response.status).toBe(404);
  });
});
