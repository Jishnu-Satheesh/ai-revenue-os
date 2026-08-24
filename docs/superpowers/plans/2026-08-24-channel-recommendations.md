# Channel Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model-written recommendations over stored analysis findings, with database-fenced writes, human triage, a helpful/not-helpful review hook, and a scheduled advisory judge — per ADRs 0037 and 0038.

**Architecture:** A second Trigger.dev task chains after `channel-analysis.run` completes, claims the finished run through a security-definer RPC, narrates from that run's findings alone through a schema-validated model call, and files rows the completion RPC re-checks (same-run citations, legal labels, ≤6, digests present). Humans triage and vote through authenticated RPCs; a 48-hour scheduled judge scores recommendations against their own citations into an internal-only table. Findings never depend on narration succeeding.

**Tech Stack:** PostgreSQL (security-definer RPCs, RLS), Trigger.dev `schemaTask`, `@ai-sdk/google` via a thin provider adapter, Zod at every boundary, Vitest + pgTAP.

**Spec:** `specs/018-governed-channel-intelligence.md` §11.3, §12.3, §14, §17.3; `adrs/0037-recommendations-ride-a-second-fenced-worker.md`; `adrs/0038-the-judge-reports-and-never-modifies.md`

## Global Constraints

- **No local database, ever.** Migrations target hosted staging via `DATABASE_URL`; push as each lands (`pnpm db:migrations:push` or repo-equivalent). pgTAP suites run against the same shared staging.
- Every new plpgsql function must be **called once against staging** before its task is done (plpgsql resolves columns at execution time).
- `pnpm db:types` cannot run; hand-type new tables in `src/lib/supabase/database.types.ts`.
- `pnpm run:trigger` must be running and showing the new task ids registered before any dispatch test.
- `git push` is the user's step. Never push.
- Everything sits behind `GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS` via `assertGovernedChannelAnalysisEnabled`.
- Worker tables are writable from no session: RLS forces select-only for members; worker writes only through security-definer functions granted to `service_role`, `set search_path = ''`, execution revoked from `PUBLIC`/`anon`/`authenticated`. Composite tenant FKs everywhere.
- Triage permission key is the existing `recommendation.triage` (operator+). Feedback needs any org member who can read.
- Cap: ≤6 recommendations per run. Judge batch: ≤200, every 48h (`0 3 */2 * *` UTC). Judge is advisory-only; it never modifies prompts, rules, or recommendations.
- Prompt versions start at integer 1, stored on every recommendation and evaluation row with prompt/output sha-256 digests.
- Money stays integer minor units. Never log raw prompts, outputs, or cited business figures in application logs — counts and identifiers only.
- Forbidden strings anywhere user-visible: `Evidence Node`, `Action Queue`. Approved labels: `Channel Economics`, `Evidence briefing`, `Data trust`, `Findings & recommendations`, `Reports & trust`, `Inspect evidence`.
- Before writing Trigger.dev code, load skill `trigger-authoring-tasks`.

---

### Task 1: Storage migration — four tables, RLS, audit

**Files:**
- Create: `supabase/migrations/20260824100000_channel_recommendations_storage.sql`
- Test: `supabase/tests/database/channel_recommendations_storage_test.sql`

**Interfaces:**
- Produces: tables `channel_recommendations`, `channel_recommendation_citations`, `channel_recommendation_decisions`, `channel_recommendation_feedback`, `channel_recommendation_evaluations` — later tasks and migrations rely on these exact column names.

- [ ] **Step 1: Write the migration**

Model RLS/grants/audit style on `20260823120000_governed_channel_analysis_findings.sql`. Core shape:

