# Task B: Full-Autonomy Agent Implementation Plan (peer lane)

> **For the peer agent:** lane 2 of the 2026-09-27 two-lane split (board top line). Lane 1 (this session + user) owns the Test-1 residual fixes and does NOT touch drawer prod code. You own the files below. Read the spec + ADRs before touching code. SDD recommended (fresh subagent per task, review between).

**Goal:** Make the Universal AI Agent fully autonomous within absolute guardrails: zero-click auto-escalate Quick → DeepThink, zero-click auto-run of one-time bounded research, one-inline-tap auto-prepared watches and drafts. Router runs a Gemini flash-class model (speed + intelligence); prompting is hardened so autonomy never becomes hallucination or misdirected action.

**Purpose (binding):** platform clients are busy running their businesses and will not operate the platform. The agent is their org's Admin, acting in natural language with no extra clicks — always within the caller's own role grants.

**Architecture:** Deterministic code still owns state, scope, money, and every state transition; models do judgment/generation only, Zod-disposed at every boundary. Autonomy moves *which* fenced path runs without asking, never *whether* fences apply.

**Tech Stack:** Next.js 16, TS strict, Zod strict at AI boundaries, existing Marker/Questionnaire/Tooltip primitives, Trigger.dev 4.6, Supabase RLS + fenced RPCs.

**Spec:** `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` (§6 modes, §8 router, §10 research/watch, §11 campaign handoff) + `docs/superpowers/specs/2026-09-26-agent-streaming-synthesis-design.md`. Amend both where autonomy changes truth. New ADR required (reverses confirm-before-spend for L1/L2, records the tiered doctrine).

## Global Constraints

