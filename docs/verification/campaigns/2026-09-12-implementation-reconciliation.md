# Campaign experience implementation — reconciliation record

**Date:** 2026-09-12. **Author:** Task 0 of
`docs/superpowers/plans/2026-09-12-campaign-experience-implementation.md`.
**Nature:** governing-document reconciliation. No feature code, migration, deployment or provider call
was produced or executed by this task.

## 1. Baseline

- Worktree: `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`.
- Branch: `feat/governed-channel-intelligence`. Main branch for PRs: `main`.
- HEAD at start: `c48a37bfc9b07c1102d5c470a7aa21b01d1f4c4d` — "chore: baseline WIP commit of in-flight
  work before Campaign experience rework". **This commit is preserved. It is not reverted.** It
  contains the previously uncommitted Campaign, Memory, Home, configuration and documentation work
  that the 12 September audit inspected as a dirty tree against `e122d374`.
- `git status` at start, unchanged by this task apart from the files it created or amended:
  - modified: `.cursor/mcp.json`, `opencode.json`, `tsconfig.tsbuildinfo`
  - untracked: `supabase/.temp/cli-latest`, `supabase/tests/database/zz_scratch_debug_test.sql`
  - These are pre-existing and unrelated. They were left alone.
- Recent commits: `c48a37b`, `e122d37` (home prototype copy), `5acf356` (swarm1 channel pack reads),
  `d42e127` (Growth Top Recommendations), `1e452b3` (board entry).

## 2. What this record could not verify, and why

State this plainly rather than guessing:

- **No database access in this dispatch.** The Supabase MCP server failed to connect
  (`CONNECT_TIMEOUT`), and this task did not run `pnpm db:migrations:list`, `:dry-run` or `db:test`.
  Every "staging-applied" cell below is therefore **unverified in this dispatch**, carried from the
  12 September audit's read-only hosted inspection or marked unknown.
- **No Trigger.dev access.** The Trigger MCP server also failed to connect. Every "worker-deployed"
  cell is unverified in this dispatch.
- **No browser verification.** No Chrome DevTools session was run; no UI claim here is a live claim.
- **No test execution.** This task ran no Vitest, typecheck, lint or build. Source-status cells below
  record file existence and inspected content, not a green suite.
- **No Meta account and no provider evidence.** No provider capability is qualified or re-verified.

## 3. Delivery status uses four separate fields

- **source** — exists on this branch, content inspected.
- **staging-applied** — migration applied to hosted staging and its pgTAP suite ran there.
- **worker-deployed** — Trigger.dev task deployed to the cloud project and registered.
- **live-verified** — a real controlled-account result proves the behavior end to end.

A later field may never be inferred from an earlier one. A deployed worker and a completed empty
sweep satisfy neither staging-applied nor live-verified.

## 4. CP1 Creative History correction — task by task

Reconciled against `docs/superpowers/plans/2026-09-09-creative-history-asset-library-correction.md`
and actual files.

