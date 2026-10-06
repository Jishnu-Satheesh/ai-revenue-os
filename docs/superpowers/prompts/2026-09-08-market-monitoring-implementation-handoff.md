# Handoff prompt — Growth Intelligence Market monitoring

Copy this prompt into the successor agent's session, or ask that agent to read this file completely.
All repository paths below are relative to the worktree unless explicitly absolute.

## 1. Your assignment and approval status

You are taking over a carefully scoped Growth Intelligence change in:

/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence

The user originally requested an end-to-end UI redesign, then narrowed implementation to one
prototype mismatch: **Market monitoring**, its review dialog, and the complete research-to-insights/
recommendations workflow. Do not restart the entire redesign or treat every visible inconsistency
as permission to fix it.

The most recent substantive request was:

> Find solutions for all these "significant gaps" and change the written design accordingly.
> Then create the execution plan.

That documentation work is complete. The current request was to prepare this handoff.

**At handoff, the revised architecture and execution plan have NOT yet received implementation
approval.** Earlier “Yes,” “Approved,” and “Proceed” messages approved earlier iterations, including
a provider choice that this review subsequently corrected. They do not establish approval for the
new branch-profile architecture, provider replacement, budget defaults or retention changes.

Your first action is to read the current files and check any user message accompanying this handoff.
If the user explicitly approves the revised plan or tells you to implement it, proceed without
asking the same permission again. Otherwise finish read-only orientation, summarize the proposed
change plainly and ask for implementation approval once. The reason is the repository's AGENTS.md:
“Wait for explicit approval before writing Tier 2 or Tier 3 code.” Link that instruction when asking.
Do not purchase services, contact providers, deploy or run paid research just because you received
this handoff.

Do not ask the user to re-answer settled product questions. Material changes to the written design
need discussion; routine implementation details should be resolved by inspecting the repository.

## 2. Current authoritative files — read these exact working-tree versions

1. AGENTS.md, including database and collaboration rules.
2. docs/collaboration/asset-library-and-studio-board.md — read banner and latest 2026-09-08 entries.
3. docs/superpowers/specs/2026-09-08-market-monitoring-research-completion-design.md.
4. docs/superpowers/plans/2026-09-08-market-monitoring-research-completion.md.
5. specs/022-growth-intelligence.md.
6. adrs/0047-branch-scoped-grounded-market-research.md.
7. Related constraints in adrs/0044-evidence-first-growth-intelligence.md and ADR 0039.
8. .superdesign/growth-intelligence/prototype.html for the approved presentation.
9. README.md and task-relevant context documents in AGENTS.md's reading order before editing code.

The design explains decisions; the 12-task plan gives files, interfaces, test scenarios and order.
This handoff supplements those files and does not replace their detailed contracts.

Important history:

- Branch observed: feat/governed-channel-intelligence.
- HEAD observed when writing this handoff: 481ca76, an unrelated cache validation commit.
- Commit 9c01270 contains the ORIGINAL design, including the superseded Google Search grounding
  choice. Do not check out that commit, use it as current truth, or undo the newer working-tree edits.
- Revised design, ADR 0047 and Spec 022 are modified but uncommitted.
- The 12-task execution plan is untracked at handoff.
- The collaboration board already contains other uncommitted entries. Preserve them.
- Many application files have existing unrelated/uncommitted changes, including GI components,
  analysis, reports, recommendation controls and database.types.ts. They are not changes you made.
- The prototype directory is untracked. Never git clean it away.
- Re-read git status and HEAD yourself; this is a snapshot, not a lock on the worktree.

No feature implementation, migrations, provider calls or browser acceptance were performed by this
design-revision pass. It is incorrect to claim that the plan's acceptance tests already passed.

## 3. What the user has already settled

