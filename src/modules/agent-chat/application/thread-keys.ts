import { z } from "zod";

/**
 * Thread-linked idempotency keys (spec 10.1).
 *
 * Client-safe leaf: pure string ops plus Zod only — no `node:` imports,
 * no provider code, no growth-intelligence imports. The campaign-advice
 * handoff (rendered in the drawer, a client component) mints keys from
 * here instead of reaching into the server-side executors module, which
 * owns the TinyFish lane and the keyed RPC seams. The key pattern is
 * fixed once, in this file:
 * `agent_thread:<threadId>:<messageDigest>`.
 */

/** Idempotency namespace for every agent-dispatched unit of work. */
export const AGENT_THREAD_IDEMPOTENCY_PREFIX = "agent_thread";

const idempotencyTokenSchema = z.string().trim().min(1).max(200);

/**
 * Thread-linked idempotency key (spec 10.1):
 * `agent_thread:<threadId>:<messageDigest>`.
 */
export function buildThreadIdempotencyKey(threadId: string, messageDigest: string): string {
  const thread = idempotencyTokenSchema.parse(threadId);
  const digest = idempotencyTokenSchema.parse(messageDigest);
  return `${AGENT_THREAD_IDEMPOTENCY_PREFIX}:${thread}:${digest}`;
}

/**
 * Stable 16-hex digest over one thread message. Pure arithmetic (the same
 * mixing as the Task 3 placeholder and the pack digest, copied so this
 * module stays client-importable): the same thread + message + body always
 * yields the same key, so an identical re-click replays instead of
 * re-spending.
 */
export function messageDigestFor(input: {
  threadId: string;
  messageId: string;
  body: string;
}): string {
  const text = `${input.threadId}:${input.messageId}:${input.body}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}
