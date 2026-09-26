# Design: Real-time streaming synthesis + ideas-first campaign flow

## Status

Design approved section by section on 2026-09-26 (brainstorming, architectural path).
Human decisions locked: two-tier models, dual approval surfaces, no spend cap, full build in one go,
sub-agent driven development for implementation.
No implementation authorized by this document. Implementation requires a separate approved
Execution Plan (writing-plans skill), executed via sub-agent driven development.

## 1. Goal

Replace the templated fallback answers with a real ChatGPT-style conversation: varied,
natural LLM answers streamed token-by-token into the thread, campaign advice that proposes
ideas instead of blank forms, and steps merged borderless into the conversation.

## 2. Non-goals

- Token-cost metering or caps (explicitly declined; timeouts + monitoring instead).
- Changing thread storage, polling, RLS, approval fences, or the Studio/Telegram review surface.
- Voice, attachments, autonomous execution (unchanged V1 boundaries).

## 3. Locked decisions

- Two-tier models: light/cheap model for Quick answers, stronger model for DeepThink and campaign ideas.
- Approval surfaces: both — inline approve in chat plus the existing Studio/Telegram review.
- Spend: no cap; 15s timeouts, fail-closed fallback, per-tier usage logged by correlation id.
- Delivery: full build in one go (phased approach considered and set aside).
- ADR 0071 (poll-rendered, no token streaming) is deliberately reversed by this design; the reversal is recorded here and must be referenced from the Execution Plan.

## 4. Architecture

One new SSE stream route per thread. The client opens it on send; the server picks the model
by tier, streams body tokens, and at stream end validates the full candidate through the
existing strict synthesis schema and persists the encoded durable row under the existing
nonce-derived idempotency keys. The drawer renders tokens live and swaps in the durable row
(citations, limitations, estimates) on the done marker. Campaign advice is ideas-first: the
route returns a 3-option questionnaire with exactly one recommended flag; the pick posts to
the answers route and the executor calls the existing draft seam immediately, returning the
inline approve action and the Studio hyperlink. Steps render as icon-led markers merged into
the thread with no container card; the routed-to intent lives only there.

## 5. Components

1. SSE stream route — owns the connection, tier selection, token forwarding, end-of-stream validation and durable persist; nothing else.
2. Tiered synthesizer — thin wrapper over the existing answer-writer seams; raised temperature so answers vary; strict schema disposal unchanged.
3. Campaign-ideas questionnaire kind — three options (title + short description, exactly one recommended), rendered by the existing Questionnaire card.
4. Inverted draft executor — on pick, immediate draft-seam call; returns inline approve plus Studio link; reuses today's exact-version approval binding.
5. Borderless step markers — current Marker list minus the container card and minus the separate "Routed to" badge line.

## 6. Data flow

Send mints the thread/message/route triple with existing idempotency keys. The intent picks the
tier; the drawer opens the stream with thread and message ids. Tokens render live; at end the
server validates, encodes, and appends the durable row; the client swaps to the durable render.
Reconnects and reopens read the durable row, never resume dead streams. Campaign picks travel
the answers route with the echoed spec; the executor returns draft id, inline approve, and
Studio link in one payload.

## 7. Error handling

Stream drop keeps partial text with a "stopped here" note plus the stored-context fallback.
End-of-stream validation failure discards the draft and shows the fallback with reason named.
Model timeout shows the fallback. Missing model config behaves exactly as today. Draft failures
alert with nothing half-created; retries are replays by key. Every failure degrades to honesty,
never invention; realized-result claims stay unrepresentable in the schemas.

## 8. Testing

Stream-protocol contracts; seam-injected synthesizer fallback tests (timeout, invalid candidate,
missing config); stream-retry idempotency; ideas-kind tests (exactly one recommended, pick posts
echoed spec); executor tests (pick → draft → both surfaces); drawer tests (live tokens, durable
swap, borderless steps, skeleton); one live supervised test run per tier before sign-off
(a single run each, not a cap system).

## 9. Implementation notes

- Execution via sub-agent driven development, dispatched per task after the approved plan.
- Temperature rises from 0.2; the conversational prompt keeps the citation/estimate discipline.
- Env: explicit `AI_ANSWER_MODEL` (light) plus a stronger-tier model id; the writer still never silently borrows models.
