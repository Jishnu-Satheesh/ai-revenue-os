import { describe, expect, it } from "vitest";

import {
  AGENT_THREAD_IDEMPOTENCY_PREFIX,
  buildThreadIdempotencyKey,
  messageDigestFor,
} from "@/modules/agent-chat/application/thread-keys";

describe("thread-linked idempotency keys", () => {
  it("mints agent_thread:<threadId>:<digest> keys", () => {
    expect(buildThreadIdempotencyKey("t1", "abc123abc123abc1")).toBe(
      `${AGENT_THREAD_IDEMPOTENCY_PREFIX}:t1:abc123abc123abc1`,
    );
  });

  it("rejects blank tokens instead of minting a colliding key", () => {
    expect(() => buildThreadIdempotencyKey("", "abc123abc123abc1")).toThrow();
    expect(() => buildThreadIdempotencyKey("t1", "x".repeat(201))).toThrow();
  });

  it("digests stably to 16 hex chars, distinct per input", () => {
    const first = messageDigestFor({ threadId: "t1", messageId: "m1", body: "Hello" });
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(messageDigestFor({ threadId: "t1", messageId: "m1", body: "Hello" })).toBe(first);
    expect(messageDigestFor({ threadId: "t1", messageId: "m1", body: "Hello!" })).not.toBe(first);
  });
});
