# Market monitoring and research completion design

## Status and scope

Revised 2026-09-08 after the six-gap review at the user's request. The dialog, branch selector,
five-competitor limit and four-tab placement were approved in chat. The corrections below and
execution plan are proposed for implementation approval. They supersede the earlier Google
Grounding choice; they are not deployed capability.

One production slice: review scope → research → cited findings → analysis → recommendations.
Spec 022 and ADR 0044 remain authoritative for advice and execution; ADR 0047 records this extension.
Performance-metric refresh, recommendation controls and other prototype discrepancies are unchanged.

## Six review resolutions

| Gap and client impact                                | Solution                                                                                                             | Proof required                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Provider terms conflict with reusable saved evidence | Brave Web Search under explicit storage/reuse rights; Gemini analyzes permitted evidence without Google Search tools | Actual account qualification and retention test      |
| Starting Marina can replace Downtown's profile       | Existing profile identity becomes organization + branch; independent versions and cadence                            | Concurrent A/B start and A-only replacement          |
| “Done” appears before recommendations                | Durable pipeline spans research and synthesis                                                                        | Delayed synthesis keeps “Preparing insights” visible |
| Crash loses handoff to analysis                      | Complete research and create the unique synthesis child in one database transaction                                  | Crash, replay and sweeper recovery                   |
| Analysis ignores the selected branch                 | Exact branch, profile, source and period carried through loaders and persistence                                     | Conflicting A/B sales fixture, direct-RPC denial     |
| Cost and coverage are promises without enforcement   | Fixed query slots, per-input coverage, atomic spend reservations, bounded attempts                                   | Maximum-input and concurrent-budget tests            |

## User experience

- Header: **Market monitoring** with Lucide Settings2. Header and Market Watch open one
  **Review market monitoring** dialog. Remove the large inline profile-review block above tabs.
- Business name and descriptor are read-only. **Location** is a single-select active-branch
  dropdown, showing branch name and saved service area where available. Initial selection follows
  the page's selected branch, otherwise the only active branch. With several branches, require
  selection; never silently choose the first.
- For the selected branch, prefill its latest undecided proposal, then active settings, then
  confirmed branch/onboarding context. Legacy organization proposals are labelled draft suggestions;
  never transfer one city's context to every branch.
- Topics: 1–20 unique editable tags, at most 160 characters each. Competitors: 0–5 rows, required
  name (160 characters), optional public website (2,048 characters), optional location hint
  (240 characters). Normalize whitespace/case for duplicates; preserve display text.
- Name-only competitors are **Unverified leads**. A website is context, not identity verification.
  AI suggestions still need cited relevance; an operator lead cannot itself support a claim.
- Missing business website is permitted. No active branch blocks Start with an explanation; do not
  invent a branch for a branchless organization.
- Missing geography: the inspected branch API creates branches; an existing branch-location editor
  has not been established. Remove the previous promised repair link. When needed, show a
  conditional **Confirm research area** group with service area, city and country inputs.
  Prefill confirmed values; label it “Used for research; does not change your business location.”
  These complete the selected branch's research snapshot only. Require all three geographic layers.
  Never infer a city from timezone or reuse shared onboarding locality for unrelated branches.
- **Start market research** is the single review confirmation. One atomic server operation saves
  or reuses the reviewed version, records confirmation and creates or returns the pipeline/request.
  Failure rolls back the start and preserves typed inputs for retry.
- Pending AI proposals offer **Reject proposal**; otherwise **Cancel**. Viewers inspect only.
  Editing, rejection, start and retry require managing permission.
- Switching branches with dirty inputs requires an inline discard/cancel choice. Background refresh
  cannot overwrite edits.
- Identical active scope returns its existing pipeline and disables Start as **Research in progress**.
  Changed scope replaces unfinished work for that branch only. After a terminal outcome, unchanged
  settings may start a new run while reusing the same immutable version.
- Keep the last successful result for that branch visible during replacement/failure, labelled with
  its date and “Earlier research settings” where applicable. Never use another branch as fallback.

## Branch profile identity and compatibility

Add nullable branch_id to organization_market_profiles with a composite organization/branch foreign
key. Replace unique organization with two partial unique indexes: organization where branch is null,
and organization + branch where branch is present. Each profile owns its current version, enabled
state and cadence. Reuse this authority rather than create a separate settings subsystem.

