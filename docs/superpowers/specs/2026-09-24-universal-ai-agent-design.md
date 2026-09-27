# Design: Universal AI Agent Floating Shell (Quick / DeepThink)

## Status

Design approved in sections 1–5 on 2026-09-24 (brainstorming, architectural path, Approach 2 governed full build).
Worktree: `.worktrees/governed-channel-intelligence`, branch `staging`.
No implementation authorized by this document. Implementation requires a separate approved Execution Plan (writing-plans skill) before any Tier 2/3 code.

## 1. Goal

Add one floating text area at the bottom of five organization pages — Overview, Growth Intelligence, Campaigns, Channels, Business memory — that acts as a universal AI agent for that organization with HEAVY org context. It answers, runs one-time TinyFish research, maintains keep-monitoring watches, and hands campaign advice into the existing Campaign Bundle pipeline. History persists per organization.

Prototype reference: screenshot 1 in the request (dark floating box, `Ask anything…`, `+`, mode pill, `Voice`, send button, glowing border animation). Build the same visual language with slightly reduced overall height. Voice and `+` render but are inert in V1 (no recording, no upload).

## 2. Non-goals (V1 out of scope)

- Voice input/output, file attachments, image generation.
- Autonomous execution: no auto-publish, no spend reservation, no budget/policy changes, no approval grants, no provider writes from the agent.
- New forecasting models, new attribution, cross-organization learning from identifiable data.
- Live research calls during page render. Pages never call providers directly.
- Replacing Growth Intelligence, Channel Audit readers, campaigns, AppShell, or organization-management UI.
- Client-local-only history. History is server-persisted (see section 7).

## 3. Governing constraints (must hold)

- Advise freely, execute narrowly (ADR 0039). The agent recommends with citations; execution passes through deterministic fenced paths + Tool Gateway + policy checks + human approval.
- No god agent. The router classifies and routes only; bounded executors perform one intent each through existing fenced RPCs/workers. Models do judgment/interpretation/ranking/extraction/generation only; deterministic code owns leases, money, tenant scope, and state transitions.
- Tenant isolation at DB and app layers. Every read/write carries server-owned organization id. RLS on all new tables. Service-role only in workers with explicit org filters.
- Zod at every AI boundary (router output, Questionnaire answers, research/monitoring/campaign inputs, synthesis candidates).
- Realized-result claims forbidden without baseline + attribution method + window. Forward estimates labeled as estimates with inputs/assumptions on the same surface.
- shadcn/ui only for user-facing controls. Add missing primitives via `pnpm dlx shadcn@latest add`, never bare HTML controls for governed actions.
- Staging is shared and live on migration push. No `supabase start`, no local rehearsal. Migration review before push; `database.types.ts` narrow edit + drift test; new plpgsql reading tables it did not create must be called once against staging before done. `git push` is the user's step. Never `git stash`.

## 4. User stories

- As a member on any of the 5 pages, I ask in one box and get an org-grounded answer without losing my page.
- As an operator, I run DeepThink once and watch honest steps (queued → searching → grading → done/blocked) with a link to the GI research tab, while staying on my page.
- As an operator told Quick needs research, I get an inline nudge offering DeepThink upgrade, not a silent escalation.
- As an operator asking to keep watching competitors/prices/reviews, I get either a new recurring watch or, when a similar watch is active, a card offering View existing / Update fields / Start fresh anyway / Cancel.
- As an operator reading `Draft advice for your review`, I initiate campaign creation through the same pipeline opportunities use, or fall back to a pre-filled brief when ineligible.
- As a viewer, I get read-only answers only; governed actions are refused with clear copy.
- As a returning user, I reopen thread history from the floating box and see thread → research → synthesis → draft lineage with safe ids.

## 5. UX design

### 5.1 Floating shell (all 5 pages)

