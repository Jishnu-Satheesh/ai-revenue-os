# Business Memory shared intelligence: successor handoff

You are continuing an evidence-backed proposal in `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`.

## Approval state — read first

**The feature is not approved for implementation as of this handoff.** The user requested thorough research, a detailed specification and an implementation plan. They confirmed the product preference “automatic capture, distinct trust levels.” That is not approval of the full proposed schema, conditional Channel narration change, retention policy or execution plan.

If a later user message explicitly approves Spec 023/ADR 0054/the plan, record that approval and execute the approved scope without asking again. Otherwise review and refine the proposal only. Do not apply migrations, modify feature code, run paid providers or deploy merely because this handoff exists.

## Required documents

1. Repository `AGENTS.md`, README and the relevant mandatory context documents.
2. [Spec 023](../../../specs/023-business-memory-shared-intelligence.md): domain rules, contracts, data model, acceptance A01–A24.
3. [Execution plan](../plans/2026-09-10-business-memory-shared-intelligence.md): Tasks 00–13, file map, exact interfaces, verification and release gates.
4. [ADR 0054](../../../adrs/0054-business-memory-shared-context-and-governed-capture.md): proposed architecture and changes to existing boundaries.
5. [Research report](../../research/2026-09-10-business-memory-shared-intelligence.md): current code/staging evidence, alternatives, primary sources and limitations.
6. Specs 004/016/018/022 and ADRs 0011/0012/0013/0019/0044/0047/0051/0052/0053 as referenced in Spec 023.
7. [Collaboration board](../../collaboration/asset-library-and-studio-board.md). Claim files before editing; preserve unrelated changes.

## The intended product

Independent AI features share relevant organizational context without calling one another. A Channel recommendation, a Campaign plan and a Growth research conclusion remain separate source records, but each feature can consult relevant history and contribute new information.

The loop is source commit → durable capture → deterministic memory projection → bounded context pack → AI run → validated source commit. Existing source modules own truth and current state. Memory owns reusable context and provenance. There is no all-powerful memory agent and no automatic policy optimization.

## Verified starting point

- Research baseline HEAD: `e8c1d6d`; recheck current HEAD before edits.
- Memory storage, retrieval, workspace, provider projection and embedding workers already exist. Do not rebuild them from scratch because an old plan says “not started.” Status headers in Spec 004 and ADRs 0011/0012 were corrected during the proposal.
- Campaign subject drafting is a real memory consumer: `src/modules/campaigns/application/subject-service.ts`, wired through `infrastructure/subject-route-wiring.ts`.
- Channel recommendations, Growth research/synthesis and general Campaign generation do not currently use a common Business Memory context port.
- The domain event publisher at `src/domain/events/publisher.ts` only logs. It is not a durable outbox and cannot deliver learning updates.
- `decide_campaign_learning_proposal` records `submitted_for_promotion`; it does not promote a lesson into Business Memory.
- `src/trigger/memory.ts` registers embed/reembed/expire tasks; automatic invocation cannot be inferred from that file. No dispatch/schedule wiring was found elsewhere in the inspected source. Deployed Trigger schedules were not inspected.
- Current retrieval returns `servedFromCache: false`; no Redis implementation is required for this extension.
- Read-only staging aggregates for the README development organization on 2026-09-10: 1,431 memory items, zero retrieval logs, 164 Channel recommendations, three Growth items, zero Campaign learning proposals. These are inspection counts, not production-use evidence.
- `scripts/seed-business-memory.mjs` creates a synthetic corpus and can erase retrieval logs on reset. Never use seeded “verified” lessons/outcomes as proof of business results. Do not run the seed/reset script.
- Hosted migration history contains memory, Campaign learning and Growth branch-synthesis migrations. New PL/pgSQL still must be executed in hosted pgTAP; application code existence does not establish runtime correctness.
- No feature tests, paid AI runs, browser acceptance, migrations or deployments were performed by the research task. Documents are the deliverable.

## Implementation order after approval

Execute Tasks 00–07 first. They deliver the complete Channel loop, including source capture, operator decisions, context input, output references, provenance drawer, basic health and rollout controls. Tasks 02–05 alone are not a released feature.

Then execute Tasks 08–09 for Growth, Tasks 10–11 for Campaigns and the existing subject reader, Task 12 for complete operational/backfill coverage, and Task 13 for whole-flow acceptance. Each task has a review gate. Do not widen scope into deterministic Decision Engine ranking, graph storage, global event infrastructure or automatic artifact promotion.

## Load-bearing implementation traps

### Trust is not one boolean