| CP1 task | Source | Staging-applied | Live-verified | Evidence |
| --- | --- | --- | --- | --- |
| 1 — Reconcile governing documents | **Yes** | n/a | n/a | `adrs/0049-...md` exists, Accepted 2026-09-09. Spec 019 status carries "corrected in part 2026-09-09" and names ADR 0049; Spec 020 carries the "Creative History boundary corrected 2026-09-09" block. Board entries exist. |
| 2 — Strict domain contracts and selector | **Yes** | n/a | Not verified | `src/domain/campaigns/creative-history.ts`, `creative-history-selector.ts` and both `.test.ts` files exist (dated 9 Sep). The audit's focused run of `creative-history-selector.test.ts` passed within its 38-test/5-file baseline; not re-run here. |
| 3 — Core schema and governed write paths | **Yes** | **Reported present, not re-verified** | Not verified | `supabase/migrations/20260909124757_creative_history_core.sql` and `supabase/tests/database/creative_history_core_test.sql` exist. The 12 Sep audit reports migration `20260909124757` present in staging; no database access in this dispatch to confirm. |
| 4 — Application, private storage intake, routes | **No** | n/a | n/a | No `creative-history-service.ts` in `src/modules/campaigns/application/`, no `creative-history-repository.ts` in `infrastructure/`, no `/assets/creative-history` routes. Directory listings inspected in full. Matches audit F05. |
| 5 — Unified Asset Library surface | **No** | n/a | n/a | Tabs remain References / Campaign output / Dishes per audit F05. `AssetUpload` is referenced only by its own test; `asset-workspace.tsx` never mounts it (F03). `assets/page.tsx` maps every reference to `previewUrl: null` (F04). |
| 6 — Pin selection receipts before model spending | **No** | **No** | n/a | No receipt migration exists: the only `creative`-named migrations are `20260817100000_campaign_creative_variants`, `20260826090000_campaign_creative_studio` and `20260909124757_creative_history_core`. |
| 7 — Blueprint-only rejected evidence at the provider boundary | **No** | n/a | n/a | `src/ai/campaign-generation-provider.ts` lines 33 and 98 still type `references` as `readonly CampaignImageReference[]`, and line 44 keeps `"avoid"` in that union. `finalImageReferenceSchema` exists and rejects `role: "avoid"` in its own test, but is not the runtime port. `src/domain/campaigns/reference-resolution.ts` still constructs `role: "avoid"` (lines 159, 481). Matches audit F06. |
| 8 — Link finished Studio designs, safe backfill | **No** | n/a | n/a | No linkage path found; depends on task 4. |
| 9 — End-to-end staging and browser acceptance | **No** | n/a | n/a | Not started. |

**Summary:** CP1 tasks 1–3 are delivered in source (task 3's staging application reported by the
audit, not re-verified here). CP1 tasks 4–9 are not started. The approved correction is therefore
**partially connected**, exactly as audit finding F05 states.

## 5. Spec 023 Business Memory — task by task

Reconciled against `docs/superpowers/plans/2026-09-10-business-memory-shared-intelligence.md`
(Tasks 00–13) and actual files.

| Spec 023 task | Source | Staging-applied | Worker-deployed | Evidence |
| --- | --- | --- | --- | --- |
| 00 — approval record and baseline | **Yes** | n/a | n/a | `docs/verification/memory/shared-intelligence-baseline.md` records HEAD `96edd78`, approvals of 2026-09-11, the grounded-search HOLD, and retention decisions. |
| 01 — pure contracts and fixtures | **Yes** | n/a | n/a | `src/domain/memory/{capture,context,trust,freshness,permissions,purposes,grounded-share,schemas,types}.ts` with tests. |
| 02 — capture storage, source identity, settings | **Yes** | **Reported applied** | n/a | `capture-repository.ts`; migrations `20260911104742/104746/110537/110954/123709`. Audit reports `20260912*` absent from staging but not the `20260911*` set. |
| 03 — leased projection, scheduling, repair | **Yes** | **Reported applied** | Not verified | `src/workflows/memory/capture-dispatch.ts`, `workers.test.ts`, `src/trigger/memory.ts`; commits `3d0af94`, `6f59333`, `2a4e3ff`. |
| 04 — context manifests and snapshots | **Yes** | **Reported applied** | Not verified | `context-repository.ts`, `erase-source-content.ts`; migrations `20260911144805` plus four named repairs through `20260911165140`; commits `e357ba6`, `3136228`, `75ea327`, `d4653ac`. |
| 05 — context assembly and current-state adapters | **Yes** | n/a | n/a | `context-selection.ts`, `context-renderer.ts`, `context-service.ts`, `current-state-reader.ts`, all with tests. |
| 06 — Channel source capture and decisions | **Yes** | **Reported applied** | Not verified | Migrations `20260911112812/112817/112823`, `20260912030945_business_memory_channel_contexts`. |
| 07 — Channel reads, citations, provenance UI | **Yes** | **Unknown** | n/a | `src/components/memory/context-used.tsx`, `integration-health.tsx`, `provenance-badges.tsx`; `application/health-service.ts`; commit `5acf356` "channel pack reads, provenance, drawer, health and settings routes". Whether `20260912030945` is applied was not verified. |
| 08 — Growth capture and retention propagation | **Source only** | **NOT APPLIED** | Not verified | `supabase/migrations/20260912120000_business_memory_growth_capture.sql` exists (enqueue/project functions plus `complete_market_research_pipeline`, `complete_growth_intelligence_synthesis`, `decide_growth_intelligence_item`). The audit reports the local `20260912*` Memory migrations absent from staging. |
| 09 — Growth research brief, synthesis context, UI | **Yes** | **Partly — unknown** | Not verified | Commit `262ca3b` "research brief, synthesis context refs, item contexts"; migration `20260912090000_growth_intelligence_item_contexts.sql` present in source, application unverified. |
| 10 — Campaign lifecycle, outcome, learning capture | **Source only** | **NOT APPLIED** | Not verified | `20260912130000_business_memory_campaign_capture.sql` exists: `enqueue_memory_campaign_state/outcome/lesson`, matching projectors, and triggers `memory_campaign_state_on_version`, `memory_campaign_outcome_on_settle`, `memory_campaign_lesson_on_submit`. No `src/` code references it, because it is entirely SQL — source presence is not staging presence. |
| 11 — Campaign generation/revision context and subject consumer | **Partial** | **NOT APPLIED** | Not verified | `20260912140000_business_memory_campaign_context_usage.sql` defines `public.load_campaign_generation_context`. `src/modules/campaigns/infrastructure/generation-readers.ts` is the only Campaign file referencing a context manifest. Audit F17 records that the rendered generation prompt **names the digest rather than supplying selected entry contents** — so the consumption half of this task is not proved. |
| 12 — health, operator controls, bounded legacy admission | **Partial** | **Unknown** | Not verified | `health-service.ts` and `integration-health.tsx` exist from Task 07's early delivery. No `scripts/backfill-business-memory-capture.mjs` found. |
| 13 — full verification, canary, documentation, release | **No** | n/a | n/a | Not started. No `docs/verification/memory/` release record beyond the baseline and the legacy corpus inventory. |