- Mounted in the organization workspace layout, rendered only on Overview, Growth Intelligence, Campaigns, Channels (`/channels`, `/channels/[channelId]`), Business memory (`/memory`). Hidden on onboarding, invitation, auth, marketing, Telegram review.
- Visual: dark floating panel, bottom-centered, max-width constrained, reduced height vs prototype (single-line input + compact control row). Glowing animated border (same hue language as prototype; respect `prefers-reduced-motion` by rendering static glow). Placeholder `Ask anything…`.
- Controls: `+` button (inert, tooltip "Attachments coming soon"), single mode pill (default `Quick`, option `DeepThink`; implemented as shadcn `Select` or `ToggleGroup` per form rules — 2 options use ToggleGroup), `Voice` button (inert, tooltip "Voice coming soon"), send button (icon, `Spinner` + disabled while routing/sending).
- Behavior: Enter sends, Shift+Enter newline. Send immediately opens/expands the drawer, appends user message to the active thread, shows router Marker (`role="status"` + `Spinner`, shimmer while streaming). Empty state shows 3 safe suggestion chips (memory-only examples, never fake data).
- Accessibility: labeled input, real buttons, focus moves to drawer on send with announce; Esc collapses drawer to strip; keyboard navigable history.

### 5.2 Drawer (bottom sheet over the shell)

- Opens on send from the bottom of the floating box. Persists across the 5 pages within the session (thread state hoisted above page switches; research progress continues via polling). Collapses to a single-line status strip docked on top of the textarea (title/summary + state dot + Spinner when running); click toggles expand/collapse. Same language as modern harness task strips.
- Tabs: `Response` (answer + citations + limitations + Questionnaire cards inline), `Steps` (Marker list, always visible inline in marker language, no collapse control), `Draft advice for your review` (campaign advice + initiate/save buttons), `History` (thread list + reopen). Mobile: full-width sheet; desktop: centered panel matching shell width.
- Steps use installed `Marker` (`src/components/ui/marker.tsx`): `Marker` + `MarkerIcon` + `MarkerContent`. In-progress steps set `role="status"` with `Spinner`; streaming text uses shimmer utility; labeled dividers (dates, sections) use `variant="separator"`; row boundaries use `variant="border"`; the GI research link uses `render={<a href="...">}` so it is a real focusable link. Decorative icons stay `aria-hidden`; icon-only Markers carry `aria-label`.
- Clarifications use `Questionnaire` (NOT installed — add via `pnpm dlx shadcn@latest add questionnaire` in implementation plan): single/multi/freeform + skip, `QuestionnaireProgress`, Zod-backed custom validation returning to the invalid item, controlled active item for resume, conditional items (e.g. cloud env question pattern reused for schedule fields). Host (drawer) owns close/cancel/persistence/transport/branching; Questionnaire owns order/answers/validation/navigation.
- Answer rendering: `Message`/`Bubble` primitives are NOT installed. Implementer may either add (`message`, `message-scroller`, `bubble`, `attachment` for future) via CLI or compose from existing `Card`/`Button`/`Skeleton`/`Badge`/`Separator`. Do not hand-roll scroll anchoring if `MessageScroller` is added — it owns streaming follow + jump-to-latest.
- Forms inside drawer follow shadcn form rules: `FieldGroup` + `Field`, `data-invalid` on `Field` + `aria-invalid` on control, `InputGroup` uses `InputGroupInput`/`InputGroupTextarea`, option sets of 2–7 use `ToggleGroup`, `FieldSet` + `FieldLegend` for radio/checkbox groups, icons in buttons use `data-icon` with no sizing classes, `size-*` for equal dimensions, `flex gap-*` never `space-x/y`, semantic colors only, `cn()` for conditionals, no manual z-index on overlays, `Dialog`/`Sheet`/`Drawer` always include Title (sr-only if hidden).

### 5.3 History

- History icon on the shell opens `History` tab: thread titles/summaries, mode badge (`Quick`/`DeepThink`), status, updated time, linked ids (research project/report, draft request/campaign). Reopen restores messages + Questionnaire saved answers + Marker receipts. Retention purge removes bodies on schedule; content-free audit remains.

