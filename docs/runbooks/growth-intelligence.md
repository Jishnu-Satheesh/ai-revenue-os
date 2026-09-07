# Growth Intelligence runbook

For the operator on call. The full contract lives in `specs/022-growth-intelligence.md`;
this page answers "what do I do when" with pointer lines, not copies.

## Routine states and what they mean

- **No insights this month.** The evidence has not arrived, not that the
  business has no story. Check Integration Hub freshness, then the Data Gaps
  lane — it names the missing input and its repair surface.
- **A snoozed recommendation.** Hidden until its horizon, for everyone
  (decision snooze) or for one actor (preference snooze). It returns on its
  own; re-snoozing restates intent rather than extending silently.
- **A retryable draft failure.** The worker fell over mid-draft. Ask again
  from the card — the same request requeues, never duplicates.
- **A permanent draft failure.** A prerequisite moved (stale version, changed
  assertions, expired opportunity). Read the failure, repair the evidence,
  and let the next cycle propose again. Do not re-ask the same version.
- **A cancelled request.** The requester withdrew it. Re-asking starts over
  from the current opportunity version.

## Overdue work, expired leases, repeated failures

- **Overdue synthesis or research requests.** `growth_intelligence_requests`
  rows stuck past `due_at` with no run: check Trigger.dev run history for the
  queue, then the worker logs for the claim token. A stuck `processing` row
  whose lease lapsed is reclaimable by the sweeper; do not hand-edit it.
- **Expired draft-request leases.** The worker fenced them with claim tokens;
  a late worker cannot publish over its replacement. If drafts stall in
  `processing` past the lease, inspect `campaign_draft_requests.attempt_count`
  and the worker logs before re-queuing.
- **Repeated adapter or provider failures.** Market research degrades to
  `delayed` with a safe code rather than failing silently. Repeated identical
  codes point at the adapter or the source, never at the evidence — escalate
  to the integration owner with the code and the request id.
- **Cost ceilings.** Draft creation performs no spend and calls no provider;
  any spend-adjacent alert belongs to Campaign approval/execution, not to
  Growth Intelligence. Route it to the campaign runbook.

## Cross-tenant refusal anomalies

- A burst of `42501`/`P0002` refusals on triage, draft, or read paths means
  someone is walking identifiers. The refusals say nothing about what exists;
  confirm the rate, the source, and the account, then revoke the session if
  the walk is hostile. Never "verify" by reading the named row back to them.

## Kill switch and escalation

- **Stop new synthesis:** pause the Growth Intelligence Trigger queue. In-flight
  runs finish their lease; nothing new is claimed.
- **Stop draft creation:** pause the campaign-drafts queue. Admitted requests
  wait in `pending`; no draft is created while paused.
- **Stop all side effects:** both queues paused leaves every surface read-only.
  Reads never start work anywhere in this module.
- Escalate to the platform owner with: organization id, correlation id (every
  response carries `x-correlation-id`), request id, and the exact failure code.
  Screenshots of cards help; pasted workbook contents, credentials, and
  customer data never belong in an escalation.

## What this module never does

- Publish, approve, schedule, or spend. Drafts are internal rows.
- Attribute a result. Only registered Campaign measurement produces an
  effectiveness verdict; planning, snoozing, dismissal, acknowledgement, and
  pins are preference evidence, never outcomes.
