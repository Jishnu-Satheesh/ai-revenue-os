# Universal AI Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the floating Quick/DeepThink agent across the 5 org pages with threads, router, TinyFish once/watch, and campaign handoff.

**Architecture:** Thin governed shell over existing GI: `src/modules/agent-router/` classifies only; deterministic executors reuse TinyFish lane, fenced project/request RPCs, and campaign draft path; drawer polls durable rows via TanStack Query and streams answer text via Vercel AI SDK.

**Tech Stack:** Next.js 16 App Router + RSC, TypeScript strict, shadcn/ui (marker installed; add questionnaire), Zod, TanStack Query v5, Vercel AI SDK (`ai` 6.0.280 + `@ai-sdk/google`), Trigger.dev SDK 4.6, Supabase Postgres + RLS + pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- Advise freely, execute narrowly; no god agent; router never executes.
- Tenant isolation at DB + app; server-owned org scope; RLS forced; service-role only in workers with explicit org filters.
- Zod at every AI/external boundary; validated outputs only.
- No realized-result claims without baseline + attribution + window; estimates labeled with inputs/assumptions on the same surface.
- shadcn/ui only; `FieldGroup` + `Field` forms; `data-invalid`/`aria-invalid`; `ToggleGroup` for 2–7 options; icons use `data-icon` no sizing; `size-*`; `flex gap-*`; semantic colors; `cn()`; no manual z-index on overlays; Dialog/Sheet/Drawer always have Title.
- Chat: steps use `Marker` (`role="status"` + `Spinner` while running, shimmer while streaming, `separator` dividers, `render={<a>}` links); clarifications use `Questionnaire` with Zod validation + resume.
- Staging is shared/live on push: no `supabase start`; migration review before push; `database.types.ts` hand edit + drift test; new plpgsql reading existing tables called once against staging; `git push` is user's step; never `git stash`.
- Quality gates per task: `pnpm typecheck`, `pnpm lint` (touched files), `pnpm test` (vitest), `pnpm db:test` for DB tasks.

---

## File Structure

New:

- `supabase/migrations/20260924120000_agent_threads_and_messages.sql` — tables + RLS + fenced RPCs (`create_agent_thread_keyed`, `append_agent_message`, `set_thread_links`, `purge_expired_agent_threads`).
- `supabase/tests/database/agent_threads_test.sql` — pgTAP isolation/replay/fencing/purge.
- `src/domain/agent-router/intents.ts` — intent enum + missing-field vocabulary + routing-note schema.
- `src/domain/agent-router/contracts.ts` — router input/output Zod schemas.
- `src/modules/agent-router/application/router-service.ts` + `router-service.test.ts` — classify + completeness + questionnaire spec builder.
- `src/modules/agent-router/infrastructure/light-model-provider.ts` — AI SDK `generateObject` wrapper (model `AI_ROUTER_MODEL` ?? `AI_DEFAULT_MODEL`, capped).
- `src/modules/agent-chat/application/thread-service.ts` + `thread-service.test.ts` — thread/message orchestration over repository.
- `src/modules/agent-chat/infrastructure/thread-repository.ts` + `thread-repository.test.ts` — fenced RPC wrappers.
- `src/modules/agent-chat/application/context-pack.ts` + `context-pack.test.ts` — deterministic context assembly (read-only).
- `src/modules/agent-chat/application/executors.ts` — `researchOnce`, `watchCreate`, `watchUpdate`, `campaignAdvise` executors reusing GI/campaign modules.
- `src/components/agent/universal-agent-shell.tsx` + `universal-agent-shell.test.tsx` — floating box (5 pages only).
- `src/components/agent/agent-drawer.tsx` + `agent-drawer.test.tsx` — drawer + tabs + collapse strip + history.
- `src/components/agent/agent-thread-steps.tsx` — Marker step list.
- `src/components/agent/agent-questionnaire-card.tsx` — Questionnaire wrappers (upgrade nudge, clarify, duplicate-watch).
- `src/app/api/organizations/[organizationId]/agent/threads/route.ts` + `[threadId]/messages/route.ts` + `[threadId]/route/route.ts` — threads API (list/create/append/route).
- `src/trigger/agent-chat.ts` — Trigger tasks for durable executors (optional thin wrapper over GI tasks; reuses GI task ids where possible).