## 6. Modes

Single pill, `Quick` default.

- `Quick` = memory + deterministic context only. No research spend, no new requests, no writes. If the router judges research is needed (high/medium confidence), a caller holding `growth_intelligence.manage` auto-escalates to DeepThink zero-click — server-owned mode flip, `DEEPTHINK_AUTO_ESCALATED` reason code, no confirmation card (ADR 0074; reverses confirm-before-spend for L1/L2). Callers without the grant stay Quick with an honest note; viewers stay read-only.
- `DeepThink` = memory + economics read + synthesis + one TinyFish background run when needed (see section 8). Requires `growth_intelligence.manage`; without it the pill is disabled with explanatory tooltip and Quick remains. Threads reach DeepThink via the mode menu or via zero-click auto-escalation from Quick (§8).

## 7. Threads schema (new, minimal)

New tables `agent_threads`, `agent_messages` (names final in implementation plan; migration slug `agent_threads_and_messages`):

- `agent_threads`: id (uuid pk), organization_id (fk, not null), title (text, generated from first message, editable), mode (`quick`/`deepthink`), status (`open`/`awaiting_user`/`running`/`completed`/`cancelled`), linked_research_project_id (nullable fk), linked_request_id (nullable fk), linked_draft_request_id (nullable fk), linked_campaign_id (nullable fk), created_by (uuid), created_at/updated_at timestamptz. Unique (organization_id, id). Index (organization_id, updated_at desc).
- `agent_messages`: id (uuid pk), organization_id (not null), thread_id (fk cascade delete), role (`user`/`assistant`/`system_note`), body (text), questionnaire_answers (jsonb, nullable, validated), marker_receipts (jsonb, nullable: step states + safe ids), citations (jsonb, nullable: claim/source ids + digests), created_by, created_at. Unique (organization_id, id). Index (organization_id, thread_id, created_at).
- RLS forced, member select/insert/update per org role (viewer read-only; operator+ write own threads; admin/owner manage). Member mutations via fenced RPCs with idempotency keys (`create_agent_thread_keyed`, `append_agent_message`, `set_thread_links`); worker link updates via service-role fenced RPC with claim token. Deletes forbidden except retention purge function (service-role, content-free audit retained).
- `database.types.ts` hand edit + `UNTYPED_TABLES` drift compliance. pgTAP suite `agent_threads_test.sql`: membership isolation, cross-org invisibility, replay idempotency, retention purge, worker fencing. New plpgsql reading existing tables called once against staging before done.
- Events: `agent_thread.opened`, `agent_message.appended`, `agent_thread.routed`, `agent_thread.research_triggered`, `agent_thread.watch_created`, `agent_thread.draft_requested` (identifier-only payloads + correlation id).

## 8. Router layer (reusable platform layer)

Purpose: a small light model sits between the user message and real workflows. It understands the message, then either asks via Questionnaire to accumulate context before routing, or routes directly when clear. It never executes.

- Location: `src/modules/agent-router/` (domain: intents + contracts; application: router service; infrastructure: light-model provider via Vercel AI SDK `generateObject` with strict schema). Reusable import for future areas (reports, campaigns, onboarding).
- Input (Zod strict): message text (trimmed, length-capped), page key, thread history digest, deterministic context digest (section 9), active-watch candidates (safe ids + scope fingerprints only, no customer data), caller role/permissions.
- Output (Zod strict): intent enum (`answer_memory` | `research_once` | `watch` | `campaign_advice` | `profile_scope_change`), confidence (`high`/`medium`/`low`), missing-fields list (max 3, from a closed vocabulary: frequency, branch, research_area, competitors, end_date, evidence_window), routing note (full context for the executor), questionnaire spec (nullable: items + resume key), safe reason codes. Low confidence → ask, never guess. Medium confidence → act with the assumption stated inline in the routing note. Business-critical policy never lives only in the prompt; intent→executor mapping is deterministic code.
- Questionnaire triggers: (a) Quick message needing research → zero-click auto-escalation for manage-holders, no card (the `deepthink_upgrade` nudge is deprecated; old rows still parse); (b) vague message → 1–3-field clarify card; (c) `watch` with similar active scope → duplicate-watch card (section 10); (d) `campaign_advice` missing evidence window → window picker card. Answers merge into the routing note; validation failures return to the invalid item with `QuestionnaireError`.
- Model: light/cheap provider via existing `src/ai` abstraction (`AI_DEFAULT_MODEL` override `AI_ROUTER_MODEL` if set). Time-bounded, token-capped; failure → fail-closed to `answer_memory` with honest limitation note. No credentials, no customer PII beyond the note, no raw provider payloads retained.
- Logging: intent + confidence + reasons + correlation id; runIds loggable, bodies never logged.

