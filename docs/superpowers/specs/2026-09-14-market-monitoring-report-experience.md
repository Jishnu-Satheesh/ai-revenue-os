# Market Monitoring research-and-report experience — reconciled feature spec

Date: 2026-09-14. Status: Approved (Tier 3 authorization granted 2026-09-14).
Authority: Spec 022, ADR 0044, ADR 0047 (Proposed — this spec proposes no ADR 0047 text change yet;
a narrow ADR amendment lands with Slice 2), audit 2026-09-13-market-monitoring-workflow-audit.md,
.superdesign/market-monitoring-experience/{README,brief.md,prototype.html}, Sept 8 design/plan/handoff.
Visual direction approved; architectureAllowances/deployment NOT approved beyond this slice.

## 1. Settled requirements (do not re-ask)

- Several independent research projects coexist at one location.
- Client explicitly chooses one-time or recurring research per project.
- Research produces a report plus draft items for review; nothing enters Recommendations or
  Insights before explicit acceptance.
- Reports open as readable briefs in a dialog with PDF download.
- First version uses simple English.
- Accepted action advice routes to Recommendations; informational findings route to Insights.
- Speculative competitor financial ranges allowed without published figures, only when clearly
  labelled with speculation, assumptions and reasoning. Never presented as observed revenue/profit.

## 2. Lifecycle (binding)

- Starting one project never replaces or cancels another project.
- Pausing monitoring stops future scheduled starts only; current update continues.
- Stopping research cancels the addressed current update only.
- Closing a dialog never cancels background work.
- A failed refresh retains the prior successful report with its date.
- Reports pin exact project, location, brief revision and evidence identity; history entries open
  that exact revision even after later edits.
- Repeated acceptance never duplicates feed items; it reports already-accepted state.
- Accepting research advice never authorizes campaign execution, spending or publication.

## 3. Reconciliation with older documents (authoritative where they conflict)

- Spec 022 §6.2 (one current version per organization) vs §6.4 (independent branch profiles):
  §6.4 governs branch scope; the new Project entity below governs independent lifecycles at one
  location. §6.2 is read as one current profile version per branch scope, not per organization.
  A forward spec correction lands with Slice 2; no silent paragraph-picking.
- Sept 8 branch-profile/pipeline machinery (ADR 0047, Tasks 2–11 committed) is retained as the
  execution substrate. This spec adds the project/report/review product layer on top; it does not
  re-argue branch identity, spend ledgers or the Brave/Gemini boundary.
- Sept 8 topic-tag input (G01) and missing brief dimensions (G09) are superseded by the Brief
  contract below. Sept 8 "Market monitoring" header/dialog naming is superseded by the
  prototype's "New research" action and 3-step Brief → Scope → Review flow where they conflict;
  the header keeps its existing Growth Intelligence placement (no fifth tab).
- Research question answering stays free-text objective + event date (prototype), not topic tags.
  Topics remain as derived investigation areas, never the client's input contract.
- No numeric operating allowance, completion-time promise, or provider purchase is approved here.
  Paid canary runs only inside an explicitly authorized existing allowance.

## 4. Entities

- Research project: org + location/branch anchor, title, question, mode (one-time | recurring),
  schedule (cadence, time/timezone, end date), lifecycle (active, paused, archived).
- Brief revision: immutable per project; question, competitors (name required; website/location
  hint optional; suggestion vs verified-lead labelling), research area, investigation areas
  (demand, presence, offers, reviews, observable performance), evidence periods, business-context
  snapshot id, frequency. Later edits create new revisions for future runs only.
- Research update: one background attempt against a pinned brief revision; progress, coverage,
  cost; terminal states ready / partial / empty / research-failed / synthesis-failed / cancelled.
- Report: saved readable answer per update; summary, local meaning, findings with citations,
  competitor comparison, speculative-estimate block (label + assumptions + reasoning), gaps,
  draft advice, sources; version-bound review state; survives later brief edits.
- Draft item: advice unit with type (action | finding), proposed destination derived by type,
  source-report identity. Acceptance is idempotent per report version + item identity.
- Feed handoff: accepted actions → Recommendations, findings → Insights, each keeping exact
  source-report link; duplicate acceptance returns existing items with an explanation.

## 5. Evidence and AI boundaries

