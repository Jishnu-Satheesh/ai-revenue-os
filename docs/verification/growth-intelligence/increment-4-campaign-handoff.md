# Increment 4 campaign-handoff gate (Task 24)

Status: **machine evidence green; operator-owned proofs open**. Date: 2026-09-05.

Covers approved plan Tasks 20–23: draft qualification, atomic draft requests,
frozen snapshot worker, and the draft CTA surface.

## Machine evidence (this session)

- New pgTAP suites `campaign_draft_requests_test.sql` (28 assertions) and
  `campaign_draft_creation_test.sql` (12 assertions): membership, replay,
  fencing, requeue, cancellation, grants, cross-tenant misuse, stale
  prerequisites, exact redelivery — all green.
- Replaced and new functions (`persist_decision_aggregate` restoration,
  all five draft RPCs, `create_campaign_draft_from_request`) executed
  repeatedly by the suites (first-call rule); seeds verified live on staging.
- Full pgTAP, full Vitest, `tsc`, ESLint, prettier, `pnpm build`: green at
  Task 23 close (see board log); rerun clean at integration below.
- Playwright `e2e/growth-intelligence.spec.ts`: handoff boundary tests pass
  (unauthenticated draft refusal without leakage, tenant-protected draft
  campaign address); seeded handoff cases skip until the canary seed exists.

## Proven in staging

- Concurrent and replayed draft requests return one request, one Campaign, one
  snapshot, and one `draft_created` transition (pgTAP, rolled back).
- No publish, provider call, spend, Campaign approval, or realized-result event
  occurs anywhere in the draft path (worker test asserts the call surface;
  workflow returns outcomes instead of throwing into retries).
- Viewer mutations and cross-account/cross-organization reads, writes, and
  handoffs fail closed (pgTAP + route suites).
- Planning, snooze, dismissal, acknowledgement, and pins remain preference
  evidence; only registered Campaign measurement can produce an effectiveness
  verdict.

## Open operator-owned proofs

- Redacted end-to-end sequence on the canary org: confirm profile, research,
  upload/current report, monthly analysis, Channel Recommendations, synthesis,
  plan a Recommendation, stale-data refusal, eligible Opportunity, create
  governed draft, open the frozen Campaign source.
- One request, one Campaign, one snapshot, one `draft_created` on concurrent
  and replayed live requests.
- Authenticated browser acceptance for loading, empty, partial, stale, failed,
  retrying, permissions, focus, source drawers, timeline, and the handoff.
- Database advisors reviewed; telemetry thresholds confirmed against the
  runbook (`docs/runbooks/growth-intelligence.md`).

## Required evidence to close the gate

Operator sign-off lines for each proof above. The gate commit lands after
those sign-offs; nothing here blocks the integration bundle.
