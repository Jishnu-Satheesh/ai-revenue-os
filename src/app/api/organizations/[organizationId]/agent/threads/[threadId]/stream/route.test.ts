import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  createReaders: vi.fn(),
  loadAdvice: vi.fn(),
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
vi.mock("@/modules/agent-chat/application/advice-context-reader", () => ({
  loadAgentAdviceContext: mocks.loadAdvice,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// The test organization sits inside the agent rollout allowlist; a refusal
// below proves authorization or tenancy, never the feature being off.
vi.mock("@/lib/env", () => ({
  env: { AGENT_CHAT_V1_ORGANIZATION_IDS: "10000000-0000-4000-8000-000000000001" },
}));

import { logger } from "@/lib/logger";
import { IdempotencyConflictError } from "@/domain/agent-chat/errors";
import {
  clearStreamRouteTestSeams,
  GET,
  setStreamRouteTestSeams,
  STREAM_DONE_DATA,
  streamEndPayloadSchema,
  type AgentStreamSource,
  type AgentStreamSourceResult,
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
    listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
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
  mocks.loadAdvice.mockResolvedValue({ entries: [], limitations: [], periodSwitch: null });
  mocks.createRepo.mockReturnValue(repoFake());
});

describe("agent thread stream route", () => {
  it("gives streaming synthesis the current user question", async () => {
    const source = vi.fn<AgentStreamSource>(async () => ({
      deltas: ["Use a measured first-week baseline."],
      candidate: { ...CANDIDATE, body: "Use a measured first-week baseline." },
    }));
    setStreamRouteTestSeams({ source });
    const response = await GET(request(streamUrl()), params);
    expect(response.status).toBe(200);
    await response.text();
    expect(source.mock.calls[0]?.[0].prompt).toContain(USER_MESSAGE_ROW.body);
  });
  it("streams token frames, the done marker, and a validated end payload with durable persist", async () => {
    const source: AgentStreamSource = async () => ({
      deltas: ["Hello ", "world, here is what the stored context supports."],
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
      deltas: ["Shiny unvalidated text."],
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
    const source: AgentStreamSource = async () => ({
      deltas: ["Hi."],
      candidate: { ...CANDIDATE, body: "Hi." },
    });
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

  it("reuses the route's kept row on idempotency conflict instead of persisting a second synthesis", async () => {
    const KEPT = "b0000000-0000-4000-8000-00000000000b";
    const keptRow = {
      ...USER_MESSAGE_ROW,
      id: KEPT,
      role: "assistant" as const,
      body: "Route-kept durable answer.",
    };
    const source: AgentStreamSource = async () => ({
      deltas: ["Hello ", "world."],
      candidate: { ...CANDIDATE, body: "Hello world." },
    });
    setStreamRouteTestSeams({ source });
    mocks.createRepo.mockReturnValue(
      repoFake({
        appendMessageKeyed: vi.fn(async () => {
          throw new IdempotencyConflictError("already saved");
        }),
        listMessages: vi.fn(async () => ({
          messages: [USER_MESSAGE_ROW, keptRow],
          nextCursor: null,
        })),
      }),
    );
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const end = parseSse(await response.text()).find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    // Conflict is the normal path: the turn keeps the route's row and the
    // stream's synthesis stays live-only — exactly one assistant row.
    expect(payload.messageId).toBe(KEPT);
    expect(payload.replayed).toBe(true);
    expect(payload.fallback).toBe(false);
    expect(payload.reason).toBeNull();
    expect(payload.draft.body).toBe("Hello world.");

    const repo = mocks.createRepo.mock.results[0]?.value;
    // No second synthesis is persisted: one failed attempt, then the read.
    expect(repo.appendMessageKeyed).toHaveBeenCalledTimes(1);
    expect(repo.listMessages).toHaveBeenCalled();
    // Downgraded: identifier-only info, no scary warn or fallback log.
    expect(vi.mocked(logger.warn).mock.calls.map((call) => call[0])).not.toContain(
      "agent_stream.answer_append_failed",
    );
    expect(logger.info).toHaveBeenCalledWith(
      "agent_stream.answer_reused",
      expect.objectContaining({ threadId: THREAD, correlationId: CORRELATION }),
    );
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(
      "What should we focus on next?",
    );
  });

  it("degrades to draft-only append_conflict when the conflict has no reusable row", async () => {
    const source: AgentStreamSource = async () => ({
      deltas: ["Hello ", "world."],
      candidate: { ...CANDIDATE, body: "Hello world." },
    });
    setStreamRouteTestSeams({ source });
    mocks.createRepo.mockReturnValue(
      repoFake({
        appendMessageKeyed: vi.fn(async () => {
          throw new IdempotencyConflictError("already saved");
        }),
        listMessages: vi.fn(async () => ({ messages: [USER_MESSAGE_ROW], nextCursor: null })),
      }),
    );
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const end = parseSse(await response.text()).find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload.messageId).toBeNull();
    expect(payload.replayed).toBe(false);
    expect(payload.fallback).toBe(false);
    expect(payload.reason).toBe("append_conflict");
    expect(logger.warn).toHaveBeenCalledWith(
      "agent_stream.answer_append_failed",
      expect.objectContaining({ threadId: THREAD, correlationId: CORRELATION }),
    );
  });

  it("streams read-only for viewers without persisting", async () => {
    mocks.getOrganizationContext.mockResolvedValue(operatorContext("viewer"));
    const source: AgentStreamSource = async () => ({
      deltas: ["Hi."],
      candidate: { ...CANDIDATE, body: "Hi." },
    });
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
    const source: AgentStreamSource = () => new Promise<AgentStreamSourceResult>(() => {});
    setStreamRouteTestSeams({ source, timeoutMs: 15 });
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const end = parseSse(await response.text()).find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload.fallback).toBe(true);
    expect(payload.reason).toBe("timeout");
  });

  it("flushes the first token frame before the candidate resolves", async () => {
    let releaseGate!: () => void;
    let candidateResolved = false;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const source: AgentStreamSource = async () => ({
      deltas: (async function* () {
        yield "Hello ";
        await gate;
        yield "world.";
      })(),
      candidate: gate.then(() => {
        candidateResolved = true;
        return { ...CANDIDATE, body: "Hello world." };
      }),
    });
    setStreamRouteTestSeams({ source });
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    // The first frame arrives while the candidate is still gated: proof
    // the route forwards incrementally instead of buffering synthesis.
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(candidateResolved).toBe(false);
    const firstText = decoder.decode(first.value);
    const firstFrames = parseSse(firstText);
    expect(firstFrames[0]?.event).toBe("token");
    expect(JSON.parse(firstFrames[0]!.data)).toEqual({ text: "Hello " });

    releaseGate();
    let rest = "";
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += decoder.decode(next.value, { stream: true });
    }
    rest += decoder.decode();
    const frames = parseSse(firstText + rest);
    const tokens = frames.filter((frame) => frame.event === "token");
    expect(tokens.map((frame) => JSON.parse(frame.data).text).join("")).toBe("Hello world.");
    const doneIndex = frames.findIndex((frame) => frame.event === "done");
    expect(doneIndex).toBe(tokens.length);
    const end = frames.find((frame) => frame.event === "end");
    expect(frames.indexOf(end!)).toBe(doneIndex + 1);
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload).toMatchObject({
      messageId: ASSISTANT_MESSAGE,
      replayed: false,
      fallback: false,
      reason: null,
      correlationId: CORRELATION,
    });
    // Preview/draft join contract, end to end.
    expect(payload.draft.body).toBe("Hello world.");
  });

  it("discards the preview when it diverges from the validated draft", async () => {
    const source: AgentStreamSource = async () => ({
      deltas: ["Preview text."],
      candidate: { ...CANDIDATE, body: "Different validated body." },
    });
    setStreamRouteTestSeams({ source });
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const frames = parseSse(await response.text());
    // The diverted preview stays on the wire; the `end` draft wins.
    expect(frames.filter((frame) => frame.event === "token")).toHaveLength(1);
    const end = frames.find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload.fallback).toBe(true);
    expect(payload.reason).toBe("invalid_candidate");
    expect(payload.draft.body).toMatch(/stored organization context/);
    expect(payload.draft.body).not.toContain("Preview text.");
    expect(payload.draft.body).not.toContain("Different validated body.");

    const repo = mocks.createRepo.mock.results[0]?.value;
    const append = repo.appendMessageKeyed.mock.calls[0][0];
    expect(append.body).toContain("failed validation");
  });

  it("caps forwarded frames while the end stays an honest model draft", async () => {
    const body = "x".repeat(2005);
    const source: AgentStreamSource = async () => ({
      deltas: Array.from({ length: 2005 }, () => "x"),
      candidate: { ...CANDIDATE, body },
    });
    setStreamRouteTestSeams({ source });
    const response = await GET(request(streamUrl()), params);

    expect(response.status).toBe(200);
    const frames = parseSse(await response.text());
    expect(frames.filter((frame) => frame.event === "token")).toHaveLength(2000);
    const end = frames.find((frame) => frame.event === "end");
    const payload = streamEndPayloadSchema.parse(JSON.parse(end!.data));
    expect(payload.fallback).toBe(false);
    expect(payload.reason).toBeNull();
    expect(payload.draft.body).toBe(body);
  });

  it("logs provider failures with identifiers only, keeping config-absent distinct", async () => {
    // G4: a failed call (length-finish) must be observable as call-failed —
    // error name + finishReason + correlation, never bodies or secrets.
    const failing: AgentStreamSource = async () => ({
      deltas: [],
      candidate: Promise.reject(
        Object.assign(new Error("No object generated"), {
          name: "AI_NoObjectGeneratedError",
          finishReason: "length",
          text: "",
        }),
      ),
    });
    setStreamRouteTestSeams({ source: failing });
    const failed = await GET(request(streamUrl()), params);
    expect(failed.status).toBe(200);
    const failedEnd = parseSse(await failed.text()).find((frame) => frame.event === "end");
    const failedPayload = streamEndPayloadSchema.parse(JSON.parse(failedEnd!.data));
    expect(failedPayload.fallback).toBe(true);
    expect(failedPayload.reason).toBe("synthesis_failed");
    expect(logger.warn).toHaveBeenCalledWith(
      "agent_stream.synthesis_failed",
      expect.objectContaining({
        errorName: "AI_NoObjectGeneratedError",
        errorCode: "length",
        correlationId: CORRELATION,
      }),
    );
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      "What should we focus on next?",
    );

    // Config-absent stays the info-only honest fallback: no error name, no
    // failure warn — operators can tell the two apart in the log stream.
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("AI_ANSWER_MODEL", "");
    vi.stubEnv("AI_ANSWER_STRONG_MODEL", "");
    clearStreamRouteTestSeams();
    const unconfigured = await GET(request(streamUrl()), params);
    expect(unconfigured.status).toBe(200);
    const plainEnd = parseSse(await unconfigured.text()).find((frame) => frame.event === "end");
    const plainPayload = streamEndPayloadSchema.parse(JSON.parse(plainEnd!.data));
    expect(plainPayload.fallback).toBe(true);
    expect(plainPayload.reason).toBe("not_configured");
    expect(vi.mocked(logger.warn).mock.calls.map((call) => call[0])).not.toContain(
      "agent_stream.synthesis_failed",
    );
  });

  it("validates end message ids as uuids like the query does", () => {
    const draft = { ...CANDIDATE };
    expect(() =>
      streamEndPayloadSchema.parse({
        messageId: "not-a-uuid",
        replayed: false,
        fallback: false,
        reason: null,
        draft,
        correlationId: CORRELATION,
      }),
    ).toThrow();
    expect(
      streamEndPayloadSchema.parse({
        messageId: ASSISTANT_MESSAGE,
        replayed: false,
        fallback: false,
        reason: null,
        draft,
        correlationId: CORRELATION,
      }).messageId,
    ).toBe(ASSISTANT_MESSAGE);
  });
});