```sql
create table public.channel_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  channel_id uuid not null,
  branch_id uuid,
  analysis_run_id uuid not null,
  window_start date not null,
  window_end date not null,
  period_grain text not null check (period_grain in ('day','week','month')),
  label text not null check (label in ('observation','recommendation','needs_data')),
  headline text not null,
  detail text not null,
  supported_actions jsonb not null default '[]'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  prompt_version integer not null check (prompt_version >= 1),
  prompt_digest text not null,
  output_digest text not null,
  provider text not null,
  model_id text not null,
  result_digest text not null,
  created_at timestamptz not null default now(),
  unique (analysis_run_id, result_digest)
);

create table public.channel_recommendation_citations (
  recommendation_id uuid not null references public.channel_recommendations (id) on delete cascade,
  finding_id uuid not null,
  organization_id uuid not null,
  primary key (recommendation_id, finding_id)
);
-- composite tenant FKs to (organization_id, id) of parents, mirroring
-- channel_finding_evidence in 20260823120000 exactly.

create table public.channel_recommendation_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recommendation_id uuid not null,
  decision text not null check (decision in ('acknowledged','dismissed','planned')),
  dismissal_reason text,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  check (decision <> 'dismissed' or (dismissal_reason is not null and length(btrim(dismissal_reason)) > 0))
);

create table public.channel_recommendation_feedback (
  organization_id uuid not null,
  recommendation_id uuid not null,
  actor_id uuid not null,
  helpful boolean not null,
  updated_at timestamptz not null default now(),
  primary key (recommendation_id, actor_id)
);

create table public.channel_recommendation_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recommendation_id uuid not null,
  batch_id uuid not null,
  citation_faithful boolean not null,
  label_appropriate boolean not null,
  invented_value_detected boolean not null,
  uncertainty_honest boolean not null,
  score integer not null check (score between 1 and 5),
  issues jsonb not null default '[]'::jsonb,
  notes text not null,
  judge_provider text not null,
  judge_model text not null,
  judge_prompt_version integer not null,
  judge_prompt_digest text not null,
  judge_output_digest text not null,
  created_at timestamptz not null default now(),
  unique (recommendation_id)
);
```

For every table: `(organization_id, id)` unique where id exists; enable + force RLS; select policy for organization members mirroring how findings grant readability (findings use `report.read`); **no insert/update/delete policies** — all writes go through Task 2/3 RPCs. Add insert/update/delete audit triggers on `channel_recommendation_decisions` writing `channel_recommendation.triaged` events to `public.audit_events`, copying the `private.audit_channel_analysis_run()` pattern (organization, actor, safe before/after, no prose payloads).

- [ ] **Step 2: Write failing pgTAP suite**

In `channel_recommendations_storage_test.sql`: begin/rollback wrapped assertions that (a) org-A session cannot select org-B recommendation/decision/feedback/evaluation rows, (b) an org member session cannot insert into any of the five tables directly (no policies → permission denied or zero rows affected via RLS, assert accordingly), (c) the dismissal CHECK rejects `('dismissed', null)` and accepts `('dismissed', 'why')` when inserting as table owner inside the test's superuser-ish context, (d) `unique(recommendation_id)` blocks a second evaluation row.

