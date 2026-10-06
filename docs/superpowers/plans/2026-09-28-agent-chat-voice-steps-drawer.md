# Chat Voice + Steps Narration + Movable Drawer Implementation Plan (peer-lane safe)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Sequential dispatch only (Tasks 1–5 share drawer files — never parallel). Fresh subagent per task, review between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five user-approved fixes from live screenshots: header overlap (F1), chatbot voice with zero internal leakage (F2), single sources line + one tooltip (F3), narrating steps that always finish (F4), resizable + draggable drawer with collapse threshold (F5). Synthesis-failure tracing is explicitly OUT (next round).

**Architecture:** Same governed shell: deterministic code owns state/scope/money; models do judgment/generation only, Zod-disposed. No spend/approval-fence change in this plan. Structured answer data (citations/limitations/estimates) stays encoded in durable rows — only the render changes.

**Tech Stack:** Next.js 16, TS strict, shadcn/ui Marker/Tooltip/Card primitives, pointer events for drag/resize (no new library), Zod, TanStack Query v5, Supabase RLS.

**Spec:** `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` (§5.2 drawer/steps, §10.1 answer rendering) — amend where rendering truth changes.

## Global Constraints

- Fewer clicks, same fences (binding purpose, board top line). No autonomy change here — Task B is a separate peer lane; do not touch router-service, thread-service, dispatch/answers routes, contracts, or the Task-B plan.
- Lane files (do not touch prod code in): `agent-questionnaire-card.tsx`, `answer-writer.ts` EXCEPT the F2 prompt/fallback-voice hunks owned by Task 2 below. Shell visual-parity WIP (`universal-agent-shell.tsx`, `globals.css`) untouched.
- Bodies/secrets never logged; estimates keep inputs + assumptions on surface; realized-result claims stay unrepresentable; viewers read-only.
- shadcn/ui only; no manual z-index on overlays; no new dependencies; no migration; no new events.
- Never `git stash`; never push (user's step); path-limited commits.

---

### Task 1: Header overlap fix (F1)

**Files:**
- Modify: `src/components/agent/agent-drawer.tsx` (thread scroll container top padding only)
- Modify: `src/components/agent/agent-drawer.test.tsx` (first-bubble-clears-header assertion)

**Interfaces:** none changed (pure layout).

- [ ] **Step 1: Add top clearance so the first user bubble never sits under the sticky header**
- [ ] **Step 2: Add/extend test (first message bubble clears header region)**
- [ ] **Step 3: Run gates (drawer suite + eslint on touched files)**
- [ ] **Step 4: Commit (path-limited)**

### Task 2: Chatbot voice, no internal leakage (F2)

**Files:**
- Modify: `src/modules/agent-chat/application/answer-writer.ts` (prompt: stored context/gaps/research status are prompt context, never body text; warm brief voice; missing data voiced in one sentence, e.g. limitation-as-sentence; fallback builder speaks the same voice, no scaffold)
- Modify: `src/components/agent/agent-response-message.tsx` (delete Sources + Limitations sections from render; structured data stays encoded in the row)
- Modify: writer + drawer tests (RED-first); spec §10.1 amendment

**Interfaces:**
- Consumes: ContextPack digest + routing note (unchanged shapes).
- Produces: same `AnswerDraft` shape; body is natural prose, limitations voiced inline as sentences.

- [ ] **Step 1: Write failing tests (RED) — no scaffold/header strings in any render, limitation voiced as sentence, sections absent from DOM, row still carries structured data**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement prompt + fallback voice + render deletion (old encoded rows keep parsing via existing strip logic)**
- [ ] **Step 4: Amend spec §10.1 + run gates (agent scope suite + typecheck + lint)**
- [ ] **Step 5: Commit (path-limited)**

### Task 3: Single sources line + one tooltip (F3)

**Files:**
- Modify: `src/components/agent/agent-response-message.tsx` (outside-below-bubble line `Sources: [1]` / `Sources: [1+]`; one hover/focus Tooltip with ordered claim+source list; replaces Task-2-era per-number tooltips)
- Modify: `src/components/agent/agent-drawer.test.tsx` (line format 1-vs-many, tooltip ordered content, keyboard access, DOM order below bubble)

**Interfaces:** same props; estimates untouched (inputs + assumptions on surface).

- [ ] **Step 1: Implement line + tooltip + tests**
- [ ] **Step 2: Run gates**
- [ ] **Step 3: Commit (path-limited)**

### Task 4: Steps that narrate + always finish (F4)

**Files:**
- Modify: `src/components/agent/agent-thread-steps.tsx` (labels: Thinking → `Understood: <plain intent>`; `Checking organization memory…` → `Checked organization memory`; `Researching <area>…` → `Research complete` + GI link; `Preparing draft…` → `Draft ready`; done rows in side-line style; one active row at a time; spacing; same plain style for any new labels)
- Modify: `src/components/agent/agent-drawer.tsx` (drive rows from real phase; flip all rows terminal on durable swap — the stuck-spinner fix; steps-hunk only)
- Modify: thread-steps + drawer tests; spec §5.2 amendment

**Interfaces:** same `AgentStepPhase`/props; intent + thread links already owned.

- [ ] **Step 1: Restyle steps + one-active-row rule with honest done states**
- [ ] **Step 2: Fix terminal flip (no stuck progress after final bubble) with regression test**
- [ ] **Step 3: Amend spec §5.2 + run gates**
- [ ] **Step 4: Commit (path-limited)**

### Task 5: Resizable + draggable drawer (F5)

**Files:**
- Modify: `src/components/agent/agent-drawer.tsx` (drag handle moving drawer + bar as one unit; edge/corner resize; sub-threshold size auto-collapses to the existing strip state)
- Modify: `src/components/agent/agent-placement.ts` + shell offset usage if the drag unit needs it (narrow, positioning only)
- Modify: drawer tests (drag moves unit, resize changes dims, sub-threshold collapses, viewport clamping, mobile sheet native)
- Modify: spec §5.2 (movable-drawer truth)

**Interfaces:** position/size live in session memory only (reset on reload — no DB/settings write); drag clamped to viewport; mobile full-width sheet keeps native behavior (no drag/resize).

- [ ] **Step 1: Implement drag + resize + threshold-collapse**
- [ ] **Step 2: Tests for move/resize/collapse/clamp/mobile-untouched**
- [ ] **Step 3: Amend spec §5.2 + run gates + live screenshot proof of drawer states**
- [ ] **Step 4: Commit (path-limited)**

## Self-Review

- Coverage: overlap → 1; voice → 2; sources → 3; steps → 4; movable → 5. Synthesis trace excluded per user.
- Fences held: no router/dispatch/executor contact, no grant/approval change, viewer paths untouched.
- Risks: F2 voice regression (rollback restores prompt + render); F4 run-state wiring (rollback restores component + wiring); F5 positioning (rollback restores fixed positioning). Terminal rows stay terminal throughout.