- Use **Market monitoring** with a settings icon, not “Manage market monitoring.”
- It opens **Review market monitoring** as a modal.
- The header and Market Watch action open the same modal.
- Remove the large inline Market Profile review block above workspace tabs.
- Business name/descriptor are read-only.
- Location is a dropdown selecting ONE active branch for the run.
- Show saved service area beside the branch name where available.
- Branch selection changes research scope, not the official business-location record.
- Topics are editable tags; the current design allows 1–20 unique topics.
- Competitors are editable rows: required name, optional public website and location hint.
- The explicit initial competitor limit is FIVE. Do not “improve” it to ten.
- Name-only competitors are valid unverified leads. Entering a website does not verify identity.
- **Start market research** is the single review confirmation; no second approval screen.
- Pending AI proposals can be rejected. Other states have Cancel.
- An identical active scope cannot duplicate research. Changed settings can start replacement work.
- No fifth top-level research tab.
- Insights & market contains research progress, findings, competitors, gaps, sources and history.
- Recommendations contains derived actionable advice with source links.
- Overview retains Top Recommendations and its More link.
- Your actions records starts and outcomes without invented percentages.
- Observe active research automatically and refresh its outcome when ready.
- Preserve existing performance metrics' fresh-fetch timestamp/manual refresh behavior.
- Preserve organization-summary channel/location filters and current recommendation controls.
- Preserve Acknowledge, Planned, like, dislike and snooze behavior; this slice does not redesign them.
- The user wants understandable real-data outcomes, not a polished dialog over placeholder workers.

The revised design additionally proposes research-only service-area/city/country inputs when the
selected branch lacks sufficient geography. Location itself remains a branch dropdown. This corrects
a promised repair link for which no existing branch-location editor was verified. These fields must
not write canonical branch data. Do not silently infer city from timezone or copy shared onboarding
locality into every branch.

## 4. The six significant gaps and their required solutions

### Gap 1 — Provider terms and stored evidence

The original written design chose Gemini Grounding with Google Search and optional URL Context.
That design stored grounded claims permanently, shared them across organization members, reused
them in synthesis and omitted Search Suggestions. Review found a conflict with Google's standard
Grounding terms.

The revised choice is:

- Brave Web Search for bounded search metadata/snippets under explicit account-specific rights.
- Paid Gemini for extraction, support review and synthesis with search tools disabled.
- No returned-page crawling in this slice.
- A working API key or ordinary plan does NOT prove storage/reuse rights.

Official sources checked 2026-09-08:

- https://ai.google.dev/gemini-api/terms
- https://brave.com/search/api/
- https://api-dashboard.search.brave.com/documentation/resources/terms-of-service

Recheck current official terms at qualification time. Do not assert that Brave's standard terms
already permit our workflow. Its published storage-rights option is a qualification path; the actual
agreement must cover retained snippets, commercial Gemini inference, organization display, derived
claims, later reuse and retention/deletion.

Provider qualification is an external launch prerequisite. Keep it off until proven. You can
implement and test with synthetic fixtures after plan approval while account setup is unavailable.
Do not silently substitute Google Grounding, Exa, Tavily, page scraping or another provider.

Persist bounded permitted evidence, not raw API JSON. Retention erasure must remove covered source
and derived payloads, withdraw support eligibility and preserve only permitted safe audit history.
This is a narrow audited exception to append-only content. Do not add unrestricted UPDATE/DELETE
access or rehash erased content as though it were the original evidence.

### Gap 2 — One global profile causes cross-branch cancellation

Current organization_market_profiles has unique organization_id and one current_version_id.
Putting branch_id on a request alone does not solve this: confirming Marina still replaces
Downtown's current profile and can cancel its work.

Required solution:

- Extend existing profile identity with nullable branch_id.
- Partial uniqueness: organization for null-branch legacy profile; organization + branch otherwise.
- Each profile has independent current version, enabled state and cadence.
- Preserve v1 documents/digests/IDs and legacy organization workflows.
- New branch starts use v2; v1 parsing/canonicalization remain frozen.
- Replace singleton readers and old ON CONFLICT(organization_id) assumptions.
- Same-branch replacement only; another branch's pipeline remains valid.
- Legacy organization results are labelled context and never shown as branch metrics.

The new reviewed start is ONE database transaction, not browser “propose, then confirm.”
It saves/reuses the reviewed immutable version, records confirmation and creates/returns the pipeline.
Keep legacy proposal/decision APIs compatible for explicit null scope.

Use branch-profile locking, expectedCurrentVersionId and server idempotency. Different browser keys
with the same active scope must still converge. A deliberate later run of unchanged settings gets
new pipeline/request IDs, not duplicate immutable versions.

### Gap 3 — Research completion is not recommendation completion

The root research request may succeed while synthesis is still pending. Never stop observing then.

Use growth_intelligence_research_pipelines as a lifecycle envelope:

- queued
- researching
- preparing_insights
- ready
- partial
- no_findings
- research_failed
- synthesis_failed
- cancelled

There are NINE pipeline stages. These are separate from existing database request and run statuses:

- Requests: pending, claimed, succeeded, failed, cancelled.
- Research runs: running, completed, partial, failed.

