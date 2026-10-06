# Test-1 Follow-ups A+C+D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Fresh subagent per task, review between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the upgrade-confirm validation bug (A), make steps always visible in shadcn marker language (C), and render natural answers with outside numbered sources (D). Task B (auto-escalation) is explicitly out of scope — parked for user suggestions.

**Architecture:** Same governed shell: deterministic code owns state/scope/money; models do judgment/generation only, Zod-disposed. No spend-fence change in this plan — the deepthink_upgrade card and the Run research once button stay exactly as they are.

**Tech Stack:** As base plan (Next.js 16, TS strict, shadcn/ui Marker + Questionnaire + Tooltip, Zod, TanStack Query v5, Supabase RLS).

**Spec:** `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` sections 5.2 + 10.1 — executors read both. Amend the spec where rendering truth changes (Task D source layout, Task C always-visible steps).

## Global Constraints

- Advise freely/execute narrowly; router never executes; Quick never spends without confirm (Task B would change this — NOT this plan).
- Tenant isolation DB + app; server-owned org id on every read/write; RLS forced; viewers read-only (403 before persistence).
- Zod at every AI/external boundary; realized-result claims stay unrepresentable; estimates labeled Estimate with inputs + assumptions on the same surface.
- shadcn/ui only for user-facing controls; Marker + MarkerIcon + MarkerContent for steps; Tooltip for source hovers; no manual z-index on overlays.
- Bodies never logged; secrets never logged/persisted; never `git stash`; never push (user's step); path-limited commits.
- No migration in this plan (no schema change). No new events. No new dependencies.

---

## File Structure

Shared modified: `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` (Tasks C + D amendments), `docs/collaboration/asset-library-and-studio-board.md` (claim + result rows).

---

### Task 1: Fix upgrade-confirm red-error bug (finding A)

**Files:**
- Modify: `src/components/agent/agent-questionnaire-card.tsx` (confirm value plumbing / double-submit guard)
- Modify: `src/components/agent/agent-drawer.tsx` (submit path only — card wiring / pending-state handling; do NOT touch steps rendering or answer rendering)
- Modify: `src/components/agent/agent-drawer.test.tsx` + card-adjacent suites (regression coverage)
- Read-only: `src/modules/agent-router/application/router-service.ts` (deepthink_upgrade spec shape — 1 item, key confirm_upgrade, kind confirm, required true)

**Interfaces:**
- Consumes: QuestionnaireSpec kind deepthink_upgrade (single confirm item), Questionnaire primitive order/validation/navigation, answers POST route.
- Produces: Yes-checked + Submit passes host validation and posts once; validation failure still returns to the invalid item with QuestionnaireError copy ("Confirm to continue, or cancel this step." only when genuinely unconfirmed).

- [ ] **Step 1: Reproduce in a failing test (RED) — mount the deepthink_upgrade card, check Yes, submit, assert no validation error and onSubmit fires once**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Fix the root cause (value plumbing for the confirm checkbox and/or pending double-submit guard — fix the cause found, not both blindly)**
- [ ] **Step 4: Run gates**
- [ ] **Step 5: Commit (path-limited: card + drawer submit hunk + tests only)**

### Task 2: Steps always visible in marker language (finding C)

**Files:**
- Modify: `src/components/agent/agent-thread-steps.tsx` (thinking loader row, switched-branch row, exploring rows, remove This-run separator + bordered container, small text)
- Modify: `src/components/agent/agent-drawer.tsx` (remove Steps Collapsible — render AgentThreadSteps inline always, during send/stream AND after done; do NOT touch questionnaire or answer rendering)
- Modify: `src/components/agent/agent-drawer.test.tsx` (always-visible steps, no collapsible trigger, a11y roles intact)
- Modify: spec section 5.2 (steps always visible, no collapse control)

**Interfaces:**
- Consumes: AgentStepPhase (idle/routing/done/error), intent + reasonCodes, thread links, Marker/MarkerIcon/MarkerContent + Spinner primitives.
- Produces: same props, new render — "Thinking…" loader row with Spinner while in progress, mode-flip row when the thread switched modes, per-phase exploring rows, intent shown only inside the icon-led list, no separator divider, no border container, text at marker scale.

- [ ] **Step 1: Remove the drawer Steps Collapsible; render AgentThreadSteps inline in both live and done states**
- [ ] **Step 2: Restyle AgentThreadSteps (loader thinking row, flip + exploring rows, drop This-run separator and border variant, small text)**
- [ ] **Step 3: Update/extend drawer + steps tests (visibility in all phases, role=status on in-progress, no Steps trigger in DOM)**
- [ ] **Step 4: Amend spec section 5.2 one-liner + run gates**
- [ ] **Step 5: Commit (path-limited)**

### Task 3: Natural answer with outside numbered sources (finding D)

**Files:**
- Modify: `src/components/agent/agent-response-message.tsx` (natural paragraph render, numbered citation superscripts with Tooltip, sources outside/underneath the synthesis box, no fallback header block, no double body)
- Modify: `src/modules/agent-chat/application/answer-writer.ts` (only if needed to stop the duplicate fallback header at the source — encode/parse must round-trip old rows)
- Modify: writer tests + `src/components/agent/agent-drawer.test.tsx` (no-duplicate-body, tooltip content, keyboard/hover a11y)
- Modify: spec section 10.1 (source layout truth)

**Interfaces:**
- Consumes: ThreadMessageView durable row (encoded body sections via encodeAnswerBody/parseAnswerBody), liveBody preview + liveNote for streams.
- Produces: same props, new render — body as natural paragraphs, citations as [1][2] superscripts with Tooltip (claim + source), Sources list outside and below the synthesis card, Limitations compact below sources, Estimates unchanged (inputs + assumptions on surface), live preview same shape, old encoded rows still parse.

- [ ] **Step 1: Write failing tests (RED) — duplicate-body rejection, numbered citations with tooltip content, sources-outside-box DOM order**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement the render (dedupe at parse boundary so history reopen is fixed too, not just live)**
- [ ] **Step 4: Amend spec 10.1 source-layout line + run gates**
- [ ] **Step 5: Commit (path-limited)**

## Self-Review

- Spec coverage: bug → Task A; markers + always-visible → Task C; natural answer + sources → Task D. Task B explicitly excluded.
- Placeholders: none — every step names exact files, commands, expected results.
- Fence check: no spend-path change, dispatch confirmed-true fence untouched, viewer gates untouched.
