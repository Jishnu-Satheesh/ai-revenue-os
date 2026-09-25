import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createRepo: vi.fn(),
  publish: vi.fn(),
  warn: vi.fn(),
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
  logger: { warn: mocks.warn, info: mocks.info, error: vi.fn() },
}));

import { GET, POST } from "@/app/api/organizations/[organizationId]/agent/threads/route";
import { IdempotencyConflictError } from "@/domain/agent-chat/errors";

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue(operatorContext());
});

describe("agent threads route", () => {
  it("lists threads with envelope, cursor, and no-store headers", async () => {
    mocks.createRepo.mockReturnValue({
      listThreads: vi.fn(async () => ({ threads: [THREAD_ROW], nextCursor: null })),
    });
    const response = await GET(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads?limit=10`),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ threads: [THREAD_ROW], nextCursor: null, correlationId: CORRELATION });
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects an out-of-range limit with 400", async () => {
    const response = await GET(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads?limit=99`),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(400);
  });

  it("creates a thread with 201, replaying with 200", async () => {
    mocks.createRepo.mockReturnValue({
      createThreadKeyed: vi.fn(async () => ({ threadId: THREAD, status: "open", replayed: false })),
      getThread: vi.fn(async () => THREAD_ROW),
    });
    const created = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "k-1234567890123456", title: "Hi", mode: "quick" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ thread: THREAD_ROW, replayed: false });

    mocks.createRepo.mockReturnValue({
      createThreadKeyed: vi.fn(async () => ({ threadId: THREAD, status: "open", replayed: true })),
      getThread: vi.fn(async () => THREAD_ROW),
    });
    const replayed = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "k-1234567890123456", title: "Hi", mode: "quick" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toMatchObject({ replayed: true });
  });

  it("refuses thread creation for viewers without touching persistence", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      ...operatorContext(),
      membership: { role: "viewer" },
    });
    const response = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "k-1234567890123456" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.createRepo).not.toHaveBeenCalled();
  });

  it("rejects a missing idempotency key and an over-200 title", async () => {
    for (const payload of [{ title: "Hi" }, { idempotencyKey: "short", title: "Hi" }, { idempotencyKey: "k-1234567890123456", title: "x".repeat(201) }]) {
      const response = await POST(
        request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads`, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
        { params: Promise.resolve({ organizationId: ORGANIZATION }) },
      );
      expect(response.status).toBe(400);
    }
  });

  it("maps a key conflict to 409", async () => {
    mocks.createRepo.mockReturnValue({
      createThreadKeyed: vi.fn(async () => {
        throw new IdempotencyConflictError("This chat was already saved with different details.");
      }),
      getThread: vi.fn(async () => THREAD_ROW),
    });
    const response = await POST(
      request(`http://localhost/api/organizations/${ORGANIZATION}/agent/threads`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "k-1234567890123456", title: "Other" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION);
  });
});