Preserve existing organization profiles, v1 documents, IDs, digests, decisions, requests and evidence.
Null branch means legacy organization scope. New branch starts write MarketProfileDocumentV2:
schemaVersion 2, one trade area bound to the profile branch, explicit city/country, existing
policy/cadence fields, competitor provenance operator_lead or cited and optional locationHint.
Cited competitors require evidence URLs; operator leads may have none. Freeze v1 validation and
canonicalization. A union parser reads both versions; reject geography references outside the
snapshot. Never rewrite an old v1 document to obtain v2 behavior.

A new start RPC receives expectedCurrentVersionId (nullable). Under the branch-profile lock,
identical active scope returns that pipeline; otherwise stale expected version conflicts and the
form retains edits. Canonical location changes do not silently revise confirmed research settings.

The start idempotency key binds organization, actor and body digest. Same key/body replays; a
different body conflicts. Different keys across browsers still converge on identical active scope
under the profile lock. One active pipeline per organization/branch. Deliberate later runs receive
new pipeline/request IDs, not duplicate profile versions.

Every consumer selects an exact profile/version, exact branch, or explicit legacy-null scope.
Replace organization-only maybeSingle reads in profile-repository and Trigger composition. Scheduling
enumerates enabled profiles with independent local cadence and branch. Starting one branch does not
disable another or legacy monitoring. Legacy results remain labelled organization scope and cannot
masquerade as branch measurements.

## Provider decision and retention

Use **Brave Web Search** with an account agreement explicitly permitting storage of metadata and
bounded snippets, commercial inference through Gemini, organization-member display, derived claims,
later synthesis reuse and agreed retention. An ordinary subscription is not assumed to grant these
rights. Google Search grounding and URL Context are excluded; Gemini remains a paid analysis model.

Qualification records must identify product, agreement/version/date, permitted uses, retention and
deletion rules, data handling, pricing version, credential readiness, model and canary result.
Missing/expired qualification disables Start with a safe explanation. Do not silently fall back to
Google Grounding or the unavailable Exa adapter.

Initial retrieval uses search metadata and snippets only; it does not crawl returned URLs. Search
rights do not grant publisher page rights. Label snippet evidence as such. If snippets cannot support
a claim, show the limitation rather than fetch unqualified page content. Full-page retrieval requires
a later approved extension.

Persist only permitted metadata, bounded excerpts/spans, source digests and claim provenance.
No raw API bodies, full pages, Search Suggestions HTML or hidden reasoning. Each excerpt records its
qualification and retain-until policy. Require survival rights for non-content audit IDs/digests.
A privileged audited retention path removes payloads when required, withdraws their eligibility and
shows “Source evidence no longer available.” Remove derived text too where the obligation covers it;
retain decisions, IDs and safe deletion events. This requires a narrow documented erasure exception
to append-only content, not unrestricted evidence editing.

Sources checked 2026-09-08:

- [Google Gemini API terms](https://ai.google.dev/gemini-api/terms): automated collection, reuse,
  storage and display restrictions make the earlier permanent evidence design unsuitable under
  standard Grounding terms. This is our design compatibility assessment.
- [Brave Search API](https://brave.com/search/api/): storage needs an explicitly qualifying plan;
  third-party page rights are separate.
- [Brave API terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service):
  ordinary restrictions and termination deletion must be reconciled by the actual order form.
  The public product page alone does not qualify this application's account.

## Coverage and spend controls

Deterministic query plan: one business/local-market query, one per topic and one per competitor.
Maximum 26 primary queries (1 + 20 + 5). Every topic gets a query. Approved name, locality and country
constrain each query; competitor website/location are context, not instructions or proof.

Persist a coverage manifest for every topic, competitor and local-market slot:
not_started, searched_no_usable_evidence, supported, failed, skipped_budget or skipped_policy.
Link entries to attempts and accepted claims. Count searched inputs separately from supported ones.
Label broader geographic context; it cannot become measured branch demand.

Initial proposed server limits:

- 26 primary searches plus 2 transient-error retries across the entire run: 28 total attempts.
  Retries reuse their slot and budget. No automatic retry after ambiguous timeout.
- 5 results per query; 512 KiB per response, 8 MiB total streamed bytes; deduplicate to 40 sources,
  2,000 characters per excerpt, 64 KiB total retained excerpt text.
- Search API endpoint allowlist, zero redirects, 20-second call timeout, at most 2 simultaneous
  searches, 8-minute research deadline within the 10-minute request lease.
- Extraction: up to 4 batches of 10 sources, 12,000 input / 4,000 output tokens each.
  Support review: same batch/token bounds. Synthesis: at most 2 calls including one explicit retry,
  each with 24,000 input / 6,000 output tokens.
  Disable hidden SDK retries. Bound all billable reasoning/output tokens as well.
- Whole-pipeline reservation ceiling: 1,000,000 micros USD (USD 1). Organization daily allowance:
  5,000,000 micros USD (USD 5), shared across manual, scheduled and recovery work in its local day.
  These conservative launch defaults are part of this proposed design, not a customer result claim.

Compute the full worst-case quote using the contracted search rate and pinned model prices. Refuse
before any paid call if the complete plan cannot fit; do not silently trim inputs. A model without
enforceable billable bounds cannot qualify. Reserve pipeline allowance against the organization's
daily ledger atomically; debit each attempt's worst-case amount from that reservation before its
external call. Replays and lease retries inherit consumed attempts and budget.

Standalone weekly/business-evidence synthesis and legacy paid research reserve against the same
organization-day ledger using their immutable request ID as work scope, rather than inventing a
branch pipeline. Their bounded quote is also capped at USD 1. All newly enabled paid paths must
use this admission boundary; otherwise the shared daily ceiling would be misleading.

Store reported usage and price-derived estimates separately from reservations. Missing usage is
unknown, never zero. Ambiguous timeout retains its reservation pending reconciliation. Record actual
overcharges without clamping and stop new calls. The limit governs app-issued work, not a guarantee
about a provider invoice. Mid-run exhaustion yields explicit partial coverage. Policy changes are
server-controlled; workers cannot enlarge limits.

## Claim extraction and branch business evidence

Gemini receives bounded permitted excerpts, citation IDs and approved public scope with tools
disabled. Treat excerpts and operator text as untrusted. Strict schemas reject unknown references.
Validate offsets against exact stored spans, dates, geographic refs, safe public HTTP(S) URLs,
exclusions, freshness and lengths.

A separate bounded support review labels candidates supported, unsupported or uncertain against
their cited span. This judgment is not deterministic proof of truth. Deterministic admission accepts
only schema-valid eligible supported candidates; ambiguous competitor identity stays unverified.
Conflicting sources remain visible limitations; a valid URL alone is not supporting evidence.

Carry exact branch, profile version and research run into synthesis. channel_findings.branch_id
already exists: filter it directly, and load analysis_run_id, period, currency, units and current/
supersession state. Require analysis-run and finding scope agreement. Use current governed findings
with compatible windows; retain actual periods and coverage. Do not add overlapping windows or mix
currencies/units into invented totals. Missing branch findings produces a business-data gap.

Organization-wide findings may be separately labelled context, never branch measurements. Other
named branches are excluded. Enforce scope and eligible support again in persistence RPCs for
sources, claims, links and synthesized items. Existing deterministic ranking, support grading,
Opportunity admission and realized-result requirements remain authoritative.

## Pipeline lifecycle and atomic handoff

Add growth_intelligence_research_pipelines as a lifecycle envelope: organization, branch,
profile/version, scope digest, root request, child request, stage, coverage, timestamps, safe reason.
Profiles remain settings authority; existing requests remain work/lease authority. Only fenced
database transitions may change the pipeline.

Keep request statuses pending/claimed/succeeded/failed/cancelled and research-run statuses
running/completed/partial/failed. Do not confuse either with product display labels.

| Stage              | Display                                   | Meaning                                            |
| ------------------ | ----------------------------------------- | -------------------------------------------------- |
| queued             | Queued                                    | Root durably saved                                 |
| researching        | Researching                               | Root lease acquired                                |
| preparing_insights | Preparing insights                        | Evidence saved; child queued/claimed               |
| ready              | Ready                                     | Synthesis and items persisted                      |
| partial            | Ready with limitations                    | Usable output; incomplete coverage                 |
| no_findings        | No usable findings                        | No eligible claims; no child                       |
| research_failed    | Research could not finish                 | Earlier results retained                           |
| synthesis_failed   | Research saved; insights could not finish | Findings available; retry analysis only            |
| cancelled          | Replaced or cancelled                     | Authorized cancellation or same-branch replacement |

After fenced evidence recording, one completion RPC locks run/request/pipeline, checks current
branch/profile, lease and eligible persisted claims, then in one transaction:

- completes the research run and sets its request to succeeded;
- inserts the unique market_evidence_changed child with market_research_completed trigger reason,
  exact branch/profile and pipeline lineage;
- sets preparing_insights with child ID, or no_findings with an explicit reason when zero eligible
  claims remain;
- records audit events and settles known usage, retaining unknown reservations.

No network call in the transaction. Existing due-request sweeping is the durable outbox; immediate
Trigger wake is optional. Crash after commit leaves a pending child; crash before commit leaves
recoverable research. Replay returns the same child. Expired/stale tokens and conflicting outcomes
cannot mutate success. Legacy completion RPCs must reject pipeline-bound runs to prevent bypass.

Synthesis items, child completion and terminal pipeline state likewise settle atomically. A successful
analysis may produce no recommendation: explain why without manufacturing advice. A partial research
run carries limitations into synthesis and ends partial. Retry analysis reclaims the same failed
child through a governed retry RPC after scope/freshness/budget checks; never refetch research.
One explicit synthesis retry is included in the two-call quote. Consumed limits remain consumed.
If allowance is exhausted, a new explicit run is required
when budget is available. Stale evidence requires new research.

Route market_evidence_changed, business_evidence_changed and weekly_synthesis to the synthesis
worker. Keep market_research/evidence_reassessment on research routing. Consolidation stays separately
exercised maintenance, not a substitute for weekly synthesis. Update due scheduling and report-current
callers for exact profile/branch scope while preventing duplicate legacy dispatch.

## Display and observation

No fifth tab:

- **Insights & market**: stage, branch, settings/time, searched/supported coverage, source count,
  findings, competitors, gaps, history and citations. Research evidence appears while preparing
  insights and remains available after synthesis failure.
- **Recommendations**: research actions labelled **From market research**, linked to exact
  supporting outcomes. Explain zero recommendations.
- **Overview**: existing Top Recommendations ordering, preview and More link.
- **Your actions**: one named start and terminal event per transition; label retries, no invented
  percentage or duplicate events.

Status reads are authenticated and RLS-backed. Observe the whole pipeline every 5 seconds in active
stages; back off errors to 30 seconds, pause hidden/offline, immediately recheck on return. A read
error means “Status unavailable,” not research failure. Return observedAt and stageChangedAt.
Refresh research views on preparing_insights and once per terminal transition. Do not stop at root
success. Include organization, branch and pipeline in query keys. Remount loads authoritative state
and same-branch history. Sweeper recovers/terminalizes expired work. Keep the performance metrics'
existing fetch timestamp and manual refresh behavior.

## Schema, authorization and audit

- Branch indexes and v2 validator; v1 compatibility wrappers. New atomic start RPC; legacy
  proposal/decision routes remain available for explicit null scope.
- Pipeline table and request lineage columns; composite tenant foreign keys; one active pipeline
  per branch and one child per pipeline/phase.
- Private spend reservation and attempt ledgers with unique attempt keys and reconciliation events.
  Browser cannot access credentials or private ledgers.
- Evidence qualification/retention and excerpt/support-review provenance; narrowly granted audited
  payload erasure. Retain safe history, not content whose rights expired.
- API and RPC enforce growth_intelligence.read for reads and growth_intelligence.manage for user
  mutations. No service-role user route. Branch must be active and same-organization at start.
- Fixed search paths, explicit grants/tenant checks, worker lease fencing, RLS on exposed tables and
  narrow manual database.types.ts edits.
- Safe audit events: growth_intelligence.research_started, research_prepared, research_finished,
  research_retried (all with the growth_intelligence prefix). Preserve existing profile/request
  events. Logs contain identifiers, timing, safe counts and codes, not provider payloads.

## Verification, release and rollback

[Execution plan](../plans/2026-09-08-market-monitoring-research-completion.md).

Verify Task 13 hosted-staging state before building. Preserve unrelated dirty changes. Only reviewed
forward migrations; no local Supabase/Docker or broken local type generation. Exercise new PL/pgSQL
paths on staging with two tenants, two branches, lease expiry and concurrency.

Prove all six resolutions, v1 digest compatibility, full/partial/empty/failed outcomes, payload
erasure, wrong-scope refusal, accessible responsive modal and pipeline status refresh. Successful
Trigger task status alone does not prove usable output.

Release behind Market/Synthesis organization flags and qualified-adapter switch. Synthetic tests
precede a budgeted staging canary with an actual qualified account. The canary must prove eligible
persisted citations, linked synthesis, visible outcomes, reconciled cost and coverage. Missing
account rights/configuration is a release blocker; documentation work does not purchase services,
contact providers or perform paid canaries.

Rollback disables new starts/calls and new dispatch, lets bounded leased work settle, and retains
lawful history. Do not deploy old singleton-profile readers after branch rows exist: use a
forward-compatible flags-off release. Retention obligations continue during rollback.