Show research evidence while preparing insights. Synthesis failure retains research and can offer
an analysis-only retry if freshness, current scope and remaining budget permit. Empty/no-advice
outcomes must be honest; do not force generation of a recommendation to call the pipeline successful.

### Gap 4 — Non-atomic handoff loses analysis

Do not implement “complete research RPC; then enqueue synthesis RPC.”

A fenced completion transaction must:

- recheck the lease, current branch/profile and persisted eligible claims;
- complete run and root request;
- create exactly one market_evidence_changed child with market_research_completed reason;
- bind exact pipeline/branch/profile lineage;
- set preparing_insights, or no_findings with a reason if no eligible claim remains;
- write safe events and settle known accounting.

Use existing due-request sweeping as a durable outbox. Immediate Trigger dispatch is optional.
Crash after commit must leave a discoverable child. Replays return the same child. Expired tokens
cannot complete. Old completion RPCs must reject pipeline-bound runs to prevent bypass.

Synthesis item persistence, child success and pipeline terminal state must also settle atomically.
Do not mark ready and persist recommendations in separate operations.

Retry synthesis reuses the same child and evidence; one explicit second synthesis call is in the
prequoted cap. Do not refetch research or reset already-consumed budgets/attempts.

### Gap 5 — Branch selection is dropped before business synthesis

channel_findings.branch_id EXISTS. Do not invent another field or migration to rediscover it.

Carry branch through:
request → worker → synthesis service → findings/claims loaders → support validation → saved item.

Load/check analysis_run_id, current/supersession state, actual periods, currency, units and coverage.
Exclude other named branches. Organization totals may be labelled broader context, never branch
measurements. Missing branch evidence produces a data gap, not another branch's fallback.

Enforce this in persistence RPCs too. Service identity does not make wrong-branch evidence valid.
Use a fixture where branch A sales = 100, branch B = 900 and organization = 1,000; A advice must
not describe 900 or 1,000 as A's sales.

### Gap 6 — Coverage and cost need deterministic enforcement

The query plan is deterministic:

- one business/local-market query;
- one query for every topic;
- one query for every competitor.

Maximum primary searches = 1 + 20 + 5 = 26. Do not keep the old first-topic-only behavior.
Up to two transient-error retry attempts across the run means at most 28 search attempts total.

Every input has a persisted coverage entry: not_started, searched_no_usable_evidence, supported,
failed, skipped_budget or skipped_policy. Search completion is not evidence support. Retaining fewer
sources under caps must not make the UI claim full supported coverage.

Proposed initial limits, copied into the execution plan:

- 5 results/query; 512 KiB/response; 8 MiB streamed total.
- 40 retained sources; 2,000 characters/excerpt; 64 KiB retained excerpt text.
- Zero API redirects; 20-second calls; at most two parallel searches.
- Eight-minute research deadline within a ten-minute request lease.
- Extraction and support review: each at most four calls, each bounded to 12,000 input and
  4,000 output tokens.
- Synthesis: at most two calls INCLUDING one explicit retry, each 24,000 input/6,000 output.
- Bound all billable reasoning tokens; disable hidden SDK retries.
- USD 1 pipeline reservation and USD 5 organization local-day allowance.
- Include all phases and retries in the full worst-case quote before the first paid call.
- If the entire scope cannot fit the quote, refuse before calling; do not silently trim inputs.
- Pin qualifying model/rates and record the price version. No exact new model was selected here.

Reserve the work budget atomically, then reserve each attempt before its external call. Standalone
weekly/business-evidence synthesis and legacy paid research use an immutable request work scope
against the SAME organization allowance. They must not bypass the limit because they lack a pipeline.

The plan describes reserveResearchAttempt first in pipeline shorthand and then generalizes it to a
discriminated pipeline-or-request work scope. Implement ONE consistent typed boundary, not two
incompatible interfaces. PostgreSQL resolves day/timezone; do not trust a client-supplied allowance.

Unknown usage remains unknown/reserved. A timeout may be billable. Never clamp measured cost with
Math.min, reset counters on worker retry or release unknown liability simply because time elapsed.
A late receipt may reconcile an already-issued attempt after cancellation, but cannot admit new
evidence or restart work under a stale lease.

## 5. Code navigation and known traps

These were inspected during design. Verify against the current working tree before modifying.

