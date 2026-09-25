import { describe, expect, it, vi } from "vitest";

import {
  createThreadRepository,
  type ThreadQueryBuilder,
} from "@/modules/agent-chat/infrastructure/thread-repository";
import { IdempotencyConflictError } from "@/domain/agent-chat/errors";
import { DomainError } from "@/lib/errors";

const THREAD_ROW = {
  id: "t1",
  organization_id: "o",
  title: "Hi",
  mode: "quick",
  status: "open",
  linked_research_project_id: null,
  linked_request_id: null,
  linked_draft_request_id: null,
  linked_campaign_id: null,
  created_by: "u",
  created_at: "2026-09-25T10:00:00.000Z",
  updated_at: "2026-09-25T10:00:00.000Z",
};

const MESSAGE_ROW = {
  id: "m1",
  organization_id: "o",
  thread_id: "t1",
  role: "user",
  body: "Hello",
  questionnaire_answers: null,
  marker_receipts: null,
  citations: null,
  created_by: "u",
  created_at: "2026-09-25T10:01:00.000Z",
};

/** Thenable select chain: records calls, resolves canned rows on await. */
function fakeQuery(rows: unknown[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const terminal = Promise.resolve({ data: rows, error: null });
  const builder = {
    select: (...args: unknown[]) => (calls.push({ method: "select", args }), builder),
    eq: (...args: unknown[]) => (calls.push({ method: "eq", args }), builder),
    order: (...args: unknown[]) => (calls.push({ method: "order", args }), builder),
    limit: (...args: unknown[]) => (calls.push({ method: "limit", args }), builder),
    lt: (...args: unknown[]) => (calls.push({ method: "lt", args }), builder),
    gt: (...args: unknown[]) => (calls.push({ method: "gt", args }), builder),
    or: (...args: unknown[]) => (calls.push({ method: "or", args }), builder),
    then: terminal.then.bind(terminal),
  };
  return { builder: builder as unknown as ThreadQueryBuilder, calls };
}

describe("thread repo replay", () => {
  it("returns kept thread on same key+body", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "t1", replayed: true }, error: null }));
    const repo = createThreadRepository({ rpc });
    const out = await repo.createThreadKeyed({
      organizationId: "o",
      actorId: "u",
      idempotencyKey: "k-1234567890123456",
      title: "Hi",
      mode: "quick",
    });
    expect(out.replayed).toBe(true);
  });

  it("calls the fenced create RPC with server-owned scope args", async () => {
    const rpc = vi.fn(async () => ({ data: { threadId: "t1", status: "open", replayed: false }, error: null }));
    const repo = createThreadRepository({ rpc });
    const out = await repo.createThreadKeyed({
      organizationId: "o",
      actorId: "u",
      idempotencyKey: "k-1234567890123456",
      title: "  Hi  ",
      mode: "deepthink",
    });
    expect(rpc).toHaveBeenCalledWith("create_agent_thread_keyed", {
      p_organization_id: "o",
      p_actor_id: "u",
      p_idempotency_key: "k-1234567890123456",
      p_title: "Hi",
      p_mode: "deepthink",
    });
    expect(out).toEqual({ threadId: "t1", status: "open", replayed: false });
  });

  it("sends null title when blank so the function applies its default", async () => {
    const rpc = vi.fn(async () => ({ data: { threadId: "t1", status: "open", replayed: false }, error: null }));
    const repo = createThreadRepository({ rpc });
    await repo.createThreadKeyed({
      organizationId: "o",
      actorId: "u",
      idempotencyKey: "k-1234567890123456",
      title: "   ",
      mode: "quick",
    });
    expect(rpc).toHaveBeenCalledWith(
      "create_agent_thread_keyed",
      expect.objectContaining({ p_title: null }),
    );
  });

  it("rejects an over-200 title like the Task 1 check", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repo = createThreadRepository({ rpc });
    await expect(
      repo.createThreadKeyed({
        organizationId: "o",
        actorId: "u",
        idempotencyKey: "k-1234567890123456",
        title: "x".repeat(201),
        mode: "quick",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a key conflict to IdempotencyConflictError", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "agent_thread_key_conflict" } }));
    const repo = createThreadRepository({ rpc });
    await expect(
      repo.createThreadKeyed({
        organizationId: "o",
        actorId: "u",
        idempotencyKey: "k-1234567890123456",
        mode: "quick",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("appends through the fenced append RPC and trims the body", async () => {
    const rpc = vi.fn(async () => ({ data: { messageId: "m1", threadId: "t1", replayed: false }, error: null }));
    const repo = createThreadRepository({ rpc });
    const out = await repo.appendMessageKeyed({
      organizationId: "o",
      actorId: "u",
      threadId: "t1",
      role: "user",
      body: "  Hello  ",
      idempotencyKey: "k-1234567890123456",
    });
    expect(rpc).toHaveBeenCalledWith("append_agent_message", {
      p_organization_id: "o",
      p_actor_id: "u",
      p_thread_id: "t1",
      p_role: "user",
      p_body: "Hello",
      p_idempotency_key: "k-1234567890123456",
    });
    expect(out).toEqual({ messageId: "m1", threadId: "t1", replayed: false });
  });

  it("rejects an over-20000 body like the Task 1 check", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repo = createThreadRepository({ rpc });
    await expect(
      repo.appendMessageKeyed({
        organizationId: "o",
        actorId: "u",
        threadId: "t1",
        role: "user",
        body: "x".repeat(20001),
        idempotencyKey: "k-1234567890123456",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a missing thread to a tenant-scoped error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "agent_thread_not_found" } }));
    const repo = createThreadRepository({ rpc });
    const error = await repo
      .appendMessageKeyed({
        organizationId: "o",
        actorId: "u",
        threadId: "foreign",
        role: "user",
        body: "Hello",
        idempotencyKey: "k-1234567890123456",
      })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("TENANT_SCOPE_ERROR");
  });

  it("pins thread reads to the caller's organization", async () => {
    const { builder, calls } = fakeQuery([THREAD_ROW]);
    const repo = createThreadRepository({ rpc: vi.fn(), from: () => builder });
    const out = await repo.listThreads({ organizationId: "o", limit: 20 });
    expect(out.threads).toHaveLength(1);
    expect(out.threads[0]).toMatchObject({ id: "t1", organizationId: "o", mode: "quick" });
    expect(out.nextCursor).toBeNull();
    expect(calls).toContainEqual({ method: "eq", args: ["organization_id", "o"] });
  });

  it("pages threads with an opaque cursor", async () => {
    const second = { ...THREAD_ROW, id: "t2", updated_at: "2026-09-25T09:00:00.000Z" };
    const { builder } = fakeQuery([THREAD_ROW, second]);
    const repo = createThreadRepository({ rpc: vi.fn(), from: () => builder });
    const first = await repo.listThreads({ organizationId: "o", limit: 1 });
    expect(first.threads).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const { builder: builder2, calls: calls2 } = fakeQuery([second]);
    const repo2 = createThreadRepository({ rpc: vi.fn(), from: () => builder2 });
    const second_page = await repo2.listThreads({ organizationId: "o", limit: 1, cursor: first.nextCursor! });
    expect(second_page.threads[0]).toMatchObject({ id: "t2" });
    expect(calls2.some((call) => call.method === "or")).toBe(true);
  });

  it("returns null for a foreign thread id", async () => {
    const { builder } = fakeQuery([]);
    const repo = createThreadRepository({ rpc: vi.fn(), from: () => builder });
    await expect(repo.getThread({ organizationId: "o", threadId: "foreign" })).resolves.toBeNull();
  });

  it("reads one message pinned to the organization", async () => {
    const { builder, calls } = fakeQuery([MESSAGE_ROW]);
    const repo = createThreadRepository({ rpc: vi.fn(), from: () => builder });
    const out = await repo.getMessage({ organizationId: "o", messageId: "m1" });
    expect(out).toMatchObject({ id: "m1", threadId: "t1" });
    expect(calls).toContainEqual({ method: "eq", args: ["organization_id", "o"] });
    expect(calls).toContainEqual({ method: "eq", args: ["id", "m1"] });
  });

  it("lists messages oldest-first with saved payloads", async () => {
    const { builder } = fakeQuery([MESSAGE_ROW]);
    const repo = createThreadRepository({ rpc: vi.fn(), from: () => builder });
    const out = await repo.listMessages({ organizationId: "o", threadId: "t1" });
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toMatchObject({ id: "m1", threadId: "t1", role: "user", body: "Hello" });
    expect(out.nextCursor).toBeNull();
  });

  it("reads the newest user message for routing", async () => {
    const { builder } = fakeQuery([MESSAGE_ROW]);
    const repo = createThreadRepository({ rpc: vi.fn(), from: () => builder });
    const out = await repo.latestUserMessage({ organizationId: "o", threadId: "t1" });
    expect(out).toMatchObject({ id: "m1", body: "Hello" });
  });

  it("refuses reads without a query client instead of inventing scope", async () => {
    const repo = createThreadRepository({ rpc: vi.fn() });
    await expect(repo.listThreads({ organizationId: "o" })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("thread repo links", () => {
  const DRAFT_REQUEST = "44444444-4444-4444-8444-444444444444";

  it("writes thread links through the fenced RPC and returns the kept ids", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        threadId: "t1",
        projectId: null,
        requestId: null,
        draftRequestId: DRAFT_REQUEST,
        campaignId: null,
        replayed: false,
      },
      error: null,
    }));
    const repo = createThreadRepository({ rpc });
    const out = await repo.setThreadLinks({
      organizationId: "o",
      actorId: "u",
      threadId: "t1",
      draftRequestId: DRAFT_REQUEST,
    });
    expect(rpc).toHaveBeenCalledWith("set_thread_links", {
      p_organization_id: "o",
      p_actor_id: "u",
      p_thread_id: "t1",
      p_project_id: null,
      p_request_id: null,
      p_draft_request_id: DRAFT_REQUEST,
      p_campaign_id: null,
    });
    expect(out).toEqual({
      threadId: "t1",
      projectId: null,
      requestId: null,
      draftRequestId: DRAFT_REQUEST,
      campaignId: null,
    });
  });

  it("refuses a malformed link id before touching the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repo = createThreadRepository({ rpc });
    await expect(
      repo.setThreadLinks({
        organizationId: "o",
        actorId: "u",
        threadId: "t1",
        draftRequestId: "not-a-uuid",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a forbidden link write to an authorization error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: "agent_thread_links_forbidden" }));
    const repo = createThreadRepository({ rpc });
    const error = await repo
      .setThreadLinks({ organizationId: "o", actorId: "u", threadId: "t1" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("AUTHORIZATION_ERROR");
  });
});