Run: `pnpm db:test -- --suites channel_recommendations_storage` (or the script's actual filter flag; suites are auto-globbed by `scripts/pgtap-suites.mjs`).

- [ ] **Step 3: Push migration to staging, run suite green**

Push, run `pnpm db:test`, confirm new suite passes alongside existing ones.

- [ ] **Step 4: Smoke-call each table once against staging**

Small node script using `dotenv` + `resolvePgTapDatabaseUrl(process.env.DATABASE_URL)` + `postgres` package: insert one throwaway row per table inside a transaction and roll back. Delete the script after.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824100000_channel_recommendations_storage.sql supabase/tests/database/channel_recommendations_storage_test.sql
git commit -m "feat(analysis): store what the narrator said and what humans answered"
```

---

### Task 2: Worker fence — claim/complete/fail RPCs

**Files:**
- Create: `supabase/migrations/20260824110000_fence_channel_recommendation_writes.sql`
- Test: `supabase/tests/database/channel_recommendation_fence_test.sql`

**Interfaces:**
- Produces (called by Task 7 workflow):
  - `claim_channel_recommendations(p_organization_id uuid, p_analysis_run_id uuid, p_correlation_id text, p_claim_token uuid)` returns jsonb `{outcome, windowStart, windowEnd, periodGrain}` where outcome ∈ `acquired|completed|not_found|not_ready|in_progress|conflict`.
  - `complete_channel_recommendations(p_organization_id uuid, p_analysis_run_id uuid, p_claim_token uuid, p_provider text, p_model_id text, p_prompt_version integer, p_prompt_digest text, p_output_digest text, p_result_digest text, p_recommendations jsonb)` — array items `{label, headline, detail, supportedActions: text[], limitations: text[], citations: uuid[]}`. `p_output_digest` is the sha-256 of the raw model response text; `p_result_digest` of the validated submission.
  - `fail_channel_recommendations(p_organization_id uuid, p_analysis_run_id uuid, p_claim_token uuid, p_failure_code text, p_result_digest text)`.

- [ ] **Step 1: Write the migration**

Three security-definer functions, `set search_path = ''`, revoke execute from `PUBLIC`, `anon`, `authenticated`; grant to `service_role` only. Claim semantics mirror `claim_channel_analysis`: lease row keyed by analysis_run_id with idempotency; refuses unless the referenced analysis run exists for the org AND is `completed`. Complete semantics:

```sql
-- inside complete_channel_recommendations, after token/lease checks:
if jsonb_array_length(p_recommendations) > 6 then
  raise exception 'RECOMMENDATION_CAP_EXCEEDED';
end if;
-- for each item: validate label against the check constraint's enum by
-- inserting; validate every cited finding via
--   select 1 from public.channel_findings f
--   where f.organization_id = p_organization_id
--     and f.id = (item->>'findingId')::uuid
--     and f.analysis_run_id = p_analysis_run_id
-- any miss -> raise 'CITATION_NOT_IN_RUN'; use the same reconciliation-current
-- rule complete_channel_analysis enforces on finding citations, copied from
-- 20260823140000_fence_channel_analysis_scope_and_citations.sql verbatim.
-- insert recommendation rows + citations; echo nothing but counts.
```

Use literal SQL above adapted to the real citation-current check copied out of `complete_channel_analysis` in `20260823140000_fence_channel_analysis_scope_and_citations.sql` — same rule, same refusal codes style.

- [ ] **Step 2: Write failing pgTAP suite**

Assertions, service_role context: claim refuses a running run (`not_ready`) and an unknown run (`not_found`); complete refuses a 7-item payload (`RECOMMENDATION_CAP_EXCEEDED`), a citation naming a finding of another run, a bad label, missing digest; complete succeeds on a valid minimal set and rows + citations land; re-complete with same result digest is idempotent; authenticated session gets "permission denied" executing any of the three.

- [ ] **Step 3: Push, run suite green**

- [ ] **Step 4: Call each function once against staging** (happy path + one refusal), via throwaway node script; delete it.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824110000_fence_channel_recommendation_writes.sql supabase/tests/database/channel_recommendation_fence_test.sql
git commit -m "feat(analysis): fence the narrator's writes behind the vault clerk"
```

---

### Task 3: Human fence — triage and feedback RPCs

**Files:**
- Create: `supabase/migrations/20260824120000_authenticated_recommendation_decisions.sql`
- Test: `supabase/tests/database/channel_recommendation_decisions_test.sql`

**Interfaces:**
- Produces (called by Task 11 routes):
  - `triage_channel_recommendation(p_organization_id uuid, p_recommendation_id uuid, p_decision text, p_dismissal_reason text, p_actor_id uuid)` returns void.
  - `record_channel_recommendation_feedback(p_organization_id uuid, p_recommendation_id uuid, p_helpful boolean, p_actor_id uuid)` returns void.

- [ ] **Step 1: Write the migration**

Both security definer, `search_path = ''`, revoked then granted to `authenticated`. Inside both: verify `(select auth.uid()) = p_actor_id`; verify membership via `public.current_organization_role(p_organization_id)` (exists since `20260817123000`); triage requires role in `('owner','admin','operator')` — matching the `recommendation.triage` permission tier; feedback allows any non-null role; verify the recommendation belongs to the organization. Triage inserts into decisions; the DB CHECK enforces the dismissal reason, so the function may simply pass it through. Feedback upserts `(recommendation_id, actor_id)`.

- [ ] **Step 2: Failing pgTAP suite**

Viewer-role actor triaging → refused; owner triaging with `dismissed` and null reason → CHECK violation surfaces; owner acknowledging → row lands and `channel_recommendation.triaged` audit event exists; cross-org recommendation id → refused; viewer leaving feedback → allowed; same actor voting twice → single updated row; anon/service_role executing triage → denied.

- [ ] **Step 3: Push, run suite green**

- [ ] **Step 4: Call once against staging** (acknowledge + feedback happy paths), delete script.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824120000_authenticated_recommendation_decisions.sql supabase/tests/database/channel_recommendation_decisions_test.sql
git commit -m "feat(analysis): let owners answer the narrator without erasing history"
```

---

### Task 4: Domain contracts

**Files:**
- Create: `src/domain/analysis/recommendations.ts`
- Test: `src/domain/analysis/recommendations.test.ts`

**Interfaces:**
- Produces:
  - `RECOMMENDATION_PROMPT_VERSION = 1`, `JUDGE_PROMPT_VERSION = 1`, `MAX_RECOMMENDATIONS_PER_RUN = 6`, `MAX_EVALUATION_BATCH = 200`.
  - `narratedItemSchema` = `{label: enum, headline: string(1..200), detail: string(1..1000), supportedActions: string[]≤5, limitations: string[]≤5, citations: z.string().uuid().array().min(1)}`
  - `narrationSubmissionSchema` = `z.object({items: z.array(narratedItemSchema).min(1).max(6)})`
  - `evaluationVerdictSchema` = `{citationFaithful: boolean, labelAppropriate: boolean, inventedValueDetected: boolean, uncertaintyHonest: boolean, score: int 1..5, issues: string[], notes: string}`
  - Types inferred and exported: `NarratedItem`, `NarrationSubmission`, `EvaluationVerdict`.

- [ ] **Step 1: Failing tests** — reject empty citations, >6 items, unknown label, score 6, headline over length; accept a canonical valid sample (use §3-shaped fixture values: funnel 18294→949→59→24, loss 35700 fils).
- [ ] **Step 2: Run, verify fail** (`pnpm vitest run src/domain/analysis/recommendations.test.ts`)
- [ ] **Step 3: Implement schemas** (pure zod, no imports beyond zod/domain types)
- [ ] **Step 4: Run, verify pass**; also `pnpm typecheck`
- [ ] **Step 5: Commit** — `git commit -m "feat(analysis): say exactly what shape a narration may take"`

---

### Task 5: Narration prompt builder and digests

**Files:**
- Create: `src/workflows/analysis/recommendation-prompt.ts`
- Test: `src/workflows/analysis/recommendation-prompt.test.ts`

**Interfaces:**
- Consumes: schemas/types from Task 4.
- Produces: `buildNarrationPrompt(input: {windowStart: string; windowEnd: string; periodGrain: string; findings: Array<{id: string; detectorKey: string; kind: string; code: string; headline: string; detail: string | null; valueSummary: string | null; limitations: readonly string[]}>})` returning `{system: string; user: string; promptVersion: number}`; `sha256Hex(text: string): string`.

- [ ] **Step 1: Failing tests** — system prompt states the output JSON contract **twice** (repo convention, see `model-router.ts:181` comment); forbids invented numbers/causes/savings and conversion of `needs_data` findings into recommendations (spec §11.4 verbatim rules); user prompt contains every finding id and no finding outside the input list; `promptVersion === RECOMMENDATION_PROMPT_VERSION`.
- [ ] **Step 2: Verify fail → Step 3: implement → Step 4: verify pass**
- [ ] **Step 5: Commit** — `feat(analysis): give the narrator one folder and hard rules`

---

### Task 6: Generation provider adapter

**Files:**
- Create: `src/modules/analysis/infrastructure/recommendation-generation-provider.ts`
- Test: `src/modules/analysis/infrastructure/recommendation-generation-provider.test.ts`
- Modify: `src/lib/env.ts` (add `RECOMMENDATION_TEXT_MODEL`, optional non-empty string, following `CAMPAIGN_TEXT_MODEL` at lines 46/94)

**Interfaces:**
- Produces: `createRecommendationGenerationProvider(config: {modelId: string})` → `{providerName: "google", modelId: string; generate(system: string, user: string): Promise<unknown>}` — parses fenced JSON like the campaign adapter (`stripCodeFence` + `JSON.parse`), throws `DomainError("INTEGRATION_ERROR", ...)` with **no provider message content** on failure. Also export `extractJsonText(raw: string): unknown` pure helper for tests.

- [ ] **Step 1: Failing tests for `extractJsonText`** — bare JSON, fenced ```json block, chatty preamble → domain error; never includes provider text in error message.
- [ ] **Step 2–4: fail → implement (mirror `gemini-campaign-generation-provider.ts` incl. `providerFailure` pattern and 90s timeout) → pass**
- [ ] **Step 5: Commit** — `feat(analysis): hire the narrator's courier, blind to its letters`

---

### Task 7: The narration workflow

**Files:**
- Create: `src/workflows/analysis/run-channel-recommendations.ts`
- Test: `src/workflows/analysis/run-channel-recommendations.test.ts`

**Interfaces:**
- Consumes: Task 2 RPC names, Task 4 schemas, Task 5 builder, Task 6 provider interface.
- Produces: `runChannelRecommendations(payload: {organizationId; channelId; analysisRunId; correlationId}, deps)` where deps = `{claim(input): Promise<{outcome: "acquired"|"completed"|"not_found"|"not_ready"|"in_progress"|"conflict"; window?: {windowStart; windowEnd; periodGrain}}>; loadFindings(runId): Promise<finding summaries>; generate(system,user): Promise<unknown>; complete(input: {provider; modelId; promptVersion; promptDigest; resultDigest; items: NarratedItem[]}): Promise<void>; fail(input: {code: string; resultDigest: string}): Promise<void>}`. Returns `{outcome: "completed"|"failed"|"skipped", recommendationCount: number}`.

Behavior: claim → if not acquired return skipped/completed mapping; load findings; build prompt; generate; compute `outputDigest = sha256Hex(rawText)`; `narrationSubmissionSchema.parse` — parse failure retries generation **once**, then `fail({code:"NARRATION_INVALID"})`; on success compute `resultDigest = sha256Hex(JSON.stringify(submission))` and call complete with both digests. Never logs item text.

- [ ] **Step 1: Failing tests** — fake deps: (a) happy path calls complete once with parsed items; (b) garbage then good JSON succeeds; (c) garbage twice fails with NARRATION_INVALID and calls complete zero times; (d) claim `completed` short-circuits without calling generate; (e) uncited/garbage-schema submission (extra fields, missing citations) rejected by zod before complete.
- [ ] **Step 2–4: fail → implement → pass**, plus `pnpm typecheck && pnpm vitest run src/workflows/analysis`
- [ ] **Step 5: Commit** — `feat(analysis): let the narrator work with a net underneath`

---

### Task 8: Trigger tasks and chaining

**Files:**
- Modify: `src/trigger/analysis.ts` (after successful `runChannelAnalysis` outcome `completed`, `tasks.trigger<typeof channelRecommendationsTask>` with org/channel/run/correlation ids)
- Create: `src/trigger/recommendations.ts` — `channel-recommendations.generate` schemaTask wiring deps onto `createAnalysisWorkerServiceClient()` RPC calls (mirror `src/trigger/analysis.ts:26-33` rpc helper), and `channel-recommendations.evaluate` scheduled `schemaTask` with cron `"0 3 */2 * *"`, delegating to Task 13 workflow.
- Load skill `trigger-authoring-tasks` before editing.

**Interfaces:**
- Consumes: Task 7 workflow; Task 13 `runChannelRecommendationEvaluations`.
- Produces: exported task handles `channelRecommendationsTask`, `evaluateRecommendationsTask` with `channelRecommendationsTaskSchema` payload `{organizationId, channelId, analysisRunId, correlationId}` (all uuid).

- [ ] **Step 1: Payload schema unit test** (parse valid, reject malformed) in `src/trigger/recommendations.test.ts` — task bodies stay thin; heavy logic already tested in Tasks 7/13.
- [ ] **Step 2: Implement tasks + chaining; guard chain dispatch failure with logged warning, not a thrown error** (a narration queue miss must not fail the completed detector run).
- [ ] **Step 3:** `pnpm typecheck && pnpm eslint src/trigger`
- [ ] **Step 4: Commit** — `feat(analysis): wake the narrator when the detectors finish counting`

---

### Task 9: Hand-typed database enums

**Files:**
- Modify: `src/lib/supabase/database.types.ts` (add five tables after `channel_finding_evidence`, ~line 800)

**Interfaces:**
- Produces: typed `Row` shapes matching Task 1 DDL exactly (`Insert: never; Update: never; Relationships: []` for the four worker-owned tables; decisions/feedback likewise — all writes via RPC).

- [ ] **Step 1:** Add entries; run `pnpm vitest run src/lib/supabase/database.types.test.ts` — UNTYPED_TABLES check passes without edits because tables are now typed.
- [ ] **Step 2:** `pnpm typecheck`
- [ ] **Step 3: Commit** — `feat(analysis): tell TypeScript about the narrator's ledger`

---

### Task 10: Read side — repository and view model

**Files:**
- Modify: `src/modules/analysis/infrastructure/read-repository.ts` (load recommendations of the displayed run + viewer's latest decision + own feedback per recommendation)
- Modify: `src/modules/analysis/application/read-model.ts` (extend `ChannelWorkspaceView`)
- Test: `src/modules/analysis/application/read-model.test.ts` (extend existing file)

**Interfaces:**
- Produces: `WorkspaceRecommendationView = {id; label: "observation"|"recommendation"|"needs_data"; headline; detail; supportedActions: readonly string[]; limitations: readonly string[]; citationFindingIds: readonly string[]; decision: {decision: "acknowledged"|"dismissed"|"planned"; reason: string | null; actorName: string; createdAt: string} | null; myFeedback: boolean | null}`; added to `ChannelWorkspaceView.recommendations`.

- [ ] **Step 1: Failing view-builder tests** — narration maps onto chapters via citations; latest decision wins by `createdAt` when several actors decided; `myFeedback` reflects viewer row; rec citing zero displayed-run findings still appears (unplaced band data).
- [ ] **Step 2–4: fail → extend repo (RLS-safe selects, join profiles for actor display name only) → pass**
- [ ] **Step 5: Commit** — `feat(analysis): carry the narrator's words to the page with receipts`

---

### Task 11: Routes — decisions and feedback

**Files:**
- Create: `src/app/api/organizations/[organizationId]/channel-recommendations/[recommendationId]/decisions/route.ts`
- Create: `src/app/api/organizations/[organizationId]/channel-recommendations/[recommendationId]/feedback/route.ts`
- Create: `src/modules/analysis/application/triage.ts` (+ `triage.test.ts`)

**Interfaces:**
- Consumes: Task 3 RPCs via authenticated supabase client (NOT service role — user path stays under RLS/definer checks). Both routes call `assertGovernedChannelAnalysisEnabled(organizationId)` first, matching the analysis route.
- Produces: `triageRecommendation({organizationId, recommendationId, decision, reason?}, actorContext)` and `recordFeedback({organizationId, recommendationId, helpful}, actorContext)`; bodies strict-zod: `{decision: "acknowledged"|"planned"}` or `{decision: "dismissed", reason: string min 3}`; feedback `{helpful: boolean}`. Decisions route gated on `hasOrganizationPermission(role, "recommendation.triage")`; feedback on any membership. Both emit structured log (ids + decision kind only).

- [ ] **Step 1: Failing application-layer tests** with fake rpc client: dismiss-without-reason blocked client-side; RPC error mapped to stable `DomainError`; success path passes exact arg names (`p_decision`, `p_dismissal_reason`, …).
- [ ] **Step 2–4: fail → implement routes modeled line-for-line on the analysis POST route (correlation header, `getOrganizationContext`, `apiErrorResponse`) → pass**
- [ ] **Step 5: Commit** — `feat(analysis): record the operator's answer where history cannot reach`

---

### Task 12: Workspace UI

**Files:**
- Modify: `src/components/analysis/finding-card.tsx` (narration block beneath figures when ≥1 citation points at this finding)
- Create: `src/components/analysis/recommendation-controls.tsx` (Acknowledge / Mark planned buttons; Dismiss opens dialog with required reason textarea; post-decision state line `Marked planned · {name} · {date}`; separate quiet helpful/not-helpful pair)
- Test: `src/components/analysis/recommendation-controls.test.tsx`

**Interfaces:**
- Consumes: Task 10 views; Task 11 routes via fetch + `router.refresh()`.
- Design-system: shadcn Card anatomy, no gradients/glass, colour only encoding status; forbidden strings absent; mobile stacks naturally.

- [ ] **Step 1: Failing component tests** — renders narration sentence; dismiss button disabled until reason ≥3 chars; clicking Acknowledge POSTs and shows recorded state after refresh; feedback pair renders selection; snapshot contains neither forbidden string.
- [ ] **Step 2–4: fail → implement → pass**; `pnpm typecheck && pnpm eslint src/components/analysis`
- [ ] **Step 5: Commit** — `feat(analysis): let the page take an answer, not an order`

---

### Task 13: The judge

**Files:**
- Create: `src/workflows/analysis/run-recommendation-evaluations.ts`
- Modify: `src/lib/env.ts` (add `RECOMMENDATION_JUDGE_MODEL`, optional non-empty string)
- Create: `supabase/migrations/20260824130000_admit_recommendation_evaluations.sql` — `admit_channel_recommendation_evaluations(p_batch_id uuid, p_batch jsonb)` security definer, service_role only; validates each verdict's recommendation exists, `unique(recommendation_id)` enforced, score range re-checked.
- Test: `supabase/tests/database/channel_recommendation_evaluations_admission_test.sql` + `src/workflows/analysis/run-recommendation-evaluations.test.ts`

**Interfaces:**
- Consumes: Task 4 `evaluationVerdictSchema`; provider pattern from Task 6 with env `RECOMMENDATION_JUDGE_MODEL`.
- Produces: `runChannelRecommendationEvaluations(deps)` selecting ≤200 unjudged recommendations (left join evaluations null, oldest first), judging one call each with folder = recommendation + cited findings (Task 10 loader reused server-side via worker client), filing via admit RPC. Returns `{batchId, evaluatedCount, refusedCount}`. Refusals (invalid judge JSON) are counted and logged by id, never silently dropped.

- [ ] **Step 1: Failing tests** — batch cap respected; judged verdict lands via admit args; invalid verdict → refusedCount++ and no partial admits; empty selection → evaluatedCount 0, no provider call.
- [ ] **Step 2: pgTAP admission suite** — duplicate recommendation id refused; bad score refused; service_role-only grants.
- [ ] **Step 3: Push migration, run db:test, smoke-call admit once against staging**
- [ ] **Step 4–6: workflow fail → implement → pass**
- [ ] **Step 7: Commit** — `feat(analysis): let a second opinion read the first against its sources`

---

### Task 14: Gates and live proof

- [ ] **Step 1:** `pnpm typecheck && pnpm eslint && pnpm vitest run` — full suite green (known pre-existing flake `pdf-text-layer.integration.test.ts` excluded mentally, do not touch).
- [ ] **Step 2:** `pnpm db:test` fully green.
- [ ] **Step 3:** Start `pnpm run:trigger`; confirm BOTH `channel-analysis.run`, `channel-recommendations.generate`, `channel-recommendations.evaluate` registered ("Local worker ready").
- [ ] **Step 4:** Re-run the staging analysis for org `2dda45b8-82db-4f5f-b17d-611b9bbb7846`, channel `b4f83dd2-3035-4676-9cf3-cedc9b9e7884`, window 2026-01-01→2026-02-28 day grain via the existing POST route; confirm §3 figures unchanged (funnel 18,294→949→59→24; gross 55,300 fils; loss 35,700; closed 34,217/70,799; reasons 39+20) and recommendation rows exist citing those runs' findings.
- [ ] **Step 5:** Triaged once via API as staging owner (acknowledge + one dismissed-with-reason), confirm audit event + append-only rows.
- [ ] **Step 6: BROWSER GATE — STOP.** No Chrome DevTools MCP here. Ask the user to open the workspace at 1440×900 and 390×844, verify narration/triage/feedback render with no console errors, and report back.
- [ ] **Step 7:** Update spec 018 §11.3 shipped-status wording if anything deviated; final commit of remaining changes.