## 9. HEAVY organization context pack (deterministic, read-only)

Built per message by deterministic readers only; digested into the router note and answer citations. Never a live web call. Oversized → refuse with safe code, never silently trim.

- Business identity: BusinessProfile + confirmed facts (source-aware, verified-first).
- Goals/constraints/policies: active goals, constraints, access/spend policies, capability blocks relevant to the message.
- Governed evidence 30–60 days: ledger-bound exact ranges in branch timezone (default 30 days; 60 when the message needs seasonality and evidence qualifies). Missing periods are gaps, never zeros.
- Market Profile current version: niche, public identity, geo scopes, competitors, topics, source rules, disclosure limits + version digest.
- Memory hits: scoped retrieval (facts/documents/decisions/outcomes), provenance + freshness attached.
- Economics readiness: availability/quality tier only (never workbook values as amounts unless the readiness model permits display).
- Recent timeline: decisions/approvals/executions/outcomes with activity vs evidence dates distinguished.
- Page context: current page key + safe ids (no user-controlled tenant inference; scope stays server-owned).

## 10. Research once + keep monitoring (TinyFish lane)

### 10.1 One-time (`research_once`, DeepThink)

- Binds the current approved Market Profile version + digest. Creates one `market_research`-family request (or research project update in the projects/reports model — implementer maps to the live table in this tree: `growth_intelligence_requests` vs `growth_intelligence_research_projects`; both converge identically-scoped starts via fingerprints + idempotency keys) with thread-linked idempotency key (`agent_thread:<threadId>:<messageDigest>`).
- Executes on the staged TinyFish lane only: `createQualifiedTinyfishResearchAdapter` assembly (search + agent fallback lanes), reserve-before-call budget (`reserve_request_budget` then per-attempt `reserve_attempt`/`settle_attempt`), staged qualification RPC (`check_research_provider_qualification_for` tinyfish), gates (`TINYFISH_SEARCH_API_KEY` present, `TINYFISH_MARKET_RESEARCH_ENABLED === "true"`), bounded queries (profile scope only: public name, domains, niche, city, country, topics; never org/branch ids, customer data, report values, source text, model instructions).
- Drawer streams immediately: Marker steps (queued → claimed → searching (per-dimension honest status) → grading → synthesis → done/blocked), synthesis preview with citations, hyperlink Marker to the GI research tab (project/report/request id). Polling via TanStack Query on leased rows; answers render poll-rendered from durable assistant rows (no token-streaming endpoint — see ADR 0071). No live provider call from the page.
- Replay safety: identical re-click returns kept rows (`replayed: true`); terminal rows never reopen; lost dispatch recovered by sweeper reading the due index + cooldown, never worker memory.
- Agreement basis: `tiny-fish-agreement.txt` ACTIVE (v1.3.0, 2026-09-20→2040-09-19, all six uses granted, $0 unlimited, training opt-out CONFIRMED). Contract doc `docs/provider-contracts/market-research-v1.md` still says blocked — stale; implementation plan must update it to the TinyFish lane (Brave stays ephemeral-preview only, Exa out).
- Answer rendering: the durable body renders as natural paragraphs with numbered `[n]` citation superscripts (hover/focus Tooltip carries claim + source); the Sources list sits outside and below the synthesis card, Limitations compact beneath it, Estimates labeled with inputs + assumptions on the same surface; legacy stored-context header blocks are stripped at the parse boundary so reopened history renders once.

