# Honest-Send + Coherent-Fallback + Answer-Quality + Model-Reach + Resize-Drag Plan (user-approved G1–G5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Sequential dispatch only (Tasks 1–5 share drawer/router/route files — never parallel). Fresh subagent per task, review between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six live-reported issues: optimistic send + failure terminality (G1), coherent router-down behavior (G2), answer quality incl. no-duplicate rows and Marker-ized receipts (G3), model-reach trace (G4), resize-works + drag-alignment (G5).

**Architecture:** Same governed shell: deterministic code owns state/scope/money; models judge/generate only, Zod-disposed. No spend/approval-fence change. Autonomy doctrine + purpose note (board top) still bind.

**Tech Stack:** Next.js 16, TS strict, shadcn/ui Marker/Tooltip, TanStack Query v5, Supabase RLS + fenced RPCs.

**Spec:** `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` (§5.2 drawer/steps, §8 router, §10.1 answers, §13 errors) — amend where truth changes. Peer Task-B plan + ADR 0074 stay authoritative for autonomy behavior.

## Global Constraints

- Fewer clicks, same fences. No autonomy change — Task B belongs to the peer lane; do not alter escalation/dispatch/one-tap semantics, only their failure/edge rendering where this plan says so.
- Tenant isolation DB + app; server-owned ids; viewers read-only (403 before persistence).
- Bodies/secrets never logged (correlation ids only); estimates keep inputs + assumptions on surface; realized-result claims stay unrepresentable.
- shadcn/ui only; no manual z-index; no new dependencies; no migration; no new events.
- Never `git stash`; never push (user's step); path-limited commits; do not touch peer Task-B prod files beyond what each task lists.

---

### Task 1: Honest send (G1)

**Files:**
- Modify: `src/components/agent/agent-drawer.tsx` (optimistic user bubble on mutate; post-send failure from ANY turn call — send/stream/answers/poll — sets error state + terminal steps + stops spinner)
- Modify: `src/components/agent/agent-drawer.test.tsx` (optimistic render; failure terminality incl. a 404 from the `[threadId]/messages` GET; no stuck spinner)

**Interfaces:** no route/shape change (client only). Known one-off: user-hit 404 came from the messages route; if it recurs the user will supply the URL — this task makes every such failure visible, whichever call fails.

- [ ] **Step 1: Optimistic user message on send (reconcile with durable row on success) with failing test first**
- [ ] **Step 2: Route every post-send failure into error state + terminal steps (regression test per call site: send, stream open, answers, messages refresh, thread poll)**
- [ ] **Step 3: Run gates (drawer suite + eslint)**
- [ ] **Step 4: Commit (path-limited)**

### Task 2: Coherent router-down (G2)

**Files:**
- Modify: `src/modules/agent-router/application/router-service.ts` (failClosed returns memory answer with NO questionnaire + honest note; delete `retry_deepthink` item from clarify cards — B2 auto-escalates, manual retry is dead; fix "read-only" copy contradiction)
- Modify: `src/components/agent/agent-thread-steps.tsx` (awaiting row without spinner for genuine clarify cards)
- Modify: router + drawer tests; spec §8/§13 lines

**Interfaces:** `RouterOutput` shape unchanged (questionnaire already nullable).

- [ ] **Step 1: Failing tests (no questionnaire on failClosed; no retry item anywhere; awaiting row renders with no spinner)**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement + spec lines + gates (router + drawer suites, typecheck, lint)**
- [ ] **Step 4: Commit (path-limited)**

### Task 3: Answer quality (G3)

**Files:**
- Modify: `src/modules/agent-chat/application/answer-writer.ts` (prompt rule: never restate org identity basics — name/industry/country — unless asked; lead with the news; fallback same voice)
- Modify: answers route + `src/modules/agent-chat/application/thread-service.ts` (re-route REPLACES the turn's assistant row instead of appending a second)
- Modify: `src/components/agent/agent-drawer.tsx` (saved answers + "Answers saved" as Markers; answered card hides during save showing shimmer Marker; questionnaireAnswers messages render as "You clarified: …" summaries, never raw `[answers …]` text)
- Modify: writer + route + drawer tests; spec §10.1 line

**Interfaces:** durable row shapes unchanged; exactly one assistant row per turn.

- [ ] **Step 1: Failing tests (no identity restatement; single assistant row after answers submit; Marker receipts; no raw echo)**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement + spec line + gates (agent scope suite, typecheck, lint)**
- [ ] **Step 4: Commit (path-limited)**

### Task 4: Model-reach trace (G4)

**Files:**
- Modify: `src/modules/agent-chat/application/answer-writer.ts` (resolution path ONLY) + stream route error path (surface, not swallow) + additive correlation-id logging
- Read-only first: env names present (`AI_ANSWER_MODEL`, `AI_ANSWER_STRONG_MODEL`, Google key named); trace why synthesis returns null/fallback with envs set — model-id validity, credential wiring, provider-call errors, route error mapping

**Interfaces:** no shape change; fix the cause found (resolution, credential, provider, or mapping), not all four blindly.

- [ ] **Step 1: Trace with failing/observable evidence (test or logged error with correlation id — never secret values)**
- [ ] **Step 2: Fix the found cause + regression test**
- [ ] **Step 3: Run gates**
- [ ] **Step 4: Commit (path-limited)**

### Task 5: Resize works + drag aligns (G5)

**Files:**
- Modify: `src/components/agent/agent-drawer.tsx` (handles E/S/SE actually resize — investigate hit-testing/event wiring first; fix cause found) + `src/components/agent/universal-agent-shell.tsx` (bar/drawer alignment — additive only, peer dirt untouched) + `src/components/agent/agent-placement.ts` ONLY if clamp math is the cause
- Modify: drawer + shell + placement tests; spec §5.2 line if behavior truth changes

**Interfaces:** session-memory-only position/size retained; 300px floor, viewport ceiling, sub-12rem collapse, mobile native all retained.

- [ ] **Step 1: Reproduce in tests (resize changes dims; drag moves bar + drawer together with zero offset between them)**
- [ ] **Step 2: Fix causes found (resize dead + misalignment may differ — fix each, not one blindly)**
- [ ] **Step 3: Run gates + live-viewport check note (browser proof is the user's step)**
- [ ] **Step 4: Commit (path-limited)**

## Self-Review

- Coverage: send → 1; fallback → 2; quality → 3; model-reach → 4; resize/drag → 5.
- Fences held: no escalation/dispatch/one-tap semantics change, no grant/approval change, viewer paths untouched.
- Risks: Task 3 replace-vs-append must preserve history + idempotency (replay returns kept row); Task 2 deletes a card users may have seen (intended per autonomy); Task 4 may surface a credential/config fix owned by the user (report, don't invent). Rollback per task restores prior component/route/prompt.
