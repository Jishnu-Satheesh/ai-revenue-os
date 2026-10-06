# End-Swap + Left-Handle + Evidence Auto-Widening Plan (user-approved H1–H3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Sequential dispatch only (Tasks 1–3 share drawer/route/pack files — never parallel). Fresh subagent per task, review between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three live-reported issues: resize handles missing on the left (H1), stream never swaps to the durable row on idempotency conflict (H2), evidence window claims unavailable instead of auto-widening (H3).

**Architecture:** Same governed shell: deterministic code owns state/scope/money; models judge/generate only, Zod-disposed. No spend/approval-fence change. H2 halves model spend per streamed turn as a side effect (one synthesis persisted, not two).

**Tech Stack:** Next.js 16, TS strict, shadcn/ui primitives, pointer events, Zod, TanStack Query v5, Supabase RLS + fenced RPCs.

**Spec:** `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` (§5.2 drawer, §9 context pack, §10.1 answers) — amend where truth changes. ADR 0074 + Task-B plan stay authoritative for autonomy.

## Global Constraints

- Fewer clicks, same fences. No autonomy-semantics change; peer Task-B files beyond each task's list are off-limits.
- Tenant isolation DB + app; server-owned ids; viewers read-only.
- Bodies/secrets never logged (correlation ids only); estimates keep inputs + assumptions on surface; realized-result claims stay unrepresentable; gaps labeled, never zero-filled.
- shadcn/ui only; no manual z-index; no new dependencies; no migration; no new events.
- Never `git stash`; never push (user's step); path-limited commits.

---

### Task 1: Left resize handles (H1)

**Files:**
- Modify: `src/components/agent/agent-drawer.tsx` (mirror E edge → W edge + SW corner; same pointer/keyboard/clamp/collapse logic; 300px floor holds)
- Modify: `src/components/agent/agent-drawer.test.tsx` (W/SW resize dims, clamps, mobile handle-free)

**Interfaces:** `ResizeAxis` gains `"w" | "sw"`; all else unchanged.

- [ ] **Step 1: Add W/SW handles reusing the existing resize path**
- [ ] **Step 2: Tests (dims change, floor/ceiling/collapse hold, mobile none)**
- [ ] **Step 3: Run gates (drawer suite + eslint)**
- [ ] **Step 4: Commit (path-limited)**

### Task 2: Stream swaps to durable on end, always (H2)

**Files:**
- Modify: stream route (`src/app/api/organizations/[organizationId]/agent/threads/[threadId]/stream/route.ts`) end-persist (on idempotency conflict REUSE the route's existing row — same SKIP lesson as G3; conflict becomes the normal path, warn downgraded; stream keeps its own synthesis for live tokens but persists nothing when the row exists)
- Modify: `src/components/agent/agent-drawer.tsx` (`end` handling ONLY: re-read messages + swap to durable row even when messageId is the kept row; steps terminal)
- Modify: stream route + drawer tests; spec §10.1 line (isolated hunk)

**Interfaces:** `end` payload shape unchanged; exactly one assistant row per streamed turn; one persisted synthesis per turn (live tokens still stream).

- [ ] **Step 1: Failing tests (conflict-path swap to durable; single row; steps terminal; no second persisted synthesis)**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement reuse + swap + spec line + gates (agent scope suite, typecheck, lint)**
- [ ] **Step 4: Commit (path-limited)**

### Task 3: Evidence auto-widening with honest window (H3)

**Files:**
- Modify: `src/modules/agent-chat/application/context-pack.ts` (build tries 30d → 45 → 60 → 90 → 120, stops at first window with ≥1 governed period; pack records actual window used; all-empty stays honest)
- Modify: windowDays schema literals (30|60 → 30|45|60|90|120) + pack/writer tests
- Modify: `src/modules/agent-chat/application/answer-writer.ts` (prompt rule: voice the ACTUAL window conversationally — "I took data from X to Y, which was available — on that basis…"; fallback same voice when widening exhausts; gaps still labeled, never zero-filled)
- Modify: spec §9 + §10.1 lines (isolated hunks)

**Interfaces:** pack `window` carries the used range (already shaped); window rendered in branch timezone as today; 120-period cap holds.

- [ ] **Step 1: Failing tests (empty-30 uses wider window with window recorded; all-empty honest note; new literals accepted; no silent trimming)**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement ladder + voice + spec lines + gates (agent scope suite, typecheck, lint)**
- [ ] **Step 4: Commit (path-limited)**

## Self-Review

- Coverage: handles → 1; swap → 2; widening → 3.
- Fences held: no escalation/dispatch/one-tap semantics change, no grant/approval change, viewer paths untouched.
- Risks: Task 2 touches the stream/durable contract (rollback restores re-append); Task 3 widens reads (bounded by 120d + period caps; rollback restores 30|60). Terminal rows stay terminal.