Recording an operator plan does not verify the recommendation. Captured AI advice remains `ai_proposed/unverified`, never a fact. Recorded outcomes preserve their deterministic verdict. Reviewed lessons preserve their original scope/method/limitations. A human cannot make an inconclusive Campaign into evidence of success by pressing Confirm.

Spec 004's existing generic proposal path remains unchanged. The new exception is a source-identity-and-lease-bound projection operation that reloads committed records; it is not an endpoint accepting arbitrary AI text. Ordinary item verification must refuse captured recommendations/decisions.

### Current source state and captured history are different

Read current facts/goals/constraints/plans through their owners. The legacy `searchFacts` is lexical and exact-branch-filtered; it does not supply all organization defaults or current plans. A just-saved plan must be visible to the next pack even while its capture is pending.

Order revisions under a database source lock. Source revision 2 arriving after revision 3 cannot become current. Different months are historical windows, not automatic corrections. Use scoped current-state revision markers to detect relevant changes during a model call.

### Source lineage is mandatory

Do not fill `memory_items.source_run_id` with another module's run UUID; it belongs to the old ingestion provenance model. Use the proposed typed capture source references and composite tenant FKs.

A Channel recommendation and Growth recommendation repeating the same finding are not two supporting sources. Retain root ancestry, reject cycles, and cap traversal. Withdrawal and retention restrictions propagate to descendants, snapshots and embeddings. A memory write never triggers every intelligence feature to run again.

### Model and search disclosure are separate

Never add internal memory to a Google-search-enabled prompt. The proposed Channel memory-enabled path uses non-grounded narration with current findings and qualified reusable evidence. Keep the legacy path only when the new feature is disabled; historical grounded answer bodies are not automatically reusable memory. Paraphrasing those answers through another model is not a workaround.

Growth keeps every approved topic/competitor search slot. Public query text uses approved public fields only. Internal context can guide relevance and interpretation, but cannot become external support or expand approved research scope/budget. A configured API key is not source-reuse or processing qualification.

### Context references are not finding citations

Maintain existing current finding/market-claim evidence checks. Add `contextRefs` separately and validate them against the same attempt's persisted manifest. Update Zod and SQL allowlists together.

Channel currently has prompt version 8 and cap 8, with gap-fill of uncited findings. Preserve both. Recommendations added by different attempts need separate context associations; a single overwritten analysis-run manifest would misrepresent earlier answers. Do not invalidate deterministic analysis caches for every new memory.

### Preserve Campaign boundaries

Generation reads pinned snapshots through `load_campaign_generation_context`; attach context with that run/version provenance. New material revisions require normal approval. Memory cannot approve a Campaign, choose spend, override assertions, or send rejected creative bytes into final image generation.

`submitted_for_promotion` creates a pending reusable lesson; review is a different act. Campaign-only/dismissed proposals do not enter shared lesson retrieval. Lifecycle/outcome episodes can be shared at their own narrow meaning independently.

### RLS applies to copies too

Manifest snapshots must not preserve visibility after a source is withdrawn or the actor loses access. Test raw PostgREST/table reads as well as UI filtering. User routes use the session client. Worker factories must bind purpose, tenant, flags and current run/lease; do not use `createMemoryWorkspaceApi` with a service role.

### Delivery and tests

Capture intent is part of the source transaction. Projection completion commits item/links/status atomically. Verify lost receipts and duplicate work, not just happy-path task completion. A logger event after commit cannot provide this guarantee.

Use safe IDs/counts/codes in logs. Do not log raw source content or read `.env.local` into tool output. Every new PL/pgSQL function must execute at least once on staging. Direct SQL source mutations, schema changes or migrations cannot be tested with local Supabase here.

## Stop conditions

- Missing implementation approval: finish reviewable documentation; do not code.
- Proposed boundary changes beyond Spec 023: explain and seek approval before widening scope.
- No provider processing/reuse qualification: keep source content excluded and context lexical/evidence-only as specified. Do not invent terms or claim a paid canary passed.
- Missing browser credentials: run available tests and give the exact remaining walkthrough; do not claim authenticated browser acceptance.
- Unrelated baseline errors: record them separately and continue approved independent work; do not rewrite unrelated modules to make totals green.
- New/high-severity tenant, trust, disclosure or retention failure: do not enable the affected consumer until fixed and retested.

## Required completion report

Report the approved increment implemented, exact files and migrations, executed test totals and skips, source-to-capture and context-to-output evidence, provider/cost qualifications, browser acceptance status, remaining limitations and rollback settings. Update the collaboration board and spec status with facts. Do not claim the whole learning loop works because a worker returned `completed` or memory row counts increased.
