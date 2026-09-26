# ADR 0071: Poll-rendered answer synthesis with durable assistant rows

## Status

Accepted (scoped). Approved 2026-09-26 as Slice A of
`docs/superpowers/plans/2026-09-26-universal-ai-agent-followups.md`
(answer-writer: closes review gap I1 — the drawer Response tab never showed
an answer because nothing wrote `assistant`-role messages).

## Context

The base agent design (§10.1) said "answer text streams via Vercel AI SDK".
No token-streaming endpoint was ever built, and adding one now would widen
the Tier 3 surface (streaming transport, partial-row durability, resume
semantics) for no product need: the drawer already polls durable state
(thread-checkpoint poll + messages GET), and history reopen already replays
durable rows. The honest gap was narrower — nobody wrote the answer at all.

## Decision

1. Answers render poll-rendered from durable `assistant` rows, never from a
   token stream. The `routeLatest`/answers re-route synthesizes after
   routing and persists one assistant row through the existing fenced
   `append_agent_message` RPC under the thread-linked key
   `agent_thread:<threadId>:<messageDigest>:answer` (replays converge; a
   conflicting append degrades to draft-only rather than failing the
   route). The drawer re-reads the messages GET after send/submit and
   merges by id; reopen replays the same rows. No new endpoint, no
   streaming transport, no POST-body rendering.
2. The light model generates; deterministic code disposes
   (`src/modules/agent-chat/application/answer-writer.ts`). Candidates are
   parsed through a strict Zod schema, citations are filtered to pack
   sources with the writer-stamped pack digest, estimates must carry the
   fixed "Estimate" label plus inputs and assumptions, unknowns become
   limitations, and every model failure degrades to the honest
   internal-only fallback. Realized-result claims are unrepresentable: the
   candidate schema has no baseline, attribution-method, or
   measurement-window field — strict parsing rejects them.
3. The model path is env-gated (`AI_ANSWER_MODEL` plus the Google
   credential); without both, the writer serves the deterministic cited
   fallback with zero provider calls. The writer never borrows the router
   or default model silently.
4. Viewer routes synthesize but persist nothing: the draft returns with a
   null message row, and the fenced RPC is never touched — read-only stays
   read-only.
5. No markdown renderer is added. None exists in this tree, and answer
   bodies render as plain text (whitespace preserved, never HTML) composed
   from the installed Card/Badge/Separator primitives — no new dependency,
   no HTML injection surface.

## Known interim shape (not hidden)

The Task 1 `append_agent_message` RPC accepts body text only, so the
draft's citations, limitations, and labeled estimates travel as
deterministic encoded sections inside the assistant body
(`encodeAnswerBody` / `parseAnswerBody`, round-trip tested). The
`citations`/`marker_receipts` jsonb columns stay null until a later slice
extends the RPC via migration — Slice B builds on the encoded-body shape
plus the structured `AnswerDraft` the service returns. Likewise the
answers route still digests the V1 placeholder (no context readers wired —
Task 3 items M6/M7), so answers re-routes synthesize from the routing note
with an explicit context-unavailable limitation until then.

## Consequences

- §10.1 is amended: "answers render poll-rendered from durable assistant
  rows (no token-streaming endpoint — see ADR 0071)".
- Rollback: stop calling the synthesize step (routeLatest returns
  `answer: null` shape); already-written assistant rows keep rendering —
  they are ordinary durable rows, so rollback removes future answers, not
  past ones.