- autonomy tiers: L1 answer-escalation + L2 bounded research run zero-click; L3 watches/drafts auto-prepared, exactly one inline tap to create; approval/publish fences untouched (a tap creates, never approves, never spends, never publishes).
- Router confidence: high → act; medium → act with the assumption stated inline; low → `answer_memory` with honest note, never guess.
- Agent never exceeds caller grants: manage-holders escalate/run silently; others stay Quick with honest note; viewers read-only (403 before persistence).
- Server attests confirmations itself at send time — never trusts a client-claimed confirmation for dispatch.
- Flash model id comes from the `AI_ROUTER_MODEL` env value (verify it exists in `src/ai` resolution; wire it if missing — never hardcode an id); temperature low + token cap for classification; model failure fails closed to `answer_memory`.
- Tenant isolation DB + app; server-owned org id everywhere; RLS forced. Bodies/secrets never logged. Estimates labeled with inputs + assumptions on surface. Realized-result claims stay unrepresentable.
- shadcn/ui only; no manual z-index. No migration expected (no schema change); no new events except reusing `agent_thread.*` names; no new dependencies.
- Never `git stash`; never push (user's step); path-limited commits; do not touch lane-1 files' prod code (`agent-questionnaire-card.tsx`, `agent-thread-steps.tsx`, `agent-response-message.tsx`, `answer-writer.ts`) or the shell visual-parity WIP (`universal-agent-shell.tsx`, `globals.css`).

---

### Task B1: Router brain upgrade (flash + hardened prompt)

**Files:**
- Modify: `src/modules/agent-router/application/router-service.ts` (prompt doctrine + escalation output)
- Modify: `src/ai/*` resolution only if `AI_ROUTER_MODEL` is missing (wire env override, no hardcoded ids)
- Modify: `src/modules/agent-router/application/router-service.test.ts` + contract suites (new probes)

**Interfaces:**
- Consumes: message text, page key, thread digest, context-pack digest, watch candidates, caller role/grants.
- Produces: same strict `RouterOutput` shape (intent enum, high/medium/low, missing-fields max 3 closed vocab, routing note, questionnaire-or-null, reason codes) — prompt changes must never widen the schema.

- [ ] **Step 1: Write failing prompt-doctrine tests (RED) — unknown data becomes limitation not claim; low confidence routes memory; forged/unknown intent rejected; missing-fields outside closed vocab rejected**
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement hardened prompt (closed enum, calibration rubric high/medium/low, forbidden list: invent ids/evidence/windows/facts, note carries evidence not conclusions, policy lives in code) + flash model wiring via env + low-temp/cap/fail-closed**
- [ ] **Step 4: Run gates (router suites + typecheck + lint on touched files)**
- [ ] **Step 5: Commit (path-limited)**

### Task B2: Auto-escalate Quick → DeepThink (zero-click)

**Files:**
- Modify: `src/modules/agent-router/application/router-service.ts` (research_once in Quick flips mode server-side; no nudge card emitted)
- Modify: `src/modules/agent-chat/application/thread-service.ts` (apply server-owned mode flip)
- Modify: router/thread tests; drawer mode-flip marker already exists (Task 2) — wire only, no restyle
- Modify: `src/domain/agent-router/contracts.ts` (deprecate `deepthink_upgrade` kind; old rows still parse)
- Modify: spec §6/§8 + new ADR (doctrine + purpose + what reverses)

**Interfaces:**
- Consumes: B1 RouterOutput + caller grants.
- Produces: escalated thread mode + `DEEPTHINK_AUTO_ESCALATED` reason code; non-holders stay Quick with honest note.

- [ ] **Step 1: Grant-matrix tests first (holder escalates silently, viewer read-only, non-holder stays Quick with note)**
- [ ] **Step 2: Implement flip + deprecation + ADR + spec lines**
- [ ] **Step 3: Run gates**
- [ ] **Step 4: Commit (path-limited; ADR + spec hunks isolated from other lanes' spec dirt)**

### Task B3: Auto-run one-time research (zero-click)

**Files:**
- Modify: answers route for threads (server-attested confirmation minted at send under fingerprint idempotency key)
- Modify: `src/modules/agent-chat/application/thread-service.ts` (dispatch seam: auto-enqueue on escalated turns)
- Modify: dispatch route (accept server attestation; client-claimed confirm still validated as before for any manual path)
- Modify: `src/components/agent/agent-drawer.tsx` (REMOVE Run-research-once button block + upgrade-card wiring ONLY — lane 1 owns all other drawer prod code; do not restyle)
- Modify: dispatch/answers/thread/drawer tests (rebase test edits on lane-1's committed test fixes)
- Modify: spec §10

**Interfaces:**
- Consumes: B2 escalated turn + qualification/budget gates.
- Produces: one bounded run per turn; retries replay, never double-run; audit events unchanged.

- [ ] **Step 1: Idempotency + gate tests first (retry replays, viewer 403, closed gate degrades honestly)**
- [ ] **Step 2: Implement attestation + auto-enqueue + drawer removal**
- [ ] **Step 3: Run gates (agent scope suite + typecheck + lint)**
- [ ] **Step 4: Commit (path-limited)**

### Task B4: Auto-prepared watches + drafts (one inline tap)

**Files:**
- Modify: watch + campaign executors (pre-fill everything: cadence/branch/areas, evidence window default 30d with assumption stated inline)
- Modify: drawer (single confirm tap replaces multi-step forms; duplicate-watch choice stays as the tap surface — view/update/fresh is human judgment)
- Modify: answers route pick handling + executor/route/component tests
- Modify: spec §10.2/§11 (one-tap truth)
- Read-only: approval/publish fences (untouched — tap creates, never approves)

**Interfaces:**
- Consumes: B1 routing note + pack + opportunity binding.
- Produces: fully-built watch/draft payload behind one confirm; ineligible → brief fallback as today.

- [ ] **Step 1: Pre-fill + invariant tests first (exactly-one-recommended intact, duplicate choices, fallback)**
- [ ] **Step 2: Implement executors + one-tap cards**
- [ ] **Step 3: Run gates**
- [ ] **Step 4: Commit (path-limited)**

### Task B5: Live supervised proof + close-out

**Files:** board log + spec status lines only; no product code unless a fix round demands it.

- [ ] **Step 1: One supervised run per level (escalate, research, watch-tap, draft-tap) with correlation ids; drafts approved/discarded deliberately**
- [ ] **Step 2: Full agent-scope suite + typecheck + lint green; tenant isolation re-verified by route read**
- [ ] **Step 3: Board result line; reports under `.superpowers/sdd/2026-09-27-agent-task-b-autonomy/`; no push**

## Self-Review

- Spec coverage: brain → B1; escalate → B2; research → B3; watches/drafts → B4; proof → B5. Genuinely ambiguous messages keep a clarify card (autonomy never guesses).
- Fences held: grants, viewer 403s, server attestation, idempotency, approval/publish untouched, audit identifiers-only.
- Risks: router misjudgment → unwanted runs (B1 calibration is the mitigation; audit shows what ran); prompt injection via user text (server-owned context + Zod disposal + policy-in-code). Rollback per task: restore prompt/model (B1), nudge card (B2), button + manual confirm (B3), multi-step forms (B4) — terminal rows stay terminal.

### 2026-10-04 authorized finish amendment

- The user authorized completing the remaining module except web deployment; root approved these isolated repairs within B4/B5.
- Bind campaign ideas to their own existing strict schema on the strong provider path; reuse answer provider tuning without model or environment changes.
- Persist bounded, signed Questionnaire envelopes through the existing fenced system-note message RPC; verify organization, thread, source message, exact spec, current grants, age, and replay before a watch or draft tap. Split the public parser from server HMAC signing because authenticated message RPC callers can choose system-note role. ADR 0076 records provenance and secret-rotation behavior.
- Preserve the validated watch/draft action when form answers are submitted, supply the direct-watch confirmation card, and restore unresolved cards after reopening. Keep report pendingChallenge, upload, and markers unchanged.
- Regression checks cover real provider schema disposal, forged/stale/cross-tenant cards, encoded tap failure, denial before persistence, replay, no duplicate answer, and reopened cards. Existing source admission and approval/publish gates remain authoritative.
- No schema, migration, model/environment update, web deployment, or Git push; rollback removes future card generation while keeping source records and refusing unsigned historical action cards.
