# Agent Streaming Synthesis + Ideas-First Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task (user-chose execution). Fresh subagent per task, review between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace templated fallback answers with streamed two-tier LLM answers and invert campaign advice to ideas-first draft creation.

**Architecture:** SSE stream route per thread with tier selection and end-of-stream validation plus durable persist; drawer renders tokens live then swaps to the durable row; campaign advice proposes ideas, drafts on pick, approves inline and in Studio.

**Tech Stack:** Vercel AI SDK (`generateObject` today, token stream for SSE), Google Generative AI, Next.js routes, SSE, Zod strict schemas, TanStack Query, existing Questionnaire/Marker/Card primitives.

**Spec:** `docs/superpowers/specs/2026-09-26-agent-streaming-synthesis-design.md` — executors read both.

## Global Constraints

- Advise freely, execute narrowly; draft creation is never approval and binds the exact bundle version.
- Tenant isolation at DB and app layers; server-owned org id on every read/write; RLS forced.
- Zod at every AI boundary; realized-result claims stay unrepresentable (no baseline, attribution, window fields).
- Idempotency keys on every retried side effect; retries replay, never double-post.
- Estimates labeled Estimate with inputs and assumptions on the same surface.
- shadcn/ui only for user-facing controls; no manual z-index on overlays.
- Staging is shared and live on push; never `git stash`; `git push` is the user's step.
- New plpgsql reading tables it did not create must be called once against staging before done.

---

### Task 1: Two-tier model switch-on

**Files:**
- Modify: `src/modules/agent-chat/application/answer-writer.ts` (tiered synthesizer selection, temperature, conversational prompt).
- Modify: `src/modules/agent-chat/application/answer-writer.test.tsx` (tier coverage).
- Note: `.env.local` plus staging env need `AI_ANSWER_MODEL` (Quick/light) and `AI_ANSWER_STRONG_MODEL` (DeepThink/ideas) — values set by the user, never committed.

**Interfaces:**
- Consumes: existing `createAnswerSynthesizer`, `synthesisCandidateSchema`, `writeAnswer` seams.
- Produces: tier-selected `synthesize` honoring mode, exported env names both tiers use downstream.

- [ ] Step 1: Extend the synthesizer factory with a strong-tier path keyed by mode, keeping the null-without-config behavior.
- [ ] Step 2: Raise sampling temperature and retune the system prompt for conversational answers without weakening citation, estimate, or realized-result discipline.
- [ ] Step 3: Add failing-then-passing tests for tier selection, fallback parity, and discipline preservation.
- [ ] Step 4: Run the answer-writer suite plus typecheck and lint on touched files.
- [ ] Step 5: Commit the code change only (no secrets).

### Task 2: ADR 0072 — streaming reversal record

**Files:**
- Create: `adrs/0072-answer-token-streaming.md` (reverses `adrs/0071-answer-poll-rendered-synthesis.md`, keeps durable persist).

**Interfaces:**
- Consumes: ADR 0071, the approved spec.
- Produces: the recorded decision every later task cites.

- [ ] Step 1: Write the ADR (context, decision, consequences, what stays: durable rows, idempotency, validation).
- [ ] Step 2: Reference it from the spec design doc.
- [ ] Step 3: Commit.

### Task 3: SSE stream route with durable end-persist

**Files:**
- Create: `src/app/api/organizations/[organizationId]/agent/threads/[threadId]/stream/route.ts` (SSE GET: tier select, token forward, end validate, durable append).
- Test: colocated `route.test.ts` with seam-injected stream source.

**Interfaces:**
- Consumes: Task 1 tiered synthesizer, `encodeAnswerBody`, thread nonce idempotency keys, existing thread/message/route auth and gating.
- Produces: frame protocol (token frames, done marker, end payload with citations/limitations/estimates) the drawer task consumes verbatim.

- [ ] Step 1: Define the frame protocol in the route module with Zod schemas for the end payload.
- [ ] Step 2: Implement tier selection, abort/timeout handling, end-of-stream validation, and durable append under the existing idempotency keys.
- [ ] Step 3: Contract tests for frames, done marker, invalid-candidate discard, retry replay, and auth/gating parity with sibling routes.
- [ ] Step 4: Run route suite plus typecheck and lint on touched files.
- [ ] Step 5: Commit.