- External evidence only through the qualified Brave path (snippets under explicit
  account storage/reuse rights). Gemini analyzes permitted evidence with its search tools
  disabled for this workflow. Private Business Memory/customer context never enters public
  queries; it informs relevance only and never establishes an external fact.
- All AI/external output validated by explicit Zod schemas. Model text never controls execution
  authority. Speculative ranges never promoted into source-owned facts.
- PDF derives from the same structured report version as the reader. The prototype's fixture
  PDF writer is not the production renderer; production needs a qualified renderer plus
  authorization, storage, download policy and accessibility verification.

## 6. UX contract (frozen reference)

- Immutable reference: prototype.html sha256
  73c7dad4eadea4500912e7b85501a4bc47a0680f2a343bc412edfa9fc2dd4e94 (remote byte-identical),
  draft 5e38b367-f8e0-4707-ba46-5b5be3d65822 version 3. Thirteen walkthrough states in
  .superdesign/market-monitoring-experience (desktop 1440x1100, phone 390x844; plus 320px
  narrow-phone and intermediate widths verified by tester).
- Zero discretionary changes to layout, spacing, typography, color, borders, shadows, radii,
  icons, dialog geometry, sticky regions, tabs, forms, interaction order, responsive behavior,
  report section navigation. Reuse existing components only when pixel-accurate.
- Surrounding Growth Intelligence tabs preserved; shared-component changes only as planned,
  with affected callers verified.
- Production substitutions (structure/geometry preserved): real org identity replaces Example
  Kitchen; real content replaces fiction; demonstration-only labels removed.

## 7. Missing states (proposed treatment, approved in principle — details reviewable in Slice 4)

- Loading: skeleton holds layout shape; no invented figures; dialog footer reachable.
- Empty: named next action per cause (no projects; filter with no match; no report yet).
- Partial results: coverage checklist per requested dimension (supported / unavailable /
  not-found / not-researched) beside the report, not a silent omission.
- Failure: safe reason, retry control, prior successful report retained with date.
- Permission denial: viewer reads authorized reports; start/accept controls hidden with reason;
  direct calls refused and tested.
- Expired/unavailable sources: "Source evidence no longer available" with retained IDs/digests.
- Long content: reader scrolls internally with sticky section index; footer actions persistent;
  no clipped controls at 320px.
- Project management absent from prototype: archive (removes from active list, keeps reports),
  resume paused monitoring (schedules next run, no catch-up rewrite), edit-during-run (saves new
  brief revision for next run; explicit separate stop for active update), history pagination,
  concurrent manual/scheduled start dedup within a project (manual refresh during active run
  opens progress, never duplicates paid work).

## 8. Acceptance criteria (release gates)

- All 8 settled lifecycle behaviors hold under test (independent projects; pause vs stop;
  close-safe; failure retains prior; pinned identity; idempotent acceptance; no exec approval).
- All 13 visual checkpoints pass with zero unexplained differences (ref/app/diff/overlay +
  measurements saved per checkpoint).
- Real journey passes with evidence: browser start → saved project/brief → queued research →
  provider work → extraction/synthesis → persisted report → reader → accepted feed items, with
  org/location/project/report/correlation/Trigger-run ids recorded (no sensitive payloads).
- Reload/retry preserve correct persisted state; cancellation, timeout, partial output, provider
  failure, retry, duplicate delivery and recurring scheduling verified with honest cost/latency.
- Tenant isolation + authorization pass at app and RLS layers (wrong-org, wrong-location
  evidence, read-only start/accept refusal, report/PDF authorization, concurrent starts,
  concurrent acceptance, history links after brief edits).
- PDF and reader preserve same content and provenance from the same structured version.
- Lint, typecheck, unit, integration, pgTAP slice suites and browser checks pass; no blocking
  functional findings; no unexplained visual differences.
- Docs, migrations and ledger match delivered implementation.

## 9. Non-goals

- No redesign of the agreed visual experience. No fifth tab. No Campaign execution, spend,
  scheduling or publication from acceptance. No semantic-similarity dedup engine (exact-match
  idempotency only). No completion-time promises or new paid allowances. No deploy or git push
  without authorization. No repository-wide formatting. No pnpm db:types (hand-maintain types).
  No local Supabase/Docker/database.
