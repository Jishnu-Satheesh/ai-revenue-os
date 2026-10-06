# Universal AI Agent Follow-up Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final-review gaps: answer-writing (I1), executor dispatch + opportunity binding + audit events (I2, I4), polish roll-up (F2, F4, M6–M10).

**Architecture:** Same governed shell as the base plan: deterministic code owns state/scope/money; models do judgment/generation only, Zod-disposed. Answer-writer synthesizes over the HEAVY context pack + router note; dispatch route enqueues existing Trigger tasks on explicit user confirm.

**Tech Stack:** As base plan (Next.js 16, TS strict, shadcn/ui, Zod, TanStack Query v5, AI SDK `ai` + `@ai-sdk/google`, Trigger.dev 4.6, Supabase RLS + pgTAP).

**Spec:** `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` — Slice A amends §10.1 (poll-rendered synthesis, not token streaming) + new ADR for the AI-SDK-free disclosure and the route/answers digest split.

## Global Constraints

- Same as base plan: advise freely/execute narrowly; router never executes; tenant isolation DB + app; Zod at AI/external boundaries; no realized-result claims without baseline + attribution + window; estimates labeled with inputs/assumptions on the same surface; shadcn/ui only; bodies never logged; never `git stash`; never push (user's step); path-limited commits.
- Staging state: both agent migrations applied; repair `20260926120000_agent_thread_create_nullif_fix.sql` PENDING push (user's step) — threads pgTAP red until then (R1 pattern, not a defect).
- Quality gates per task: `pnpm typecheck`, `pnpm lint` (touched), `pnpm test` (in scope), `pnpm db:test` for DB tasks.

---

## File Structure

(Per-task below; shared modified: `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md`, `adrs/` new, `docs/collaboration/asset-library-and-studio-board.md` claim rows.)

---

### Task 1: Slice A — Answer-writer (closes I1)

**Files:**
- Create: `src/modules/agent-chat/application/answer-writer.ts` + `answer-writer.test.ts`
- Create: `src/components/agent/agent-response-message.tsx` (+ test or drawer-covered)
- Modify: `src/modules/agent-chat/application/thread-service.ts` (synthesize step in routeLatest/answers re-route)
- Modify: `src/components/agent/agent-drawer.tsx` (Response tab renders assistant messages)
- Modify: spec §10.1 sentence; create `adrs/NNNN-answer-poll-rendered-synthesis.md`

**Interfaces:**
- Consumes: `ContextPack` (Task 5), `RouterOutput` routing note (Task 2/3), `append_agent_message` role `assistant` (Task 1 RPC), light-model provider (Task 2 `src/ai` abstraction).
- Produces: `writeAnswer(input: { pack, routingNote, threadId, mode }): AnswerDraft` where `AnswerDraft = { body, citations: [{claim, sourceId, digest}], limitations: string[], estimates: [{label, value, inputs, assumptions}] }`, persisted as assistant message rows with citations/marker_receipts.

- [ ] **Step 1: Check the tree for an existing markdown/sanitized-text renderer; if none, compose from Card/Badge/Separator (no new dep without cause)**
- [ ] **Step 2: Write failing synthesis tests (RED)**

```ts
// unknown pack lane -> limitation, never a claim; estimate without inputs -> rejected by Zod
```

- [ ] **Step 3: Run to verify fail**

Run: `pnpm test src/modules/agent-chat/application/answer-writer.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement writer (light-model generateObject with strict synthesis schema; citations required from pack sources; unknowns to limitations; realized-result claims unrepresentable — no baseline/attribution/window fields; estimates carry inputs+assumptions; failure degrades to honest limitation, never invention)**

- [ ] **Step 5: Wire synthesize step + Response rendering (assistant rows render with citation chips + limitations; poll-rendered via existing checkpoint poll — NO token streaming endpoint)**

- [ ] **Step 6: Amend spec §10.1 + ADR, run gates**

Run: `pnpm test src/modules/agent-chat src/components/agent`, `pnpm typecheck`, `pnpm lint`
Expected: PASS (threads pgTAP still red until repair push — pre-existing, not yours).

- [ ] **Step 7: Commit**

```bash
git add src/modules/agent-chat/application/answer-writer.ts src/modules/agent-chat/application/answer-writer.test.ts src/components/agent/agent-response-message.tsx src/modules/agent-chat/application/thread-service.ts src/components/agent/agent-drawer.tsx docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md adrs/NNNN-answer-poll-rendered-synthesis.md
git commit -m "feat(agent): answer-writer with cited synthesis plus poll-rendered Response"
```

### Task 2: Slice B — Dispatch + opportunity resolver + audit events (closes I2, I4)

**Files:**
- Create: `src/app/api/organizations/[organizationId]/agent/threads/[threadId]/dispatch/route.ts` + `route.test.ts`
- Modify: `src/modules/agent-chat/application/thread-service.ts` (dispatch seam: idempotent enqueue of the three `src/trigger/agent-chat.ts` tasks)
- Modify: drawer/shell (opportunity prop from page context; dispatch wiring; flip `watchUpdateAvailable` default true — schedule RPC live and proven 27/27)
- Modify: Trigger tasks + `adviseCampaign` caller (emit `agent_thread.research_triggered`, `agent_thread.watch_created`, `agent_thread.draft_requested`, identifier-only payloads + correlation)

**Interfaces:**
- Consumes: Task 6 executors, Task 7 `adviseCampaign`, existing Trigger tasks, thread link ids.
- Produces: `POST dispatch {idempotencyKey, action: research_once|watch_create|watch_update|campaign_advice, confirmation}` → `{ outcome, eventId, replayed }`; 403 viewers / without `manage` (watch/research) or `campaign.create` (draft).

- [ ] **Step 1: Write failing gate tests (viewer 403, idempotent redispatch replays, event identifier-only)**

- [ ] **Step 2: Run to verify fail**

Run: `pnpm test` on the new route test
Expected: FAIL.

- [ ] **Step 3: Implement dispatch seam + route + opportunity binding + events (explicit user confirm required; recheck permissions at dispatch; same token replays without duplicate enqueue; events carry ids + correlation only, never bodies)**

- [ ] **Step 4: Run gates**

Run: `pnpm test src/app/api/organizations/\[organizationId\]/agent src/modules/agent-chat`, `pnpm typecheck`, `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/organizations/\[organizationId\]/agent/threads/\[threadId\]/dispatch src/modules/agent-chat/application/thread-service.ts src/components/agent/agent-drawer.tsx src/components/agent/universal-agent-shell.tsx src/trigger/agent-chat.ts src/modules/agent-chat/application/campaign-advise.ts
git commit -m "feat(agent): dispatch route with opportunity binding plus audit events"
```

### Task 3: Slice C — Polish roll-up (closes F2, F4, M6–M10)

**Files:**
- Modify: answers route (return confidence/reasonCodes; use `createAgentContextReaders` so re-routes digest the real pack — M6/M7)
- Modify: `src/components/agent/agent-drawer.tsx` (consume fresh codes; nonce-derived idempotency keys `<nonce>:thread|:message|:route` — M8; single-thread GET poll — M9)
- Modify: `src/lib/logger.ts` (`reasonCodes` union/branded type — F4)
- Create: `supabase/migrations/20260926XXXXXX_scope_registry_collision_code.sql` + pgTAP (M10: collision keeps a reason code instead of silent fingerprint-less row; R1 pattern — dry-run only, user pushes)

**Interfaces:**
- Consumes: existing answers route, drawer poll, logger, scope registry.
- Produces: same shapes, tightened (codes fresh per turn, keys stable across retries, collision explicit).

- [ ] **Step 1: Implement F2/M6/M7 (codes through answers route + readers) with covering tests**

- [ ] **Step 2: Implement M8/M9 (nonce keys, single-thread poll) with covering tests**

- [ ] **Step 3: Implement F4 (logger type) + M10 migration + pgTAP (dry-run listed, no push)**

Run: `pnpm db:migrations:dry-run`
Expected: only the M10 migration pending (after repair push lands).

- [ ] **Step 4: Run gates**

Run: `pnpm test src/components/agent src/app/api/organizations/\[organizationId\]/agent`, `pnpm typecheck`, `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent/agent-drawer.tsx src/lib/logger.ts supabase/migrations/20260926XXXXXX_scope_registry_collision_code.sql supabase/tests/database/scope_registry_collision_test.sql
git commit -m "fix(agent): fresh routing codes, stable idempotency keys, collision code"
```

## Self-Review

- Spec coverage: I1 → Task 1 (+spec/ADR update); I2/I4 → Task 2; F2/F4/M6–M10 → Task 3; M1–M5 done in base fix wave; M11–M13 no-action recorded.
- Placeholders: none — every step names exact files, commands, expected results.
- Type consistency: `AnswerDraft` citations reuse pack `sources` shape; dispatch reuses `agent_thread:<threadId>:<messageDigest>` keys; events reuse base-plan names.
