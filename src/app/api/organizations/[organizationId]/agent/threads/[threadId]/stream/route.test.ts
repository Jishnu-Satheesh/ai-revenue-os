import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  createReaders: vi.fn(),
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
  createAgentContextReaders: mocks.createReaders,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// The test organization sits inside the agent rollout allowlist; a refusal
// below proves authorization or tenancy, never the feature being off.
vi.mock("@/lib/env", () => ({
  env: { AGENT_CHAT_V1_ORGANIZATION_IDS: "10000000-0000-4000-8000-000000000001" },
}));

import {
  clearStreamRouteTestSeams,
  GET,
  setStreamRouteTestSeams,
  STREAM_DONE_DATA,
  streamEndPayloadSchema,
  type AgentStreamSource,
} from "@/app/api/organizations/[organizationId]/agent/threads/[threadId]/stream/route";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const USER = "70000000-0000-4000-8000-000000000007";
const THREAD = "80000000-0000-4000-8000-000000000008";
const USER_MESSAGE = "90000000-0000-4000-8000-000000000009";
const ASSISTANT_MESSAGE = "a0000000-0000-4000-8000-00000000000a";
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

const USER_MESSAGE_ROW = {
  id: USER_MESSAGE,
  threadId: THREAD,
  role: "user",
  body: "What should we focus on next?",
  questionnaireAnswers: null,
  markerReceipts: null,
  citations: null,
  createdAt: "2026-09-25T10:01:00.000Z",
};

const CANDIDATE = {
  body: "Hello world, here is what the stored context supports.",
  citations: [],
  limitations: ["One evidence gap."],
  estimates: [],
};

function operatorContext(role = "operator") {
  return {
    supabase: {},
    user: { id: USER },
    organizationId: ORGANIZATION,
    membership: { role },
  };
}

function repoFake(overrides: Record<string, unknown> = {}) {
  return {
    getThread: vi.fn(async () => THREAD_ROW),
    getMessage: vi.fn(async (input: { messageId: string }) =>
      input.messageId === ASSISTANT_MESSAGE
        ? { ...USER_MESSAGE_ROW, id: ASSISTANT_MESSAGE, role: "assistant" }
        : USER_MESSAGE_ROW,
    ),
    latestUserMessage: vi.fn(async () => USER_MESSAGE_ROW),
    appendMessageKeyed: vi.fn(async () => ({
      messageId: ASSISTANT_MESSAGE,
      threadId: THREAD,
      replayed: false,
    })),
    ...overrides,
  };
}

function request(url: string) {
  return new Request(url, { headers: { "x-correlation-id": CORRELATION } });
}

const params = { params: Promise.resolve({ organizationId: ORGANIZATION, threadId: THREAD }) };

function streamUrl(query = `messageId=${USER_MESSAGE}`) {
  return `http://localhost/api/organizations/${ORGANIZATION}/agent/threads/${THREAD}/stream?${query}`;
}

type SseFrame = { event: string; data: string };

function parseSse(text: string): SseFrame[] {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const event = (lines[0] ?? "").replace(/^event:\s*/, "");
      const data = (lines[1] ?? "").replace(/^data:\s?/, "");
      return { event, data };
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  clearStreamRouteTestSeams();
  mocks.getOrganizationContext.mockResolvedValue(operatorContext());
  mocks.createReaders.mockReturnValue({});
  mocks.createRepo.mockReturnValue(repoFake());
});