### 10.2 Keep monitoring (`watch`)

- Router checks `growth_intelligence_monitoring_active_scopes` fingerprint + open projects for similar purpose (same/overlapping dimensions: investigation areas, named competitors). No similar active → create via `create_research_project_keyed` with mode=`recurring`, cadence daily/weekly/monthly + localTime + timezone + optional endDate, branch, areas (1–5, unique), competitors (unique names, valid public URLs), idempotency key. Thread links to project + first update; drawer + GI project row both track it.
- Similar active found → pause creation, show duplicate-watch Questionnaire card: View existing (link Marker to GI project) / Update fields (Frequency, Branch, research area, Competitors, end date) / Start fresh anyway (explicit confirm, mints second project with distinct fingerprint) / Cancel. Field edits validate like `new-research-dialog` (same option model, same error copy: mode required, cadence required when recurring, competitor URL rules, uniqueness).
- Scope rule: Frequency/Branch/end-date edits update the watch in place (fenced update RPC). Adding a new competitor/topic is `profile_scope_change`: opens a Market Profile proposal (`market-profile/proposals` + approve flow); recurring runs on the widened scope start only after operator approval. Recurring never silently widens scope.
- Coverage honesty: every requested dimension reports exactly one status (`supported`/`unavailable`/`not-found`/`not-researched`); research failure backfills `unavailable` with safe reason codes; no empty settlements.
- Permissions: create/update need `growth_intelligence.manage`. Viewers see existing watches read-only.

### 10.3 Blocked/degraded

- Missing qualification, closed gate, missing credential, failed canary, unsafe target, budget exhaustion → fail-closed with safe reason codes + operator-readable copy (existing `BLOCKER_COPY` pattern). Drawer shows internal-evidence-only synthesis labeled with limitations + blocked Marker + GI link. Zero invented external claims. Unknown costs stay reserved, never zeroed.

## 11. Campaign advice handoff (`Draft advice for your review`)

- Drawer tab renders advice with citations, exact evidence window, limitations, cost/impact inputs labeled estimate with assumptions on the same surface. Buttons: primary initiates campaign creation; secondary saves to Recommendations (manual outside-platform action with plan/snooze/dismiss semantics, never auto-completed).
- Eligibility is deterministic: `campaign.create` permission + qualifying readiness (evidence snapshot freezable, Market Profile bound, policy/capability/schedule/audience checks pass). Eligible → atomic `request_campaign_draft_from_opportunity`-family path (or its thread-advice equivalent in the implementation plan): claim/lease, frozen evidence snapshot, idempotency key, `campaign_draft_requests` row, thread→request→Campaign link. Drawer Markers track requested → claimed → draft-ready + link to the Campaign Bundle review.
- Ineligible → pre-filled `/campaigns/new` brief (same pipeline Decision Engine opportunities enter: `NewCampaignBrief` + qualification service + immutable Bundle versions). No silent upgrade.
- Fences: draft creation is never approval, never publishes, never spends/reserves, never moves money. Approval binds one exact Bundle version + digest (+ actions, capability/policy versions, schedule/audience, attestations, expiry, spend ceiling) in Studio/Telegram review; material edits invalidate approval and require a new version. Campaign-scoped learning stays a separately governed proposal.
- Audit: draft request/response ids + correlation across thread, GI rows, and campaign.

## 12. Permissions matrix (V1)

