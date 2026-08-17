# Feature Specification: Revenue Opportunity Feed

## Business outcome

Turn analysis into prioritized decisions that an agency operator or client can understand and act on.

## Card content

- Opportunity and affected scope.
- Expected incremental gross-profit **range**, in the organization's currency. The point estimate that drives ranking is never shown without its range.
- Evidence tier — `computed`, `observed`, or `prior` — stated on the card, not in a tooltip.
- Confidence and its rationale.
- Estimated cost and time to impact.
- Why now.
- Required capabilities and missing blockers.
- Risk and approval level.
- Primary metric and guardrails.
- Data freshness.

## Ordering

Per `adrs/0014-decision-value-and-evidence-tiers.md`, the feed sorts by **evidence tier first**, then by expected contribution within the tier, then by time to impact. Tier boundaries are rendered visibly.

Values from different tiers are never blended or compared. A small, certain saving outranks a large, speculative gain, and that is intended: sorting arithmetic and inference into one list would teach the operator that every figure on the card carries the same weight.

`needs_data` decisions do not appear in this feed. They name a missing input and surface in the readiness view of `specs/008-ai-readiness-score.md`.

## Actions

- Approve.
- Edit parameters.
- Reject with reason.
- Request more evidence.
- Snooze until a condition or date.
- Open decision details.

## Acceptance criteria

- Feed is sorted by evidence tier, then expected contribution, then time to impact.
- No card displays a point value without its range or without its evidence tier.
- `needs_data` outcomes never appear in the feed.
- Users cannot approve beyond their permission.
- Editing creates a new plan version.
- Approval is tied to an immutable version.
- Every action on a card — approve, edit, reject, snooze — writes a `DecisionFeedback` row, including the edit diff where the output was modified.
- Rejection reason becomes learning data and suppresses the candidate fingerprint under the rules in `specs/005-decision-engine-v1.md` section 5.9.
- Expired opportunities cannot be executed without reassessment, and reassessment is a new decision rather than a revived row.