describe("agent thread stream route", () => {
  it("streams token frames, the done marker, and a validated end payload with durable persist", async () => {
    const source: AgentStreamSource = async () => ({
      tokens: ["Hello ", "world, here is what the stored context supports."],
      candidate: CANDIDATE,
    });
    setStreamRouteTestSeams({ source });
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION);

    const frames = parseSse(await response.text());
    const tokens = frames.filter((frame) => frame.event === "token");
    expect(tokens).toHaveLength(2);
    expect(tokens.map((frame) => JSON.parse(frame.data).text).join("")).toBe(CANDIDATE.body);

    const doneIndex = frames.findIndex((frame) => frame.event === "done");
    expect(doneIndex).toBe(2);
    expect(frames[doneIndex]?.data).toBe(STREAM_DONE_DATA);

    const end = frames.find((frame) => frame.event === "end");
    expect(end).toBeDefined();
    expect(frames.indexOf(end!)).toBe(doneIndex + 1);
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload).toMatchObject({
      messageId: ASSISTANT_MESSAGE,
      replayed: false,
      fallback: false,
      reason: null,
      correlationId: CORRELATION,
    });
    expect(payload.draft.body).toBe(CANDIDATE.body);
    expect(payload.draft.limitations).toContain("One evidence gap.");

    // Durable append: assistant role, encoded body with sections, stable
    // thread-linked answer key (retries replay by key).
    const repo = mocks.createRepo.mock.results[0]?.value;
    expect(repo.appendMessageKeyed).toHaveBeenCalledTimes(1);
    const append = repo.appendMessageKeyed.mock.calls[0][0];
    expect(append.role).toBe("assistant");
    expect(append.threadId).toBe(THREAD);
    expect(append.body).toContain(CANDIDATE.body);
    expect(append.body).toContain("Limitations");
    expect(append.idempotencyKey).toMatch(/^agent_thread:.+:answer$/);
    expect(append.idempotencyKey).toContain(THREAD);
  });

  it("discards invalid candidates and persists the named fallback", async () => {
    const source: AgentStreamSource = async () => ({
      tokens: ["Shiny unvalidated text."],
      candidate: { body: "", baseline: "AED 4,000", attribution: "ads", window: "Q1" },
    });
    setStreamRouteTestSeams({ source });
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const frames = parseSse(await response.text());
    // Live tokens already on the wire stay; the end payload discards them.
    expect(frames.filter((frame) => frame.event === "token")).toHaveLength(1);
    const end = frames.find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload.fallback).toBe(true);
    expect(payload.reason).toBe("invalid_candidate");
    expect(payload.draft.body).toMatch(/stored organization context/);
    expect(payload.draft.body).not.toContain("Shiny unvalidated");

    const repo = mocks.createRepo.mock.results[0]?.value;
    const append = repo.appendMessageKeyed.mock.calls[0][0];
    expect(append.body).toContain("failed validation");
    expect(append.body).not.toContain("AED 4,000");
  });

  it("replays retries under the same idempotency key", async () => {
    const source: AgentStreamSource = async () => ({ tokens: ["Hi."], candidate: CANDIDATE });
    setStreamRouteTestSeams({ source });

    const first = await GET(request(streamUrl()), params);
    const firstEnd = parseSse(await first.text()).find((frame) => frame.event === "end");
    const firstPayload = streamEndPayloadSchema.parse(JSON.parse(firstEnd!.data));
    expect(firstPayload.replayed).toBe(false);

    mocks.createRepo.mockReturnValue(
      repoFake({
        appendMessageKeyed: vi.fn(async () => ({
          messageId: ASSISTANT_MESSAGE,
          threadId: THREAD,
          replayed: true,
        })),
      }),
    );
    const second = await GET(request(streamUrl()), params);
    const secondEnd = parseSse(await second.text()).find((frame) => frame.event === "end");
    const secondPayload = streamEndPayloadSchema.parse(JSON.parse(secondEnd!.data));
    expect(secondPayload.replayed).toBe(true);
    expect(secondPayload.messageId).toBe(ASSISTANT_MESSAGE);

    const firstKey = mocks.createRepo.mock.results[0]?.value.appendMessageKeyed.mock.calls[0][0]
      .idempotencyKey;
    const secondRepo = mocks.createRepo.mock.results[1]?.value;
    const secondKey = secondRepo.appendMessageKeyed.mock.calls[0][0].idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it("streams read-only for viewers without persisting", async () => {
    mocks.getOrganizationContext.mockResolvedValue(operatorContext("viewer"));
    const source: AgentStreamSource = async () => ({ tokens: ["Hi."], candidate: CANDIDATE });
    setStreamRouteTestSeams({ source });
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const end = parseSse(await response.text()).find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload.messageId).toBeNull();
    expect(payload.fallback).toBe(false);
    const repo = mocks.createRepo.mock.results[0]?.value;
    expect(repo.appendMessageKeyed).not.toHaveBeenCalled();
  });

  it("keeps auth and tenant gating parity with sibling routes", async () => {
    // Foreign thread reads as not-found, never a permission leak.
    mocks.createRepo.mockReturnValue(repoFake({ getThread: vi.fn(async () => null) }));
    const missing = await GET(request(streamUrl()), params);
    expect(missing.status).toBe(404);

    // Unauthenticated callers are refused before any stream opens.
    mocks.createRepo.mockReturnValue(repoFake());
    const { DomainError } = await import("@/lib/errors");
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHENTICATION_ERROR", "Authentication is required."),
    );
    const denied = await GET(request(streamUrl()), params);
    expect(denied.status).toBe(401);

    // Unknown query keys are refused like every other agent route.
    mocks.getOrganizationContext.mockResolvedValue(operatorContext());
    const invalid = await GET(request(`${streamUrl()}&unknown=1`), params);
    expect(invalid.status).toBe(400);
  });

  it("falls back honestly when the tier is unconfigured", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("AI_ANSWER_MODEL", "");
    vi.stubEnv("AI_ANSWER_STRONG_MODEL", "");
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const frames = parseSse(await response.text());
    expect(frames.filter((frame) => frame.event === "token").length).toBeGreaterThan(0);
    const end = frames.find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload.fallback).toBe(true);
    expect(payload.reason).toBe("not_configured");
    expect(payload.draft.body).toMatch(/stored organization context/);
  });

  it("times out to the named fallback instead of hanging the stream", async () => {
    const source: AgentStreamSource = () => new Promise(() => {});
    setStreamRouteTestSeams({ source, timeoutMs: 15 });
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const end = parseSse(await response.text()).find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload.fallback).toBe(true);
    expect(payload.reason).toBe("timeout");
  });
});
