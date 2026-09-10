# ADR 0047: Branch-scoped Market Research with durable synthesis

- Status: Proposed — revised after design review; implementation approval pending
- Date: 2026-09-08
- Related: Spec 022, ADR 0039, ADR 0044
- Design: [Market monitoring](../docs/superpowers/specs/2026-09-08-market-monitoring-research-completion-design.md)

## Context

The approved dialog lets an operator research one branch, topics and up to five competitor leads.
Current profiles have one organization-wide current version; confirming another scope cancels prior
work. The adapter is unavailable, claims are not extracted, and research completion does not durably
hand off to branch-fenced synthesis. A modal alone would promise an outcome the system cannot deliver.

Review also found that the earlier Google Search grounding proposal conflicts with the durable,
organization-shared evidence use described here under the standard published terms.

## Decision

Extend the existing Market Profile identity to organization + branch, retaining an explicit legacy
null-branch identity. Each branch has independent immutable versions and cadence. New branch starts
use a v2 document; old v1 digests and validation remain unchanged. One atomic start operation saves
the reviewed scope, records confirmation and starts or returns an identical active pipeline.

Use Brave Web Search only under account-specific storage, commercial inference, display and reuse
rights. Gemini analyzes bounded permitted snippets with search tools disabled. Publicly advertised
storage plans establish a qualification path, not permission for our account. No returned-page
crawling is included. Provider qualification and audited content-retention handling are release
requirements. See the design's dated official sources and exact required agreement scope.

Add a research-pipeline lifecycle envelope over existing leased requests. Research success is not
pipeline success: queued → researching → preparing_insights → ready, with distinct partial, empty,
research-failed, synthesis-failed and cancelled outcomes. Completing research and creating its unique
market_evidence_changed synthesis child occur in one fenced database transaction. Existing request
sweeping recovers lost dispatch. Synthesis persistence and pipeline completion also settle atomically.

Carry branch, exact profile/version, research lineage and business-evidence periods through reads,
support validation and writes. Other named branches never enter branch analysis. Organization-wide
context is explicitly labelled and never becomes a branch measurement.

Deterministic query slots cover every topic and competitor. Persist searched and supported coverage
separately. Reserve spend against per-pipeline and organization-day budgets before external calls,
including retries. Record unknown, estimated and reported cost distinctly; never clamp actual cost.

Keep the four tabs. Research outcomes live in Insights & market, derived actions in Recommendations
and the existing Overview preview. The UI observes pipeline state through synthesis completion.
The platform never publishes, spends business budgets, approves Campaigns or treats an operator
competitor lead as verified through this research flow.

## Consequences and tradeoffs

- Independent branch monitoring requires auditing every singleton-profile reader and scheduler.
- A lifecycle envelope and private spend ledgers add state, but do not duplicate settings authority.
- v1 history stays intact; v2 handles operator-lead provenance and branch-specific geography.
- Snippet-only retrieval can yield less evidence than full-page retrieval; show that limitation.
- Source spans enable review, but citation validation cannot prove factual truth. A bounded support
  review and deterministic admission enforce the evidence contract.
- Retention requires narrowly authorized payload erasure, extending append-only evidence rules only
  where rights require deletion. Safe audit records survive.
- Actual provider agreement, pricing/model configuration and a live canary remain external release
  prerequisites. Flags-off rollback must remain compatible with multiple branch profiles.

## Rejected alternatives

- One organization profile plus branch_id on requests: another branch still replaces its settings.
- An unrelated branch-settings subsystem: duplicates existing profile authority; extend it instead.
- Google Search Grounding as a reusable evidence database: standard storage/reuse/display terms do
  not fit this design. Do not bypass the conflict by discarding Search Suggestions.
- Separate research-complete and enqueue calls: a process crash can lose synthesis permanently.
- Poll only the research request: the user sees completion before insights arrive.
- Model-controlled search counts and cost defaults: cannot enforce coverage or application spend.
- Two browser mutations to propose then confirm: recoverable, but unnecessary for this new entry
  point; retain legacy APIs and use one atomic reviewed start for the dialog.

## Verification (2026-09-09, market-monitoring Task 12)

The decision above is implemented (Tasks 2–11) and verified to the extent fixtures allow:
migrations paired on staging, every new PL/pgSQL path executed via pgTAP (11/12 slice suites
green), e2e boundary tests proving the routes refuse strangers (8 passed, 12 seeded scenarios
skip). Status stays Proposed: provider qualification is blocked (no Brave key, no Gemini
rate/model qualification), no paid canary ran, and the seeded-browser research flow never
executed — so new starts stay gated and no production readiness is claimed. Two slice-attributed
findings remain open: `pnpm lint` reports 9 errors in slice files (workflow restricted-import and
react-hooks rules Tasks 7/8/11 never ran), and pgTAP `growth_intelligence_item_decisions` test 25
fails because the Task 5 retention rewrite renamed the DELETE refusal string. See the Task 12
report for commands, outputs, and the remaining release acceptance.