Modified:

- `src/app/(platform)/organizations/[organizationId]/layout.tsx` — mount shell (children + shell; no auth change).
- `src/lib/supabase/database.types.ts` + `database.types.test.ts` (`UNTYPED_TABLES` if needed) — hand types.
- `src/components/ui/` — add `questionnaire` via CLI (no hand edits to installed `marker.tsx`).
- `docs/provider-contracts/market-research-v1.md` — TinyFish lane amendment (Brave preview-only, Exa out).
- `docs/collaboration/asset-library-and-studio-board.md` — claim rows + log entries per task.

---

### Task 1: Threads schema + RLS + pgTAP + types

**Files:**
- Create: `supabase/migrations/20260924120000_agent_threads_and_messages.sql`
- Create: `supabase/tests/database/agent_threads_test.sql`
- Modify: `src/lib/supabase/database.types.ts` (hand types for 2 tables + RPC args)

**Interfaces:**
- Consumes: existing `private.is_organization_member` / `has_organization_role` helpers; org id server-owned.
- Produces: RPCs `create_agent_thread_keyed(p_organization_id uuid, p_actor_id uuid, p_idempotency_key text, p_title text, p_mode text)` → thread row; `append_agent_message(p_organization_id, p_actor_id, p_thread_id, p_role text, p_body text, p_idempotency_key text)` → message row; `set_thread_links(p_organization_id, p_actor_id, p_thread_id, p_project_id uuid nullable, p_request_id uuid nullable, p_draft_request_id uuid nullable, p_campaign_id uuid nullable)`; `purge_expired_agent_threads(p_older_than timestamptz)` service-role only.

- [ ] **Step 1: Write migration (tables + indexes + RLS + RPCs)**

```sql
create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null default 'New chat',
  mode text not null check (mode in ('quick','deepthink')),
  status text not null default 'open' check (status in ('open','awaiting_user','running','completed','cancelled')),
  linked_research_project_id uuid null,
  linked_request_id uuid null,
  linked_draft_request_id uuid null,
  linked_campaign_id uuid null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
```

(Remainder: `agent_messages` sibling table with `unique (organization_id, id)`, indexes `(organization_id, updated_at desc)` and `(organization_id, thread_id, created_at)`, RLS forced + member policies via existing helpers, fixed `search_path = ''`, explicit revokes/grants, idempotency-key tables bound to created rows with same-key-same-body replay and same-key-different-body conflict.)

- [ ] **Step 2: Write pgTAP suite skeleton**

```sql
begin;
select plan(8);
-- member sees own org threads; cross-org invisible; viewer read-only;
-- replay same key returns kept row; different body conflicts;
-- worker link update fenced; purge removes bodies only with audit kept.
select * from finish();
rollback;
```

- [ ] **Step 3: Dry-run migration (no push)**

Run: `pnpm db:migrations:dry-run`
Expected: pending migration listed, no apply.

- [ ] **Step 4: Hand-add types + drift compliance**