- Quick ask + history reopen: any org member (viewer read-only answers, no actions).
- DeepThink research/watch create/update + retry: `growth_intelligence.manage`.
- Campaign draft initiate: `campaign.create` (approval wording/authority never reused; approval needs `campaign.approve` elsewhere).
- Market Profile proposal approve: existing profile approvers (operator confirm flow; recurring never self-approves scope).
- Enforcement in page loader + every API route + every worker/RPC (policies recheck current role; navigation visibility is not authorization).

## 13. Error handling

- Router failure/low confidence → `answer_memory` with honest limitation + offer to retry as DeepThink.
- Research blocked/failed → degraded synthesis + blocked Markers + GI link + retry affordance (permission-gated, idempotent).
- Duplicate idempotency-key body mismatch → conflict error with View-existing link, no second project.
- Lease expiry/orphans → sweeper + `expire_stale_*` path marks `failed/WORKER_ORPHANED`; terminal parent never reopens; fresh uploads/messages spawn fresh requests.
- Validation errors → inline `QuestionnaireError` + focus management; ineligible campaign → prefilled-brief fallback with reason.
- All errors log with org/thread/request/correlation ids; bodies never logged; secrets never logged/persisted.

## 14. Observability

- Structured logs with organizationId, threadId, request/project/update ids, correlationId, provider lane, safe reason codes, integer-micros cost, latency.
- Research budget ledger refs on every attempt (reserve/settle); unknown stays reserved.
- Timeline/audit chain: thread → request/project → synthesis → advice → draft request → campaign, all identifier-linked.

## 15. Testing plan (implementer must satisfy)

- Zod contract tests: router intents, Questionnaire specs/answers, context digests, research/monitoring/campaign inputs, synthesis candidates.
- pgTAP (`supabase/tests/database/agent_threads_test.sql` + existing GI suites): RLS isolation (member sees own org only, cross-org invisible), replay idempotency, claim/lease fencing, retention purge, worker fencing, first-call proof for any new plpgsql reading existing tables.
- Worker tests: once/watch/campaign paths with truthful blocked lanes (unqualified → blocked baseline, zero spend), budget reserve/settle, fingerprint convergence, coverage backfill on failure.
- UI tests: shell on 5 pages only; drawer open/collapse/persist across pages; Marker steps + shimmer + separator + link render; Questionnaire validate/resume/conditional/skip; history reopen; voice/`+` inert tooltips; permission-gated buttons; reduced-motion glow.
- Manual staging proof: dev-org thread → DeepThink once → blocked-or-live lane per gates → GI link resolves → advice → draft-or-brief path, all with safe ids (no direct DB deletes; `storage.objects` assertions expect SKIP on hosted).

## 16. Rollout & rollback