- src/domain/growth-intelligence/types.ts and schemas.ts:
  current MarketProfileDocumentV1, strict competitor relevance URLs and required geographic layers.
  Add v2 instead of weakening old validation. Include provenance so AI cannot enter unsupported
  competitors through the operator-lead exception.
- src/domain/growth-intelligence/profile-digest.ts:
  preserve exact old canonicalization and hash fixtures. Optional defaults can change a digest.
- src/modules/growth-intelligence/infrastructure/profile-repository.ts:
  organization-level maybeSingle read; proposal context includes active branch service_area JSON.
  Shared onboarding locality must not silently become every branch's location.
- src/modules/growth-intelligence/application/profile-service.ts:
  existing proposal/decision behavior; preserve legacy callers and explicit domain outcomes.
- src/app/api/organizations/[organizationId]/market-profile/:
  existing GET, proposals POST, version decision routes. New reviewed start is a separate atomic API.
- src/app/api/organizations/[organizationId]/branches/route.ts:
  the inspected route creates branches. Do not invent an existing update-location destination.
- src/modules/growth-intelligence/infrastructure/research/ports.ts:
  approvedDomains currently requires at least one, maxQueries caps at 3, and searchAndFetch returns
  Promise<never>. All are incompatible with the revised actual adapter contract.
- src/modules/growth-intelligence/infrastructure/research/qualified-provider.ts:
  unavailable Exa placeholder. Do not change available to true without implementing qualification.
- src/modules/growth-intelligence/infrastructure/research/query-plan.ts:
  currently ignores competitors and covers only the first topic.
- src/workflows/growth-intelligence/run-market-research.ts:
  inspected code still records payload { sources, claims: [], links: [] }.
  It also clamps adapter cost and latency with Math.min. Replace misleading accounting, including
  failure/replay paths; do not treat a successful mock adapter as a complete research feature.
- src/trigger/growth-intelligence.ts:
  readApprovedProfile currently selects one organization profile; synthesis findings loader drops
  branch scope. Update exact profile resolution and compact evidence lineage.
  Audit task-ID validation as well as routing so the synthesis task is actually dispatchable.
- src/workflows/growth-intelligence/dispatch-due-work.ts:
  business_evidence_changed currently routes to research; weekly_synthesis to consolidation.
  The revised plan routes those and market_evidence_changed to synthesis. Keep consolidation
  separately exercised rather than deleting a maintenance workflow accidentally.
- src/workflows/growth-intelligence/run-synthesis.ts and application/synthesis-service.ts:
  branch is not passed through all boundaries. A branch ID on the final item alone is insufficient.
- src/modules/growth-intelligence/infrastructure/read-repository.ts and application read models:
  current-profile-only reads will hide previous successes after replacement. Add explicit history/
  same-branch fallback without making old evidence automatically eligible.
- src/components/growth-intelligence/:
  preserve existing dirty changes to workspace, cards, controls, timeline and queries.
  Introduce focused dialog/progress/outcome components as planned, not another giant workspace file.

Relevant existing schema history:

- supabase/migrations/20260831154256_growth_intelligence_profiles_and_requests.sql
- supabase/migrations/20260902080209_growth_intelligence_market_evidence.sql
- Later market-evidence hardening/support/failure migrations — read the latest replacement function,
  not only the original CREATE FUNCTION.
- supabase/migrations/20260903120000_growth_intelligence_synthesis_items.sql
- supabase/migrations/20260904032340_growth_intelligence_worker_reads.sql
- supabase/migrations/20260904065759_enqueue_growth_intelligence_on_report_current.sql
- supabase/migrations/20260823120000_governed_channel_analysis_findings.sql

Relevant tests:

- src/domain/growth-intelligence/
- src/modules/growth-intelligence/
- src/workflows/growth-intelligence/
- src/components/growth-intelligence/
- src/trigger/synthesis-loaders.test.ts
- market-profile and Growth Intelligence route tests
- supabase/tests/database/growth*intelligence*\* and market_evidence_test.sql
- e2e/growth-intelligence.spec.ts

## 6. Implementation order — follow the actual 12-task plan

1. Verify current worktree and Task 13 hosted-staging baseline; record external release prerequisites.
2. Define v1/v2 scope, lifecycle, coverage and budget contracts before UI.
3. Persist independent branch profiles and pipeline/request lineage with tenant constraints.
4. Implement atomic start, scoped reads, legacy compatibility and scheduling.
5. Implement private spend reservations, provider qualification and retention.
6. Implement deterministic bounded Brave retrieval and full coverage manifest.
7. Extract, review and persist actual cited claims.
8. Make research/synthesis handoff and completion atomic; fix dispatch and recovery.
9. Fence business synthesis and persistence by branch and actual governed evidence.
10. Serve pipeline status, history, retry eligibility and outcome/provenance links.
11. Implement accessible prototype dialog and pipeline-aware views.
12. Run integration/browser/provider acceptance, document evidence and enable cautiously.

