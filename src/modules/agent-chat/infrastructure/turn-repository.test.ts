import { describe, expect, it, vi } from "vitest";

import { createAgentTurnRepository } from "@/modules/agent-chat/infrastructure/turn-repository";

const ORG = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const TURN = "55555555-5555-4555-8555-555555555555";

describe("durable agent turn repository", () => {
  it("keeps safe RPC reason codes for revoked permissions without exposing provider errors", async () => {
    const repository = createAgentTurnRepository({ rpc: vi.fn(async () => ({ data: null, error: { message: "agent_turn_actor_revoked" } })) });
    await expect(repository.getActorRole({ organizationId: ORG, turnId: TURN, leaseToken: "99999999-9999-4999-8999-999999999999" })).rejects.toMatchObject({
      code: "AUTHORIZATION_ERROR", cause: { reasonCode: "agent_turn_actor_revoked" },
    });
  });
  it("keeps a worker lease alive and fences its terminal answer", async () => {
    const lease = "99999999-9999-4999-8999-999999999999";
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === "claim_agent_turn"
          ? { turnId: TURN, status: "running", leaseToken: lease, attempt: 1 }
          : name === "heartbeat_agent_turn"
            ? { turnId: TURN, status: "running", leaseExpiresAt: "2026-10-03T12:00:00+00:00" }
            : { turnId: TURN, status: "completed", messageId: MESSAGE, replayed: false },
      error: null,
    }));
    const repository = createAgentTurnRepository({ rpc });

    expect(
      await repository.claim({ organizationId: ORG, turnId: TURN, leaseToken: lease }),
    ).toMatchObject({
      turnId: TURN,
      status: "running",
      leaseToken: lease,
    });
    expect(
      await repository.heartbeat({ organizationId: ORG, turnId: TURN, leaseToken: lease }),
    ).toMatchObject({
      turnId: TURN,
      status: "running",
    });
    expect(
      await repository.complete({
        organizationId: ORG,
        turnId: TURN,
        leaseToken: lease,
        answerBody: "A practical answer.",
      }),
    ).toMatchObject({
      messageId: MESSAGE,
      status: "completed",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "heartbeat_agent_turn", {
      p_organization_id: ORG,
      p_turn_id: TURN,
      p_lease_token: lease,
    });
  });

  it("keeps approval and challenge definitions on server-owned calls", async () => {
    const lease = "99999999-9999-4999-8999-999999999999";
    const packageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === "set_agent_turn_challenge"
          ? {
              turnId: TURN,
              status: "awaiting_user",
              challengeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            }
          : name === "set_agent_turn_approval"
            ? { turnId: TURN, status: "awaiting_approval", packageId }
            : { turnId: TURN, status: "queued", replayed: false },
      error: null,
    }));
    const repository = createAgentTurnRepository({ rpc });
    expect(
      await repository.setChallenge({
        organizationId: ORG,
        turnId: TURN,
        leaseToken: lease,
        kind: "metadata",
        fields: [{ key: "periodStart", label: "Period start", kind: "date", required: true }],
      }),
    ).toMatchObject({ status: "awaiting_user" });
    expect(
      await repository.setApproval({
        organizationId: ORG,
        turnId: TURN,
        leaseToken: lease,
        kind: "report_contract",
        packageId,
      }),
    ).toMatchObject({ status: "awaiting_approval" });
    expect(
      await repository.resumeApproval({ organizationId: ORG, turnId: TURN, packageId }),
    ).toMatchObject({
      status: "queued",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "set_agent_turn_challenge", {
      p_organization_id: ORG,
      p_turn_id: TURN,
      p_lease_token: lease,
      p_kind: "metadata",
      p_fields: [{ key: "periodStart", label: "Period start", kind: "date", required: true }],
    });
  });

  it("reads the actor's current effective role through a fenced worker RPC", async () => {
    const lease = "99999999-9999-4999-8999-999999999999";
    const rpc = vi.fn(async () => ({
      data: { turnId: TURN, actorId: ACTOR, role: "operator" },
      error: null,
    }));
    const repository = createAgentTurnRepository({ rpc });

    expect(
      await repository.getActorRole({ organizationId: ORG, turnId: TURN, leaseToken: lease }),
    ).toEqual({
      turnId: TURN,
      actorId: ACTOR,
      role: "operator",
    });
    expect(rpc).toHaveBeenCalledWith("get_agent_turn_actor_role", {
      p_organization_id: ORG,
      p_turn_id: TURN,
      p_lease_token: lease,
    });
  });

  it("loads recent turns by organization and thread so history can be restored", async () => {
    const calls: Array<[string, unknown]> = [];
    const row = {
      id: TURN,
      organization_id: ORG,
      thread_id: THREAD,
      user_message_id: MESSAGE,
      requested_by: ACTOR,
      objective: "business_advice",
      status: "completed",
      pending_challenge: null,
      challenge_answers: null,
      answered_challenge_kind: null,
      pending_approval: null,
      lease_expires_at: null,
      attempt: 1,
      final_message_id: MESSAGE,
      failure_code: null,
      created_at: "2026-10-03T10:00:00+00:00",
      updated_at: "2026-10-03T10:01:00+00:00",
    };
    const query = {
      select() {
        return this;
      },
      eq(key: string, value: unknown) {
        calls.push([key, value]);
        return this;
      },
      gt(key: string, value: number) {
        calls.push([key, value]);
        return this;
      },
      order() {
        return this;
      },
      limit(count: number) {
        calls.push(["limit", count]);
        return this;
      },
      then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
          | null
          | undefined,
      ): PromiseLike<TResult1 | TResult2> {
        const value = { data: [row] as unknown, error: null };
        return Promise.resolve(
          onfulfilled ? onfulfilled(value) : (undefined as unknown as TResult1 | TResult2),
        );
      },
    };
    const repository = createAgentTurnRepository({ rpc: vi.fn(), from: () => query });

    expect(await repository.listTurns(ORG, THREAD, 20)).toMatchObject([
      { id: TURN, status: "completed", pendingApproval: null, challengeAnswers: null, answeredChallengeKind: null },
    ]);
    expect(calls).toContainEqual(["organization_id", ORG]);
    expect(calls).toContainEqual(["thread_id", THREAD]);
    expect(calls).toContainEqual(["limit", 20]);
    expect(await repository.getTurnById(ORG, TURN)).toMatchObject({ id: TURN, threadId: THREAD });
  });
  it("returns the kept turn on a repeated start", async () => {
    const rpc = vi.fn(async () => ({
      data: { turnId: TURN, status: "queued", replayed: true },
      error: null,
    }));
    const repository = createAgentTurnRepository({ rpc });
    const result = await repository.start({
      organizationId: ORG,
      actorId: ACTOR,
      threadId: THREAD,
      userMessageId: MESSAGE,
      idempotencyKey: "12345678-1234-4234-8234-123456789012",
      objective: "business_advice",
    });

    expect(result).toEqual({ turnId: TURN, status: "queued", replayed: true });
    expect(rpc).toHaveBeenCalledWith("create_agent_turn", {
      p_organization_id: ORG,
      p_actor_id: ACTOR,
      p_thread_id: THREAD,
      p_user_message_id: MESSAGE,
      p_idempotency_key: "12345678-1234-4234-8234-123456789012",
      p_objective: "business_advice",
    });
  });

  it("submits only challenge ID and answers, never a client question definition", async () => {
    const rpc = vi.fn(async () => ({
      data: { turnId: TURN, status: "queued", replayed: false },
      error: null,
    }));
    const repository = createAgentTurnRepository({ rpc });
    await repository.answerChallenge({
      organizationId: ORG,
      actorId: ACTOR,
      turnId: TURN,
      challengeId: "66666666-6666-4666-8666-666666666666",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
      answers: { branchId: "88888888-8888-4888-8888-888888888888" },
    });
    expect(rpc).toHaveBeenCalledWith("answer_agent_turn_challenge", {
      p_organization_id: ORG,
      p_actor_id: ACTOR,
      p_turn_id: TURN,
      p_challenge_id: "66666666-6666-4666-8666-666666666666",
      p_idempotency_key: "77777777-7777-4777-8777-777777777777",
      p_answers: { branchId: "88888888-8888-4888-8888-888888888888" },
    });
  });
});