**The three pending migrations** are `20260912120000`, `20260912130000` and `20260912140000`. Because
`pnpm db:migrations:push` is all-or-nothing, pushing any new Campaign migration during this
implementation run would carry all three to staging. **No migration is pushed during this run without
a separate explicit user decision.** Every Campaign task that adds schema may therefore reach
**source** status only.

## 6. Immutable proposal → bundle linkage

- A **campaign proposal version** is immutable and digest-bound: `campaign_proposal_versions` stores
  the strict document, its digest, the bound source revision manifest, the creator identity and an
  increasing version, unique on `(organization_id, proposal_id, version)`. Document and digest never
  change after insert.
- **Decisions are append-only.** `campaign_proposal_decisions` names the proposal version and its
  digest, the actor from auth context, the decision, an optional reason, and the timestamp. The
  read model derives proposed-versus-approved labels from the decision log, never from a mutable flag
  on the document.
- **Approval is one atomic transaction** that rechecks role, exact current version and digest, source
  freshness, eligibility and preparatory cost limits; appends the decision; establishes exactly one
  campaign link; and saves the generation intent. A duplicate request replays the committed result;
  different content under the same idempotency key is refused.
- **The linkage is one-directional and permanent.** Campaign source kinds gain `campaign_proposal`
  with a `proposal_id` and a check requiring exactly the appropriate source link. A qualified Decision
  opportunity is never manufactured and `manual_brief` is never misused to avoid that amendment.
  Existing manual and Decision campaigns remain readable.
- **Bundle provenance links to the exact proposal version and digest.** The approved proposal owns
  intent until preparation; the immutable bundle and launch set own exact authorized execution.
  Neither can independently change offer, audience, channels or budget. New evidence that materially
  changes those terms requires a new proposal revision and a new approval — not an edit.

## 7. V2 / V3 manifest compatibility rule

- **Authorized by the controller for this implementation run, 2026-09-12:** campaign bundle manifest
  **version 3** may be introduced for finished-deliverable identity, **conditional on a V2 backward
  reader shipping in the same change**.
- Existing `schemaVersion: 2` records, their digests, renders, approvals, reference receipts and
  outcomes remain **readable and unmodified**. Legacy launch eligibility for them is explicit, or the
  path fails closed — never implied.