Keep all new starts/provider calls gated until the dependent backend path is ready. A passing Task 4
API does not authorize enabling a UI button before budgets, claims and completion exist.

Each task has explicit files/test cases in the execution plan. Read its prerequisites before editing.
Do not implement all UI first and leave the worker as “follow-up.” Do not create unused abstractions
or split the work into disconnected partial products.

For implementation, use the executing-plans skill; load repository Supabase/Postgres skills before
database changes and the relevant Trigger skill before task changes. Follow applicable shadcn rules
for shared components. Do not spawn agents unless the active user/repository instructions authorize
delegation.

## 7. Database and repository rules that must not be violated

- There is NO local database. Never run supabase start, db reset, Docker Postgres, or any command
  depending on a local Supabase instance.
- Hosted staging is shared and authoritative. A migration push is live immediately.
- Read latest schema/function replacements first; generate a NEW forward migration. Never edit an
  already-applied migration as the repair.
- pnpm db:migrations:list, :dry-run and :push target staging. Check pending migrations carefully:
  the wrapper can include unrelated files. Do not blindly push every pending worktree migration.
- Every new/changed PL/pgSQL path must actually execute against staging. A successful CREATE
  FUNCTION does not prove referenced columns exist; PostgreSQL resolves many references at runtime.
- Use distinct PL/pgSQL local variable names to avoid column ambiguity such as safe_failure_code.
- pgTAP runs against shared staging. It is integration evidence, not a hermetic local test layer.
- pnpm db:types is unusable here because it calls --local. Update database.types.ts narrowly by hand
  and run its table-coverage tests.
- User routes use the signed-in Supabase client and RLS, never service-role shortcuts.
- Composite organization foreign keys plus explicit scope validation are required for branch,
  profile, request, run, source, claim, support link and output lineage.
- Privileged functions need fixed search paths, explicit execute grants, actor/tenant checks and
  worker fencing. Do not rely on RLS alone inside security-definer functions.
- New public tables need RLS and appropriate grants. Budget/attempt ledgers stay private.
- Never print .env.local, tokens, raw business data, full provider payloads, signed URLs or contracts.
- Use Node 22 via PATH=/home/spy/.local/node/bin:$PATH and pnpm.
- Never git stash, git reset away user changes, git clean, bulk-stage or push.
- Never run pnpm format here: it reformats unrelated dirty files. Format named files only.
- Record touched files, decisions, verification and rejected assumptions on the collaboration board.
- Old board reservations are historical per AGENTS; read current ownership rather than treating an
  old row as a permanent blocker.
- Git push is the user's step. Use narrow commits only when their diff is understood.

## 8. UX and evidence checks that commonly get missed

- Dirty form content survives network failure, conflict and background refresh.
- Branch switch does not overwrite edits without the inline discard/cancel choice.
- Multiple branches with no selected filter must not default to the first branch.
- A viewer can inspect but cannot mutate via either UI or direct RPC.
- A same-scope double click and two independent browsers converge server-side.
- Cross-branch calls cannot cancel each other even when both belong to the same organization.
- A later successful root research request does not cause polling to stop before synthesis.
- Query keys include organization, branch and pipeline; late responses cannot overwrite another scope.
- Active-only status observation: 5-second polling, error backoff up to 30 seconds, pause hidden/
  offline, immediate authoritative check on return.
- Status-read error is not pipeline failure. No fake progress percentage.
- Previous successful findings have their real date/settings label; B never substitutes for A.
- Source history can remain visible without being eligible current support.
- Research results may be partial, empty or unsuitable for recommendations; explain those outcomes.
- Source title/URL alone does not prove the model statement. Validate exact spans and perform
  bounded support review; label snippets and unresolved competitor identity honestly.
- Model support review is judgment, not a truth guarantee. Deterministic code enforces admissibility,
  scope, policy, limits and downstream eligibility.
- Preserve currency, units, actual periods and coverage. Never fabricate local sales by apportioning
  an organization total or summing overlapping windows.
