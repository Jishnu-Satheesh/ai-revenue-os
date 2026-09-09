# ADR 0047: Branch-scoped grounded Market Research completes into synthesis

- Status: Proposed
- Date: 2026-09-08
- Related: Spec 022, ADR 0039, ADR 0044

## Context

The Growth Intelligence prototype asks an operator to review market monitoring for a chosen
location, topics, and competitors. The current implementation confirms an organization-wide Market
Profile, enqueues a request with no branch, ignores competitors in its query scope, and uses an
unavailable adapter that persists no Market Evidence Claims. A completed source retrieval also has
no immediate path into synthesis.

Showing **Start market research** over those boundaries would make the interface promise a result
the system does not produce.

## Decision

One operator-started Market Research run binds one active organization branch and one immutable
Market Profile version. Topics and up to five operator-entered competitor leads are part of that
profile. A competitor name is sufficient to form an unverified lead; website and location hint are
optional. User-entered details guide research but never become evidence by assertion.

The qualified adapter uses Gemini Grounding with Google Search and optional URL Context. Grounded
retrieval and strict claim extraction remain separate bounded stages so production correctness does
not depend on the preview combination of built-in tools and structured outputs. Deterministic code
validates citations, source policy, geography, dates, content bounds, support, and persistence.

A completed or partial research run that stores eligible claims enqueues one durable
`market_evidence_changed` request. That request runs the existing governed synthesis path and may
produce cited Insights, Recommendations, and Data Gaps. It never publishes, spends, approves a
Campaign, or treats an operator-entered competitor as verified.

The existing four Growth Intelligence tabs remain. Research outcomes live under **Insights &
market**; derived actions live under **Recommendations** and may appear in Overview's Top
Recommendations.

## Consequences

- Research scope, evidence, and synthesis share exact branch/profile lineage.
- The interface can show meaningful active, partial, completed, empty, and failed states.
- Operator location edits remain research-only and cannot mutate canonical branch data.
- The request vocabulary, dispatcher, worker adapter, profile validation, and UI read model expand.
- A live provider remains disabled until billing, retention, legal/commercial, citation, cost, and
  canary gates pass.
- Existing Market Profile versions remain readable through backward-compatible schema validation;
  database changes are additive and forward-only.

## Rejected alternatives

### Per-request settings outside the Market Profile

This duplicates research scope and weakens the explanation of which settings produced a result.

### A separate branch-monitoring configuration subsystem

This supports several simultaneous saved scopes but adds a new authority and lifecycle that the
approved one-branch-per-run flow does not need.

### Grounded search with preview structured output as one production step

This reduces calls but makes the evidence contract depend on a preview tool combination. Separate
retrieval and validation gives the platform an explicit citation fence.

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