### Task 4: Drawer live tokens, durable swap, borderless steps

**Files:**
- Modify: `src/components/agent/agent-drawer.tsx` (open stream on send, render tokens into the thread bubble, swap to durable row on done, skeleton while connecting).
- Modify: `src/components/agent/agent-response-message.tsx` (accept a live body plus the parsed durable render).
- Modify: `src/components/agent/agent-drawer.test.tsx` (streaming, swap, skeleton coverage).
- Remove: the bordered processing container and the separate Routed-to badge line; routed-to intent shows only inside the icon-led Marker list.

**Interfaces:**
- Consumes: Task 3 frame protocol verbatim; existing `AgentThreadSteps`, checkpoint poll, reopen path.
- Produces: the thread UI the campaign task mounts its cards into.

- [ ] Step 1: Stream-open on send with reconnect-never semantics (reconnects and reopens read the durable row).
- [ ] Step 2: Live-token bubble rendering with durable swap on the done marker and partial-plus-note on stream drop.
- [ ] Step 3: Borderless icon-led steps merged into the thread; intent shown only in steps.
- [ ] Step 4: Tests for live rendering, swap, drop honesty, skeleton, and existing pipeline/gating preservation.
- [ ] Step 5: Run the agent component suites plus typecheck and lint; live screenshot proof.
- [ ] Step 6: Commit.

### Task 5: Campaign-ideas questionnaire kind

**Files:**
- Modify: `src/domain/agent-router/contracts.ts` (add `campaign_ideas` to `questionnaireKindSchema` with options carrying title, short description, and exactly-one recommended flag).
- Modify: `src/components/agent/agent-questionnaire-card.tsx` (render ideas with the recommended marker).
- Test: extend questionnaire/domain suites for the exactly-one-recommended invariant and echoed-spec posting.

**Interfaces:**
- Consumes: existing Questionnaire card, answers route echoed-spec contract.
- Produces: the ideas spec shape the executor task consumes verbatim.

- [ ] Step 1: Extend the kind union and option schema with the recommended invariant.
- [ ] Step 2: Render ideas (title plus short description, recommended marked) in the existing card.
- [ ] Step 3: Tests for the invariant, rendering, and spec echo.
- [ ] Step 4: Run domain plus component suites, typecheck, lint.
- [ ] Step 5: Commit.

### Task 6: Executor inversion — pick to instant draft to dual approval

**Files:**
- Modify: `src/modules/agent-chat/application/campaign-advise.ts` (advise via ideas generation on the strong tier; immediate `requestDraft` on pick).
- Modify: the answers route for threads (accept the ideas pick, return draft id, inline approve action, and Studio hyperlink in one payload).
- Modify: `src/components/agent/agent-campaign-advice.tsx` (ideas result rendering, inline approve button, Studio link; form-first flow removed).
- Test: executor, route, and component suites.

**Interfaces:**
- Consumes: Task 5 ideas spec; existing `requestDraft` seam, approval binding, brief fallback.
- Produces: pick-to-approval thread flow with both surfaces.

- [ ] Step 1: Generate three grounded ideas (one recommended) through the strong-tier synthesizer with pack-cited inputs.
- [ ] Step 2: Accept the pick in the answers route and call the draft seam immediately with idempotency.
- [ ] Step 3: Render inline approve plus Studio hyperlink; keep the brief fallback when ineligible.
- [ ] Step 4: Tests for ideas grounding, immediate draft, dual surfaces, fallback, and grant enforcement.
- [ ] Step 5: Run module plus component suites, typecheck, lint; live screenshot proof.
- [ ] Step 6: Commit.

### Task 7: Live supervised runs and close-out

**Files:**
- Modify: board log and spec status lines only; no product code unless a fix round demands it.

**Interfaces:**
- Consumes: all tasks above.
- Produces: sign-off evidence.

- [ ] Step 1: One live supervised run per tier (Quick, DeepThink, ideas-to-draft) with correlation ids recorded; drafts approved or discarded deliberately.
- [ ] Step 2: Rerun the full E2E proof on the final build and record the summary.
- [ ] Step 3: Verify tenant isolation paths once more (role gating, RLS, server-owned org).
- [ ] Step 4: Record results in the board log; leave uncommitted for user review and push.