- No recommendation, research completion or button click approves Campaign execution.
- Source erasure must affect eligibility and source drawers across consumers, not just delete a blob.
- Keep Overview Top Recommendations preview/More and current triage controls functional.

## 9. Required validation and honest reporting

Before changes, record baseline tests and actual staging migration/function state. Historical notes
are not current staging proof. Record safe IDs and counts, never raw tenant payloads.

After each task run its focused tests. Important behavioral fixtures:

- v1 digest unchanged; v2 scope/provenance bounds.
- Two tenants and two branches, direct SQL/RPC denial and independent concurrent starts.
- Different idempotency keys/same active scope; same key/different body conflict.
- Research completion crash before and after commit; child wake loss; replay; expired lease.
- Synthesis completion crash/retry; no duplicate items or timeline events.
- Same-branch replacement while a worker is active; late cost reconciliation without stale writes.
- All 20 topics and 5 competitors represented; no first-topic truncation.
- Total attempt/token/byte/budget caps survive restarts, retries and concurrent pipelines.
- Mixed manual, scheduled and legacy paid work shares the daily allowance.
- Unknown provider charge remains reserved; actual charge is never clamped.
- Unsupported/uncertain/malformed citations rejected; retained and erased evidence handled safely.
- A/B/organization sales fixture, stale/current business windows, missing branch data.
- UI waits through synthesis, resumes on remount, pauses when hidden and preserves dirty input.
- Keyboard, focus, 375px/mobile and desktop layout compared with prototype.

Integration checks after the slice:

- pnpm typecheck
- pnpm lint
- pnpm test
- pnpm build
- pnpm db:test
- pnpm exec playwright test e2e/growth-intelligence.spec.ts with the real authenticated test setup

Check actual CLI/filter support rather than inventing flags. All environment setup should avoid
printing secrets. Separate unrelated baseline failures from changes, but do not conceal required
slice failures.

A controlled live provider canary is required before enablement, after actual rights/configuration
and budget authorization. It must prove persisted eligible sources/claims, unique synthesis child,
correct branch evidence, final UI state and reconciled cost/coverage. A green Trigger run alone
proves none of that. A valid no-recommendation result may still pass if the analysis explains why.

If browser or provider access is unavailable, continue independent implementation/tests that are
authorized and record the precise remaining release blocker. Do not claim browser acceptance,
production readiness or all tasks complete using synthetic fixtures only.

At handoff, ONLY these documentation checks ran successfully:

- Prettier check of revised design, plan, ADR 0047 and Spec 022.
- Relative Markdown link existence check.
- Placeholder scan.
- git diff --check.
  No fresh app unit/integration/build/browser/hosted canary acceptance was run by this documentation
  pass. Do not copy old success counts into your completion report.

## 10. Decisions still awaiting approval or external evidence

The current revised plan proposes:

- Brave under explicit storage/reuse rights, rather than Google Search Grounding.
- Independent branch profiles and v2 documents.
- Atomic reviewed start plus a pipeline lifecycle envelope.
- Private shared spend ledgers and retention handling.
- Conditional research-only geography inputs.
- The specified query/token ceilings, USD 1 per work scope and USD 5/day.
- Snippet-only evidence in this first adapter.

Do not tell the user these are already implemented or fully provider-qualified.

Still needed before launch:

- actual account rights and retention evidence;
- qualified paid Gemini model with pinned rate table and enforceable billable limits;
- credentials supplied through the established secret mechanism;
- current hosted-staging checks and authenticated browser verification;
- controlled live research-to-synthesis canary.

No specific replacement model was selected in the design. Preserve the existing configured Gemini
model if it qualifies; do not silently choose a new expensive/unbounded model. If a material choice
cannot satisfy the written contract, explain the concrete conflict and request a narrow decision.

## 11. Rollback and completion discipline

Use organization feature flags and provider qualification to disable new starts/calls/dispatch while
bounded leased work settles. Keep lawful history, decisions, audit records and retention processing.

Do not roll back to organization-singleton readers once branch profiles exist. A flags-off,
forward-compatible application is the rollback path; database repairs are forward-only.

Update this plan's checkboxes and the verification record only from actual evidence. At each
checkpoint state what now works, how it was tested and what remains. Communicate in simple language,
with a short real-world impact when explaining a defect. Do not repeatedly reopen settled questions,
invent new product scope or stop at a cosmetic implementation.

Your immediate next step is orientation and approval-state verification in section 1, followed by
Task 1 once implementation is authorized. The user should not need to reconstruct this history.