- Org allowlist flag (pattern: `INTEGRATION_HUB_V1_ORGANIZATION_IDS` / GI increments), enforced in loader + API + worker. Default off.
- Migrations reviewed before `db:migrations:push` (user's step); no local rehearsal. `database.types.ts` narrow commit + drift test green. Trigger deploy out of scope for the design task.
- Rollback: flag off; cancel pending thread-linked non-terminal requests via privileged cancel RPCs; terminal rows stay terminal; retention purge continues on schedule.

## 17. Reuse map (where the code lives in this tree)

- Shell/pages: `src/app/(platform)/organizations/[organizationId]/` + `overview/page.tsx`, `growth-intelligence/page.tsx`, `campaigns/page.tsx`, `channels/page.tsx`, `channels/[channelId]/page.tsx`, `memory/page.tsx`; layout/sidebar in `src/components/layout/`.
- Chat UI: `src/components/ui/marker.tsx` (installed), `questionnaire` (add), `dialog`, `sheet`, `field`, `radio-group`, `select`, `input`, `textarea`, `button`, `badge`, `skeleton`, `spinner`, `sonner`, `scroll-area`, `tabs`, `separator`, `switch`, `tooltip`.
- Research option model + validation copy: `src/components/growth-intelligence/new-research-dialog.tsx`, `organization-competitors.ts`, `schedule-fields.tsx`, `query-options.ts`.
- Project/watch list + rows: `market-watch-projects.tsx`, `research-project-row.tsx`, `project-overview-dialog.tsx`, `report-reader.tsx`, `source-evidence-drawer.tsx`, `market-watch-live-preview.tsx`.
- Router home (new): `src/modules/agent-router/` reusing `src/ai/*` (`provider.ts`, `model-router.ts`, `telemetry.ts`) + `ai` SDK `generateObject`/`generateText`.
- Context readers: Digital Twin/organization module, goals/constraints/policies routes, governed ledger readers, `profile-service` + `profile-repository`, memory search/timeline routes, economics-readiness route, growth-intelligence `read-service`/`market-watch`.
- Research lane: `src/modules/growth-intelligence/infrastructure/research/` (`qualified-provider.ts`, `qualification.ts`, `tinyfish-search-adapter/transport`, `tinyfish-agent-adapter.ts`, `budget-repository.ts`, `retention-repository.ts`, `query-plan.ts`, `claim-extraction.ts`, `claim-support-review.ts`), `src/trigger/growth-intelligence-tinyfish.ts`, `src/workflows/growth-intelligence/` (`run-market-research.ts`, `dispatch-due-work.ts`, `consolidate-market-evidence.ts`, `run-synthesis`).
- Monitoring lifecycle: `supabase/migrations/20260914054733*`, `20260915*scope_release*`, research projects/reports `20260913202720*`, competitors `20260922090000*`, agent lane opt-in `2026092119*`, TinyFish qualification `2026091912*`, `2026092013*`, `2026092014*`, `20260920154*`.
- Campaign path: `src/app/api/organizations/[organizationId]/opportunities/[opportunityId]/campaign-draft/route.ts`, `campaigns/route.ts`, `campaigns/new/page.tsx` + `NewCampaignBrief`, `campaign-draft-action.tsx`, `campaign_draft_requests` migrations + pgTAP, Tool Gateway + approval envelopes (ADRs 0015/0017/0018/0019).
- Agreement: `tiny-fish-agreement.txt` (ACTIVE). Stale doc to fix in plan: `docs/provider-contracts/market-research-v1.md`.

## 18. Open assumptions (explicit, not silently resolved)

- Evidence window default 30 days, 60 when seasonality needed and evidence qualifies — implementer confirms exact horizons per reader.
- Thread retention period: propose 90-day bodies + content-free audit retained; needs owner sign-off in plan.
- Exact new RPC names (`create_agent_thread_keyed`, etc.) are proposals; plan finalizes against existing fenced-RPC conventions.
- Whether `Message`/`Bubble`/`MessageScroller` primitives are added or composed from existing components — plan decides (shadcn rule: use primitives for chat; adding is allowed via CLI).
- TinyFish lane is the production research provider; Brave stays ephemeral-preview; Exa stays out. Plan updates the stale provider-contract doc accordingly.

## 19. Risks

- Scope creep into god-agent autonomy → contained by router-never-executes + fenced executors + permission rechecks + plan approval gate.
- Stale docs (`market-research-v1.md` blocked) misleading implementers → plan must update contract + qualification references first.
- Shared staging collisions (parallel pgTAP, orphan runs) → idempotency keys, fingerprints, leases, sweeper recovery, no direct deletes.
- Long-running agent runs outliving UI session → drawer polling + thread resume + terminal-state honesty cover it.
- Cost overrun on research → reserve-before-call + per-attempt caps + pipeline quote + qualification gates; unknown stays reserved.

## 20. What the implementer does next

Invoke the writing-plans skill to produce the Execution Plan (bullet points only, no code blocks): impacted files per slice, schemas/migrations/RPCs/events/exports, blast radius (callers, RLS, consumers, background tasks), assumptions, tenant-isolation verification, risks + rollback. Then implement the smallest production-complete vertical slice first (shell + threads + Quick memory answer), followed by DeepThink once, watch + duplicate card, and campaign handoff — each gated and demoable.