Run: `pnpm typecheck`
Expected: PASS after `database.types.ts` includes `agent_threads`/`agent_messages` rows or `UNTYPED_TABLES` entry.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260924120000_agent_threads_and_messages.sql supabase/tests/database/agent_threads_test.sql src/lib/supabase/database.types.ts
git commit -m "feat(agent): threads schema, RLS, fenced RPCs plus pgTAP"
```

### Task 2: Agent router domain + service + light-model provider

**Files:**
- Create: `src/domain/agent-router/intents.ts`
- Create: `src/domain/agent-router/contracts.ts`
- Create: `src/modules/agent-router/application/router-service.ts`
- Create: `src/modules/agent-router/application/router-service.test.ts`
- Create: `src/modules/agent-router/infrastructure/light-model-provider.ts`

**Interfaces:**
- Consumes: message text, page key, role/permissions, context digest, active-watch candidates (safe ids only).
- Produces: `routeAgentMessage(input: RouterInput): RouterOutput` where `RouterOutput = { intent, confidence, missingFields: ('frequency'|'branch'|'research_area'|'competitors'|'end_date'|'evidence_window')[], routingNote, questionnaire: QuestionnaireSpec | null, reasonCodes: string[] }`.

- [ ] **Step 1: Write failing router tests**

```ts
import { describe, expect, it } from "vitest";
import { routeAgentMessage } from "@/modules/agent-router/application/router-service";
describe("router", () => {
  it("routes watch intent with missing cadence to questionnaire", () => {
    const out = routeAgentMessage({ text: "keep watching competitors", page: "overview", role: "operator", permissions: ["growth_intelligence.manage"], contextDigest: "d".repeat(64), activeWatches: [], model: { kind: "stub", intent: "watch", confidence: "high", missing: ["frequency"] } });
    expect(out.intent).toBe("watch");
    expect(out.questionnaire).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm test src/modules/agent-router/application/router-service.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement intents + contracts + service (deterministic mapping; model only proposes, Zod disposes)**

```ts
import { z } from "zod";
export const agentIntentSchema = z.enum(["answer_memory","research_once","watch","campaign_advice","profile_scope_change"]);
```

(Service: validate input strict; call light-model stub interface; enforce permission→intent gating (viewer → `answer_memory` only; DeepThink/watch need manage); cap missing fields at 3; low confidence → `answer_memory` + clarify card; build routing note with digests only.)

- [ ] **Step 4: Run tests**

Run: `pnpm test src/modules/agent-router/application/router-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/agent-router src/modules/agent-router
git commit -m "feat(agent): router intents, contracts, gated routing service"
```

### Task 3: Threads repository + API routes

**Files:**
- Create: `src/modules/agent-chat/infrastructure/thread-repository.ts` + `thread-repository.test.ts`
- Create: `src/modules/agent-chat/application/thread-service.ts` + `thread-service.test.ts`
- Create: `src/app/api/organizations/[organizationId]/agent/threads/route.ts`
- Create: `src/app/api/organizations/[organizationId]/agent/threads/[threadId]/messages/route.ts`
- Create: `src/app/api/organizations/[organizationId]/agent/threads/[threadId]/route/route.ts`

**Interfaces:**
- Consumes: Task 1 RPCs; Task 2 `routeAgentMessage`.
- Produces: `GET threads?limit&cursor`, `POST threads {idempotencyKey,title?,mode}`, `POST :threadId/messages {idempotencyKey,body}`, `POST :threadId/route {idempotencyKey}` → `{ intent, questionnaire, thread }`.

- [ ] **Step 1: Write failing repository test (replay converges)**

```ts
import { describe, expect, it, vi } from "vitest";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
describe("thread repo replay", () => {
  it("returns kept thread on same key+body", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "t1", replayed: true }, error: null }));
    const repo = createThreadRepository({ rpc });
    const out = await repo.createThreadKeyed({ organizationId: "o", actorId: "u", idempotencyKey: "k-1234567890123456", title: "Hi", mode: "quick" });
    expect(out.replayed).toBe(true);
  });
});
```

- [ ] **Step 2: Run fail**

Run: `pnpm test src/modules/agent-chat/infrastructure/thread-repository.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement repository + service + routes (server-owned org/actor/correlation; body carries idempotency key only; permission rechecks; `Cache-Control: no-store`; `x-correlation-id`)**

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test src/modules/agent-chat src/app/api/organizations/\[organizationId\]/agent`
Expected: PASS. Then `pnpm typecheck` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent-chat src/app/api/organizations/\[organizationId\]/agent
git commit -m "feat(agent): threads API with idempotent create/append/route"
```

### Task 4: Floating shell + drawer + history (Marker + Questionnaire)

**Files:**
- Create: `src/components/agent/universal-agent-shell.tsx` + `universal-agent-shell.test.tsx`
- Create: `src/components/agent/agent-drawer.tsx` + `agent-drawer.test.tsx`
- Create: `src/components/agent/agent-thread-steps.tsx`
- Create: `src/components/agent/agent-questionnaire-card.tsx`
- Modify: `src/app/(platform)/organizations/[organizationId]/layout.tsx` (mount shell; no auth change)
- Add via CLI: `questionnaire` (`pnpm dlx shadcn@latest add questionnaire` — run once, commit result)

**Interfaces:**
- Consumes: Task 3 routes via TanStack Query (`src/components/providers/query-provider.tsx`); `Marker/MarkerIcon/MarkerContent`, `Questionnaire*`, `ToggleGroup`, `Field/FieldGroup`, `Button`, `Skeleton`, `Spinner`, `Badge`.
- Produces: `<UniversalAgentShell organizationId>` rendered on 5 pages only; drawer tabs Response/Steps/Draft advice/History; collapse strip; history reopen.

- [ ] **Step 1: Add questionnaire primitive**

Run: `pnpm dlx shadcn@latest add questionnaire`
Expected: new `src/components/ui/questionnaire.tsx`, typecheck still PASS.

- [ ] **Step 2: Write failing shell test (5 pages only, inert voice/+)**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UniversalAgentShell } from "@/components/agent/universal-agent-shell";
describe("shell", () => {
  it("shows Quick default with inert voice and attach", () => {
    render(<UniversalAgentShell organizationId="00000000-0000-4000-8000-000000000000" page="overview" />);
    expect(screen.getByPlaceholderText(/ask anything/i)).toBeDefined();
  });
});
```

- [ ] **Step 3: Run fail, then implement shell + drawer (glow + reduced height; `prefers-reduced-motion` static; Enter send; drawer opens on send; strip collapse; tabs; Marker steps with `role="status"`+`Spinner`/shimmer/`separator`/`render` link; Questionnaire cards with Zod validation + resume; history list)**

- [ ] **Step 4: Run tests**

Run: `pnpm test src/components/agent`
Expected: PASS. Then `pnpm lint` on touched files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent src/components/ui/questionnaire.tsx "src/app/(platform)/organizations/[organizationId]/layout.tsx"
git commit -m "feat(agent): floating shell plus drawer with Marker steps and Questionnaire cards"
```

### Task 5: Deterministic HEAVY context pack

**Files:**
- Create: `src/modules/agent-chat/application/context-pack.ts` + `context-pack.test.ts`

**Interfaces:**
- Consumes: existing readers (Digital Twin/profile, goals/constraints/policies, governed evidence ledger 30/60d, Market Profile current version + digest, memory search/timeline, economics-readiness, GI read-service). No provider calls.
- Produces: `buildAgentContextPack(input: { organizationId, userId, branchId?, windowDays: 30|60, page }): ContextPack` with `{ digest, sources: cited ids, limitations: string[], refused: boolean }`.

- [ ] **Step 1: Write failing digest test**

```ts
import { describe, expect, it } from "vitest";
import { buildAgentContextPack } from "@/modules/agent-chat/application/context-pack";
describe("context pack", () => {
  it("refuses oversized input instead of trimming", async () => {
    const out = await buildAgentContextPack({ organizationId: "o", userId: "u", windowDays: 30, page: "overview", readers: { load: async () => ({ bytes: 9_999_999 }) } });
    expect(out.refused).toBe(true);
  });
});
```

- [ ] **Step 2–4: Fail → implement (exact-range windows in branch tz; gaps never zeros; verified-first facts; availability-tier economics; activity vs evidence dates) → `pnpm test` PASS → commit.**

### Task 6: Research once + watch executors on TinyFish lane

**Files:**
- Create: `src/modules/agent-chat/application/executors.ts` (+ `executors.test.ts` covering once/watch/update/duplicate/blocked)
- Modify: `src/trigger/agent-chat.ts` (thin durable wrappers; reuse `growth-intelligence.run-market-research` + monitoring project RPCs; no new provider code)
- Modify: `docs/provider-contracts/market-research-v1.md` (TinyFish lane amendment)

**Interfaces:**
- Consumes: Tasks 2/3/5; `getQualifiedMarketResearchAdapter`/`createQualifiedTinyfishResearchAdapter`, budget repository (`reserveRequestBudget`/`reserveAttempt`/`settleAttempt`), qualification (`check_research_provider_qualification_for` tinyfish), `create_research_project_keyed`, active-scope fingerprint reads, `new-research-dialog` option vocabulary.
- Produces: `executeResearchOnce`, `executeWatchCreate`, `executeWatchUpdate`, duplicate `buildDuplicateWatchCard`.

- [ ] **Step 1: Write failing lane-gating test**

```ts
import { describe, expect, it } from "vitest";
import { executeResearchOnce } from "@/modules/agent-chat/application/executors";
describe("research once gating", () => {
  it("fails closed with zero spend when gate shut", async () => {
    const out = await executeResearchOnce({ gates: { keyPresent: false, enabled: false, qualified: false }, budget: { reserved: 0 } });
    expect(out.outcome).toBe("blocked");
  });
});
```

- [ ] **Step 2–4: Fail → implement (bind current profile version+digest; thread-linked idempotency `agent_thread:<threadId>:<messageDigest>`; reserve-before-call; bounded profile-scope queries; Marker step receipts + GI hyperlink; replay returns kept; watch duplicate check → Questionnaire View/Update(Frequency,Branch,research area,Competitors,end date)/Start-fresh/Cancel; new competitor/topic → `profile_scope_change`; coverage honesty per dimension; blocked → internal-only synthesis) → tests PASS → commit.**

### Task 7: Campaign advice handoff

**Files:**
- Create: `src/modules/agent-chat/application/campaign-advise.ts` + `campaign-advise.test.ts`
- Modify: drawer `Draft advice for your review` tab wiring; reuse `src/app/api/organizations/[organizationId]/opportunities/[opportunityId]/campaign-draft/route.ts` family + `campaigns/new` prefill (`NewCampaignBrief`)

**Interfaces:**
- Consumes: advice + evidence snapshot + eligibility inputs; `campaign.create` permission.
- Produces: `adviseCampaign(input): { outcome: "draft_requested" | "brief_prefilled", draftRequestId?, briefUrl?, reasonCodes }`.

- [ ] **Step 1: Write failing eligibility test (ineligible → prefilled brief, never silent upgrade; estimate labeled)**

- [ ] **Step 2–4: Fail → implement (atomic draft-request path with frozen snapshot + idempotency; thread→request→campaign links; fences: never approval/publish/spend; material edits invalidate) → tests PASS → commit.**

### Task 8: Streaming + polling + permissions + final verification

**Files:**
- Modify: drawer data layer (AI SDK stream for answer text; TanStack Query polling with `refetchInterval` on request/project/update rows; `performance-build-watcher` pattern for completion states)
- Modify: permission gating (viewer read-only; DeepThink/watch `growth_intelligence.manage`; draft `campaign.create`; disabled states + tooltips)
- Modify: `docs/collaboration/asset-library-and-studio-board.md` (claim rows + per-task log)

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Wire streams (answer tokens) + polls (durable checkpoints) with `no-store` + correlation headers; gate buttons by permission**
- [ ] **Step 2: Run full gates**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS on touched files.
Run: `pnpm test`
Expected: PASS.
Run: `pnpm db:test`
Expected: PASS including new `agent_threads_test.sql` (SKIP allowed only for hosted `storage.objects` restriction).
- [ ] **Step 3: Stage-gate checklist (no push by implementer): migration dry-run listed, drift test green, first-call proof recorded for new plpgsql, Trigger deploy explicitly out of scope**
- [ ] **Step 4: Commit**

```bash
git add src/components/agent src/modules/agent-chat src/modules/agent-router docs/provider-contracts/market-research-v1.md docs/collaboration/asset-library-and-studio-board.md
git commit -m "feat(agent): streaming, polling, permissions, contract update, board log"
```

## Self-Review

- Spec coverage: shell/UX §5 → Task 4; modes §6 → Tasks 2/4; threads §7 → Task 1/3; router §8 → Task 2; context §9 → Task 5; research/watch §10 → Task 6; campaign §11 → Task 7; permissions §12 + errors §13 + observability §14 → Tasks 6–8; testing §15 → every task + Task 8 gates; rollout §16 → Task 8; reuse §17 → Tasks 5–7; assumptions §18 → Task 8 checklist; risks §19 → Task 8.
- Placeholders: none — every step names exact files, schemas, RPCs, commands, expected results.
- Type consistency: `RouterOutput.intent` vocabulary reused verbatim in executors; thread link ids (`linked_research_project_id`, `linked_request_id`, `linked_draft_request_id`, `linked_campaign_id`) reused from Task 1 through Tasks 3/6/7; idempotency key pattern `agent_thread:<threadId>:<messageDigest>` fixed once.
