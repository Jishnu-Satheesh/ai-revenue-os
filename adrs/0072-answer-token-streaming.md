# ADR 0072: Answer token streaming over SSE with durable validated persist

## Status

Accepted (scoped). Approved 2026-09-26 as part of
`docs/superpowers/specs/2026-09-26-agent-streaming-synthesis-design.md`.
Reverses the no-streaming rule of ADR 0071 only; everything ADR 0071 says
about durable rows, validation, and fallback honesty stands.

## Context

ADR 0071 chose poll-rendered answers deliberately: no token-streaming
endpoint existed, adding one would have widened the Tier 3 surface
(streaming transport, partial-row durability, resume semantics) for no
product need, and the honest gap was narrower — nothing wrote
`assistant`-role messages at all. So answers rendered from durable
assistant rows re-read after send/submit, with the model path env-gated
and every model failure degrading to the deterministic cited fallback.

That fallback did its job and then drew the outcry: served without model
config, or served on every model failure, it reads templated — the same
canned shape on every question. The user direction in the approved design
is explicit: replace the templated fallback answers with a real
ChatGPT-style conversation — varied, natural LLM answers streamed
token-by-token into the thread. Poll-then-appear cannot deliver that feel;
tokens must render live.

## Decision

1. One new SSE stream route per thread. The client opens it on send with
   thread and message ids; the server picks the model by tier (light/cheap
   for Quick answers, stronger for DeepThink and campaign ideas), streams
   body tokens, and the drawer renders tokens live, swapping in the
   durable row on the done marker.
2. Streaming is transport only. At stream end the server validates the
   full candidate through the existing strict synthesis schema and
   persists the encoded durable row under the existing nonce-derived
   idempotency keys (replays converge; retries are replays by key). A
   stream that fails end-of-stream validation discards the draft and
   shows the fallback with the reason named — never invention.
3. Reconnects and history reopens read durable rows, never resume dead
   streams. A dropped stream keeps its partial text with a "stopped here"
   note plus the stored-context fallback.

## What stays (from ADR 0071)

- Durable `assistant` rows remain the system of record; the stream is not
  one. History, reopen, and reconnect all replay the same rows.
- Nonce idempotency is unchanged: the thread/message/route triple and the
  thread-linked key (`agent_thread:<threadId>:<messageDigest>:answer`)
  still converge replays, and a conflicting append still degrades to
  draft-only rather than failing the route.
- Strict validation is unchanged: candidates parse through the strict Zod
  schema, citations filter to pack sources with the writer-stamped pack
  digest, estimates carry the fixed "Estimate" label plus inputs and
  assumptions, unknowns become limitations, and realized-result claims
  stay unrepresentable.
- Approval fences are unchanged: inline approve in chat plus the existing
  Studio/Telegram review with exact-version binding; viewer routes still
  synthesize without persisting, so read-only stays read-only.
- No caps: token-cost metering stays a non-goal. 15s timeouts,
  fail-closed fallback, and per-tier usage logged by correlation id carry
  the spend discipline instead.

## Consequences

- ADR 0071's rule "answers render poll-rendered from durable assistant
  rows, never from a token stream — no new endpoint, no streaming
  transport" is reversed. The remainder of ADR 0071 (durable rows,
  idempotency, strict schema disposal, env-gated model path, honest
  fallback) is reaffirmed above and stays binding.
- §10.1 is amended again: "answers stream token-live over SSE per thread
  and persist validated durable rows at stream end (see ADR 0072);
  reconnects read durable rows".
- Rollback: close or stop calling the stream route; the drawer falls back
  to poll-rendered durable rows per ADR 0071. Already-written assistant
  rows keep rendering — they are ordinary durable rows, so rollback
  removes future streams, not past answers.