- **No data is deleted.** ADR 0020's note that "there is no `schemaVersion: 1` reader" and that
  pre-production bundles were repaired forward is a record of one past act taken while no execution
  history existed. It is not a precedent and must never be repeated as a migration step. Any future
  manifest version ships with a backward reader for the version it succeeds.
- Migrations are additive and forward-only. `database.types.ts` is hand-maintained; every new table is
  either typed there or listed with its reason in `UNTYPED_TABLES`.

## 8. Acceptance checklist — every audit finding mapped to its owning tasks

Status legend per finding: **src** = implemented in source; **stg** = applied to hosted staging;
**wrk** = worker deployed; **live** = proved by a real controlled-account result. `—` = not
applicable to that finding. All four fields start unmet for every finding; Task 0 moves none of them.

| Finding | One-line summary | Owning task(s) | src | stg | wrk | live | Gate notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | Expired Meta contract crashes internal generation before its lifecycle starts | **Task 1** | ☐ | ☐ | ☐ | — | Contract `expiresAt = 2026-09-10` must NOT be extended. Repair by real reverification only. |
| F02 | Trigger FAILED vs domain run still `queued`, attempt 0 | **Task 1** | ☐ | ☐ | ☐ | — | Needs a preclaim/bootstrap failure RPC; stg blocked by the migration decision. |
| F03 | No usable frontend upload journey | **Tasks 2, 3** | ☐ | ☐ | — | ☐ | live = authenticated browser upload → finalize → preview. |
| F04 | Library shows no actual visual work (`previewUrl: null`) | **Tasks 2, 3** | ☐ | ☐ | — | ☐ | Private previews are session-authorized with bounded expiry. |
| F05 | Approved Creative History correction only partly connected | **Tasks 2, 3** | ☐ | ☐ | — | ☐ | CP1 1–3 done; 4–9 outstanding (section 4). Reuse existing schema. |
| F06 | Final image path still accepts rejected-image bytes | **Task 4** | ☐ | — | — | ☐ | Proof is the actual adapter payload, not a type test. ADR 0049 cutover. |
| F07 | Growth Intelligence campaign proposal section drifted | **Task 7** | ☐ | — | — | ☐ | Restore the named section; no prototype data in production. |
| F08 | Proposal admission has two paths, neither is the research loop | **Tasks 5, 6, 7** | ☐ | ☐ | ☐ | — | D07 applies here only. Generic Decision execution admission unchanged; regression required. |
| F09 | The first full-proposal approval is missing | **Tasks 5, 7** | ☐ | ☐ | — | — | Gate 1 per ADR 0057. Manual briefs enter the same proposal review stage. |
| F10 | Creative-family approval conflicts with required output review | **Tasks 8, 10** | ☐ | ☐ | — | — | D05/ADR 0057. ADR 0020 and Spec 016 amended by Task 0. |
| F11 | Studio editing split across surfaces | **Task 9** | ☐ | — | — | ☐ | live = authenticated desktop/mobile edit → render → review. |
| F12 | Dispatch selects `direction.assetIds[0]`, not the reviewed poster | **Tasks 8, 10, 13** | ☐ | ☐ | ☐ | ☐ | live blocked by the Meta gate. |
| F13 | Real publishing and collection not activated end to end | **Tasks 12, 13, 16** | ☐ | ☐ | ☐ | ☐ | **BLOCKED** — see section 9. Organic and paid gates are independent. |
| F14 | Local pause is not a provider-confirmed pause | **Task 14** | ☐ | ☐ | ☐ | ☐ | **BLOCKED** — see section 9. ADR 0021 amended by Task 0. |
| F15 | Performance history disappears when approval expires | **Task 11** | ☐ | — | — | ☐ | Historical visibility separated from mutation eligibility. |
| F16 | Clinical investigation not implemented | **Task 15** | ☐ | ☐ | ☐ | ☐ | live needs real outcome evidence, which needs F13. |
| F17 | Business Memory not proved as comprehensive Campaign context | **Tasks 6, 15, 16** | ☐ | ☐ | ☐ | — | Spec 023 Tasks 10/11 are source-only and unapplied (section 5). Content proof, not digest proof. |
| F18 | Presentation dominated by implementation concepts | **Task 11** | ☐ | — | — | ☐ | Exact identities stay in the data model; diagnostics behind disclosure. |

