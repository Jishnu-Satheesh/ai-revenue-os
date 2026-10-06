# Settle-Guarantee Slice: end-received settles steps + authoritative end-refresh (user-approved prereq: browser E2E proved stuck Checking after valid end despite correct durable truth)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Single task + review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "steps stuck on Thinking/Checking after the answer landed" unreachable by construction: (1) a validated `end` frame marks the turn received — steps go terminal on end even if row-merge lags; (2) the end/drop refresh REPLACES (not merges) messages with the fresh durable read; (3) `send.isPending` can no longer single-handedly pin routing after end arrived.

**Architecture:** Unchanged (deterministic code owns state; models judge/generate only). No spend/approval-fence change. No autonomy-semantics change.

**Tech Stack:** As ever (Next.js 16, TS strict, TanStack Query v5, shadcn/ui Marker, Supabase RLS).

**Spec:** `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` §5.2 (one-line: end-received settles steps) + §10.1 if render truth changes (it should not).

## Global Constraints

- Bodies/secrets never logged; viewers read-only; never `git stash`; never push (user's step); path-limited commits.
- No schema/migration/event/dependency changes; no router/thread-service/route/writer/prompt/fence changes — drawer-only slice.
- shadcn/ui only; no manual z-index.

---

### Task 1: End-received settles steps + authoritative end-refresh

**Files:**
- Modify: `src/components/agent/agent-drawer.tsx` ONLY (endReceived ref set in `onEnd` after schema validation; phase derivation: after `turnFailure`, settled = turnSettled || endReceivedForTurn → done; end/drop refresh REPLACES messages with fetched rows instead of merging; reset the ref on new send/reopen/new-chat)
- Modify: `src/components/agent/agent-drawer.test.tsx` (new tests ONLY)

**Interfaces:** No prop, route, or payload change. `end` shape untouched. The draft-only path (messageId null) already appends the draft row AND sets the received flag — steps terminal with the draft rendered.

- [ ] **Step 1: Failing tests (RED) — (a) end arrives but fetched rows merge-lag: steps still go terminal; (b) end-refresh replaces (stale local row superseded by durable read, no duplicates, optimistic already reconciled); (c) drop path unchanged honest (dropped note + refresh); (d) new send / reopen / new-chat resets the flag (next turn starts routing, no stuck-done)**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement (flag + phase rule + resets) + spec §5.2 one-liner with isolated hunk**
- [ ] **Step 4: Run gates (drawer suite + full agent scope + typecheck + lint on touched files)**
- [ ] **Step 5: Commit (path-limited: drawer + drawer test + spec hunk only)**

### Amendment (controller ruling, review-signed)

Refresh stays keep-first MERGE, not replace: replace broke 6 suites by
wiping locally-known rows (answers receipts, optimistic bodies) on stale
echoes, and same-id divergent bodies are unrepresentable through the
fenced keyed RPCs — merge-keep-first is correct. The guarantee rides on
the end-received state flag, not on refresh semantics.

## Self-Review

- Coverage: stuck-steps unreachable (end-received outranks pending/stream flags) + durable truth wins (replace) + next-turn clean (resets).
- Honesty preserved: end means a validated answer exists (durable row or validated draft) — terminal is truthful, never premature; pre-end streaming still shows routing; failures still go error via turnFailure.
- Risks: replace-on-refresh could drop a locally-queued row if a second send raced the first end — the pump serializes sends (one in flight) and optimistic rows reconcile on success before end; regression test pins no-loss. Rollback: restore merge + old phase order.