Cross-check against the plan's own "Coverage and delivery order" line: F01/F02 → 1; F03/F04/F05 →
2–3; F06 → 4; F07/F08/F09 → 5–7; F10/F12 → 8/10/13; F11 → 9; F13 → 12/13/16; F14 → 14; F15/F18 → 11;
F16 → 15; F17 → 6/15/16. The table above matches it with no unmapped finding and no invented mapping.

## 9. Blocked activation gates and the exact missing evidence

These are recorded as blocked, with the evidence that is missing named. Code may be written and
merged behind them. Activation may not proceed.

- **Task 12 — Meta provider qualification. BLOCKED.** Missing: current official Meta documentation and
  controlled-account evidence for each desired organic, paid, pause and read capability; an exact
  pinned API/SDK version; account eligibility; granted scopes; formats and limits; billing
  constraints; reconciliation support. The audit's documentation opens returned 429 and safe-open
  failures, which is not reverification. **The contract's `expiresAt = 2026-09-10` must not be
  extended.** Injecting today's date into a fixture or returning guessed platform limits to clear the
  exception is prohibited.
- **Task 13 — organic dispatch canary. BLOCKED.** Missing: a qualified organization-owned Meta
  connection with a credential reference. The audited organization has only a
  `google_business_profile` fixture connection with no credential reference and no Meta connection at
  all. Adapter sandbox and fixture checks may run; the canary may not.
- **Task 14 — confirmed pause canary. BLOCKED.** Missing: a controlled account with a live bounded ad
  to pause and read back, and approved per-organization pause policy values. Paid live dispatch stays
  blocked until this gate passes. Passing the organic gate does not open it.
- **Staging application and worker deployment — BLOCKED** pending the user's decision on the
  all-or-nothing migration push described in section 5.

## 10. Conflicts found between the plan and the repository

- **Duplicate ADR numbers exist.** `adrs/` contains two files numbered 0015
  (`0015-campaign-bundle-system-of-record.md`, `0015-user-scoped-interface-state.md`) and two numbered
  0054 (`0054-ai-sdk-majors-for-search-grounding.md`,
  `0054-business-memory-shared-context-and-governed-capture.md`). This task amended
  `0015-campaign-bundle-system-of-record.md` and `0054-business-memory-shared-context-and-governed-capture.md`,
  which are the ones the brief and the design document mean. The collision is left as found — renaming
  an accepted ADR is a separate decision — but it is recorded here because a future reader citing
  "ADR 0054" is ambiguous.
- **`specs/000-spec-template.md` offers `Draft | Ready | In Progress | Done` as statuses and has no
  `Proposed` value.** Spec 025 uses **Proposed**, matching the vocabulary the brief and the existing
  ADR corpus use, and matching Spec 023's "Draft — approval pending" intent. The template is left
  unchanged.
- **Spec 010 had no `## Status` section.** One was added to carry its amendment; the risk tiers below
  it are untouched.
- **The prototype deliverable is deferred.** The Task 0 brief's second-to-last checkbox
  (`.superdesign/campaign-experience/prototype.html`) is deferred to a later dispatch, Task 0b,
  immediately before the first production UI task, by controller decision R7. It is not built here and
  is not a Task 0 omission.
- **The audit's baseline HEAD `e122d374` has moved.** What the audit inspected as a dirty working tree
  is now committed as `c48a37b`. Findings that cite "the working file has shifted lines" should be
  re-read against `c48a37b`, not against `e122d374`.

## 11. What Task 0 changed

- Created `specs/025-campaign-experience-and-marketing-loop.md` — Proposed.
- Created `adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md` — Proposed.
- Created this record.
- Amended, each with a dated block naming the driving ADR or spec, superseding without deleting:
  ADR 0015, ADR 0017, ADR 0020, ADR 0021, ADR 0049, ADR 0054 (business memory), Spec 005, Spec 010,
  Spec 016, Spec 019, Spec 020, Spec 022, Spec 023.
- Appended an ownership entry to `docs/collaboration/asset-library-and-studio-board.md`.
- No source file, migration, type file or test was changed. No status field moved from unmet to met.
